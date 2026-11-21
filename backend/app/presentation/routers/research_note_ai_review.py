from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.domain.research_notes.ai_review import confirm_ai_review, get_ai_review
from app.domain.research_notes.review_queue import project_review_queue
from app.domain.research_notes.use_cases import (
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
    ResearchNoteStateError,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/research-notes", tags=["research-notes"])
project_router = APIRouter(prefix="/projects", tags=["research-notes"])


def _raise(exc: Exception) -> HTTPException:
    if isinstance(exc, ResearchNoteNotFoundError):
        return HTTPException(status_code=404, detail="연구노트를 찾을 수 없습니다")
    if isinstance(exc, ResearchNoteAccessDeniedError | ResearchNoteManageDeniedError):
        return HTTPException(status_code=403, detail=str(exc))
    return HTTPException(status_code=409, detail=str(exc))


HANDLED = (ResearchNoteNotFoundError, ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError, ResearchNoteStateError)


@router.get("/{note_id}/ai-review")
def get_ai_review_endpoint(note_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return get_ai_review(db, note_id, current_user)
    except HANDLED as exc:
        raise _raise(exc) from exc


@router.post("/{note_id}/ai-review/confirm")
def confirm_ai_review_endpoint(note_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return confirm_ai_review(db, note_id, current_user)
    except HANDLED as exc:
        raise _raise(exc) from exc


@project_router.get("/{project_id}/note-review")
def project_note_review_endpoint(project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Notes in this project that need a person's attention (AI checks, approvals, rejections, automatic checks)."""
    from app.domain.research_notes.use_cases import ProjectNotFoundError

    try:
        return project_review_queue(db, current_user, project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다") from exc
    except HANDLED as exc:
        raise _raise(exc) from exc
