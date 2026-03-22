from dataclasses import dataclass
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db.models import ProjectORM, ResearchNoteFileORM, ResearchNoteORM, ResearchNotePageORM
from app.infrastructure.pdf.pdf_splitter import PdfSplitterService
from app.infrastructure.storage.local_storage import LocalStorageService


class ResearchNoteNotFoundError(Exception):
    pass


class ProjectNotFoundError(Exception):
    pass


class UnsupportedFileTypeError(Exception):
    pass


@dataclass
class FileUploadResult:
    note_file: ResearchNoteFileORM
    pages: list[ResearchNotePageORM]


IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
PDF_MIME_TYPES = {"application/pdf", "application/x-pdf"}


def _ensure_project_exists(db: Session, project_id: str) -> None:
    project = db.get(ProjectORM, project_id)
    if not project:
        raise ProjectNotFoundError(project_id)


def create_research_note(db: Session, **kwargs) -> ResearchNoteORM:
    _ensure_project_exists(db, kwargs["project_id"])
    note = ResearchNoteORM(**kwargs)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def list_research_notes(db: Session, project_id: str | None = None) -> list[ResearchNoteORM]:
    stmt = select(ResearchNoteORM).where(ResearchNoteORM.is_deleted.is_(False))
    if project_id is not None:
        stmt = stmt.where(ResearchNoteORM.project_id == project_id)
    return list(db.scalars(stmt.order_by(ResearchNoteORM.created_at.desc())).all())


def get_research_note(db: Session, note_id: str) -> ResearchNoteORM:
    note = db.get(ResearchNoteORM, note_id)
    if not note or note.is_deleted:
        raise ResearchNoteNotFoundError(note_id)
    return note


def update_research_note(db: Session, note_id: str, **kwargs) -> ResearchNoteORM:
    note = get_research_note(db, note_id)
    for key, value in kwargs.items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    return note


def delete_research_note(db: Session, note_id: str) -> None:
    note = get_research_note(db, note_id)
    note.is_deleted = True
    db.commit()


def _detect_file_type(mime_type: str, original_name: str) -> str:
    normalized_mime_type = (mime_type or "").lower()
    extension = Path(original_name).suffix.lower()

    if normalized_mime_type in PDF_MIME_TYPES or extension == ".pdf":
        return "pdf"
    if normalized_mime_type in IMAGE_MIME_TYPES or extension in {".png", ".jpg", ".jpeg", ".webp"}:
        return "image"
    raise UnsupportedFileTypeError(mime_type or original_name)


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

    file_type = _detect_file_type(mime_type, original_name)
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
