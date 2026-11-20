"""GitHub account connection (company level) and repository links (project level).

The company owner connects one GitHub account from the main GitHub page. Inside a project,
the project lead or company owner picks repositories from that account and links them to the
project; each link is a ``GitHubProjectMappingORM`` on a shared per-repository integration.
"""

import json
from datetime import datetime, timezone
from urllib.parse import urlencode

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.github_integrations.use_cases import (
    GitHubIntegrationAccessDeniedError,
    GitHubIntegrationManageDeniedError,
    GitHubIntegrationNotFoundError,
    ai_explanation_available,
    generate_note_from_github_event,
    generate_webhook_secret,
    get_generated_note_id,
)
from app.infrastructure.db.models import (
    CompanyMemberORM,
    GitHubAccountConnectionORM,
    GitHubEventORM,
    GitHubProjectMappingORM,
    GitHubRepositoryIntegrationORM,
    GitHubUserIdentityORM,
    ProjectMemberORM,
    ProjectORM,
)
from app.core.config import get_settings
from app.domain.research_notes.bundles import require_bundle_in_project
from app.infrastructure.github import app_auth
from app.infrastructure.github.client import GitHubApiError, GitHubClient, GitHubRepository, get_github_client
from app.infrastructure.llm.connections import decrypt_secret, encrypt_secret

NOTE_CREATION_MODES = {"pr_merge", "manual", "every_push"}


class GitHubAccountNotConnectedError(Exception):
    pass


# ─── Access helpers ──────────────────────────────────────────────────────


def _primary_membership(db: Session, user: UserAccount) -> CompanyMemberORM | None:
    return db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == (user.id or 0)).order_by(CompanyMemberORM.id.asc())
    )


def _require_company(db: Session, user: UserAccount, *, manage: bool) -> int:
    membership = _primary_membership(db, user)
    if membership is None:
        raise GitHubIntegrationAccessDeniedError("소속된 기관이 없습니다")
    if manage and membership.role != "owner" and not user.is_system_admin:
        raise GitHubIntegrationManageDeniedError("GitHub 계정 연동은 기관 관리자만 바꿀 수 있습니다")
    return membership.company_id


def _project_access(db: Session, user: UserAccount, project_id: str) -> tuple[ProjectORM, bool]:
    """Returns (project, can_manage). Members of the project can view; its lead or the company owner manage."""
    project = db.get(ProjectORM, project_id)
    if project is None:
        raise GitHubIntegrationNotFoundError(project_id)
    if user.is_system_admin:
        return project, True
    member = db.scalar(
        select(CompanyMemberORM).where(
            CompanyMemberORM.user_id == (user.id or 0), CompanyMemberORM.company_id == project.company_id
        )
    )
    if member is None:
        raise GitHubIntegrationAccessDeniedError("이 기관의 구성원이 아닙니다")
    if member.role == "owner":
        return project, True
    in_project = db.scalar(
        select(ProjectMemberORM.id).where(
            ProjectMemberORM.project_id == project.id, ProjectMemberORM.company_member_id == member.id
        )
    )
    if in_project is None:
        raise GitHubIntegrationAccessDeniedError("프로젝트 참여자만 볼 수 있습니다")
    return project, project.owner_member_id == member.id


def _require_project_manage(db: Session, user: UserAccount, project_id: str) -> ProjectORM:
    project, can_manage = _project_access(db, user, project_id)
    if not can_manage:
        raise GitHubIntegrationManageDeniedError("프로젝트 책임자나 기관 관리자만 저장소 연결을 바꿀 수 있습니다")
    return project


# ─── Company account ─────────────────────────────────────────────────────


def _account_row(db: Session, company_id: int) -> GitHubAccountConnectionORM | None:
    return db.get(GitHubAccountConnectionORM, company_id)


def account_connected(db: Session, company_id: int) -> bool:
    return _account_row(db, company_id) is not None


def account_token(db: Session, company_id: int, client: GitHubClient | None = None) -> str:
    """The token to call GitHub with for this organization: a fresh App installation token, or the stored PAT."""
    row = _account_row(db, company_id)
    if row is None:
        raise GitHubAccountNotConnectedError("먼저 메인 화면의 GitHub 연동에서 계정을 연결하세요")
    if row.auth_type == "app":
        if not row.installation_id:
            raise GitHubAccountNotConnectedError("GitHub App 설치 정보가 없습니다. 다시 설치하세요")
        try:
            return app_auth.installation_token(client or get_github_client(), row.installation_id)
        except app_auth.GitHubAppNotConfiguredError as exc:
            raise GitHubAccountNotConnectedError("서버에 GitHub App 설정이 없어 App 연결을 쓸 수 없습니다") from exc
    return decrypt_secret(row.encrypted_token)


def _is_app(db: Session, company_id: int) -> bool:
    row = _account_row(db, company_id)
    return row is not None and row.auth_type == "app"


def _installation_manage_url(row: GitHubAccountConnectionORM) -> str | None:
    if row.auth_type != "app" or not row.installation_id:
        return None
    base = app_auth.web_base_url()
    if (row.account_type or "").lower() == "organization":
        return f"{base}/organizations/{row.login}/settings/installations/{row.installation_id}"
    return f"{base}/settings/installations/{row.installation_id}"


def _account_summary(row: GitHubAccountConnectionORM | None) -> dict:
    if row is None:
        return {"connected": False}
    return {
        "connected": True,
        "auth_type": row.auth_type or "token",
        "account_type": row.account_type,
        "login": row.login,
        "display_name": row.display_name,
        "avatar_url": row.avatar_url,
        "profile_url": row.profile_url,
        "scopes": row.scopes,
        "manage_url": _installation_manage_url(row),
        "connected_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _identity_summary(db: Session, user: UserAccount) -> dict:
    identity = db.get(GitHubUserIdentityORM, user.id or 0)
    if identity is None:
        return {"linked": False}
    return {
        "linked": True,
        "login": identity.login,
        "avatar_url": identity.avatar_url,
        "profile_url": identity.profile_url,
        "linked_at": identity.linked_at.isoformat() if identity.linked_at else None,
    }


def get_account(db: Session, user: UserAccount) -> dict:
    company_id = _require_company(db, user, manage=False)
    membership = _primary_membership(db, user)
    links = db.execute(
        select(GitHubProjectMappingORM, GitHubRepositoryIntegrationORM, ProjectORM)
        .join(GitHubRepositoryIntegrationORM, GitHubRepositoryIntegrationORM.id == GitHubProjectMappingORM.integration_id)
        .join(ProjectORM, ProjectORM.id == GitHubProjectMappingORM.project_id)
        .where(GitHubRepositoryIntegrationORM.company_id == company_id)
        .order_by(ProjectORM.name.asc())
    ).all()
    return {
        **_account_summary(_account_row(db, company_id)),
        "can_manage": bool(user.is_system_admin or (membership and membership.role == "owner")),
        "app_available": app_auth.app_configured(),
        "app_slug": get_settings().github_app_slug.strip() or None,
        "user_login_available": app_auth.user_login_configured(),
        "me": _identity_summary(db, user),
        "linked_repositories": [
            {
                "mapping_id": mapping.id,
                "project_id": project.id,
                "project_name": project.name,
                "repo_full_name": f"{integration.repo_owner}/{integration.repo_name}",
                "repository_url": integration.repository_url,
                "is_active": mapping.is_active,
            }
            for mapping, integration, project in links
        ],
    }


def connect_account(db: Session, user: UserAccount, *, token: str, client: GitHubClient) -> dict:
    company_id = _require_company(db, user, manage=True)
    token = token.strip()
    if not token:
        raise ValueError("GitHub 토큰을 입력하세요")
    viewer = client.get_viewer(token)  # raises GitHubApiError for a bad token
    row = _account_row(db, company_id)
    if row is None:
        row = GitHubAccountConnectionORM(company_id=company_id, login=viewer.login, encrypted_token="")
        db.add(row)
    row.login = viewer.login
    row.display_name = viewer.name
    row.avatar_url = viewer.avatar_url
    row.profile_url = viewer.profile_url
    row.scopes = viewer.scopes
    row.encrypted_token = encrypt_secret(token)
    row.connected_by = user.id
    row.auth_type = "token"
    row.installation_id = None
    row.account_type = None
    row.updated_at = datetime.now().astimezone()
    db.commit()
    return get_account(db, user)


def disconnect_account(db: Session, user: UserAccount) -> None:
    company_id = _require_company(db, user, manage=True)
    row = _account_row(db, company_id)
    if row is not None:
        if row.installation_id:
            app_auth.forget_installation(row.installation_id)
        db.delete(row)
        db.commit()


# ─── GitHub App installation ─────────────────────────────────────────────


def app_install_url(db: Session, user: UserAccount) -> str:
    company_id = _require_company(db, user, manage=True)
    if not app_auth.app_configured():
        raise ValueError("서버에 GitHub App이 설정되지 않았습니다. 관리자에게 GITHUB_APP_* 설정을 요청하세요")
    state = app_auth.sign_state("install", c=company_id, u=user.id)
    return f"{app_auth.web_base_url()}/apps/{get_settings().github_app_slug.strip()}/installations/new?{urlencode({'state': state})}"


def complete_app_installation(
    db: Session, user: UserAccount, *, installation_id: int, state: str, client: GitHubClient
) -> dict:
    """Called when GitHub sends the browser back after the App was installed on an account."""
    company_id = _require_company(db, user, manage=True)
    values = app_auth.verify_state(state, "install")
    if values.get("c") != company_id or values.get("u") != user.id:
        raise app_auth.InvalidStateError("다른 사용자나 기관에서 시작한 설치 요청입니다. 처음부터 다시 시도하세요")
    try:
        installation = client.get_app_installation(app_auth.create_app_jwt(), installation_id)
    except app_auth.GitHubAppNotConfiguredError as exc:
        raise ValueError(str(exc)) from exc
    account = installation.get("account") or {}
    login = account.get("login")
    if not login:
        raise ValueError("GitHub App 설치 정보를 읽지 못했습니다")
    taken = db.scalar(
        select(GitHubAccountConnectionORM).where(
            GitHubAccountConnectionORM.installation_id == installation_id,
            GitHubAccountConnectionORM.company_id != company_id,
        )
    )
    if taken is not None:
        raise ValueError("이 GitHub App 설치는 이미 다른 기관에 연결되어 있습니다")
    row = _account_row(db, company_id)
    if row is None:
        row = GitHubAccountConnectionORM(company_id=company_id, login=login, encrypted_token="")
        db.add(row)
    row.auth_type = "app"
    row.installation_id = installation_id
    row.account_type = account.get("type")
    row.login = login
    row.display_name = account.get("name")
    row.avatar_url = account.get("avatar_url")
    row.profile_url = account.get("html_url")
    selection = installation.get("repository_selection")
    row.scopes = "선택한 저장소만" if selection == "selected" else "모든 저장소" if selection == "all" else None
    row.encrypted_token = ""
    row.connected_by = user.id
    row.updated_at = datetime.now().astimezone()
    db.commit()
    app_auth.forget_installation(installation_id)
    return get_account(db, user)


def companies_for_installation(db: Session, installation_id: int) -> list[int]:
    return list(
        db.scalars(
            select(GitHubAccountConnectionORM.company_id).where(
                GitHubAccountConnectionORM.auth_type == "app",
                GitHubAccountConnectionORM.installation_id == installation_id,
            )
        ).all()
    )


def remove_installation(db: Session, installation_id: int) -> int:
    """The App was uninstalled on GitHub: drop the organizations' connection to it."""
    rows = db.scalars(
        select(GitHubAccountConnectionORM).where(GitHubAccountConnectionORM.installation_id == installation_id)
    ).all()
    for row in rows:
        db.delete(row)
    db.commit()
    app_auth.forget_installation(installation_id)
    return len(rows)


# ─── Each user's own GitHub login ────────────────────────────────────────


def user_link_url(db: Session, user: UserAccount) -> str:
    if not app_auth.user_login_configured():
        raise ValueError("서버에 GitHub 로그인(GITHUB_APP_CLIENT_ID/SECRET)이 설정되지 않았습니다")
    state = app_auth.sign_state("user_link", u=user.id)
    query = urlencode({"client_id": get_settings().github_app_client_id.strip(), "state": state})
    return f"{app_auth.web_base_url()}/login/oauth/authorize?{query}"


def complete_user_link(db: Session, user: UserAccount, *, code: str, state: str, client: GitHubClient) -> dict:
    values = app_auth.verify_state(state, "user_link")
    if values.get("u") != user.id:
        raise app_auth.InvalidStateError("다른 사용자가 시작한 GitHub 로그인입니다. 처음부터 다시 시도하세요")
    settings = get_settings()
    token = client.exchange_oauth_code(
        client_id=settings.github_app_client_id.strip(), client_secret=settings.github_app_client_secret.strip(), code=code
    )
    viewer = client.get_viewer(token)  # the user token is used only for this and then dropped
    if viewer.id is None:
        raise ValueError("GitHub 사용자 정보를 읽지 못했습니다")
    other = db.scalar(
        select(GitHubUserIdentityORM).where(
            GitHubUserIdentityORM.github_id == viewer.id, GitHubUserIdentityORM.user_id != (user.id or 0)
        )
    )
    if other is not None:
        raise ValueError(f"GitHub 계정 @{viewer.login}은(는) 이미 다른 LabNote 사용자에 연결되어 있습니다")
    identity = db.get(GitHubUserIdentityORM, user.id or 0)
    if identity is None:
        identity = GitHubUserIdentityORM(user_id=user.id, github_id=viewer.id, login=viewer.login)
        db.add(identity)
    identity.github_id = viewer.id
    identity.login = viewer.login
    identity.avatar_url = viewer.avatar_url
    identity.profile_url = viewer.profile_url
    identity.linked_at = datetime.now(timezone.utc)
    db.commit()
    return _identity_summary(db, user)


def unlink_user(db: Session, user: UserAccount) -> None:
    identity = db.get(GitHubUserIdentityORM, user.id or 0)
    if identity is not None:
        db.delete(identity)
        db.commit()


# ─── Project repository links ────────────────────────────────────────────


def _link_summary(
    mapping: GitHubProjectMappingORM, integration: GitHubRepositoryIntegrationORM, webhook_url: str
) -> dict:
    return {
        "mapping_id": mapping.id,
        "integration_id": integration.id,
        "repo_owner": integration.repo_owner,
        "repo_name": integration.repo_name,
        "repo_full_name": f"{integration.repo_owner}/{integration.repo_name}",
        "repository_url": integration.repository_url,
        "default_branch": integration.default_branch,
        "branch_pattern": mapping.branch_pattern,
        "note_creation_mode": mapping.note_creation_mode,
        "default_author_member_id": mapping.default_author_member_id,
        "default_reviewer_member_id": mapping.default_reviewer_member_id,
        "is_active": mapping.is_active,
        "bundle_id": mapping.bundle_id,
        "webhook_url": webhook_url,
        "event_count": 0,
    }


def get_project_github(
    db: Session, user: UserAccount, project_id: str, webhook_url_for, app_webhook_url: str | None = None
) -> dict:
    project, can_manage = _project_access(db, user, project_id)
    via_app = _is_app(db, project.company_id)
    rows = db.execute(
        select(GitHubProjectMappingORM, GitHubRepositoryIntegrationORM)
        .join(GitHubRepositoryIntegrationORM, GitHubRepositoryIntegrationORM.id == GitHubProjectMappingORM.integration_id)
        .where(GitHubProjectMappingORM.project_id == project.id)
        .order_by(GitHubProjectMappingORM.created_at.asc())
    ).all()
    counts = dict(
        db.execute(
            select(GitHubEventORM.project_mapping_id, func.count(GitHubEventORM.id))
            .where(GitHubEventORM.project_id == project.id)
            .group_by(GitHubEventORM.project_mapping_id)
        ).all()
    )
    links = []
    for mapping, integration in rows:
        summary = _link_summary(
            mapping, integration, app_webhook_url if via_app and app_webhook_url else webhook_url_for(integration.id)
        )
        summary["webhook_mode"] = "app" if via_app else "repository"
        summary["event_count"] = counts.get(mapping.id, 0)
        links.append(summary)
    return {
        "project_id": project.id,
        "can_manage": can_manage,
        "account": _account_summary(_account_row(db, project.company_id)),
        "links": links,
    }


def list_project_repositories(
    db: Session, user: UserAccount, project_id: str, *, client: GitHubClient, query: str = ""
) -> list[dict]:
    project = _require_project_manage(db, user, project_id)
    token = account_token(db, project.company_id, client)
    linked = {
        (owner.lower(), name.lower())
        for owner, name in db.execute(
            select(GitHubRepositoryIntegrationORM.repo_owner, GitHubRepositoryIntegrationORM.repo_name)
            .join(GitHubProjectMappingORM, GitHubProjectMappingORM.integration_id == GitHubRepositoryIntegrationORM.id)
            .where(GitHubProjectMappingORM.project_id == project.id)
        ).all()
    }
    needle = query.strip().lower()
    if _is_app(db, project.company_id):
        repositories: list[GitHubRepository] = client.list_installation_repositories(token)
    else:
        repositories = client.list_repositories(token)
    return [
        {
            "full_name": repo.full_name,
            "owner": repo.owner,
            "name": repo.name,
            "private": repo.private,
            "default_branch": repo.default_branch,
            "html_url": repo.html_url,
            "description": repo.description,
            "updated_at": repo.updated_at,
            "can_admin": repo.can_admin,
            "linked": (repo.owner.lower(), repo.name.lower()) in linked,
        }
        for repo in repositories
        if not needle or needle in repo.full_name.lower() or needle in (repo.description or "").lower()
    ]


def _validate_members(db: Session, company_id: int, member_ids: list[int | None]) -> None:
    for member_id in member_ids:
        if member_id is None:
            continue
        member = db.get(CompanyMemberORM, member_id)
        if member is None or member.company_id != company_id:
            raise ValueError("기본 작성자와 검토자는 같은 기관 소속이어야 합니다")


def _validate_mode(mode: str) -> str:
    if mode not in NOTE_CREATION_MODES:
        raise ValueError("노트 생성 방식이 올바르지 않습니다")
    return mode


def link_repository(
    db: Session,
    user: UserAccount,
    project_id: str,
    *,
    repo_owner: str,
    repo_name: str,
    repository_url: str | None,
    default_branch: str | None,
    branch_pattern: str | None,
    note_creation_mode: str,
    default_author_member_id: int | None,
    default_reviewer_member_id: int | None,
    bundle_id: str | None = None,
) -> tuple[GitHubProjectMappingORM, GitHubRepositoryIntegrationORM]:
    project = _require_project_manage(db, user, project_id)
    if bundle_id:
        require_bundle_in_project(db, bundle_id, project.id)
    owner, name = repo_owner.strip(), repo_name.strip()
    if not owner or not name:
        raise ValueError("저장소를 고르세요")
    _validate_mode(note_creation_mode)
    _validate_members(db, project.company_id, [default_author_member_id, default_reviewer_member_id])

    integration = db.scalar(
        select(GitHubRepositoryIntegrationORM).where(
            GitHubRepositoryIntegrationORM.company_id == project.company_id,
            func.lower(GitHubRepositoryIntegrationORM.repo_owner) == owner.lower(),
            func.lower(GitHubRepositoryIntegrationORM.repo_name) == name.lower(),
        )
    )
    if integration is None:
        integration = GitHubRepositoryIntegrationORM(
            company_id=project.company_id,
            created_by=user.id,
            repo_owner=owner,
            repo_name=name,
            repository_url=(repository_url or "").strip() or f"https://github.com/{owner}/{name}",
            default_branch=(default_branch or "main").strip() or "main",
            webhook_secret=generate_webhook_secret(),
            status="active",
        )
        db.add(integration)
        db.flush()
    elif db.scalar(
        select(GitHubProjectMappingORM.id).where(
            GitHubProjectMappingORM.integration_id == integration.id,
            GitHubProjectMappingORM.project_id == project.id,
        )
    ):
        raise ValueError("이미 이 프로젝트에 연결된 저장소입니다")

    mapping = GitHubProjectMappingORM(
        integration_id=integration.id,
        project_id=project.id,
        branch_pattern=(branch_pattern or integration.default_branch or "*").strip() or "*",
        note_creation_mode=note_creation_mode,
        default_author_member_id=default_author_member_id,
        default_reviewer_member_id=default_reviewer_member_id,
        is_active=True,
        bundle_id=bundle_id or None,
    )
    db.add(mapping)
    db.commit()
    db.refresh(mapping)
    db.refresh(integration)
    return mapping, integration


def _project_mapping(db: Session, project_id: str, mapping_id: int) -> tuple[GitHubProjectMappingORM, GitHubRepositoryIntegrationORM]:
    mapping = db.get(GitHubProjectMappingORM, mapping_id)
    if mapping is None or mapping.project_id != project_id:
        raise GitHubIntegrationNotFoundError(mapping_id)
    integration = db.get(GitHubRepositoryIntegrationORM, mapping.integration_id)
    if integration is None:
        raise GitHubIntegrationNotFoundError(mapping_id)
    return mapping, integration


def update_link(db: Session, user: UserAccount, project_id: str, mapping_id: int, **changes) -> tuple[GitHubProjectMappingORM, GitHubRepositoryIntegrationORM]:
    project = _require_project_manage(db, user, project_id)
    mapping, integration = _project_mapping(db, project.id, mapping_id)
    if "note_creation_mode" in changes and changes["note_creation_mode"] is not None:
        mapping.note_creation_mode = _validate_mode(changes["note_creation_mode"])
    if "branch_pattern" in changes and changes["branch_pattern"] is not None:
        mapping.branch_pattern = changes["branch_pattern"].strip() or "*"
    for key in ("default_author_member_id", "default_reviewer_member_id"):
        if key in changes:
            _validate_members(db, project.company_id, [changes[key]])
            setattr(mapping, key, changes[key])
    if "is_active" in changes and changes["is_active"] is not None:
        mapping.is_active = bool(changes["is_active"])
    if "bundle_id" in changes:
        bundle_id = changes["bundle_id"] or None
        if bundle_id:
            require_bundle_in_project(db, bundle_id, project.id)
        mapping.bundle_id = bundle_id
    db.commit()
    db.refresh(mapping)
    return mapping, integration


def unlink_repository(db: Session, user: UserAccount, project_id: str, mapping_id: int) -> None:
    project = _require_project_manage(db, user, project_id)
    mapping, _ = _project_mapping(db, project.id, mapping_id)
    db.delete(mapping)
    db.commit()


def webhook_secret_for_link(db: Session, user: UserAccount, project_id: str, mapping_id: int) -> str:
    project = _require_project_manage(db, user, project_id)
    _, integration = _project_mapping(db, project.id, mapping_id)
    if not integration.webhook_secret:
        integration.webhook_secret = generate_webhook_secret()
        db.commit()
    return integration.webhook_secret or ""


def install_webhook(
    db: Session, user: UserAccount, project_id: str, mapping_id: int, *, client: GitHubClient, webhook_url: str
) -> str:
    """Adds the repository webhook; returns "app" when the GitHub App already delivers the events."""
    project = _require_project_manage(db, user, project_id)
    _, integration = _project_mapping(db, project.id, mapping_id)
    if _is_app(db, project.company_id):
        return "app"
    token = account_token(db, project.company_id, client)
    if not integration.webhook_secret:
        integration.webhook_secret = generate_webhook_secret()
        db.commit()
    client.create_webhook(
        token,
        owner=integration.repo_owner,
        repo=integration.repo_name,
        url=webhook_url,
        secret=integration.webhook_secret or "",
    )
    return "repository"


def list_project_events(db: Session, user: UserAccount, project_id: str, limit: int = 50) -> list[dict]:
    project, _ = _project_access(db, user, project_id)
    events = db.scalars(
        select(GitHubEventORM)
        .where(GitHubEventORM.project_id == project.id)
        .order_by(GitHubEventORM.created_at.desc(), GitHubEventORM.id.desc())
        .limit(limit)
    ).all()
    return [
        {
            "id": event.id,
            "created_at": event.created_at.isoformat() if event.created_at else None,
            "event_type": event.event_type,
            "action": event.action,
            "source_url": event.source_url,
            "status": event.status,
            "error_message": event.error_message,
            "project_mapping_id": event.project_mapping_id,
            "generated_note_id": get_generated_note_id(db, event.id),
        }
        for event in events
    ]


# ─── Notes from a picked commit (works without a public webhook URL) ───────

ZERO_SHA = "0" * 40


def _commit_branch(mapping: GitHubProjectMappingORM, integration: GitHubRepositoryIntegrationORM) -> str:
    pattern = (mapping.branch_pattern or "").strip()
    if pattern and not any(char in pattern for char in "*?["):
        return pattern
    return integration.default_branch or "main"


def _commit_delivery_id(sha: str) -> str:
    return f"commit-{sha}"


def list_recent_commits(
    db: Session, user: UserAccount, project_id: str, mapping_id: int, *, client: GitHubClient, limit: int = 10
) -> dict:
    project, _ = _project_access(db, user, project_id)
    mapping, integration = _project_mapping(db, project.id, mapping_id)
    token = account_token(db, project.company_id, client)
    branch = _commit_branch(mapping, integration)
    items = client.list_commits(token, owner=integration.repo_owner, repo=integration.repo_name, branch=branch, limit=limit)
    deliveries = {_commit_delivery_id(str(item.get("sha") or "")): str(item.get("sha") or "") for item in items}
    noted: dict[str, tuple[str | None, str]] = {}
    if deliveries:
        for event in db.scalars(
            select(GitHubEventORM).where(
                GitHubEventORM.integration_id == integration.id,
                GitHubEventORM.delivery_id.in_(list(deliveries)),
            )
        ).all():
            noted[deliveries[event.delivery_id]] = (get_generated_note_id(db, event.id), event.status)
    commits = []
    for item in items:
        sha = str(item.get("sha") or "")
        commit = item.get("commit") or {}
        message = str(commit.get("message") or "").strip()
        author = commit.get("author") or {}
        note_id, event_status = noted.get(sha, (None, None))
        commits.append(
            {
                "sha": sha,
                "short_sha": sha[:7],
                "message": message.splitlines()[0] if message else "",
                "author": author.get("name") or (item.get("author") or {}).get("login") or "",
                "date": author.get("date"),
                "html_url": item.get("html_url"),
                "note_id": note_id,
                "event_status": event_status,
            }
        )
    return {"branch": branch, "ai_enabled": ai_explanation_available(db, integration), "commits": commits}


def create_note_from_commit(
    db: Session, user: UserAccount, project_id: str, mapping_id: int, sha: str, *, client: GitHubClient
) -> dict:
    project, _ = _project_access(db, user, project_id)
    mapping, integration = _project_mapping(db, project.id, mapping_id)
    token = account_token(db, project.company_id, client)
    commit = client.get_commit(token, owner=integration.repo_owner, repo=integration.repo_name, sha=sha)
    full_sha = str(commit.get("sha") or sha)
    delivery_id = _commit_delivery_id(full_sha)
    event = db.scalar(
        select(GitHubEventORM).where(GitHubEventORM.integration_id == integration.id, GitHubEventORM.delivery_id == delivery_id)
    )
    if event is not None:
        existing_note = get_generated_note_id(db, event.id)
        if existing_note:
            return {"event_id": event.id, "note_id": existing_note, "created": False}
    else:
        info = commit.get("commit") or {}
        message = str(info.get("message") or "")
        author_name = (info.get("author") or {}).get("name") or ""
        branch = _commit_branch(mapping, integration)
        author_login = (commit.get("author") or {}).get("login")
        head = {
            "id": full_sha,
            "message": message,
            "author": {"name": author_name, "username": author_login},
            "url": commit.get("html_url"),
        }
        payload = {
            "ref": f"refs/heads/{branch}",
            "before": ZERO_SHA,  # explain exactly this commit
            "after": full_sha,
            "commits": [head],
            "head_commit": head,
            "compare": commit.get("html_url"),
            "repository": {
                "full_name": f"{integration.repo_owner}/{integration.repo_name}",
                "html_url": integration.repository_url,
            },
        }
        event = GitHubEventORM(
            integration_id=integration.id,
            project_mapping_id=mapping.id,
            project_id=project.id,
            delivery_id=delivery_id,
            github_event_id=full_sha,
            event_type="push",
            action="commit",
            source_url=commit.get("html_url"),
            payload_json=json.dumps(payload, ensure_ascii=False),
            status="pending",
        )
        db.add(event)
        db.commit()
        db.refresh(event)
    event_id = event.id
    try:
        note_id = generate_note_from_github_event(db, event_id, generation_type="manual", current_user=user, client=client)
    except Exception as exc:
        db.rollback()
        failed = db.get(GitHubEventORM, event_id)
        if failed is not None:
            failed.status = "failed"
            failed.error_message = str(exc)[:500]
            failed.processed_at = datetime.now(timezone.utc)
            db.commit()
        raise
    return {"event_id": event_id, "note_id": note_id, "created": True}


__all__ = [
    "GitHubAccountNotConnectedError",
    "GitHubApiError",
    "account_connected",
    "account_token",
    "app_install_url",
    "companies_for_installation",
    "complete_app_installation",
    "complete_user_link",
    "remove_installation",
    "unlink_user",
    "user_link_url",
    "connect_account",
    "create_note_from_commit",
    "list_recent_commits",
    "disconnect_account",
    "get_account",
    "get_project_github",
    "install_webhook",
    "link_repository",
    "list_project_events",
    "list_project_repositories",
    "unlink_repository",
    "update_link",
    "webhook_secret_for_link",
]
