import fnmatch
import json
import secrets
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
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
        raise ValueError("Company not found")
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
        raise GitHubIntegrationAccessDeniedError("You are not a member of this company")
    if manage and not current_user.is_company_owner and member.role != "owner":
        raise GitHubIntegrationManageDeniedError("Only organization owners can manage GitHub integrations")
    return company


def _normalize_repo_value(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        raise ValueError("Repository owner and name are required")
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
        raise ValueError("Mapped project must belong to the integration company")
    for member_id in [default_author_member_id, default_reviewer_member_id]:
        if member_id is None:
            continue
        member = db.get(CompanyMemberORM, member_id)
        if member is None or member.company_id != integration.company_id:
            raise ValueError("Default author/reviewer must belong to the integration company")
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


def ingest_github_event(
    db: Session,
    *,
    integration_id: int,
    delivery_id: str,
    event_type: str,
    payload: dict,
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

    try:
        note_id = generate_note_from_github_event(db, event.id, generation_type="automatic")
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


def get_generated_note_id(db: Session, event_id: int) -> str | None:
    generated = db.scalar(select(GitHubGeneratedNoteORM).where(GitHubGeneratedNoteORM.event_id == event_id))
    return generated.note_id if generated else None


def _resolve_author_reviewer(
    db: Session,
    *,
    mapping: GitHubProjectMappingORM,
) -> tuple[int, int | None]:
    project = db.get(ProjectORM, mapping.project_id)
    if project is None:
        raise ValueError("Mapped project not found")
    author_member_id = mapping.default_author_member_id or project.owner_member_id
    if author_member_id is None:
        member = db.scalar(
            select(CompanyMemberORM)
            .where(CompanyMemberORM.company_id == project.company_id)
            .order_by(CompanyMemberORM.id.asc())
        )
        author_member_id = member.id if member else None
    if author_member_id is None:
        raise ValueError("No default author member is available for this mapping")
    reviewer_member_id = mapping.default_reviewer_member_id or project.owner_member_id
    return author_member_id, reviewer_member_id


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
    if event.event_type == "push":
        branch = _event_branch("push", payload) or "branch"
        message = payload.get("head_commit", {}).get("message") or "Push update"
        first_line = str(message).splitlines()[0]
        return f"[GitHub] Push to {branch}: {first_line}"[:255]
    return "[GitHub] Repository event"[:255]


def _build_note_body(event: GitHubEventORM, payload: dict) -> str:
    repo = payload.get("repository", {})
    repo_name = repo.get("full_name") or ""
    lines = [
        "GitHub Event Summary",
        f"- Repository: {repo_name}",
        f"- Event: {event.event_type}",
        f"- Action: {event.action or '-'}",
        f"- Source: {event.source_url or '-'}",
        "",
    ]
    if event.event_type == "pull_request":
        pr = payload.get("pull_request", {})
        user = pr.get("user", {})
        merged_by = pr.get("merged_by") or {}
        lines.extend(
            [
                f"PR #{pr.get('number')}: {pr.get('title') or ''}",
                f"- Author: {user.get('login') or '-'}",
                f"- Merged by: {merged_by.get('login') or '-'}",
                f"- Base branch: {pr.get('base', {}).get('ref') or '-'}",
                f"- Head branch: {pr.get('head', {}).get('ref') or '-'}",
                f"- Commits: {pr.get('commits') or 0}",
                f"- Changed files: {pr.get('changed_files') or 0}",
                "",
                "PR Body",
                str(pr.get("body") or "-"),
            ]
        )
    elif event.event_type == "push":
        commits = payload.get("commits") or []
        lines.extend(
            [
                f"Branch: {_event_branch('push', payload) or '-'}",
                f"Commit count: {len(commits)}",
                "",
                "Commits",
            ]
        )
        for commit in commits[:20]:
            lines.append(f"- {str(commit.get('id') or '')[:7]} {commit.get('message') or ''}")
    return "\n".join(lines)


def _text_block(block_id: str, x: int, y: int, w: int, h: int, content: str, font_size: int = 14) -> dict:
    return {
        "id": block_id,
        "type": "text",
        "x": x,
        "y": y,
        "w": w,
        "h": h,
        "locked": False,
        "content": content,
        "style": {"fontSize": font_size, "fontWeight": "normal", "textAlign": "left"},
    }


def _build_document_payload(note: ResearchNoteORM, body: str) -> dict:
    return {
        "schemaVersion": 1,
        "id": f"draft-{note.id}",
        "title": f"{note.title} Layout",
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
            _text_block("github-title", 34, 34, 720, 42, note.title, font_size=16),
            _text_block("github-summary", 34, 88, 720, 820, body, font_size=12),
        ],
    }


def generate_note_from_github_event(
    db: Session,
    event_id: int,
    *,
    generation_type: str = "manual",
    current_user: UserAccount | None = None,
) -> str:
    event = db.get(GitHubEventORM, event_id)
    if event is None:
        raise GitHubIntegrationNotFoundError(event_id)

    existing = db.scalar(select(GitHubGeneratedNoteORM).where(GitHubGeneratedNoteORM.event_id == event_id))
    if existing is not None:
        return existing.note_id

    integration = db.get(GitHubRepositoryIntegrationORM, event.integration_id)
    mapping = db.get(GitHubProjectMappingORM, event.project_mapping_id) if event.project_mapping_id else None
    if integration is None or mapping is None:
        raise ValueError("Event is not mapped to a project")
    if current_user is not None:
        _require_company_access(db, company_id=integration.company_id, current_user=current_user)

    payload = json.loads(event.payload_json)
    author_member_id, reviewer_member_id = _resolve_author_reviewer(db, mapping=mapping)
    actor_user_id = current_user.id if current_user and current_user.id else _event_actor_user_id(db, integration, author_member_id)
    note = ResearchNoteORM(
        project_id=mapping.project_id,
        title=_build_note_title(event, payload),
        content=_build_note_body(event, payload),
        status="draft",
        owner_member_id=author_member_id,
        written_date=date.today(),
        reviewer_member_id=reviewer_member_id,
        reviewed_date=None,
        last_updated_by=actor_user_id,
    )
    db.add(note)
    db.flush()

    document_payload = _build_document_payload(note, note.content or "")
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
        change_summary="Generated from GitHub event",
    )
    db.add(revision)
    db.flush()
    document.current_revision_id = revision.id
    generated = GitHubGeneratedNoteORM(event_id=event.id, note_id=note.id, generation_type=generation_type)
    db.add(generated)
    event.status = "processed"
    event.processed_at = datetime.now(timezone.utc)
    event.error_message = None
    db.commit()
    return note.id
