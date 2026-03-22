from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.domain.research_notes.use_cases import (
    ProjectNotFoundError,
    ResearchNoteNotFoundError,
    create_research_note,
    delete_research_note,
    get_research_note,
    list_research_notes,
    update_research_note,
)
from app.infrastructure.db.session import get_db
from app.presentation.schemas.research_note import (
    ResearchNoteCreateRequest,
    ResearchNoteResponse,
    ResearchNoteUpdateRequest,
)

router = APIRouter(prefix="/research-notes", tags=["research-notes"])


@router.post("", response_model=ResearchNoteResponse, status_code=status.HTTP_201_CREATED)
def create_research_note_endpoint(
    payload: ResearchNoteCreateRequest, db: Session = Depends(get_db)
) -> ResearchNoteResponse:
    try:
        return create_research_note(db, **payload.model_dump())
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc


@router.get("", response_model=list[ResearchNoteResponse])
def list_research_notes_endpoint(
    project_id: str | None = Query(default=None), db: Session = Depends(get_db)
) -> list[ResearchNoteResponse]:
    return list_research_notes(db, project_id=project_id)


@router.get("/{note_id}", response_model=ResearchNoteResponse)
def get_research_note_endpoint(note_id: str, db: Session = Depends(get_db)) -> ResearchNoteResponse:
    try:
        return get_research_note(db, note_id)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc


@router.put("/{note_id}", response_model=ResearchNoteResponse)
def update_research_note_endpoint(
    note_id: str, payload: ResearchNoteUpdateRequest, db: Session = Depends(get_db)
) -> ResearchNoteResponse:
    try:
        return update_research_note(db, note_id, **payload.model_dump(exclude_unset=True))
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_research_note_endpoint(note_id: str, db: Session = Depends(get_db)) -> Response:
    try:
        delete_research_note(db, note_id)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
