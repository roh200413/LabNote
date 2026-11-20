from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.infrastructure.repositories.sqlalchemy_identity import (
    SqlAlchemyAuditLogRepository,
    SqlAlchemyCompanyRepository,
    SqlAlchemyUserAccountRepository,
)


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_admin_dashboard(db: Session) -> dict:
    from app.domain.companies.use_cases import list_pending_organizations

    users = SqlAlchemyUserAccountRepository(db).list_all()
    companies = SqlAlchemyCompanyRepository(db).list_all()
    audits = SqlAlchemyAuditLogRepository(db)

    since = datetime.now(timezone.utc) - timedelta(days=6)
    recent_logins = [entry for entry in audits.list_recent(30) if entry.action == "login"][:10]
    login_entries = audits.list_by_action_since("login", since.date().isoformat())

    counts: dict[str, int] = {}
    for entry in login_entries:
        if entry.created_at is None:
            continue
        day = entry.created_at.date().isoformat()
        counts[day] = counts.get(day, 0) + 1

    logins_by_day = []
    for offset in range(7):
        day = (since + timedelta(days=offset)).date().isoformat()
        logins_by_day.append({"date": day, "count": counts.get(day, 0)})

    return {
        "total_users": len(users),
        "total_organizations": len(companies),
        "active_admins": sum(1 for user in users if user.global_role == "system_admin" and user.is_active),
        "pending_organizations": len(list_pending_organizations(db)),
        "logins_by_day": logins_by_day,
        "recent_logins": [
            {
                "id": entry.id,
                "occurred_at": entry.created_at,
                "user_id": entry.actor_user_id,
                "email": entry.detail.split(" for ")[-1] if entry.detail and " for " in entry.detail else "",
                "event_type": entry.action,
            }
            for entry in recent_logins
        ],
    }
