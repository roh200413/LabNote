from dataclasses import dataclass
from pathlib import Path

from sqlalchemy.orm import Session

from app.application.research_note_service import ResearchNoteNotFoundError, get_research_note
from app.infrastructure.db.models import ResearchNoteFileORM, ResearchNotePageORM
from app.infrastructure.pdf.pdf_splitter import PdfSplitterService
from app.infrastructure.storage.local_storage import LocalStorageService


class UnsupportedFileTypeError(Exception):
    pass


@dataclass
class FileUploadResult:
    note_file: ResearchNoteFileORM
    pages: list[ResearchNotePageORM]


IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}


def _detect_file_type(mime_type: str) -> str:
    if mime_type == "application/pdf":
        return "pdf"
    if mime_type in IMAGE_MIME_TYPES:
        return "image"
    raise UnsupportedFileTypeError(mime_type)


def upload_note_file(
    db: Session,
    *,
    note_id: str,
    uploaded_by: int,
    original_name: str,
    mime_type: str,
    file_bytes: bytes,
) -> FileUploadResult:
    get_research_note(db, note_id)

    file_type = _detect_file_type(mime_type)
    storage = LocalStorageService()

    raw_storage_key = storage.save_bytes(file_bytes, f"notes/{note_id}/raw", original_name)

    note_file = ResearchNoteFileORM(
        note_id=note_id,
        uploaded_by=uploaded_by,
        file_type=file_type,
        original_name=original_name,
        storage_key=raw_storage_key,
        mime_type=mime_type,
        file_size=len(file_bytes),
    )
    db.add(note_file)
    db.commit()
    db.refresh(note_file)

    pages: list[ResearchNotePageORM] = []

    if file_type == "pdf":
        splitter = PdfSplitterService()
        split_pages = splitter.split_to_images(file_bytes)
        for item in split_pages:
            page_storage_key = storage.save_bytes(
                item.image_bytes,
                f"notes/{note_id}/pages",
                f"file-{note_file.id}-page-{item.page_no}.png",
            )
            page = ResearchNotePageORM(
                file_id=note_file.id,
                page_no=item.page_no,
                page_type="pdf_page",
                image_storage_key=page_storage_key,
                sort_order=item.page_no,
            )
            db.add(page)
            pages.append(page)
    else:
        ext = Path(original_name).suffix or ".img"
        page_storage_key = storage.save_bytes(
            file_bytes,
            f"notes/{note_id}/pages",
            f"file-{note_file.id}-page-1{ext}",
        )
        page = ResearchNotePageORM(
            file_id=note_file.id,
            page_no=1,
            page_type="image",
            image_storage_key=page_storage_key,
            sort_order=1,
        )
        db.add(page)
        pages.append(page)

    db.commit()
    for page in pages:
        db.refresh(page)

    return FileUploadResult(note_file=note_file, pages=pages)


def list_note_files(db: Session, note_id: str) -> list[ResearchNoteFileORM]:
    get_research_note(db, note_id)
    return (
        db.query(ResearchNoteFileORM)
        .filter(ResearchNoteFileORM.note_id == note_id, ResearchNoteFileORM.is_deleted.is_(False))
        .order_by(ResearchNoteFileORM.created_at.desc())
        .all()
    )


def list_note_pages(db: Session, file_id: int) -> list[ResearchNotePageORM]:
    return (
        db.query(ResearchNotePageORM)
        .filter(ResearchNotePageORM.file_id == file_id, ResearchNotePageORM.is_deleted.is_(False))
        .order_by(ResearchNotePageORM.sort_order.asc())
        .all()
    )
