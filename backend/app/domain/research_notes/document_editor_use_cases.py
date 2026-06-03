import json
from copy import deepcopy

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.research_notes.use_cases import (
    EDITABLE_NOTE_STATUSES,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteStateError,
    _can_manage_note,
    _get_note,
    _require_note_access,
)
from app.infrastructure.db.models import (
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
    ResearchNoteFileORM,
    ResearchNotePageORM,
)
from app.infrastructure.storage.local_storage import LocalStorageService


class ResearchNoteDocumentNotFoundError(Exception):
    pass


def _latest_revision_no(db: Session, document_id: str) -> int:
    return (
        db.scalar(
            select(ResearchNoteDocumentRevisionORM.revision_no)
            .where(ResearchNoteDocumentRevisionORM.document_id == document_id)
            .order_by(ResearchNoteDocumentRevisionORM.revision_no.desc())
            .limit(1)
        )
        or 0
    )


def _create_revision(
    db: Session,
    *,
    document: ResearchNoteDocumentORM,
    payload_json: str,
    current_user: UserAccount,
    change_summary: str | None = None,
) -> ResearchNoteDocumentRevisionORM:
    revision = ResearchNoteDocumentRevisionORM(
        document_id=document.id,
        revision_no=_latest_revision_no(db, document.id) + 1,
        payload_json=payload_json,
        created_by=current_user.id,
        change_summary=change_summary,
    )
    db.add(revision)
    db.flush()
    document.current_revision_id = revision.id
    return revision


def _ensure_source_belongs_to_note(
    db: Session,
    *,
    note_id: str,
    source_file_id: int | None,
    source_page_id: int | None,
) -> None:
    if source_file_id is not None:
        source_file = db.get(ResearchNoteFileORM, source_file_id)
        if source_file is None or source_file.note_id != note_id:
            raise ValueError("Source file not found")
    if source_page_id is not None:
        source_page = db.get(ResearchNotePageORM, source_page_id)
        if source_page is None:
            raise ValueError("Source page not found")
        if source_page.note_id and source_page.note_id != note_id:
            raise ValueError("Source page does not belong to this note")
        if not source_page.note_id:
            source_file = db.get(ResearchNoteFileORM, source_page.file_id)
            if source_file is None or source_file.note_id != note_id:
                raise ValueError("Source page does not belong to this note")


def list_note_documents(
    db: Session,
    note_id: str,
    current_user: UserAccount,
) -> list[ResearchNoteDocumentORM]:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    stmt = (
        select(ResearchNoteDocumentORM)
        .where(ResearchNoteDocumentORM.note_id == note_id)
        .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
    )
    return list(db.scalars(stmt).all())


def get_note_document(
    db: Session,
    document_id: str,
    current_user: UserAccount,
) -> ResearchNoteDocumentORM:
    document = db.get(ResearchNoteDocumentORM, document_id)
    if document is None:
        raise ResearchNoteDocumentNotFoundError(document_id)
    note = _get_note(db, document.note_id)
    _require_note_access(db, note, current_user)
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
    current_user: UserAccount,
    change_summary: str | None = None,
) -> ResearchNoteDocumentORM:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Only draft, rejected, or reopened notes can be edited")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can edit this document")

    _ensure_source_belongs_to_note(
        db,
        note_id=note_id,
        source_file_id=source_file_id,
        source_page_id=source_page_id,
    )

    payload_with_id = deepcopy(document_payload)
    if document_id:
        document = db.get(ResearchNoteDocumentORM, document_id)
        if document is None:
            raise ResearchNoteDocumentNotFoundError(document_id)
        if document.note_id != note_id:
            raise ValueError("Document does not belong to this note")
        if document.status in {"submitted", "approved", "locked"}:
            raise ResearchNoteStateError("Submitted or approved documents cannot be edited")
        payload_with_id["id"] = document.id
        payload_json = json.dumps(payload_with_id, ensure_ascii=False)
        document.title = title
        document.schema_version = int(document_payload.get("schemaVersion", 1))
        document.source_file_id = source_file_id
        document.source_page_id = source_page_id
        document.document_payload = payload_json
        _create_revision(
            db,
            document=document,
            payload_json=payload_json,
            current_user=current_user,
            change_summary=change_summary,
        )
        note.last_updated_by = current_user.id
        db.commit()
        db.refresh(document)
        return document

    document = ResearchNoteDocumentORM(
        note_id=note_id,
        title=title,
        status="draft",
        schema_version=int(document_payload.get("schemaVersion", 1)),
        source_file_id=source_file_id,
        source_page_id=source_page_id,
        document_payload="{}",
    )
    db.add(document)
    db.flush()
    payload_with_id["id"] = document.id
    payload_json = json.dumps(payload_with_id, ensure_ascii=False)
    document.document_payload = payload_json
    _create_revision(
        db,
        document=document,
        payload_json=payload_json,
        current_user=current_user,
        change_summary=change_summary or "Initial document revision",
    )
    note.last_updated_by = current_user.id
    db.commit()
    db.refresh(document)
    return document


def upload_editor_image(
    *,
    db: Session,
    note_id: str,
    filename: str,
    file_bytes: bytes,
    current_user: UserAccount,
) -> tuple[str, str]:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Only draft, rejected, or reopened notes can receive editor images")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can upload editor images")
    storage = LocalStorageService()
    storage_key = storage.save_bytes(file_bytes, f"notes/{note_id}/editor", filename)
    return storage_key, filename


def get_current_revision_no(db: Session, document: ResearchNoteDocumentORM) -> int | None:
    if document.current_revision_id is None:
        return None
    return db.scalar(
        select(ResearchNoteDocumentRevisionORM.revision_no).where(
            ResearchNoteDocumentRevisionORM.id == document.current_revision_id
        )
    )
