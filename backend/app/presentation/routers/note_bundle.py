from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.domain.research_notes.bundles import (
    NoteBundleNotFoundError,
    create_bundle,
    delete_bundle,
    list_bundles,
    move_notes,
    update_bundle,
)
from app.domain.research_notes.use_cases import (
    ProjectNotFoundError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(tags=["note-bundles"])


class NoteBundleResponse(BaseModel):
    id: str
    project_id: str
    name: str
    description: str | None
    note_count: int
    created_at: datetime | None


class NoteBundleCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)


class NoteBundleUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = Field(default=None, max_length=1000)


class NoteBundleMoveRequest(BaseModel):
    note_ids: list[str] = Field(min_length=1, max_length=500)
    bundle_id: str | None = None


def _raise(exc: Exception) -> HTTPException:
    if isinstance(exc, ProjectNotFoundError):
        return HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다")
    if isinstance(exc, NoteBundleNotFoundError):
        return HTTPException(status_code=404, detail="묶음을 찾을 수 없습니다")
    if isinstance(exc, ResearchNoteNotFoundError):
        return HTTPException(status_code=404, detail=str(exc) or "연구노트를 찾을 수 없습니다")
    if isinstance(exc, ResearchNoteAccessDeniedError | ResearchNoteManageDeniedError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=400, detail=str(exc))


HANDLED = (
    ProjectNotFoundError,
    NoteBundleNotFoundError,
    ResearchNoteNotFoundError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ValueError,
)


@router.get("/projects/{project_id}/note-bundles", response_model=list[NoteBundleResponse])
def list_bundles_endpoint(project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return list_bundles(db, current_user, project_id)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/projects/{project_id}/note-bundles", response_model=NoteBundleResponse, status_code=status.HTTP_201_CREATED)
def create_bundle_endpoint(
    project_id: str,
    payload: NoteBundleCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return create_bundle(db, current_user, project_id, name=payload.name, description=payload.description)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/projects/{project_id}/note-bundles/move")
def move_notes_endpoint(
    project_id: str,
    payload: NoteBundleMoveRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        moved = move_notes(db, current_user, project_id, note_ids=payload.note_ids, bundle_id=payload.bundle_id)
    except HANDLED as exc:
        raise _raise(exc) from exc
    return {"moved": moved}


@router.patch("/note-bundles/{bundle_id}", response_model=NoteBundleResponse)
def update_bundle_endpoint(
    bundle_id: str,
    payload: NoteBundleUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return update_bundle(db, current_user, bundle_id, name=payload.name, description=payload.description)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.delete("/note-bundles/{bundle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bundle_endpoint(bundle_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)) -> Response:
    try:
        delete_bundle(db, current_user, bundle_id)
    except HANDLED as exc:
        raise _raise(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
