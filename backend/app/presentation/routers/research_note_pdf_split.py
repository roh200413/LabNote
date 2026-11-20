from datetime import date

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy.orm import Session

from app.domain.research_notes.pdf_split import split_pdf_into_notes
from app.domain.research_notes.use_cases import (
    FileUploadLimitError,
    ProjectNotFoundError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    UnsupportedFileTypeError,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/research-notes", tags=["research-notes"])


@router.post("/from-pdf", status_code=status.HTTP_201_CREATED)
async def split_pdf_endpoint(
    project_id: str = Form(...),
    title: str = Form(default=""),
    pages_per_note: int = Form(default=1),
    owner_member_id: int = Form(...),
    reviewer_member_id: int | None = Form(default=None),
    written_date: date | None = Form(default=None),
    reviewed_date: date | None = Form(default=None),
    upload: UploadFile = File(...),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    name = upload.filename or "document.pdf"
    if not (name.lower().endswith(".pdf") or (upload.content_type or "").lower() == "application/pdf"):
        raise HTTPException(status_code=400, detail="PDF 파일만 여러 노트로 나눌 수 있습니다")
    try:
        notes = split_pdf_into_notes(
            db,
            current_user,
            project_id=project_id,
            pdf_bytes=await upload.read(),
            original_name=name,
            pages_per_note=pages_per_note,
            title=title,
            owner_member_id=owner_member_id,
            reviewer_member_id=reviewer_member_id,
            written_date=written_date,
            reviewed_date=reviewed_date,
        )
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="프로젝트를 찾을 수 없습니다") from exc
    except (ResearchNoteAccessDeniedError, ResearchNoteManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except FileUploadLimitError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except (UnsupportedFileTypeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "notes": [
            {"id": note.note_id, "title": note.title, "first_page": note.first_page, "last_page": note.last_page}
            for note in notes
        ]
    }
