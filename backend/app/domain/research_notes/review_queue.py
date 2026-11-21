"""Project note review queue: which notes need a person's attention before they can be trusted.

Four reasons put a note in the queue (a note can have several):
  ai_unreviewed      written by the LLM from GitHub changes and not yet confirmed by a person
  awaiting_approval  submitted and waiting for the reviewer
  rejected           sent back to the author
  needs_check        automatic checks found something (empty body, leftover "[확인 필요]", no attachment, ...)
"""

import json
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.research_notes.use_cases import (
    _can_manage_note,
    _get_project,
    _require_project_access,
)
from app.infrastructure.db.models import (
    CompanyMemberORM,
    GitHubGeneratedNoteORM,
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
    ResearchNoteFileORM,
    ResearchNoteORM,
    UserAccountORM,
)

FRAME_IDS = {"note-title", "continued-page", "recorded-by", "recorded-date", "witnessed-by", "witnessed-date"}
VERIFY_MARKERS = ("[확인 필요]", "[needs verification]")
MIN_BODY_CHARS = 20
CLOSED_STATUSES = {"approved", "locked"}


def _body_text(payload: str | None) -> str:
    """Text the author wrote (section headings, template labels and locked boxes are left out)."""
    if not payload:
        return ""
    try:
        blocks = json.loads(payload).get("blocks", [])
    except ValueError:
        return ""
    parts = []
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "text" or block.get("locked"):
            continue
        block_id = str(block.get("id") or "")
        if block_id in FRAME_IDS or (block_id.startswith("section-") and block_id.endswith("-heading")):
            continue
        content = str(block.get("content") or "").strip()
        if content:
            parts.append(content)
    return "\n".join(parts)


def _day(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def project_review_queue(db: Session, user: UserAccount, project_id: str, *, today: date | None = None) -> dict:
    project = _get_project(db, project_id)
    company_member = _require_project_access(db, project, user)
    can_manage = _can_manage_note(user, project, company_member)
    today = today or datetime.now(timezone.utc).date()

    notes = db.scalars(
        select(ResearchNoteORM)
        .where(ResearchNoteORM.project_id == project.id, ResearchNoteORM.is_deleted.is_(False))
        .order_by(ResearchNoteORM.updated_at.asc())
    ).all()
    note_ids = [note.id for note in notes]

    latest_payload: dict[str, str] = {}
    if note_ids:
        for note_id, payload in db.execute(
            select(ResearchNoteDocumentORM.note_id, ResearchNoteDocumentORM.document_payload)
            .where(ResearchNoteDocumentORM.note_id.in_(note_ids))
            .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
        ).all():
            latest_payload.setdefault(note_id, payload)

    file_counts = dict(
        db.execute(
            select(ResearchNoteFileORM.note_id, func.count(ResearchNoteFileORM.id))
            .where(ResearchNoteFileORM.note_id.in_(note_ids), ResearchNoteFileORM.is_deleted.is_(False))
            .group_by(ResearchNoteFileORM.note_id)
        ).all()
    ) if note_ids else {}

    github_rows = {
        row.note_id: row
        for row in db.scalars(
            select(GitHubGeneratedNoteORM).where(
                GitHubGeneratedNoteORM.note_id.in_(note_ids), GitHubGeneratedNoteORM.review_required.is_(True)
            )
        )
    } if note_ids else {}

    batch_notes = set()
    if note_ids:
        batch_notes = {
            document_note
            for document_note in db.scalars(
                select(ResearchNoteDocumentORM.note_id)
                .join(ResearchNoteDocumentRevisionORM, ResearchNoteDocumentRevisionORM.document_id == ResearchNoteDocumentORM.id)
                .where(
                    ResearchNoteDocumentORM.note_id.in_(note_ids),
                    ResearchNoteDocumentRevisionORM.change_summary.like("AI batch%"),
                )
            )
        }

    member_ids = {note.owner_member_id for note in notes} | {note.reviewer_member_id for note in notes if note.reviewer_member_id}
    people: dict[int, tuple[str, bool]] = {}
    if member_ids:
        for member_id, name, signature in db.execute(
            select(CompanyMemberORM.id, UserAccountORM.display_name, UserAccountORM.signature_data_url)
            .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
            .where(CompanyMemberORM.id.in_(member_ids))
        ).all():
            people[member_id] = (name, bool(signature))

    items = []
    counts = {"ai_unreviewed": 0, "awaiting_approval": 0, "rejected": 0, "needs_check": 0}
    clean = 0
    for note in notes:
        if note.status in CLOSED_STATUSES:
            continue
        tags: list[str] = []
        checks: list[str] = []

        github_row = github_rows.get(note.id)
        if github_row is not None and github_row.reviewed_at is None:
            tags.append("ai_unreviewed")
        if note.status == "submitted":
            tags.append("awaiting_approval")
        if note.status == "rejected":
            tags.append("rejected")

        body = _body_text(latest_payload.get(note.id)) or (note.content or "").strip()
        if len(body) < MIN_BODY_CHARS:
            checks.append("본문이 거의 비어 있음")
        else:
            leftover = sum(body.count(marker) for marker in VERIFY_MARKERS)
            if leftover:
                checks.append(f"'[확인 필요]' 표시 {leftover}곳이 남아 있음")
        if not file_counts.get(note.id):
            checks.append("첨부 파일이 없음")
        if note.reviewer_member_id is None:
            checks.append("검토자가 지정되지 않음")
        missing_signatures = []
        if not people.get(note.owner_member_id, ("", True))[1]:
            missing_signatures.append("작성자")
        if note.reviewer_member_id is not None and not people.get(note.reviewer_member_id, ("", True))[1]:
            missing_signatures.append("검토자")
        if missing_signatures:
            checks.append(f"서명 미등록: {', '.join(missing_signatures)}")
        written = _day(note.written_date)
        # The server date is UTC; a note dated "today" in Korea can be one day ahead of it.
        if written and written > today + timedelta(days=1):
            checks.append("작성일이 오늘보다 뒤임")
        if checks:
            tags.append("needs_check")

        if not tags:
            clean += 1
            continue
        for tag in tags:
            counts[tag] += 1

        owner = people.get(note.owner_member_id)
        reviewer = people.get(note.reviewer_member_id) if note.reviewer_member_id else None
        is_author = company_member is not None and company_member.id == note.owner_member_id
        ai_source = "github" if github_row is not None else "ai_batch" if note.id in batch_notes else None
        items.append(
            {
                "id": note.id,
                "title": note.title,
                "status": note.status,
                "written_date": written.isoformat() if written else None,
                "updated_days": max(0, (today - (_day(note.updated_at) or today)).days),
                "author_member_id": note.owner_member_id,
                "author_name": owner[0] if owner else "",
                "reviewer_name": reviewer[0] if reviewer else None,
                "tags": tags,
                "checks": checks,
                "ai_source": ai_source,
                "ai_model": github_row.ai_model if github_row is not None else None,
                "can_confirm_ai": bool(github_row is not None and github_row.reviewed_at is None and (is_author or can_manage)),
            }
        )

    # Waiting longest first inside each reason; approval and rejection before softer problems.
    priority = {"awaiting_approval": 0, "rejected": 1, "ai_unreviewed": 2, "needs_check": 3}
    items.sort(key=lambda item: (min(priority[tag] for tag in item["tags"]), -item["updated_days"], item["title"]))
    return {"project_id": project.id, "counts": counts, "total": len(items), "clean": clean, "items": items}
