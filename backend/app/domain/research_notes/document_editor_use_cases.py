import json
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db.models import ResearchNoteDocumentORM, ResearchNoteFileORM, ResearchNoteORM, ResearchNotePageORM
from app.infrastructure.storage.local_storage import LocalStorageService


class ResearchNoteDocumentNotFoundError(Exception):
    pass


def _ensure_note_exists(db: Session, note_id: str) -> ResearchNoteORM:
    note = db.get(ResearchNoteORM, note_id)
    if note is None or note.is_deleted:
        raise ResearchNoteDocumentNotFoundError(note_id)
    return note


def list_note_documents(db: Session, note_id: str) -> list[ResearchNoteDocumentORM]:
    _ensure_note_exists(db, note_id)
    stmt = (
        select(ResearchNoteDocumentORM)
        .where(ResearchNoteDocumentORM.note_id == note_id)
        .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def get_note_document(db: Session, document_id: str) -> ResearchNoteDocumentORM:
    document = db.get(ResearchNoteDocumentORM, document_id)
    if document is None:
        raise ResearchNoteDocumentNotFoundError(document_id)
    return document


def save_note_document(
    db: Session,
    *,
    document_id: str | None,
    note_id: str,
    title: str,
    source_file_id: int | None,
    source_page_id: int | None,
    document_payload: dict,
) -> ResearchNoteDocumentORM:
    _ensure_note_exists(db, note_id)
    if source_file_id is not None and db.get(ResearchNoteFileORM, source_file_id) is None:
        raise ValueError("Source file not found")
    if source_page_id is not None and db.get(ResearchNotePageORM, source_page_id) is None:
        raise ValueError("Source page not found")

    payload_json = json.dumps(document_payload, ensure_ascii=False)
    if document_id:
        document = db.get(ResearchNoteDocumentORM, document_id)
        if document is None:
            raise ResearchNoteDocumentNotFoundError(document_id)
        document.title = title
        document.note_id = note_id
        document.schema_version = int(document_payload.get("schemaVersion", 1))
        document.source_file_id = source_file_id
        document.source_page_id = source_page_id
        document.document_payload = payload_json
        db.commit()
        db.refresh(document)
        return document

    document = ResearchNoteDocumentORM(
        note_id=note_id,
        title=title,
        schema_version=int(document_payload.get("schemaVersion", 1)),
        source_file_id=source_file_id,
        source_page_id=source_page_id,
        document_payload=payload_json,
    )
    db.add(document)
    db.commit()
    db.refresh(document)
    payload_with_id = deepcopy(document_payload)
    payload_with_id["id"] = document.id
    document.document_payload = json.dumps(payload_with_id, ensure_ascii=False)
    db.commit()
    db.refresh(document)
    return document


def upload_editor_image(*, note_id: str, filename: str, file_bytes: bytes) -> tuple[str, str]:
    storage = LocalStorageService()
    storage_key = storage.save_bytes(file_bytes, f"notes/{note_id}/editor", filename)
    return storage_key, filename
