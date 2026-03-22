from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class AuditLogEntry:
    id: int | None
    created_at: datetime | None
    actor_user_id: int | None
    company_id: int | None
    target_type: str
    target_id: str
    action: str
    detail: str | None
