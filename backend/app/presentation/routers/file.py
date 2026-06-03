from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.domain.research_notes.use_cases import (
    FileUploadLimitError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
    ResearchNoteStateError,
    UnsupportedFileTypeError,
    list_note_files,
    list_note_pages,
    list_pages_for_note,
    replace_note_page_asset,
    upload_note_file,
)
from app.infrastructure.db.session import get_db
from app.presentation.schemas.file import FileUploadResponse, ResearchNoteFileResponse, ResearchNotePageResponse
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/research-note-files", tags=["research-note-files"])


@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file_endpoint(
    note_id: str = Form(...),
    uploaded_by: int | None = Form(default=None),
    upload: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> FileUploadResponse:
    try:
        data = await upload.read()
        result = upload_note_file(
            db,
            note_id=note_id,
            uploaded_by=uploaded_by,
            original_name=upload.filename or "uploaded.bin",
            mime_type=upload.content_type or "application/octet-stream",
            file_bytes=data,
            current_user=current_user,
        )
        return FileUploadResponse(file=result.note_file, pages=result.pages)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileUploadLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileTypeError as exc:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {exc}") from exc


@router.get("/notes/{note_id}", response_model=list[ResearchNoteFileResponse])
def list_note_files_endpoint(
    note_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResearchNoteFileResponse]:
    try:
        return list_note_files(db, note_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/notes/{note_id}/pages", response_model=list[ResearchNotePageResponse])
def list_note_pages_for_note_endpoint(
    note_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResearchNotePageResponse]:
    try:
        return list_pages_for_note(db, note_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/{file_id}/pages", response_model=list[ResearchNotePageResponse])
def list_note_pages_endpoint(
    file_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ResearchNotePageResponse]:
    try:
        return list_note_pages(db, file_id, current_user)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except ResearchNoteAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.post("/pages/{page_id}/replace", response_model=ResearchNotePageResponse)
async def replace_note_page_asset_endpoint(
    page_id: int,
    change_reason: str | None = Form(default=None),
    upload: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ResearchNotePageResponse:
    try:
        data = await upload.read()
        return replace_note_page_asset(
            db,
            page_id=page_id,
            current_user=current_user,
            original_name=upload.filename or "replacement.png",
            mime_type=upload.content_type or "application/octet-stream",
            file_bytes=data,
            change_reason=change_reason,
        )
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note page not found") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ResearchNoteStateError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except FileUploadLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except UnsupportedFileTypeError as exc:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {exc}") from exc
