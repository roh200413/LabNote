"""Numbers for the workspace home that the note list alone cannot give (approval turnaround)."""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.research_notes.use_cases import list_research_notes
from app.infrastructure.db.models import CompanyMemberORM, ResearchNoteApprovalEventORM

WINDOW_DAYS = 90


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo else value.replace(tzinfo=timezone.utc)


def approval_turnaround(db: Session, current_user: UserAccount, *, mine: bool) -> dict:
    """Average days from submission to approval for notes approved in the last 90 days.

    ``mine`` limits it to notes the user wrote; otherwise every note the user can see.
    """
    notes = list_research_notes(db, current_user)
    if mine:
        member_ids = set(
            db.scalars(select(CompanyMemberORM.id).where(CompanyMemberORM.user_id == (current_user.id or 0))).all()
        )
        notes = [note for note in notes if note.owner_member_id in member_ids]
    note_ids = [note.id for note in notes]
    if not note_ids:
        return {"average_days": None, "approved_count": 0, "window_days": WINDOW_DAYS}

    events = db.execute(
        select(ResearchNoteApprovalEventORM.note_id, ResearchNoteApprovalEventORM.event_type, ResearchNoteApprovalEventORM.created_at)
        .where(
            ResearchNoteApprovalEventORM.note_id.in_(note_ids),
            ResearchNoteApprovalEventORM.event_type.in_(["submitted", "approved"]),
        )
        .order_by(ResearchNoteApprovalEventORM.created_at.asc(), ResearchNoteApprovalEventORM.id.asc())
    ).all()

    since = datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)
    last_submitted: dict[str, datetime] = {}
    durations: list[float] = []
    for note_id, event_type, created_at in events:
        when = _aware(created_at)
        if event_type == "submitted":
            last_submitted[note_id] = when
        elif event_type == "approved" and note_id in last_submitted and when >= since:
            durations.append((when - last_submitted.pop(note_id)).total_seconds() / 86400)

    average = round(sum(durations) / len(durations), 1) if durations else None
    return {"average_days": average, "approved_count": len(durations), "window_days": WINDOW_DAYS}
