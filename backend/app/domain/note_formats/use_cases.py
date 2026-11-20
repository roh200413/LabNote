import json

from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.note_formats.entities import DEFAULT_NOTE_FORMAT, NoteFormat
from app.infrastructure.db.models import CompanyMemberORM, CompanyNoteFormatORM, ProjectORM, ResearchNoteORM


class NoteFormatAccessDeniedError(Exception):
    pass


class NoteFormatManageDeniedError(Exception):
    pass


def _parse(payload: str | None) -> NoteFormat:
    if not payload:
        return DEFAULT_NOTE_FORMAT.model_copy(deep=True)
    try:
        return NoteFormat.model_validate(json.loads(payload))
    except (ValueError, ValidationError):
        # A stored format that no longer validates falls back to the default rather than breaking exports.
        return DEFAULT_NOTE_FORMAT.model_copy(deep=True)


def get_company_note_format(db: Session, company_id: int | None) -> NoteFormat:
    if company_id is None:
        return DEFAULT_NOTE_FORMAT.model_copy(deep=True)
    row = db.scalar(select(CompanyNoteFormatORM).where(CompanyNoteFormatORM.company_id == company_id))
    return _parse(row.payload if row else None)


def get_note_format_for_note(db: Session, note: ResearchNoteORM) -> NoteFormat:
    project = db.get(ProjectORM, note.project_id)
    return get_company_note_format(db, project.company_id if project else None)


def _primary_membership(db: Session, user: UserAccount) -> CompanyMemberORM | None:
    return db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == (user.id or 0)).order_by(CompanyMemberORM.id.asc())
    )


def get_my_note_format(db: Session, current_user: UserAccount) -> tuple[int | None, NoteFormat, bool, bool]:
    """Returns (company_id, format, is_custom, can_manage) for the user's company."""
    membership = _primary_membership(db, current_user)
    if membership is None:
        if current_user.is_system_admin:
            return None, DEFAULT_NOTE_FORMAT.model_copy(deep=True), False, False
        raise NoteFormatAccessDeniedError("소속된 기관이 없습니다")
    row = db.scalar(select(CompanyNoteFormatORM).where(CompanyNoteFormatORM.company_id == membership.company_id))
    can_manage = membership.role == "owner" or current_user.is_system_admin
    return membership.company_id, _parse(row.payload if row else None), row is not None, can_manage


def delete_my_note_format(db: Session, current_user: UserAccount) -> None:
    """Removes the company's saved format so every note goes back to the built-in default."""
    membership = _primary_membership(db, current_user)
    if membership is None:
        raise NoteFormatAccessDeniedError("소속된 기관이 없습니다")
    if membership.role != "owner" and not current_user.is_system_admin:
        raise NoteFormatManageDeniedError("노트 포맷은 기관 관리자만 바꿀 수 있습니다")
    row = db.scalar(select(CompanyNoteFormatORM).where(CompanyNoteFormatORM.company_id == membership.company_id))
    if row is not None:
        db.delete(row)
        db.commit()


def save_my_note_format(db: Session, current_user: UserAccount, note_format: NoteFormat) -> NoteFormat:
    membership = _primary_membership(db, current_user)
    if membership is None:
        raise NoteFormatAccessDeniedError("소속된 기관이 없습니다")
    if membership.role != "owner" and not current_user.is_system_admin:
        raise NoteFormatManageDeniedError("노트 포맷은 기관 관리자만 바꿀 수 있습니다")

    payload = json.dumps(note_format.model_dump(by_alias=True), ensure_ascii=False)
    row = db.scalar(select(CompanyNoteFormatORM).where(CompanyNoteFormatORM.company_id == membership.company_id))
    if row is None:
        row = CompanyNoteFormatORM(company_id=membership.company_id, payload=payload, updated_by=current_user.id)
        db.add(row)
    else:
        row.payload = payload
        row.updated_by = current_user.id
    db.commit()
    return _parse(row.payload)
