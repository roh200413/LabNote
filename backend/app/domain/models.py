from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(slots=True)
class Project:
    id: UUID
    company_id: int
    name: str
    code: str
    created_at: datetime
    updated_at: datetime
