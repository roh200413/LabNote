from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from app.domain.note_formats.entities import DEFAULT_NOTE_FORMAT, NoteFormat
from app.domain.note_formats.use_cases import (
    NoteFormatAccessDeniedError,
    NoteFormatManageDeniedError,
    delete_my_note_format,
    get_my_note_format,
    save_my_note_format,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/note-format", tags=["note-format"])


class NoteFormatResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    company_id: int | None
    is_custom: bool
    can_manage: bool
    format: NoteFormat
    default_format: NoteFormat


def _response(company_id: int | None, note_format: NoteFormat, is_custom: bool, can_manage: bool) -> dict:
    return {
        "company_id": company_id,
        "is_custom": is_custom,
        "can_manage": can_manage,
        "format": note_format.model_dump(by_alias=True),
        "default_format": DEFAULT_NOTE_FORMAT.model_dump(by_alias=True),
    }


@router.get("")
def get_note_format_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return _response(*get_my_note_format(db, current_user))
    except NoteFormatAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("")
def save_note_format_endpoint(
    payload: NoteFormat,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        save_my_note_format(db, current_user, payload)
        return _response(*get_my_note_format(db, current_user))
    except NoteFormatAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except NoteFormatManageDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete("")
def delete_note_format_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    """Deletes the company format; the response is the (now default) format."""
    try:
        delete_my_note_format(db, current_user)
        return _response(*get_my_note_format(db, current_user))
    except (NoteFormatAccessDeniedError, NoteFormatManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
