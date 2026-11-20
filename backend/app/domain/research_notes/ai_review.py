"""Human review of research notes written by an LLM from GitHub code changes.

A note whose text came from the LLM cannot be submitted for approval until its author (or the
project lead / organization admin) confirms they checked it against the actual change.
"""

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.infrastructure.db.models import GitHubGeneratedNoteORM, UserAccountORM


def _review_row(db: Session, note_id: str) -> GitHubGeneratedNoteORM | None:
    return db.scalar(
        select(GitHubGeneratedNoteORM)
        .where(GitHubGeneratedNoteORM.note_id == note_id, GitHubGeneratedNoteORM.review_required.is_(True))
        .order_by(GitHubGeneratedNoteORM.id.desc())
    )


def get_ai_review(db: Session, note_id: str, current_user: UserAccount) -> dict:
    from app.domain.research_notes.use_cases import _get_note, _require_note_access

    note = _get_note(db, note_id)
    _require_note_access(db, note, current_user)
    row = _review_row(db, note_id)
    if row is None:
        return {"required": False, "reviewed": False, "source": None, "model": None, "reviewed_by_name": None, "reviewed_at": None}
    reviewer = db.get(UserAccountORM, row.reviewed_by) if row.reviewed_by else None
    reviewed_at = row.reviewed_at
    if reviewed_at is not None and reviewed_at.tzinfo is None:
        reviewed_at = reviewed_at.replace(tzinfo=timezone.utc)  # SQLite drops the zone; values are stored in UTC
    return {
        "required": True,
        "reviewed": row.reviewed_at is not None,
        "source": "github",
        "model": row.ai_model,
        "reviewed_by_name": reviewer.display_name if reviewer else None,
        "reviewed_at": reviewed_at.isoformat() if reviewed_at else None,
    }


def ensure_ai_review_done(db: Session, note_id: str) -> None:
    """Raises when an AI-written note has not been checked by a person yet."""
    from app.domain.research_notes.use_cases import ResearchNoteStateError

    row = _review_row(db, note_id)
    if row is not None and row.reviewed_at is None:
        raise ResearchNoteStateError(
            "AI가 GitHub 변경 내용으로 작성한 노트입니다. 실제 변경과 맞는지 검토하고 '검토 완료'를 눌러야 제출할 수 있습니다"
        )


def confirm_ai_review(db: Session, note_id: str, current_user: UserAccount) -> dict:
    from app.domain.research_notes.use_cases import (
        EDITABLE_NOTE_STATUSES,
        ResearchNoteManageDeniedError,
        ResearchNoteStateError,
        _can_manage_note,
        _get_note,
        _require_note_access,
    )

    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if not is_author and not _can_manage_note(current_user, project, company_member):
        raise ResearchNoteManageDeniedError("작성자, 프로젝트 책임자, 기관 관리자만 AI 작성 내용을 검토 완료할 수 있습니다")
    row = _review_row(db, note_id)
    if row is None:
        raise ResearchNoteStateError("AI 검토가 필요한 노트가 아닙니다")
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("이미 제출된 노트입니다")
    if row.reviewed_at is None:
        row.reviewed_by = current_user.id
        row.reviewed_at = datetime.now(timezone.utc)
        db.commit()
    return get_ai_review(db, note_id, current_user)
