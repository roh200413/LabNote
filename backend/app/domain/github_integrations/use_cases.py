import fnmatch
import json
import secrets
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.audit.note_log import record_note_event
from app.domain.accounts.entities import UserAccount
from app.domain.github_integrations import change_analysis
from app.infrastructure.github.client import GitHubApiError, GitHubClient, get_github_client
from app.domain.note_formats.page_fit import (
    LINE_HEIGHT,
    MIN_FONT_SIZE,
    char_budget,
    fit_font_size,
    text_height,
)
from app.infrastructure.db.models import (
    CompanyMemberORM,
    CompanyORM,
    GitHubEventORM,
    GitHubGeneratedNoteORM,
    GitHubProjectMappingORM,
    GitHubRepositoryIntegrationORM,
    ProjectORM,
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
    ResearchNoteORM,
    UserAccountORM,
)


class GitHubIntegrationNotFoundError(Exception):
    pass


class GitHubIntegrationAccessDeniedError(Exception):
    pass


class GitHubIntegrationManageDeniedError(Exception):
    pass


class GitHubWebhookVerificationError(Exception):
    pass


def _get_company(db: Session, company_id: int) -> CompanyORM:
    company = db.get(CompanyORM, company_id)
    if company is None:
        raise ValueError("기관을 찾을 수 없습니다")
    return company


def _get_company_member(db: Session, *, user_id: int, company_id: int) -> CompanyMemberORM | None:
    return db.scalar(
        select(CompanyMemberORM).where(
            CompanyMemberORM.user_id == user_id,
            CompanyMemberORM.company_id == company_id,
        )
    )


def _require_company_access(
    db: Session,
    *,
    company_id: int,
    current_user: UserAccount,
    manage: bool = False,
) -> CompanyORM:
    company = _get_company(db, company_id)
    if current_user.is_system_admin:
        return company

    member = _get_company_member(db, user_id=current_user.id or 0, company_id=company_id)
    if member is None:
        raise GitHubIntegrationAccessDeniedError("이 기관의 구성원이 아닙니다")
    if manage and not current_user.is_company_owner and member.role != "owner":
        raise GitHubIntegrationManageDeniedError("GitHub 연동은 기관 관리자만 관리할 수 있습니다")
    return company


def _normalize_repo_value(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("저장소 소유자와 이름을 입력하세요")
    return normalized


def _repository_url(repo_owner: str, repo_name: str, repository_url: str | None) -> str:
    if repository_url and repository_url.strip():
        return repository_url.strip()
    return f"https://github.com/{repo_owner}/{repo_name}"


def generate_webhook_secret() -> str:
    return secrets.token_urlsafe(32)


def list_github_integrations(
    db: Session,
    current_user: UserAccount,
    *,
    company_id: int | None = None,
) -> list[GitHubRepositoryIntegrationORM]:
    stmt = select(GitHubRepositoryIntegrationORM)
    if company_id is not None:
        _require_company_access(db, company_id=company_id, current_user=current_user)
        stmt = stmt.where(GitHubRepositoryIntegrationORM.company_id == company_id)
    elif not current_user.is_system_admin:
        company_ids = [
            member.company_id
            for member in db.scalars(
                select(CompanyMemberORM).where(CompanyMemberORM.user_id == (current_user.id or 0))
            ).all()
        ]
        if not company_ids:
            return []
        stmt = stmt.where(GitHubRepositoryIntegrationORM.company_id.in_(company_ids))

    return list(db.scalars(stmt.order_by(GitHubRepositoryIntegrationORM.created_at.desc())).all())


def get_github_integration(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
) -> GitHubRepositoryIntegrationORM:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(integration_id)
    _require_company_access(db, company_id=integration.company_id, current_user=current_user)
    return integration


def create_github_integration(
    db: Session,
    current_user: UserAccount,
    *,
    company_id: int,
    repo_owner: str,
    repo_name: str,
    repository_url: str | None = None,
    default_branch: str | None = "main",
    status: str = "active",
    notes: str | None = None,
) -> GitHubRepositoryIntegrationORM:
    _require_company_access(db, company_id=company_id, current_user=current_user, manage=True)
    owner = _normalize_repo_value(repo_owner)
    name = _normalize_repo_value(repo_name)
    integration = GitHubRepositoryIntegrationORM(
        company_id=company_id,
        created_by=current_user.id,
        repo_owner=owner,
        repo_name=name,
        repository_url=_repository_url(owner, name, repository_url),
        default_branch=(default_branch or "main").strip() or "main",
        webhook_secret=generate_webhook_secret(),
        status=status,
        notes=notes,
    )
    db.add(integration)
    db.commit()
    db.refresh(integration)
    return integration


def update_github_integration(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
    **kwargs,
) -> GitHubRepositoryIntegrationORM:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(integration_id)
    _require_company_access(db, company_id=integration.company_id, current_user=current_user, manage=True)

    if "repo_owner" in kwargs and kwargs["repo_owner"] is not None:
        integration.repo_owner = _normalize_repo_value(kwargs["repo_owner"])
    if "repo_name" in kwargs and kwargs["repo_name"] is not None:
        integration.repo_name = _normalize_repo_value(kwargs["repo_name"])
    if "repository_url" in kwargs:
        integration.repository_url = _repository_url(
            integration.repo_owner,
            integration.repo_name,
            kwargs["repository_url"],
        )
    if "default_branch" in kwargs:
        value = kwargs["default_branch"]
        integration.default_branch = (value or "main").strip() or "main"
    if "status" in kwargs and kwargs["status"] is not None:
        integration.status = kwargs["status"]
    if "notes" in kwargs:
        integration.notes = kwargs["notes"]

    if not integration.repository_url:
        integration.repository_url = _repository_url(integration.repo_owner, integration.repo_name, None)
    db.commit()
    db.refresh(integration)
    return integration


def delete_github_integration(db: Session, integration_id: int, current_user: UserAccount) -> None:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(integration_id)
    _require_company_access(db, company_id=integration.company_id, current_user=current_user, manage=True)
    db.delete(integration)
    db.commit()


def rotate_github_webhook_secret(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
) -> GitHubRepositoryIntegrationORM:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(integration_id)
    _require_company_access(db, company_id=integration.company_id, current_user=current_user, manage=True)
    integration.webhook_secret = generate_webhook_secret()
    db.commit()
    db.refresh(integration)
    return integration


def _get_integration_for_manage(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
) -> GitHubRepositoryIntegrationORM:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(integration_id)
    _require_company_access(db, company_id=integration.company_id, current_user=current_user, manage=True)
    return integration


def _validate_mapping_project(
    db: Session,
    *,
    integration: GitHubRepositoryIntegrationORM,
    project_id: str,
    default_author_member_id: int | None,
    default_reviewer_member_id: int | None,
) -> ProjectORM:
    project = db.get(ProjectORM, project_id)
    if project is None or project.company_id != integration.company_id:
        raise ValueError("매핑할 프로젝트는 연동된 기관 소속이어야 합니다")
    for member_id in [default_author_member_id, default_reviewer_member_id]:
        if member_id is None:
            continue
        member = db.get(CompanyMemberORM, member_id)
        if member is None or member.company_id != integration.company_id:
            raise ValueError("기본 작성자와 검토자는 연동된 기관 소속이어야 합니다")
    return project


def list_project_mappings(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
) -> list[GitHubProjectMappingORM]:
    integration = get_github_integration(db, integration_id, current_user)
    return list(
        db.scalars(
            select(GitHubProjectMappingORM)
            .where(GitHubProjectMappingORM.integration_id == integration.id)
            .order_by(GitHubProjectMappingORM.created_at.desc(), GitHubProjectMappingORM.id.desc())
        ).all()
    )


def create_project_mapping(
    db: Session,
    integration_id: int,
    current_user: UserAccount,
    *,
    project_id: str,
    branch_pattern: str | None = None,
    path_pattern: str | None = None,
    note_creation_mode: str = "pr_merge",
    default_author_member_id: int | None = None,
    default_reviewer_member_id: int | None = None,
    is_active: bool = True,
) -> GitHubProjectMappingORM:
    integration = _get_integration_for_manage(db, integration_id, current_user)
    _validate_mapping_project(
        db,
        integration=integration,
        project_id=project_id,
        default_author_member_id=default_author_member_id,
        default_reviewer_member_id=default_reviewer_member_id,
    )
    mapping = GitHubProjectMappingORM(
        integration_id=integration_id,
        project_id=project_id,
        branch_pattern=(branch_pattern or integration.default_branch or "*").strip() or "*",
        path_pattern=(path_pattern or "").strip() or None,
        note_creation_mode=note_creation_mode,
        default_author_member_id=default_author_member_id,
        default_reviewer_member_id=default_reviewer_member_id,
        is_active=is_active,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    return mapping


def update_project_mapping(
    db: Session,
    mapping_id: int,
    current_user: UserAccount,
    **kwargs,
) -> GitHubProjectMappingORM:
    mapping = db.get(GitHubProjectMappingORM, mapping_id)
    if mapping is None:
        raise GitHubIntegrationNotFoundError(mapping_id)
    integration = _get_integration_for_manage(db, mapping.integration_id, current_user)
    project_id = kwargs.get("project_id", mapping.project_id)
    author_member_id = kwargs.get("default_author_member_id", mapping.default_author_member_id)
    reviewer_member_id = kwargs.get("default_reviewer_member_id", mapping.default_reviewer_member_id)
    _validate_mapping_project(
        db,
        integration=integration,
        project_id=project_id,
        default_author_member_id=author_member_id,
        default_reviewer_member_id=reviewer_member_id,
    )
    for key, value in kwargs.items():
        setattr(mapping, key, value)
    if mapping.branch_pattern is not None:
        mapping.branch_pattern = mapping.branch_pattern.strip() or "*"
    if mapping.path_pattern is not None:
        mapping.path_pattern = mapping.path_pattern.strip() or None
    db.commit()
    db.refresh(mapping)
    return mapping


def delete_project_mapping(db: Session, mapping_id: int, current_user: UserAccount) -> None:
    mapping = db.get(GitHubProjectMappingORM, mapping_id)
    if mapping is None:
        raise GitHubIntegrationNotFoundError(mapping_id)
    _get_integration_for_manage(db, mapping.integration_id, current_user)
    db.delete(mapping)
    db.commit()


def _event_branch(event_type: str, payload: dict) -> str | None:
    if event_type == "pull_request":
        return payload.get("pull_request", {}).get("base", {}).get("ref")
    if event_type == "push":
        ref = payload.get("ref")
        if isinstance(ref, str) and ref.startswith("refs/heads/"):
            return ref.removeprefix("refs/heads/")
        return ref
    return None


def _find_mapping_for_event(
    db: Session,
    *,
    integration_id: int,
    event_type: str,
    payload: dict,
) -> GitHubProjectMappingORM | None:
    branch = _event_branch(event_type, payload)
    mappings = db.scalars(
        select(GitHubProjectMappingORM)
        .where(GitHubProjectMappingORM.integration_id == integration_id, GitHubProjectMappingORM.is_active.is_(True))
        .order_by(GitHubProjectMappingORM.id.asc())
    ).all()
    for mapping in mappings:
        pattern = mapping.branch_pattern or "*"
        if branch is None or fnmatch.fnmatch(branch, pattern):
            return mapping
    return None


def _github_event_id(event_type: str, payload: dict, delivery_id: str) -> str:
    if event_type == "pull_request":
        pr = payload.get("pull_request", {})
        return str(pr.get("id") or pr.get("node_id") or delivery_id)
    if event_type == "push":
        return str(payload.get("after") or delivery_id)
    if event_type == "release":
        release = payload.get("release", {})
        return str(release.get("id") or release.get("node_id") or delivery_id)
    return delivery_id


def _source_url(event_type: str, payload: dict) -> str | None:
    if event_type == "pull_request":
        return payload.get("pull_request", {}).get("html_url")
    if event_type == "push":
        return payload.get("compare") or payload.get("repository", {}).get("html_url")
    if event_type == "release":
        return payload.get("release", {}).get("html_url")
    return payload.get("repository", {}).get("html_url")


def _should_auto_generate(event: GitHubEventORM, mapping: GitHubProjectMappingORM | None, payload: dict) -> bool:
    if mapping is None or mapping.note_creation_mode == "manual":
        return False
    if event.event_type == "pull_request" and mapping.note_creation_mode == "pr_merge":
        pr = payload.get("pull_request", {})
        return event.action == "closed" and bool(pr.get("merged"))
    if event.event_type == "push" and mapping.note_creation_mode == "every_push":
        return True
    return False


_executor = None


def _dispatch_generation(event_id: int, client: GitHubClient | None) -> None:
    """Writes the note on a worker thread: GitHub waits only ~10s for a webhook response."""
    global _executor
    from concurrent.futures import ThreadPoolExecutor

    if _executor is None:
        _executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="labnote-github-notes")
    _executor.submit(run_event_generation, event_id, client)


def run_event_generation(event_id: int, client: GitHubClient | None = None) -> None:
    from app.infrastructure.db.session import SessionLocal

    with SessionLocal() as db:
        try:
            generate_note_from_github_event(db, event_id, generation_type="automatic", client=client)
        except Exception as exc:  # noqa: BLE001 - record any failure on the event
            db.rollback()
            event = db.get(GitHubEventORM, event_id)
            if event is not None:
                event.status = "failed"
                event.error_message = str(exc)[:500]
                event.processed_at = datetime.now(timezone.utc)
                db.commit()


def ingest_github_event(
    db: Session,
    *,
    integration_id: int,
    delivery_id: str,
    event_type: str,
    payload: dict,
    client: GitHubClient | None = None,
    background: bool = True,
) -> tuple[GitHubEventORM, str | None]:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None or integration.status != "active":
        raise GitHubIntegrationNotFoundError(integration_id)

    existing = db.scalar(
        select(GitHubEventORM).where(
            GitHubEventORM.integration_id == integration_id,
            GitHubEventORM.delivery_id == delivery_id,
        )
    )
    if existing is not None:
        generated = db.scalar(select(GitHubGeneratedNoteORM).where(GitHubGeneratedNoteORM.event_id == existing.id))
        return existing, generated.note_id if generated else None

    mapping = _find_mapping_for_event(db, integration_id=integration_id, event_type=event_type, payload=payload)
    action = payload.get("action")
    event = GitHubEventORM(
        integration_id=integration_id,
        project_mapping_id=mapping.id if mapping else None,
        project_id=mapping.project_id if mapping else None,
        delivery_id=delivery_id,
        github_event_id=_github_event_id(event_type, payload, delivery_id),
        event_type=event_type,
        action=str(action) if action is not None else None,
        source_url=_source_url(event_type, payload),
        payload_json=json.dumps(payload, ensure_ascii=False),
        status="pending" if mapping else "ignored",
        error_message=None if mapping else "No active project mapping matched this event",
    )
    db.add(event)
    db.commit()
    db.refresh(event)

    if not _should_auto_generate(event, mapping, payload):
        if event.status == "pending":
            event.status = "ignored"
            event.error_message = "Stored event; note creation policy did not auto-generate"
            db.commit()
            db.refresh(event)
        return event, None

    if background and ai_explanation_available(db, integration):
        event.status = "processing"
        event.error_message = None
        db.commit()
        db.refresh(event)
        _dispatch_generation(event.id, client)
        return event, None

    try:
        note_id = generate_note_from_github_event(db, event.id, generation_type="automatic", client=client)
        db.refresh(event)
        return event, note_id
    except Exception as exc:
        event.status = "failed"
        event.error_message = str(exc)
        event.processed_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(event)
        return event, None


def list_github_events(
    db: Session,
    current_user: UserAccount,
    *,
    integration_id: int | None = None,
    project_id: str | None = None,
    status: str | None = None,
) -> list[GitHubEventORM]:
    stmt = select(GitHubEventORM)
    if integration_id is not None:
        integration = get_github_integration(db, integration_id, current_user)
        stmt = stmt.where(GitHubEventORM.integration_id == integration.id)
    elif not current_user.is_system_admin:
        company_ids = [
            member.company_id
            for member in db.scalars(
                select(CompanyMemberORM).where(CompanyMemberORM.user_id == (current_user.id or 0))
            ).all()
        ]
        if not company_ids:
            return []
        integration_ids = select(GitHubRepositoryIntegrationORM.id).where(
            GitHubRepositoryIntegrationORM.company_id.in_(company_ids)
        )
        stmt = stmt.where(GitHubEventORM.integration_id.in_(integration_ids))
    if project_id is not None:
        stmt = stmt.where(GitHubEventORM.project_id == project_id)
    if status is not None:
        stmt = stmt.where(GitHubEventORM.status == status)
    return list(db.scalars(stmt.order_by(GitHubEventORM.created_at.desc(), GitHubEventORM.id.desc())).all())


def _live_generated_note(db: Session, event_id: int) -> GitHubGeneratedNoteORM | None:
    """The note made from this event; a link to a note that was since deleted is dropped so it can be made again."""
    generated = db.scalar(select(GitHubGeneratedNoteORM).where(GitHubGeneratedNoteORM.event_id == event_id))
    if generated is None:
        return None
    note = db.get(ResearchNoteORM, generated.note_id)
    if note is None or note.is_deleted:
        db.delete(generated)
        db.flush()
        return None
    return generated


def get_generated_note_id(db: Session, event_id: int) -> str | None:
    generated = _live_generated_note(db, event_id)
    return generated.note_id if generated else None


def _resolve_author_reviewer(
    db: Session,
    *,
    mapping: GitHubProjectMappingORM,
) -> tuple[int, int | None]:
    project = db.get(ProjectORM, mapping.project_id)
    if project is None:
        raise ValueError("매핑된 프로젝트를 찾을 수 없습니다")
    author_member_id = mapping.default_author_member_id or project.owner_member_id
    if author_member_id is None:
        member = db.scalar(
            select(CompanyMemberORM)
            .where(CompanyMemberORM.company_id == project.company_id)
            .order_by(CompanyMemberORM.id.asc())
        )
        author_member_id = member.id if member else None
    if author_member_id is None:
        raise ValueError("이 매핑에 사용할 기본 작성자가 없습니다")
    reviewer_member_id = mapping.default_reviewer_member_id or project.owner_member_id
    return author_member_id, reviewer_member_id


def _event_github_logins(event_type: str, payload: dict) -> list[str]:
    """GitHub logins of the people who did the work, most specific first."""
    candidates: list[object] = []
    if event_type == "pull_request":
        pr = payload.get("pull_request") or {}
        candidates += [(pr.get("user") or {}).get("login"), (pr.get("merged_by") or {}).get("login")]
    elif event_type == "push":
        head = payload.get("head_commit") or {}
        candidates += [(head.get("author") or {}).get("username"), (head.get("committer") or {}).get("username")]
        candidates.append((payload.get("pusher") or {}).get("name"))
    candidates.append((payload.get("sender") or {}).get("login"))
    logins: list[str] = []
    for value in candidates:
        if isinstance(value, str) and value.strip() and value.strip().lower() not in logins:
            logins.append(value.strip().lower())
    return logins


def _member_for_github_login(db: Session, project: ProjectORM, logins: list[str]) -> int | None:
    """The project member whose linked GitHub account made the change, if any."""
    from sqlalchemy import func

    from app.infrastructure.db.models import GitHubUserIdentityORM, ProjectMemberORM

    for login in logins:
        identity = db.scalar(select(GitHubUserIdentityORM).where(func.lower(GitHubUserIdentityORM.login) == login))
        if identity is None:
            continue
        member = db.scalar(
            select(CompanyMemberORM).where(
                CompanyMemberORM.user_id == identity.user_id, CompanyMemberORM.company_id == project.company_id
            )
        )
        if member is None:
            continue
        in_project = project.owner_member_id == member.id or db.scalar(
            select(ProjectMemberORM.id).where(
                ProjectMemberORM.project_id == project.id, ProjectMemberORM.company_member_id == member.id
            )
        )
        if in_project:
            return member.id
    return None


def _event_actor_user_id(db: Session, integration: GitHubRepositoryIntegrationORM, author_member_id: int) -> int | None:
    if integration.created_by is not None and db.get(UserAccountORM, integration.created_by) is not None:
        return integration.created_by
    author_member = db.get(CompanyMemberORM, author_member_id)
    return author_member.user_id if author_member else None


def _build_note_title(event: GitHubEventORM, payload: dict) -> str:
    if event.event_type == "pull_request":
        pr = payload.get("pull_request", {})
        number = pr.get("number")
        title = pr.get("title") or "Merged pull request"
        return f"[GitHub] PR #{number}: {title}"[:255]
    if event.event_type == "push" and event.action == "commit":
        commit = payload.get("head_commit", {})
        first_line = str(commit.get("message") or "").splitlines()[0] if commit.get("message") else ""
        return f"[GitHub] 커밋 {str(commit.get('id') or '')[:7]}: {first_line}"[:255]
    if event.event_type == "push":
        branch = _event_branch("push", payload) or "branch"
        message = payload.get("head_commit", {}).get("message") or "Push update"
        first_line = str(message).splitlines()[0]
        return f"[GitHub] Push to {branch}: {first_line}"[:255]
    return "[GitHub] Repository event"[:255]


def _build_note_body(event: GitHubEventORM, payload: dict) -> str:
    """Plain record of the change. The first block (up to the blank line) is the header kept above an AI explanation."""
    repo_name = (payload.get("repository") or {}).get("full_name") or "-"
    if event.event_type == "pull_request":
        pr = payload.get("pull_request") or {}
        lines = [
            f"- 저장소: {repo_name}",
            f"- PR: #{pr.get('number')} ({(pr.get('head') or {}).get('ref') or '-'} → {(pr.get('base') or {}).get('ref') or '-'})",
            f"- 작성자: {(pr.get('user') or {}).get('login') or '-'} · 병합: {(pr.get('merged_by') or {}).get('login') or '-'}",
            f"- 링크: {event.source_url or '-'}",
            "",
            f"커밋 {pr.get('commits') or 0}개 · 변경 파일 {pr.get('changed_files') or 0}개",
            "",
            "PR 설명",
            str(pr.get("body") or "").strip() or "-",
        ]
        return "\n".join(lines)
    if event.event_type == "push":
        commits = payload.get("commits") or []
        head = payload.get("head_commit") or {}
        branch = _event_branch("push", payload) or "-"
        head_author = head.get("author") or {}
        author = head_author.get("name") or head_author.get("username") or "-"
        if event.action == "commit" or len(commits) <= 1:
            commit = head or (commits[0] if commits else {})
            lines = [
                f"- 저장소: {repo_name} ({branch})",
                f"- 커밋: {str(commit.get('id') or '')[:7]} · 작성자 {author}",
                f"- 링크: {event.source_url or commit.get('url') or '-'}",
                "",
                "커밋 메시지",
                str(commit.get("message") or "").strip() or "-",
            ]
            return "\n".join(lines)
        lines = [
            f"- 저장소: {repo_name} ({branch})",
            f"- 커밋 {len(commits)}개 · 마지막 작성자 {author}",
            f"- 링크: {event.source_url or '-'}",
            "",
            "커밋 목록",
        ]
        for commit in commits[:20]:
            first_line = (str(commit.get("message") or "").strip().splitlines() or [""])[0]
            lines.append(f"- {str(commit.get('id') or '')[:7]} {first_line}")
        return "\n".join(lines)
    return "\n".join([f"- 저장소: {repo_name}", f"- 이벤트: {event.event_type}", f"- 링크: {event.source_url or '-'}"])


def _summary_header(summary: str) -> str:
    return summary.split("\n\n", 1)[0]


BODY_FONT_SIZE = 12


def _body_box(fmt) -> tuple[int, int]:
    """Width and height of the single text block a GitHub note is written into."""
    return 726, fmt.content_bottom - fmt.content_top - 12


def _build_document_payload(db: Session, note: ResearchNoteORM, body: str) -> dict:
    """One free text block in the note format's content area; the format's header already shows the title.

    The note is one A4 page, so the font shrinks (12 → 9pt) until the text fits the block.
    """
    from app.domain.note_formats.use_cases import get_note_format_for_note

    fmt = get_note_format_for_note(db, note)
    top, bottom = fmt.content_top, fmt.content_bottom
    width, height = _body_box(fmt)
    font_size = fit_font_size(body, width, height, start=BODY_FONT_SIZE) or MIN_FONT_SIZE
    return {
        "schemaVersion": 1,
        "id": f"draft-{note.id}",
        "title": note.title,
        "page": {
            "width": 794,
            "height": 1123,
            "background": "#ffffff",
            "backgroundImage": None,
        },
        "meta": {
            "noteId": note.id,
            "sourceFileId": None,
            "sourcePageId": None,
        },
        "blocks": [
            {
                "id": "github-body",
                "type": "text",
                "x": 34,
                "y": top + 6,
                "w": 726,
                "h": bottom - top - 12,
                "locked": False,
                "content": body,
                "style": {"fontSize": font_size, "fontWeight": "normal", "textAlign": "left"},
            }
        ],
    }


def build_change_generator(db: Session, company_id: int):
    """The organization's LLM client, or None when AI is not set up. Replaced in tests."""
    from app.domain.research_notes.note_generation import NoteGenerationUnavailableError
    from app.infrastructure.llm.connections import resolve_settings
    from app.infrastructure.llm.openai_note_generator import OpenAINoteGenerator

    try:
        settings = resolve_settings(db, company_id)
    except NoteGenerationUnavailableError:
        return None
    if settings is None:
        return None
    try:
        return OpenAINoteGenerator(settings)
    except ImportError:
        return None


def _company_token(db: Session, company_id: int, client: GitHubClient | None = None) -> str | None:
    from app.domain.github_integrations.connections import GitHubAccountNotConnectedError, account_token

    try:
        return account_token(db, company_id, client)
    except GitHubAccountNotConnectedError:
        return None


def ai_explanation_available(db: Session, integration: GitHubRepositoryIntegrationORM) -> bool:
    """Whether a note for this integration can explain the diff (GitHub connection + LLM connection)."""
    from app.domain.github_integrations.connections import account_connected

    if not account_connected(db, integration.company_id):
        return False
    generator = build_change_generator(db, integration.company_id)
    if generator is None:
        return False
    close = getattr(generator, "close", None)
    if callable(close):
        close()
    return True


def _explain_event(
    db: Session,
    integration: GitHubRepositoryIntegrationORM,
    event: GitHubEventORM,
    payload: dict,
    client: GitHubClient | None,
) -> tuple[str | None, str, str | None]:
    """(note text, status message, model). Text is None when the AI explanation could not be made."""
    from app.domain.note_formats.use_cases import get_company_note_format
    from app.domain.research_notes.note_generation import NoteGenerationFailedError

    if event.event_type not in {"push", "pull_request"}:
        return None, "코드 변경을 설명할 수 없는 이벤트", None
    try:
        token = _company_token(db, integration.company_id, client)
    except GitHubApiError as exc:
        return None, f"GitHub 접근 실패: {exc}", None
    if token is None:
        return None, "GitHub 계정이 연결되지 않아 코드 변경을 읽지 못함", None
    generator = build_change_generator(db, integration.company_id)
    if generator is None:
        return None, "AI(LLM) 연결이 없어 커밋 정보만 기록함", None
    try:
        changes = change_analysis.collect_changes(
            client or get_github_client(),
            token,
            owner=integration.repo_owner,
            repo=integration.repo_name,
            event_type=event.event_type,
            payload=payload,
        )
        note_format = get_company_note_format(db, integration.company_id)
        sections = [(section.title, section.guide) for section in note_format.sections]
        project = db.get(ProjectORM, event.project_id) if event.project_id else None
        context = f"{project.name}\n{project.description or ''}" if project else ""
        appendix = change_analysis.change_appendix(changes)
        # The AI text shares the page with the header lines and this appendix.
        width, height = _body_box(note_format)
        reserved = text_height(appendix, width, BODY_FONT_SIZE) + 6 * BODY_FONT_SIZE * LINE_HEIGHT
        budget = max(400, char_budget(width, height - reserved, BODY_FONT_SIZE))
        generated = change_analysis.explain_changes(
            generator, changes, sections, project_context=context, max_chars=budget
        )
    except (GitHubApiError, NoteGenerationFailedError, ValueError) as exc:
        return None, f"AI 설명 실패: {exc}", None
    finally:
        close = getattr(generator, "close", None)
        if callable(close):
            close()
    text = "\n\n".join([generated.as_text(), appendix])
    return text, f"AI 코드 변경 설명 ({generated.model})", generated.model


def generate_note_from_github_event(
    db: Session,
    event_id: int,
    *,
    generation_type: str = "manual",
    current_user: UserAccount | None = None,
    client: GitHubClient | None = None,
) -> str:
    event = db.get(GitHubEventORM, event_id)
    if event is None:
        raise GitHubIntegrationNotFoundError(event_id)

    existing = _live_generated_note(db, event_id)
    if existing is not None:
        return existing.note_id

    integration = db.get(GitHubRepositoryIntegrationORM, event.integration_id)
    mapping = db.get(GitHubProjectMappingORM, event.project_mapping_id) if event.project_mapping_id else None
    if integration is None or mapping is None:
        raise ValueError("이 이벤트는 프로젝트에 매핑되지 않았습니다")
    if current_user is not None:
        _require_company_access(db, company_id=integration.company_id, current_user=current_user)

    payload = json.loads(event.payload_json)
    author_member_id, reviewer_member_id = _resolve_author_reviewer(db, mapping=mapping)
    project = db.get(ProjectORM, mapping.project_id)
    credited_member_id = _member_for_github_login(db, project, _event_github_logins(event.event_type, payload)) if project else None
    if credited_member_id is not None:
        author_member_id = credited_member_id
    actor_user_id = current_user.id if current_user and current_user.id else _event_actor_user_id(db, integration, author_member_id)
    ai_text, generation_message, ai_model = _explain_event(db, integration, event, payload, client)
    summary = _build_note_body(event, payload)
    # With an AI explanation, keep only the summary's header: the appendix lists commits and files.
    content = f"{_summary_header(summary)}\n\n{ai_text}" if ai_text else f"{summary}\n\n※ {generation_message}"
    note = ResearchNoteORM(
        project_id=mapping.project_id,
        title=_build_note_title(event, payload),
        content=content,
        status="draft",
        owner_member_id=author_member_id,
        written_date=date.today(),
        reviewer_member_id=reviewer_member_id,
        reviewed_date=None,
        last_updated_by=actor_user_id,
        bundle_id=mapping.bundle_id,
    )
    db.add(note)
    db.flush()
    record_note_event(db, note=note, actor_user_id=actor_user_id, action="note_create", source="github")

    document_payload = _build_document_payload(db, note, note.content or "")
    payload_json = json.dumps(document_payload, ensure_ascii=False)
    document = ResearchNoteDocumentORM(
        note_id=note.id,
        title=document_payload["title"],
        status="draft",
        schema_version=1,
        source_file_id=None,
        source_page_id=None,
        document_payload=payload_json,
    )
    db.add(document)
    db.flush()
    revision = ResearchNoteDocumentRevisionORM(
        document_id=document.id,
        revision_no=1,
        payload_json=payload_json,
        created_by=actor_user_id,
        change_summary=f"Generated from GitHub event; {generation_message}"[:255],
    )
    db.add(revision)
    db.flush()
    document.current_revision_id = revision.id
    generated = GitHubGeneratedNoteORM(
        event_id=event.id,
        note_id=note.id,
        generation_type=generation_type,
        review_required=ai_text is not None,
        ai_model=ai_model,
    )
    db.add(generated)
    event.status = "processed"
    event.processed_at = datetime.now(timezone.utc)
    event.error_message = None
    db.commit()
    return note.id
