import base64
import hashlib
from dataclasses import dataclass
from datetime import date, datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import unquote_to_bytes

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.accounts.entities import UserAccount
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ProjectMemberORM,
    ProjectORM,
    ResearchNoteApprovalEventORM,
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
    ResearchNoteFileORM,
    ResearchNoteORM,
    ResearchNotePageAssetVersionORM,
    ResearchNotePageORM,
    ResearchNoteSignatureSnapshotORM,
    UserAccountORM,
    UserSignatureORM,
)
from app.infrastructure.pdf.pdf_splitter import PdfSplitterService
from app.infrastructure.storage.local_storage import LocalStorageService


class ResearchNoteNotFoundError(Exception):
    pass


class ProjectNotFoundError(Exception):
    pass


class UnsupportedFileTypeError(Exception):
    pass


class ResearchNoteAccessDeniedError(Exception):
    pass


class ResearchNoteManageDeniedError(Exception):
    pass


class ResearchNoteStateError(Exception):
    pass


class FileUploadLimitError(Exception):
    pass


@dataclass
class FileUploadResult:
    note_file: ResearchNoteFileORM
    pages: list[ResearchNotePageORM]


IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}
PDF_MIME_TYPES = {"application/pdf", "application/x-pdf"}
EDITABLE_NOTE_STATUSES = {"draft", "rejected", "reopened"}


def _sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _decode_data_url(value: str) -> bytes:
    header, encoded = value.split(",", 1)
    if ";base64" in header:
        return base64.b64decode(encoded)
    return unquote_to_bytes(encoded)


def _image_size(image_bytes: bytes) -> tuple[int | None, int | None]:
    try:
        with Image.open(BytesIO(image_bytes)) as image:
            return image.width, image.height
    except Exception:
        return None, None


def _thumbnail_bytes(image_bytes: bytes) -> bytes:
    settings = get_settings()
    with Image.open(BytesIO(image_bytes)) as image:
        image = image.convert("RGB")
        image.thumbnail((settings.thumbnail_max_width, settings.thumbnail_max_width * 2))
        output = BytesIO()
        image.save(output, format="WEBP", quality=82)
        return output.getvalue()


def _get_project(db: Session, project_id: str) -> ProjectORM:
    project = db.get(ProjectORM, project_id)
    if not project:
        raise ProjectNotFoundError(project_id)
    return project


def _get_note(db: Session, note_id: str) -> ResearchNoteORM:
    note = db.get(ResearchNoteORM, note_id)
    if not note or note.is_deleted:
        raise ResearchNoteNotFoundError(note_id)
    return note


def _get_company_member(db: Session, *, user_id: int, company_id: int) -> CompanyMemberORM | None:
    return db.scalar(
        select(CompanyMemberORM).where(
            CompanyMemberORM.user_id == user_id,
            CompanyMemberORM.company_id == company_id,
        )
    )


def _get_project_member(db: Session, *, project_id: str, company_member_id: int) -> ProjectMemberORM | None:
    return db.scalar(
        select(ProjectMemberORM).where(
            ProjectMemberORM.project_id == project_id,
            ProjectMemberORM.company_member_id == company_member_id,
        )
    )


def _require_project_access(
    db: Session,
    project: ProjectORM,
    current_user: UserAccount,
    *,
    manage: bool = False,
) -> CompanyMemberORM | None:
    if current_user.is_system_admin:
        return None

    company_member = _get_company_member(db, user_id=current_user.id or 0, company_id=project.company_id)
    if company_member is None:
        raise ResearchNoteAccessDeniedError("You are not a member of this company")

    if current_user.is_company_owner:
        return company_member

    project_member = _get_project_member(db, project_id=project.id, company_member_id=company_member.id)
    if project_member is None:
        raise ResearchNoteAccessDeniedError("Only project members can access this research note")

    if manage and project.owner_member_id != company_member.id:
        raise ResearchNoteManageDeniedError("Only the project lead or company owner can manage this research note")

    return company_member


def _require_note_access(
    db: Session,
    note: ResearchNoteORM,
    current_user: UserAccount,
    *,
    manage: bool = False,
) -> tuple[ProjectORM, CompanyMemberORM | None]:
    project = _get_project(db, note.project_id)
    company_member = _require_project_access(db, project, current_user, manage=manage)
    return project, company_member


def _can_manage_note(current_user: UserAccount, project: ProjectORM, company_member: CompanyMemberORM | None) -> bool:
    return (
        current_user.is_system_admin
        or current_user.is_company_owner
        or (company_member is not None and project.owner_member_id == company_member.id)
    )


def _validate_member_for_project(db: Session, *, member_id: int | None, project: ProjectORM) -> None:
    if member_id is None:
        return
    member = db.get(CompanyMemberORM, member_id)
    if member is None or member.company_id != project.company_id:
        raise ValueError("Selected member must belong to this project company")


def _default_author_member_id(
    db: Session,
    *,
    project: ProjectORM,
    current_user: UserAccount,
    requested_owner_member_id: int | None,
) -> int:
    company_member = None
    if not current_user.is_system_admin:
        company_member = _get_company_member(db, user_id=current_user.id or 0, company_id=project.company_id)

    can_choose = current_user.is_system_admin or current_user.is_company_owner or (
        company_member is not None and project.owner_member_id == company_member.id
    )
    if requested_owner_member_id is not None and can_choose:
        _validate_member_for_project(db, member_id=requested_owner_member_id, project=project)
        return requested_owner_member_id
    if company_member is not None:
        return company_member.id
    if requested_owner_member_id is not None:
        _validate_member_for_project(db, member_id=requested_owner_member_id, project=project)
        return requested_owner_member_id
    raise ValueError("Author member is required")


def create_research_note(db: Session, current_user: UserAccount, **kwargs) -> ResearchNoteORM:
    project = _get_project(db, kwargs["project_id"])
    _require_project_access(db, project, current_user)

    owner_member_id = _default_author_member_id(
        db,
        project=project,
        current_user=current_user,
        requested_owner_member_id=kwargs.get("owner_member_id"),
    )
    reviewer_member_id = kwargs.get("reviewer_member_id") or project.owner_member_id
    _validate_member_for_project(db, member_id=reviewer_member_id, project=project)

    note = ResearchNoteORM(
        project_id=project.id,
        title=kwargs["title"],
        content=kwargs.get("content"),
        status=kwargs.get("status") or "draft",
        owner_member_id=owner_member_id,
        written_date=kwargs.get("written_date"),
        reviewer_member_id=reviewer_member_id,
        reviewed_date=kwargs.get("reviewed_date"),
        last_updated_by=current_user.id,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def list_research_notes(
    db: Session,
    current_user: UserAccount,
    project_id: str | None = None,
) -> list[ResearchNoteORM]:
    stmt = select(ResearchNoteORM).where(ResearchNoteORM.is_deleted.is_(False))
    if project_id is not None:
        project = _get_project(db, project_id)
        _require_project_access(db, project, current_user)
        stmt = stmt.where(ResearchNoteORM.project_id == project_id)
        return list(db.scalars(stmt.order_by(ResearchNoteORM.created_at.desc())).all())

    if current_user.is_system_admin:
        return list(db.scalars(stmt.order_by(ResearchNoteORM.created_at.desc())).all())

    memberships = db.scalars(select(CompanyMemberORM).where(CompanyMemberORM.user_id == (current_user.id or 0))).all()
    member_ids = [membership.id for membership in memberships]
    company_ids = [membership.company_id for membership in memberships]
    if not member_ids:
        return []

    if current_user.is_company_owner:
        stmt = stmt.join(ProjectORM, ProjectORM.id == ResearchNoteORM.project_id).where(ProjectORM.company_id.in_(company_ids))
    else:
        stmt = (
            stmt.join(ProjectMemberORM, ProjectMemberORM.project_id == ResearchNoteORM.project_id)
            .where(ProjectMemberORM.company_member_id.in_(member_ids))
        )
    return list(db.scalars(stmt.order_by(ResearchNoteORM.created_at.desc())).all())


def get_research_note(db: Session, note_id: str, current_user: UserAccount) -> ResearchNoteORM:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    return note


def update_research_note(db: Session, note_id: str, current_user: UserAccount, **kwargs) -> ResearchNoteORM:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id

    if note.status not in EDITABLE_NOTE_STATUSES and not can_manage:
        raise ResearchNoteStateError("Submitted or approved notes cannot be edited")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can edit this note")

    if "owner_member_id" in kwargs and kwargs["owner_member_id"] is not None:
        if not can_manage:
            raise ResearchNoteManageDeniedError("Only the project lead or company owner can change the author")
        _validate_member_for_project(db, member_id=kwargs["owner_member_id"], project=project)
    if "reviewer_member_id" in kwargs and kwargs["reviewer_member_id"] is not None:
        if not can_manage:
            raise ResearchNoteManageDeniedError("Only the project lead or company owner can change the reviewer")
        _validate_member_for_project(db, member_id=kwargs["reviewer_member_id"], project=project)

    kwargs.pop("last_updated_by", None)
    for key, value in kwargs.items():
        setattr(note, key, value)
    note.last_updated_by = current_user.id
    db.commit()
    db.refresh(note)
    return note


def assign_research_note_members(
    db: Session,
    note_id: str,
    current_user: UserAccount,
    *,
    author_member_id: int,
    reviewer_member_id: int | None,
) -> ResearchNoteORM:
    note = _get_note(db, note_id)
    project, _company_member = _require_note_access(db, note, current_user, manage=True)
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Submitted or approved notes cannot be reassigned")

    _validate_member_for_project(db, member_id=author_member_id, project=project)
    if reviewer_member_id is not None:
        _validate_member_for_project(db, member_id=reviewer_member_id, project=project)

    note.owner_member_id = author_member_id
    note.reviewer_member_id = reviewer_member_id
    note.last_updated_by = current_user.id
    db.commit()
    db.refresh(note)
    return note


def delete_research_note(db: Session, note_id: str, current_user: UserAccount) -> None:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user, manage=True)
    storage = LocalStorageService()
    db.query(ResearchNoteApprovalEventORM).filter(ResearchNoteApprovalEventORM.note_id == note_id).delete()
    db.query(ResearchNoteSignatureSnapshotORM).filter(ResearchNoteSignatureSnapshotORM.note_id == note_id).delete()
    document_ids = select(ResearchNoteDocumentORM.id).where(ResearchNoteDocumentORM.note_id == note_id)
    db.query(ResearchNoteDocumentRevisionORM).filter(
        ResearchNoteDocumentRevisionORM.document_id.in_(document_ids)
    ).delete(synchronize_session=False)
    db.query(ResearchNoteDocumentORM).filter(ResearchNoteDocumentORM.note_id == note_id).delete()
    page_ids = select(ResearchNotePageORM.id).where(ResearchNotePageORM.note_id == note_id)
    db.query(ResearchNotePageAssetVersionORM).filter(
        ResearchNotePageAssetVersionORM.page_id.in_(page_ids)
    ).delete(synchronize_session=False)
    db.query(ResearchNotePageORM).filter(ResearchNotePageORM.note_id == note_id).delete()
    db.query(ResearchNoteFileORM).filter(ResearchNoteFileORM.note_id == note_id).delete()
    db.delete(note)
    db.commit()
    storage.delete_tree(f"notes/{note_id}")


def _detect_file_type(mime_type: str, original_name: str) -> str:
    normalized_mime_type = (mime_type or "").lower()
    extension = Path(original_name).suffix.lower()

    if normalized_mime_type in PDF_MIME_TYPES or extension == ".pdf":
        return "pdf"
    if normalized_mime_type in IMAGE_MIME_TYPES or extension in {".png", ".jpg", ".jpeg", ".webp"}:
        return "image"
    raise UnsupportedFileTypeError(mime_type or original_name)


def _ensure_upload_allowed(file_type: str, file_bytes: bytes) -> None:
    settings = get_settings()
    if len(file_bytes) > settings.max_upload_bytes:
        raise FileUploadLimitError(f"Upload exceeds {settings.max_upload_bytes} bytes")
    if file_type == "pdf":
        try:
            import fitz

            with fitz.open(stream=file_bytes, filetype="pdf") as document:
                if document.page_count > settings.max_pdf_pages:
                    raise FileUploadLimitError(f"PDF exceeds {settings.max_pdf_pages} pages")
        except FileUploadLimitError:
            raise
        except Exception as exc:
            raise UnsupportedFileTypeError("Invalid PDF file") from exc


def _create_asset_version(
    db: Session,
    *,
    page: ResearchNotePageORM,
    image_bytes: bytes,
    mime_type: str,
    created_by: int | None,
    change_reason: str | None = None,
) -> ResearchNotePageAssetVersionORM:
    storage = LocalStorageService()
    width, height = _image_size(image_bytes)
    thumbnail_storage_key = None
    try:
        thumbnail_storage_key = storage.save_bytes(
            _thumbnail_bytes(image_bytes),
            f"notes/{page.note_id}/pages/{page.id}",
            f"page-{page.id}-thumb.webp",
        )
    except Exception:
        thumbnail_storage_key = None

    version_no = (
        db.scalar(
            select(ResearchNotePageAssetVersionORM.version_no)
            .where(ResearchNotePageAssetVersionORM.page_id == page.id)
            .order_by(ResearchNotePageAssetVersionORM.version_no.desc())
            .limit(1)
        )
        or 0
    ) + 1
    asset = ResearchNotePageAssetVersionORM(
        page_id=page.id,
        version_no=version_no,
        image_storage_key=page.image_storage_key,
        thumbnail_storage_key=thumbnail_storage_key,
        width=width,
        height=height,
        mime_type=mime_type,
        checksum=_sha256(image_bytes),
        created_by=created_by,
        change_reason=change_reason,
    )
    db.add(asset)
    db.flush()
    page.thumbnail_storage_key = thumbnail_storage_key
    page.width = width
    page.height = height
    page.active_asset_version_id = asset.id
    return asset


def upload_note_file(
    db: Session,
    *,
    note_id: str,
    uploaded_by: int | None,
    original_name: str,
    mime_type: str,
    file_bytes: bytes,
    current_user: UserAccount,
) -> FileUploadResult:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Files can only be uploaded to draft, rejected, or reopened notes")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can upload files")

    file_type = _detect_file_type(mime_type, original_name)
    _ensure_upload_allowed(file_type, file_bytes)
    storage = LocalStorageService()
    raw_storage_key = storage.save_bytes(file_bytes, f"notes/{note_id}/sources", original_name)

    note_file = ResearchNoteFileORM(
        note_id=note_id,
        uploaded_by=current_user.id or uploaded_by or 0,
        file_type=file_type,
        original_name=original_name,
        storage_key=raw_storage_key,
        mime_type=mime_type,
        file_size=len(file_bytes),
        checksum=_sha256(file_bytes),
        status="processing",
    )
    db.add(note_file)
    db.commit()
    db.refresh(note_file)

    pages: list[ResearchNotePageORM] = []
    try:
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
                    note_id=note_id,
                    file_id=note_file.id,
                    page_no=item.page_no,
                    page_type="pdf_page",
                    image_storage_key=page_storage_key,
                    sort_order=item.page_no,
                    status="ready",
                )
                db.add(page)
                db.flush()
                _create_asset_version(
                    db,
                    page=page,
                    image_bytes=item.image_bytes,
                    mime_type="image/png",
                    created_by=current_user.id,
                    change_reason="Rendered from source PDF",
                )
                pages.append(page)
        else:
            ext = Path(original_name).suffix or ".img"
            page_storage_key = storage.save_bytes(
                file_bytes,
                f"notes/{note_id}/pages",
                f"file-{note_file.id}-page-1{ext}",
            )
            page = ResearchNotePageORM(
                note_id=note_id,
                file_id=note_file.id,
                page_no=1,
                page_type="image",
                image_storage_key=page_storage_key,
                sort_order=1,
                status="ready",
            )
            db.add(page)
            db.flush()
            _create_asset_version(
                db,
                page=page,
                image_bytes=file_bytes,
                mime_type=mime_type,
                created_by=current_user.id,
                change_reason="Uploaded source image",
            )
            pages.append(page)

        note_file.status = "ready"
        note_file.page_count = len(pages)
        note_file.error_message = None
        note.last_updated_by = current_user.id
        db.commit()
    except Exception as exc:
        note_file.status = "failed"
        note_file.error_message = str(exc)
        db.commit()
        raise

    for page in pages:
        db.refresh(page)
    db.refresh(note_file)
    return FileUploadResult(note_file=note_file, pages=pages)


def list_note_files(db: Session, note_id: str, current_user: UserAccount) -> list[ResearchNoteFileORM]:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    return (
        db.query(ResearchNoteFileORM)
        .filter(ResearchNoteFileORM.note_id == note_id, ResearchNoteFileORM.is_deleted.is_(False))
        .order_by(ResearchNoteFileORM.created_at.desc())
        .all()
    )


def list_note_pages(db: Session, file_id: int, current_user: UserAccount) -> list[ResearchNotePageORM]:
    note_file = db.get(ResearchNoteFileORM, file_id)
    if note_file is None or note_file.is_deleted:
        return []
    note = _get_note(db, note_file.note_id)
    _require_note_access(db, note, current_user)
    return (
        db.query(ResearchNotePageORM)
        .filter(ResearchNotePageORM.file_id == file_id, ResearchNotePageORM.is_deleted.is_(False))
        .order_by(ResearchNotePageORM.sort_order.asc())
        .all()
    )


def list_pages_for_note(db: Session, note_id: str, current_user: UserAccount) -> list[ResearchNotePageORM]:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    return (
        db.query(ResearchNotePageORM)
        .filter(ResearchNotePageORM.note_id == note_id, ResearchNotePageORM.is_deleted.is_(False))
        .order_by(ResearchNotePageORM.sort_order.asc(), ResearchNotePageORM.page_no.asc())
        .all()
    )


def replace_note_page_asset(
    db: Session,
    *,
    page_id: int,
    current_user: UserAccount,
    original_name: str,
    mime_type: str,
    file_bytes: bytes,
    change_reason: str | None = None,
) -> ResearchNotePageORM:
    page = db.get(ResearchNotePageORM, page_id)
    if page is None or page.is_deleted:
        raise ResearchNoteNotFoundError(page_id)
    note_id = page.note_id
    if not note_id:
        source_file = db.get(ResearchNoteFileORM, page.file_id)
        if source_file is None or source_file.is_deleted:
            raise ResearchNoteNotFoundError(page_id)
        note_id = source_file.note_id
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Approved or submitted pages cannot be replaced")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can replace page images")

    file_type = _detect_file_type(mime_type, original_name)
    if file_type != "image":
        raise UnsupportedFileTypeError("Only images can replace a page asset")
    _ensure_upload_allowed(file_type, file_bytes)
    storage = LocalStorageService()
    page.image_storage_key = storage.save_bytes(
        file_bytes,
        f"notes/{note.id}/pages/{page.id}",
        original_name,
    )
    _create_asset_version(
        db,
        page=page,
        image_bytes=file_bytes,
        mime_type=mime_type,
        created_by=current_user.id,
        change_reason=change_reason or "Replaced page image",
    )
    note.last_updated_by = current_user.id
    db.commit()
    db.refresh(page)
    return page


def _latest_document(db: Session, note_id: str) -> ResearchNoteDocumentORM | None:
    return db.scalars(
        select(ResearchNoteDocumentORM)
        .where(ResearchNoteDocumentORM.note_id == note_id)
        .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
    ).first()


def _active_signature_for_user(db: Session, user: UserAccountORM) -> UserSignatureORM | None:
    signature = db.scalars(
        select(UserSignatureORM)
        .where(UserSignatureORM.user_id == user.id, UserSignatureORM.status == "active")
        .order_by(UserSignatureORM.created_at.desc(), UserSignatureORM.id.desc())
    ).first()
    if signature is not None:
        return signature
    if not user.signature_data_url:
        return None

    try:
        image_bytes = _decode_data_url(user.signature_data_url)
    except Exception:
        return None

    storage = LocalStorageService()
    storage_key = storage.save_bytes(image_bytes, f"signatures/{user.id}", "signature.png")
    signature = UserSignatureORM(
        user_id=user.id,
        image_storage_key=storage_key,
        checksum=_sha256(image_bytes),
        status="active",
    )
    db.add(signature)
    db.flush()
    return signature


def _create_signature_snapshot(
    db: Session,
    *,
    note: ResearchNoteORM,
    document: ResearchNoteDocumentORM | None,
    actor_user_id: int,
    actor_member_id: int | None,
    role: str,
) -> ResearchNoteSignatureSnapshotORM | None:
    user = db.get(UserAccountORM, actor_user_id)
    if user is None:
        return None
    signature = _active_signature_for_user(db, user)
    snapshot = ResearchNoteSignatureSnapshotORM(
        note_id=note.id,
        document_id=document.id if document else None,
        document_revision_id=document.current_revision_id if document else None,
        signer_user_id=actor_user_id,
        signer_member_id=actor_member_id,
        signature_id=signature.id if signature else None,
        role=role,
        signature_image_storage_key_snapshot=signature.image_storage_key if signature else None,
    )
    db.add(snapshot)
    db.flush()
    return snapshot


def _record_approval_event(
    db: Session,
    *,
    note: ResearchNoteORM,
    document: ResearchNoteDocumentORM | None,
    current_user: UserAccount,
    actor_member_id: int | None,
    event_type: str,
    comment: str | None,
    signature_snapshot: ResearchNoteSignatureSnapshotORM | None,
) -> ResearchNoteApprovalEventORM:
    event = ResearchNoteApprovalEventORM(
        note_id=note.id,
        document_id=document.id if document else None,
        document_revision_id=document.current_revision_id if document else None,
        actor_user_id=current_user.id or 0,
        actor_member_id=actor_member_id,
        event_type=event_type,
        comment=comment,
        signature_snapshot_id=signature_snapshot.id if signature_snapshot else None,
    )
    db.add(event)
    db.flush()
    return event


def _ensure_latest_document_for_action(db: Session, note_id: str) -> ResearchNoteDocumentORM:
    document = _latest_document(db, note_id)
    if document is None:
        raise ResearchNoteStateError("Create and save a note document before submitting")
    return document


def submit_research_note(
    db: Session,
    note_id: str,
    current_user: UserAccount,
    *,
    comment: str | None = None,
) -> ResearchNoteApprovalEventORM:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("Only the author, project lead, or company owner can submit this note")
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("Only draft, rejected, or reopened notes can be submitted")

    document = _ensure_latest_document_for_action(db, note_id)
    snapshot = _create_signature_snapshot(
        db,
        note=note,
        document=document,
        actor_user_id=current_user.id or 0,
        actor_member_id=company_member.id if company_member else None,
        role="author",
    )
    event = _record_approval_event(
        db,
        note=note,
        document=document,
        current_user=current_user,
        actor_member_id=company_member.id if company_member else None,
        event_type="submitted",
        comment=comment,
        signature_snapshot=snapshot,
    )
    note.status = "submitted"
    note.last_updated_by = current_user.id
    document.status = "submitted"
    db.commit()
    db.refresh(event)
    return event


def approve_research_note(
    db: Session,
    note_id: str,
    current_user: UserAccount,
    *,
    comment: str | None = None,
) -> ResearchNoteApprovalEventORM:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_reviewer = company_member is not None and note.reviewer_member_id == company_member.id
    if not can_manage and not is_reviewer:
        raise ResearchNoteManageDeniedError("Only the assigned reviewer, project lead, or company owner can approve this note")
    if note.status != "submitted":
        raise ResearchNoteStateError("Only submitted notes can be approved")

    document = _ensure_latest_document_for_action(db, note_id)
    snapshot = _create_signature_snapshot(
        db,
        note=note,
        document=document,
        actor_user_id=current_user.id or 0,
        actor_member_id=company_member.id if company_member else None,
        role="reviewer",
    )
    event = _record_approval_event(
        db,
        note=note,
        document=document,
        current_user=current_user,
        actor_member_id=company_member.id if company_member else None,
        event_type="approved",
        comment=comment,
        signature_snapshot=snapshot,
    )
    note.status = "approved"
    note.reviewed_date = note.reviewed_date or date.today()
    note.last_updated_by = current_user.id
    document.status = "approved"
    db.commit()
    db.refresh(event)
    return event


def reject_research_note(
    db: Session,
    note_id: str,
    current_user: UserAccount,
    *,
    comment: str | None,
) -> ResearchNoteApprovalEventORM:
    if not comment or not comment.strip():
        raise ResearchNoteStateError("A rejection comment is required")
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_reviewer = company_member is not None and note.reviewer_member_id == company_member.id
    if not can_manage and not is_reviewer:
        raise ResearchNoteManageDeniedError("Only the assigned reviewer, project lead, or company owner can reject this note")
    if note.status != "submitted":
        raise ResearchNoteStateError("Only submitted notes can be rejected")

    document = _ensure_latest_document_for_action(db, note_id)
    event = _record_approval_event(
        db,
        note=note,
        document=document,
        current_user=current_user,
        actor_member_id=company_member.id if company_member else None,
        event_type="rejected",
        comment=comment,
        signature_snapshot=None,
    )
    note.status = "rejected"
    note.last_updated_by = current_user.id
    document.status = "rejected"
    db.commit()
    db.refresh(event)
    return event


def reopen_research_note(
    db: Session,
    note_id: str,
    current_user: UserAccount,
    *,
    comment: str | None,
) -> ResearchNoteApprovalEventORM:
    if not comment or not comment.strip():
        raise ResearchNoteStateError("A reopen reason is required")
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user, manage=True)
    if note.status != "approved":
        raise ResearchNoteStateError("Only approved notes can be reopened")
    document = _ensure_latest_document_for_action(db, note_id)
    event = _record_approval_event(
        db,
        note=note,
        document=document,
        current_user=current_user,
        actor_member_id=company_member.id if company_member else None,
        event_type="reopened",
        comment=comment,
        signature_snapshot=None,
    )
    note.status = "reopened"
    note.last_updated_by = current_user.id
    document.status = "reopened"
    db.commit()
    db.refresh(event)
    return event


def list_approval_events(
    db: Session,
    note_id: str,
    current_user: UserAccount,
) -> list[ResearchNoteApprovalEventORM]:
    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    return list(
        db.scalars(
            select(ResearchNoteApprovalEventORM)
            .where(ResearchNoteApprovalEventORM.note_id == note_id)
            .order_by(ResearchNoteApprovalEventORM.created_at.asc(), ResearchNoteApprovalEventORM.id.asc())
        ).all()
    )
