"""User feedback (불편사항·버그·개선 제안·문의): users send it, system admins answer it."""

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.infrastructure.db.models import CompanyMemberORM, CompanyORM, UserAccountORM, UserFeedbackORM

CATEGORIES = {"bug", "improvement", "question", "other"}
STATUSES = {"open", "in_progress", "resolved", "closed"}


class FeedbackNotFoundError(Exception):
    pass


def _to_dict(row: UserFeedbackORM, user: UserAccountORM | None = None, company: CompanyORM | None = None) -> dict:
    return {
        "id": row.id,
        "created_at": row.created_at.isoformat() if row.created_at else None,
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
        "category": row.category,
        "title": row.title,
        "content": row.content,
        "page": row.page,
        "status": row.status,
        "admin_reply": row.admin_reply,
        "replied_at": row.replied_at.isoformat() if row.replied_at else None,
        "user_id": row.user_id,
        "user_name": user.display_name if user else None,
        "user_email": user.email if user else None,
        "company_name": company.name if company else None,
    }


def create_feedback(
    db: Session,
    user: UserAccount,
    *,
    category: str,
    title: str,
    content: str,
    page: str | None = None,
) -> dict:
    if category not in CATEGORIES:
        raise ValueError("의견 종류가 올바르지 않습니다")
    title, content = title.strip(), content.strip()
    if not title:
        raise ValueError("제목을 입력하세요")
    if not content:
        raise ValueError("내용을 입력하세요")
    membership = db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == (user.id or 0)).order_by(CompanyMemberORM.id.asc())
    )
    row = UserFeedbackORM(
        user_id=user.id,
        company_id=membership.company_id if membership else None,
        category=category,
        title=title[:200],
        content=content,
        page=(page or "").strip()[:200] or None,
        status="open",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _to_dict(row)


def list_my_feedback(db: Session, user: UserAccount) -> list[dict]:
    rows = db.scalars(
        select(UserFeedbackORM)
        .where(UserFeedbackORM.user_id == (user.id or 0))
        .order_by(UserFeedbackORM.created_at.desc(), UserFeedbackORM.id.desc())
    ).all()
    return [_to_dict(row) for row in rows]


def list_all_feedback(db: Session, *, status: str | None = None, category: str | None = None) -> list[dict]:
    stmt = (
        select(UserFeedbackORM, UserAccountORM, CompanyORM)
        .join(UserAccountORM, UserAccountORM.id == UserFeedbackORM.user_id)
        .outerjoin(CompanyORM, CompanyORM.id == UserFeedbackORM.company_id)
    )
    if status:
        stmt = stmt.where(UserFeedbackORM.status == status)
    if category:
        stmt = stmt.where(UserFeedbackORM.category == category)
    rows = db.execute(stmt.order_by(UserFeedbackORM.created_at.desc(), UserFeedbackORM.id.desc())).all()
    return [_to_dict(row, user, company) for row, user, company in rows]


def count_open_feedback(db: Session) -> int:
    return db.scalar(select(func.count(UserFeedbackORM.id)).where(UserFeedbackORM.status.in_(["open", "in_progress"]))) or 0


def answer_feedback(
    db: Session,
    admin: UserAccount,
    feedback_id: int,
    *,
    status: str | None = None,
    admin_reply: str | None = None,
) -> dict:
    row = db.get(UserFeedbackORM, feedback_id)
    if row is None:
        raise FeedbackNotFoundError(feedback_id)
    if status is not None:
        if status not in STATUSES:
            raise ValueError("처리 상태가 올바르지 않습니다")
        row.status = status
    if admin_reply is not None:
        reply = admin_reply.strip()
        if reply != (row.admin_reply or ""):
            row.admin_reply = reply or None
            row.replied_at = datetime.now(timezone.utc) if reply else None
            row.replied_by = admin.id if reply else None
    db.commit()
    db.refresh(row)
    return _to_dict(row, db.get(UserAccountORM, row.user_id), db.get(CompanyORM, row.company_id) if row.company_id else None)
