from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.domain.research_notes.use_cases import (
    ProjectNotFoundError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
    ResearchNoteStateError,
    assign_research_note_members,
    approve_research_note,
    create_research_note,
    delete_research_note,
    get_research_note,
    list_approval_events,
    list_research_notes,
    reject_research_note,
    reopen_research_note,
    submit_research_note,
    update_research_note,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.research_note import (
    ResearchNoteAssignmentRequest,
    ResearchNoteApprovalEventResponse,
    ResearchNoteApprovalRequest,
    ResearchNoteCreateRequest,
    ResearchNoteResponse,
    ResearchNoteUpdateRequest,
)

router = APIRouter(prefix="/research-notes", tags=["research-notes"])


@router.post("", response_model=ResearchNoteResponse, status_code=status.HTTP_201_CREATED)
def create_research_note_endpoint(
    payload: ResearchNoteCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteResponse:
    try:
        return create_research_note(db, current_user, **payload.model_dump())
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("", response_model=list[ResearchNoteResponse])
def list_research_notes_endpoint(
    project_id: str | None = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResearchNoteResponse]:
    try:
        return list_research_notes(db, current_user, project_id=project_id)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/{note_id}", response_model=ResearchNoteResponse)
def get_research_note_endpoint(
    note_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteResponse:
    try:
        return get_research_note(db, note_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/{note_id}", response_model=ResearchNoteResponse)
def update_research_note_endpoint(
    note_id: str,
    payload: ResearchNoteUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteResponse:
    try:
        return update_research_note(db, note_id, current_user, **payload.model_dump(exclude_unset=True))
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{note_id}/assignments", response_model=ResearchNoteResponse)
def assign_research_note_members_endpoint(
    note_id: str,
    payload: ResearchNoteAssignmentRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteResponse:
    try:
        return assign_research_note_members(
            db,
            note_id,
            current_user,
            author_member_id=payload.author_member_id,
            reviewer_member_id=payload.reviewer_member_id,
        )
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_research_note_endpoint(
    note_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_research_note(db, note_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{note_id}/approval-events", response_model=list[ResearchNoteApprovalEventResponse])
def list_approval_events_endpoint(
    note_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResearchNoteApprovalEventResponse]:
    try:
        return list_approval_events(db, note_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/{note_id}/submit", response_model=ResearchNoteApprovalEventResponse)
def submit_research_note_endpoint(
    note_id: str,
    payload: ResearchNoteApprovalRequest | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteApprovalEventResponse:
    try:
        return submit_research_note(db, note_id, current_user, comment=payload.comment if payload else None)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{note_id}/approve", response_model=ResearchNoteApprovalEventResponse)
def approve_research_note_endpoint(
    note_id: str,
    payload: ResearchNoteApprovalRequest | None = None,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteApprovalEventResponse:
    try:
        return approve_research_note(db, note_id, current_user, comment=payload.comment if payload else None)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{note_id}/reject", response_model=ResearchNoteApprovalEventResponse)
def reject_research_note_endpoint(
    note_id: str,
    payload: ResearchNoteApprovalRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteApprovalEventResponse:
    try:
        return reject_research_note(db, note_id, current_user, comment=payload.comment)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


@router.post("/{note_id}/reopen", response_model=ResearchNoteApprovalEventResponse)
def reopen_research_note_endpoint(
    note_id: str,
    payload: ResearchNoteApprovalRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNoteApprovalEventResponse:
    try:
        return reopen_research_note(db, note_id, current_user, comment=payload.comment)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
