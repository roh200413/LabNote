"""GitHub App: installing it for an organization, its single webhook, and each user's GitHub login."""

import hashlib
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.github_integrations.app_webhooks import handle_app_event
from app.domain.github_integrations.connections import (
    GitHubAccountNotConnectedError,
    app_install_url,
    complete_app_installation,
    complete_user_link,
    unlink_user,
    user_link_url,
)
from app.domain.github_integrations.use_cases import (
    GitHubIntegrationAccessDeniedError,
    GitHubIntegrationManageDeniedError,
)
from app.infrastructure.db.session import get_db
from app.infrastructure.github.app_auth import InvalidStateError
from app.infrastructure.github.client import GitHubApiError, GitHubClient, get_github_client
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(tags=["github-app"])


class InstallationCompleteRequest(BaseModel):
    installation_id: int = Field(gt=0)
    state: str = Field(min_length=1, max_length=2000)


class UserLinkCompleteRequest(BaseModel):
    code: str = Field(min_length=1, max_length=200)
    state: str = Field(min_length=1, max_length=2000)


def _raise(exc: Exception) -> HTTPException:
    if isinstance(exc, GitHubIntegrationManageDeniedError | GitHubIntegrationAccessDeniedError):
        return HTTPException(status_code=403, detail=str(exc))
    if isinstance(exc, GitHubApiError):
        return HTTPException(status_code=502, detail=str(exc))
    if isinstance(exc, GitHubAccountNotConnectedError):
        return HTTPException(status_code=409, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


HANDLED = (
    GitHubIntegrationManageDeniedError,
    GitHubIntegrationAccessDeniedError,
    GitHubAccountNotConnectedError,
    GitHubApiError,
    InvalidStateError,
    ValueError,
)


@router.get("/github/app/install-url")
def install_url_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"url": app_install_url(db, current_user)}
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/github/app/installations")
def complete_installation_endpoint(
    payload: InstallationCompleteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return complete_app_installation(
            db, current_user, installation_id=payload.installation_id, state=payload.state, client=client
        )
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/github/app/webhook")
async def app_webhook_endpoint(
    request: Request,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_github_delivery: str = Header(..., alias="X-GitHub-Delivery"),
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    secret = get_settings().github_app_webhook_secret.strip()
    if not secret:
        raise HTTPException(status_code=404, detail="GitHub App 웹훅이 설정되지 않았습니다")
    body = await request.body()
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not x_hub_signature_256 or not hmac.compare_digest(expected, x_hub_signature_256):
        raise HTTPException(status_code=403, detail="Invalid GitHub webhook signature")
    return handle_app_event(
        db, event_type=x_github_event, delivery_id=x_github_delivery, payload=await request.json(), client=client
    )


@router.get("/github/me/link-url")
def user_link_url_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return {"url": user_link_url(db, current_user)}
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/github/me/link")
def complete_user_link_endpoint(
    payload: UserLinkCompleteRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
    client: GitHubClient = Depends(get_github_client),
):
    try:
        return complete_user_link(db, current_user, code=payload.code, state=payload.state, client=client)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.delete("/github/me/link", status_code=status.HTTP_204_NO_CONTENT)
def unlink_user_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    unlink_user(db, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
