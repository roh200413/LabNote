import hashlib
import hmac

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.github_integrations.use_cases import (
    GitHubIntegrationAccessDeniedError,
    GitHubIntegrationManageDeniedError,
    GitHubIntegrationNotFoundError,
    create_project_mapping,
    create_github_integration,
    delete_github_integration,
    delete_project_mapping,
    generate_note_from_github_event,
    get_generated_note_id,
    get_github_integration,
    ingest_github_event,
    list_github_events,
    list_github_integrations,
    list_project_mappings,
    rotate_github_webhook_secret,
    update_project_mapping,
    update_github_integration,
)
from app.infrastructure.db.models import GitHubRepositoryIntegrationORM
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.github_integration import (
    GitHubRepositoryIntegrationCreateRequest,
    GitHubRepositoryIntegrationResponse,
    GitHubRepositoryIntegrationUpdateRequest,
    GitHubEventResponse,
    GitHubProjectMappingCreateRequest,
    GitHubProjectMappingResponse,
    GitHubProjectMappingUpdateRequest,
    GitHubWebhookResponse,
    GitHubWebhookSecretResponse,
)

router = APIRouter(prefix="/github-integrations", tags=["github-integrations"])


def _webhook_url(request: Request, integration_id: int) -> str:
    return f"{str(request.base_url).rstrip('/')}/github-integrations/{integration_id}/webhook"


def _to_integration_response(
    integration: GitHubRepositoryIntegrationORM,
    request: Request,
) -> dict:
    return {
        "id": integration.id,
        "created_at": integration.created_at,
        "updated_at": integration.updated_at,
        "company_id": integration.company_id,
        "created_by": integration.created_by,
        "repo_owner": integration.repo_owner,
        "repo_name": integration.repo_name,
        "repository_url": integration.repository_url,
        "default_branch": integration.default_branch,
        "webhook_configured": bool(integration.webhook_secret),
        "webhook_url": _webhook_url(request, integration.id),
        "status": integration.status,
        "notes": integration.notes,
    }


def _to_event_response(db: Session, event) -> dict:
    return {
        "id": event.id,
        "created_at": event.created_at,
        "processed_at": event.processed_at,
        "integration_id": event.integration_id,
        "project_mapping_id": event.project_mapping_id,
        "project_id": event.project_id,
        "delivery_id": event.delivery_id,
        "github_event_id": event.github_event_id,
        "event_type": event.event_type,
        "action": event.action,
        "source_url": event.source_url,
        "status": event.status,
        "error_message": event.error_message,
        "generated_note_id": get_generated_note_id(db, event.id),
    }


def _verify_webhook_signature(secret: str | None, body: bytes, signature: str | None) -> None:
    if not secret or not signature:
        raise HTTPException(status_code=403, detail="Missing GitHub webhook signature")
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=403, detail="Invalid GitHub webhook signature")


@router.get("", response_model=list[GitHubRepositoryIntegrationResponse])
def list_github_integrations_endpoint(
    request: Request,
    company_id: int | None = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GitHubRepositoryIntegrationResponse]:
    try:
        return [_to_integration_response(item, request) for item in list_github_integrations(db, current_user, company_id=company_id)]
    except GitHubIntegrationAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.post("", response_model=GitHubRepositoryIntegrationResponse, status_code=status.HTTP_201_CREATED)
def create_github_integration_endpoint(
    payload: GitHubRepositoryIntegrationCreateRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubRepositoryIntegrationResponse:
    try:
        return _to_integration_response(create_github_integration(db, current_user, **payload.model_dump()), request)
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Repository integration already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/events", response_model=list[GitHubEventResponse])
def list_github_events_endpoint(
    integration_id: int | None = Query(default=None),
    project_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GitHubEventResponse]:
    try:
        return [
            _to_event_response(db, event)
            for event in list_github_events(
                db,
                current_user,
                integration_id=integration_id,
                project_id=project_id,
                status=status_filter,
            )
        ]
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc


@router.post("/events/{event_id}/generate-note", response_model=GitHubEventResponse)
def generate_note_from_github_event_endpoint(
    event_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubEventResponse:
    try:
        generate_note_from_github_event(db, event_id, generation_type="manual", current_user=current_user)
        event = next(item for item in list_github_events(db, current_user) if item.id == event_id)
        return _to_event_response(db, event)
    except StopIteration as exc:
        raise HTTPException(status_code=404, detail="GitHub event not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except (GitHubIntegrationNotFoundError, ValueError) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


@router.get("/{integration_id}", response_model=GitHubRepositoryIntegrationResponse)
def get_github_integration_endpoint(
    integration_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubRepositoryIntegrationResponse:
    try:
        return _to_integration_response(get_github_integration(db, integration_id, current_user), request)
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except GitHubIntegrationAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/{integration_id}", response_model=GitHubRepositoryIntegrationResponse)
def update_github_integration_endpoint(
    integration_id: int,
    payload: GitHubRepositoryIntegrationUpdateRequest,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubRepositoryIntegrationResponse:
    try:
        return _to_integration_response(
            update_github_integration(
                db,
                integration_id,
                current_user,
                **payload.model_dump(exclude_unset=True),
            ),
            request,
        )
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Repository integration already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_github_integration_endpoint(
    integration_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_github_integration(db, integration_id, current_user)
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{integration_id}/webhook-secret", response_model=GitHubWebhookSecretResponse)
def rotate_github_webhook_secret_endpoint(
    integration_id: int,
    request: Request,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubWebhookSecretResponse:
    try:
        integration = rotate_github_webhook_secret(db, integration_id, current_user)
        return GitHubWebhookSecretResponse(
            integration_id=integration.id,
            webhook_secret=integration.webhook_secret or "",
            webhook_url=_webhook_url(request, integration.id),
        )
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/{integration_id}/mappings", response_model=list[GitHubProjectMappingResponse])
def list_project_mappings_endpoint(
    integration_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[GitHubProjectMappingResponse]:
    try:
        return list_project_mappings(db, integration_id, current_user)
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except GitHubIntegrationAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/{integration_id}/mappings", response_model=GitHubProjectMappingResponse, status_code=status.HTTP_201_CREATED)
def create_project_mapping_endpoint(
    integration_id: int,
    payload: GitHubProjectMappingCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubProjectMappingResponse:
    try:
        return create_project_mapping(db, integration_id, current_user, **payload.model_dump())
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/mappings/{mapping_id}", response_model=GitHubProjectMappingResponse)
def update_project_mapping_endpoint(
    mapping_id: int,
    payload: GitHubProjectMappingUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> GitHubProjectMappingResponse:
    try:
        return update_project_mapping(db, mapping_id, current_user, **payload.model_dump(exclude_unset=True))
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub project mapping not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_mapping_endpoint(
    mapping_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_project_mapping(db, mapping_id, current_user)
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub project mapping not found") from exc
    except (GitHubIntegrationAccessDeniedError, GitHubIntegrationManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{integration_id}/webhook", response_model=GitHubWebhookResponse)
async def github_webhook_endpoint(
    integration_id: int,
    request: Request,
    x_github_event: str = Header(..., alias="X-GitHub-Event"),
    x_github_delivery: str = Header(..., alias="X-GitHub-Delivery"),
    x_hub_signature_256: str | None = Header(default=None, alias="X-Hub-Signature-256"),
    db: Session = Depends(get_db),
) -> GitHubWebhookResponse:
    integration = db.get(GitHubRepositoryIntegrationORM, integration_id)
    if integration is None:
        raise HTTPException(status_code=404, detail="GitHub integration not found")
    body = await request.body()
    _verify_webhook_signature(integration.webhook_secret, body, x_hub_signature_256)
    try:
        event, note_id = ingest_github_event(
            db,
            integration_id=integration_id,
            delivery_id=x_github_delivery,
            event_type=x_github_event,
            payload=await request.json(),
        )
        return GitHubWebhookResponse(
            event_id=event.id,
            status=event.status,
            note_id=note_id,
            message="GitHub event received",
        )
    except GitHubIntegrationNotFoundError as exc:
        raise HTTPException(status_code=404, detail="GitHub integration not found") from exc
