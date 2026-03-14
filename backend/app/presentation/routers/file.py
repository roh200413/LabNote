from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.application.file_service import (
    UnsupportedFileTypeError,
    list_note_files,
    list_note_pages,
    upload_note_file,
)
from app.application.research_note_service import ResearchNoteNotFoundError
from app.infrastructure.db.session import get_db
from app.presentation.schemas.file import FileUploadResponse, ResearchNoteFileResponse, ResearchNotePageResponse

router = APIRouter(prefix="/research-note-files", tags=["research-note-files"])


@router.post("/upload", response_model=FileUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_file_endpoint(
    note_id: str = Form(...),
    uploaded_by: int = Form(...),
    upload: UploadFile = File(...),
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
        )
        return FileUploadResponse(file=result.note_file, pages=result.pages)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    except UnsupportedFileTypeError as exc:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {exc}") from exc


@router.get("/notes/{note_id}", response_model=list[ResearchNoteFileResponse])
def list_note_files_endpoint(note_id: str, db: Session = Depends(get_db)) -> list[ResearchNoteFileResponse]:
    try:
        return list_note_files(db, note_id)
    except ResearchNoteNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc


@router.get("/{file_id}/pages", response_model=list[ResearchNotePageResponse])
def list_note_pages_endpoint(file_id: int, db: Session = Depends(get_db)) -> list[ResearchNotePageResponse]:
    return list_note_pages(db, file_id)
