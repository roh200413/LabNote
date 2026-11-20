"""Per-member research note activity for a project dashboard, with "needs attention" flags."""

import math
from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.projects.use_cases import _ensure_project_lead_membership, _require_project
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ProjectActivityRuleORM,
    ProjectMemberORM,
    ResearchNoteORM,
    UserAccountORM,
)

# Defaults when a project has not set its own rules. A day value of 0 turns that check off.
DEFAULT_RULES = {
    "inactive_days": 14,  # no note for this long → flagged
    "stale_draft_days": 7,  # draft left unsubmitted this long → flagged
    "review_wait_days": 7,  # submitted note waiting for this reviewer this long → flagged
    "check_rejected": True,  # rejected notes not fixed yet → flagged
    "check_monthly_pace": True,  # behind the project's monthly target (per-person share) → flagged
}


def get_activity_rules(db: Session, project_id: str) -> dict:
    row = db.get(ProjectActivityRuleORM, project_id)
    if row is None:
        return {**DEFAULT_RULES, "is_custom": False}
    return {
        "inactive_days": row.inactive_days,
        "stale_draft_days": row.stale_draft_days,
        "review_wait_days": row.review_wait_days,
        "check_rejected": row.check_rejected,
        "check_monthly_pace": row.check_monthly_pace,
        "is_custom": True,
    }


def save_activity_rules(db: Session, project_id: str, current_user: UserAccount, **values) -> dict:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    for key in ("inactive_days", "stale_draft_days", "review_wait_days"):
        if not 0 <= int(values[key]) <= 365:
            raise ValueError("일수는 0~365 사이로 입력하세요 (0은 확인 안 함)")
    row = db.get(ProjectActivityRuleORM, project.id)
    if row is None:
        row = ProjectActivityRuleORM(project_id=project.id)
        db.add(row)
    for key in DEFAULT_RULES:
        setattr(row, key, values[key])
    row.updated_by = current_user.id
    db.commit()
    return get_activity_rules(db, project.id)


def reset_activity_rules(db: Session, project_id: str, current_user: UserAccount) -> dict:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    row = db.get(ProjectActivityRuleORM, project.id)
    if row is not None:
        db.delete(row)
        db.commit()
    return get_activity_rules(db, project.id)


def _day(value: date | datetime | None) -> date | None:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


def project_note_activity(db: Session, project_id: str, current_user: UserAccount, *, today: date | None = None) -> dict:
    project, member = _require_project(db, project_id=project_id, current_user=current_user)
    _ensure_project_lead_membership(db, project_id=project.id, owner_member_id=project.owner_member_id)
    db.commit()
    rules = get_activity_rules(db, project.id)
    can_manage_rules = bool(
        current_user.is_system_admin
        or current_user.is_company_owner
        or (member is not None and project.owner_member_id == member.id)
    )
    today = today or datetime.now(timezone.utc).date()
    month_start = today.replace(day=1)

    members = db.execute(
        select(ProjectMemberORM, CompanyMemberORM, UserAccountORM)
        .join(CompanyMemberORM, CompanyMemberORM.id == ProjectMemberORM.company_member_id)
        .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
        .where(ProjectMemberORM.project_id == project.id)
        .order_by(UserAccountORM.display_name.asc())
    ).all()
    notes = db.scalars(
        select(ResearchNoteORM).where(ResearchNoteORM.project_id == project.id, ResearchNoteORM.is_deleted.is_(False))
    ).all()

    member_count = max(1, len(members))
    target = project.monthly_note_target
    # The project's monthly target is shared; each member's fair share is used for the per-person check.
    share = math.ceil(target / member_count) if target else None
    # Only judge the monthly pace after the first week, so the 1st of the month is not full of warnings.
    pace_ratio = min(1.0, today.day / 30)

    rows = []
    for project_member, company_member, user in members:
        mine = [note for note in notes if note.owner_member_id == company_member.id]
        written = [_day(note.written_date) or _day(note.created_at) for note in mine]
        written = [value for value in written if value]
        last = max(written) if written else None
        this_month = sum(1 for value in written if value >= month_start)
        drafts = [note for note in mine if note.status in {"draft", "reopened"}]
        stale_drafts = [
            note
            for note in drafts
            if rules["stale_draft_days"] and (today - (_day(note.updated_at) or today)).days >= rules["stale_draft_days"]
        ]
        rejected = [note for note in mine if note.status == "rejected"]
        waiting_review = [
            note
            for note in notes
            if note.reviewer_member_id == company_member.id
            and note.status == "submitted"
            and rules["review_wait_days"]
            and (today - (_day(note.updated_at) or today)).days >= rules["review_wait_days"]
        ]

        issues: list[str] = []
        days_since = (today - last).days if last else None
        if last is None:
            issues.append("아직 작성한 연구노트가 없음")
        elif rules["inactive_days"] and days_since is not None and days_since >= rules["inactive_days"]:
            issues.append(f"{days_since}일째 연구노트 미작성")
        if rules["check_rejected"] and rejected:
            issues.append(f"반려된 노트 {len(rejected)}건 미처리")
        if stale_drafts:
            issues.append(f"{rules['stale_draft_days']}일 넘게 제출 안 한 초안 {len(stale_drafts)}건")
        if waiting_review:
            issues.append(f"{rules['review_wait_days']}일 넘게 결재 대기 {len(waiting_review)}건")
        if rules["check_monthly_pace"] and share and today.day > 7 and this_month < math.floor(share * pace_ratio):
            issues.append(f"이번 달 {this_month}건 (목표 페이스 {math.floor(share * pace_ratio)}건)")

        rows.append(
            {
                "company_member_id": company_member.id,
                "name": user.display_name,
                "email": user.email,
                "role": project_member.role,
                "is_lead": project.owner_member_id == company_member.id,
                "total": len(mine),
                "this_month": this_month,
                "monthly_share": share,
                "last_written": last.isoformat() if last else None,
                "days_since_last": days_since,
                "drafts": len(drafts),
                "rejected": len(rejected),
                "waiting_review": len(waiting_review),
                "issues": issues,
                "needs_attention": bool(issues),
            }
        )

    rows.sort(key=lambda row: (not row["needs_attention"], -len(row["issues"]), row["name"]))
    month_total = sum(
        1 for note in notes if (_day(note.written_date) or _day(note.created_at) or today) >= month_start
    )
    return {
        "project_id": project.id,
        "today": today.isoformat(),
        "month_start": month_start.isoformat(),
        "monthly_target": target,
        "month_total": month_total,
        "member_count": len(members),
        "attention_count": sum(1 for row in rows if row["needs_attention"]),
        "rules": rules,
        "can_manage_rules": can_manage_rules,
        "members": rows,
    }
