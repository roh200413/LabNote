"""GitHub account connection (main page) and per-project repository links."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.github_integrations.connections import (
    GitHubAccountNotConnectedError,
    connect_account,
    create_note_from_commit,
    disconnect_account,
    get_account,
    get_project_github,
    install_webhook,
    link_repository,
    list_project_events,
    list_project_repositories,
    list_recent_commits,
    unlink_repository,
    update_link,
    webhook_secret_for_link,
)
from app.domain.github_integrations.use_cases import (
    GitHubIntegrationAccessDeniedError,
    GitHubIntegrationManageDeniedError,
    GitHubIntegrationNotFoundError,
)
from app.infrastructure.db.session import get_db
from app.infrastructure.github.client import GitHubApiError, GitHubClient, get_github_client
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(tags=["github-account"])


class GitHubTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=400)


class GitHubLinkCreateRequest(BaseModel):
    repo_owner: str = Field(min_length=1, max_length=120)
    repo_name: str = Field(min_length=1, max_length=160)
    repository_url: str | None = Field(default=None, max_length=500)
    default_branch: str | None = Field(default=None, max_length=120)
    branch_pattern: str | None = Field(default=None, max_length=120)
    note_creation_mode: str = "pr_merge"
    default_author_member_id: int | None = None
    default_reviewer_member_id: int | None = None
    bundle_id: str | None = Field(default=None, max_length=36)
    install_webhook: bool = True


class GitHubLinkUpdateRequest(BaseModel):
    branch_pattern: str | None = Field(default=None, max_length=120)
    note_creation_mode: str | None = None
    default_author_member_id: int | None = None
    default_reviewer_member_id: int | None = None
    is_active: bool | None = None
    bundle_id: str | None = Field(default=None, max_length=36)


def _public_base(request: Request) -> str:
    return (get_settings().public_api_base_url or str(request.base_url)).rstrip("/")


def _webhook_url_builder(request: Request):
    base = _public_base(request)
    return lambda integration_id: f"{base}/github-integrations/{integration_id}/webhook"


def _app_webhook_url(request: Request) -> str:
    return f"{_public_base(request)}/github/app/webhook"


def _raise(exc: Exception) -> HTTPException:
    if isinstance(exc, GitHubIntegrationManageDeniedError | GitHubIntegrationAccessDeniedError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, GitHubIntegrationNotFoundError):
        return HTTPException(status_code=404, detail="GitHub 연결을 찾을 수 없습니다")
    if isinstance(exc, GitHubAccountNotConnectedError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, GitHubApiError):
        return HTTPException(status_code=502, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


HANDLED = (
    GitHubIntegrationManageDeniedError,
    GitHubIntegrationAccessDeniedError,
    GitHubIntegrationNotFoundError,
    GitHubAccountNotConnectedError,
    GitHubApiError,
    ValueError,
)


# ─── Main page: account ──────────────────────────────────────────────────


@router.get("/github/account")
def get_account_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return get_account(db, current_user)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.put("/github/account")
def connect_account_endpoint(
    payload: GitHubTokenRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return connect_account(db, current_user, token=payload.token, client=client)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.delete("/github/account", status_code=status.HTTP_204_NO_CONTENT)
def disconnect_account_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    try:
        disconnect_account(db, current_user)
    except HANDLED as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ─── Project page: repository links ──────────────────────────────────────


@router.get("/projects/{project_id}/github")
def get_project_github_endpoint(
    project_id: str, request: Request, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        return get_project_github(
            db, current_user, project_id, _webhook_url_builder(request), app_webhook_url=_app_webhook_url(request)
        )
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.get("/projects/{project_id}/github/repositories")
def list_project_repositories_endpoint(
    project_id: str,
    q: str = Query(default="", max_length=120),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return list_project_repositories(db, current_user, project_id, client=client, query=q)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/projects/{project_id}/github/links", status_code=status.HTTP_201_CREATED)
def link_repository_endpoint(
    project_id: str,
    payload: GitHubLinkCreateRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        mapping, integration = link_repository(
            db,
            current_user,
            project_id,
            **payload.model_dump(exclude={"install_webhook"}),
        )
    except HANDLED as exc:
        raise _raise(exc) from exc

    webhook = {"installed": False, "error": None, "mode": "repository"}
    if payload.install_webhook:
        try:
            webhook["mode"] = install_webhook(
                db,
                current_user,
                project_id,
                mapping.id,
                client=client,
                webhook_url=_webhook_url_builder(request)(integration.id),
            )
            webhook["installed"] = True
        except (GitHubApiError, GitHubAccountNotConnectedError) as exc:
            # The link stays; the page shows the manual webhook setup instead.
            webhook["error"] = str(exc)
    return {"mapping_id": mapping.id, "integration_id": integration.id, "webhook": webhook}


@router.put("/projects/{project_id}/github/links/{mapping_id}")
def update_link_endpoint(
    project_id: str,
    mapping_id: int,
    payload: GitHubLinkUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        mapping, _ = update_link(db, current_user, project_id, mapping_id, **payload.model_dump(exclude_unset=True))
    except HANDLED as exc:
        raise _raise(exc) from exc
    return {"mapping_id": mapping.id}


@router.delete("/projects/{project_id}/github/links/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def unlink_repository_endpoint(
    project_id: str, mapping_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)
) -> Response:
    try:
        unlink_repository(db, current_user, project_id, mapping_id)
    except HANDLED as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/projects/{project_id}/github/links/{mapping_id}/webhook")
def install_webhook_endpoint(
    project_id: str,
    mapping_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        _, integration = update_link(db, current_user, project_id, mapping_id)
        install_webhook(
            db,
            current_user,
            project_id,
            mapping_id,
            client=client,
            webhook_url=_webhook_url_builder(request)(integration.id),
        )
    except HANDLED as exc:
        raise _raise(exc) from exc
    return {"installed": True}


@router.post("/projects/{project_id}/github/links/{mapping_id}/webhook-secret")
def webhook_secret_endpoint(
    project_id: str, mapping_id: int, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        return {"webhook_secret": webhook_secret_for_link(db, current_user, project_id, mapping_id)}
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.get("/projects/{project_id}/github/links/{mapping_id}/commits")
def list_recent_commits_endpoint(
    project_id: str,
    mapping_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return list_recent_commits(db, current_user, project_id, mapping_id, client=client)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/projects/{project_id}/github/links/{mapping_id}/commits/{sha}/note")
def create_note_from_commit_endpoint(
    project_id: str,
    mapping_id: int,
    sha: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return create_note_from_commit(db, current_user, project_id, mapping_id, sha, client=client)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.get("/projects/{project_id}/github/events")
def list_project_events_endpoint(
    project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        return list_project_events(db, current_user, project_id)
    except HANDLED as exc:
        raise _raise(exc) from exc
