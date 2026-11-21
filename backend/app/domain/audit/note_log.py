"""Audit trail for research notes: who did what to a note, and when.

Entries use ``target_type="research_note"`` and the note id as ``target_id``. Nothing references the
note by foreign key, so the trail survives deleting the note. ``detail`` is a JSON object that always
holds ``project_id`` and ``title`` (the title as it was at that time) plus action-specific fields.
"""

import json

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db.models import AuditLogORM, ProjectORM, ResearchNoteORM, UserAccountORM

TARGET_TYPE = "research_note"

# action -> label shown in the UI
ACTION_LABELS = {
    "note_create": "노트 생성",
    "note_update": "노트 정보 수정",
    "note_assign": "담당자 변경",
    "note_delete": "노트 삭제",
    "note_file_upload": "파일 업로드",
    "note_page_replace": "페이지 이미지 교체",
    "note_document_save": "문서 저장",
    "note_submit": "제출",
    "note_approve": "승인",
    "note_reject": "반려",
    "note_reopen": "재개",
    "note_export": "PDF 내보내기",
    "note_move_bundle": "묶음 이동",
}


def record_note_event(
    db: Session,
    *,
    note: ResearchNoteORM,
    actor_user_id: int | None,
    action: str,
    **detail: object,
) -> None:
    """Add one audit entry in the caller's transaction (flushed, committed with the caller's commit)."""
    project = db.get(ProjectORM, note.project_id) if note.project_id else None
    payload = {"project_id": note.project_id, "title": note.title, **detail}
    db.add(
        AuditLogORM(
            actor_user_id=actor_user_id,
            company_id=project.company_id if project else None,
            target_type=TARGET_TYPE,
            target_id=note.id,
            action=action,
            detail=json.dumps(payload, ensure_ascii=False, default=str),
        )
    )
    db.flush()


def _entry(row: AuditLogORM, actors: dict[int, str]) -> dict:
    try:
        detail = json.loads(row.detail) if row.detail else {}
    except json.JSONDecodeError:
        detail = {}
    if not isinstance(detail, dict):
        detail = {}
    return {
        "id": row.id,
        "created_at": row.created_at,
        "actor_user_id": row.actor_user_id,
        "actor_name": actors.get(row.actor_user_id or 0, "-"),
        "action": row.action,
        "action_label": ACTION_LABELS.get(row.action, row.action),
        "note_id": row.target_id,
        "note_title": detail.get("title"),
        "detail": {key: value for key, value in detail.items() if key not in {"project_id", "title"}},
    }


def _actor_names(db: Session, rows: list[AuditLogORM]) -> dict[int, str]:
    ids = {row.actor_user_id for row in rows if row.actor_user_id}
    if not ids:
        return {}
    users = db.scalars(select(UserAccountORM).where(UserAccountORM.id.in_(ids))).all()
    return {user.id: user.display_name or user.email for user in users}


def list_note_events(db: Session, note_id: str, *, limit: int = 200) -> list[dict]:
    rows = list(
        db.scalars(
            select(AuditLogORM)
            .where(AuditLogORM.target_type == TARGET_TYPE, AuditLogORM.target_id == note_id)
            .order_by(AuditLogORM.id.desc())
            .limit(limit)
        ).all()
    )
    actors = _actor_names(db, rows)
    return [_entry(row, actors) for row in rows]


def list_project_events(db: Session, project: ProjectORM, *, limit: int = 300) -> list[dict]:
    """All note events of a project, including notes that were deleted since."""
    marker = f'"project_id": "{project.id}"'
    rows = list(
        db.scalars(
            select(AuditLogORM)
            .where(
                AuditLogORM.target_type == TARGET_TYPE,
                AuditLogORM.company_id == project.company_id,
                AuditLogORM.detail.like(f"%{marker}%"),
            )
            .order_by(AuditLogORM.id.desc())
            .limit(limit)
        ).all()
    )
    actors = _actor_names(db, rows)
    return [_entry(row, actors) for row in rows]
