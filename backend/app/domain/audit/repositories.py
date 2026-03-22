from collections.abc import Sequence
from typing import Protocol

from app.domain.audit.entities import AuditLogEntry


class AuditLogRepository(Protocol):
    def add(self, entry: AuditLogEntry) -> AuditLogEntry: ...
    def list_recent(self, limit: int = 10) -> Sequence[AuditLogEntry]: ...
    def list_by_action_since(self, action: str, since_iso_date: str) -> Sequence[AuditLogEntry]: ...
