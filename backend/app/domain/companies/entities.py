from dataclasses import dataclass
from datetime import date, datetime


@dataclass(slots=True)
class Company:
    id: int | None
    created_at: datetime | None
    updated_at: datetime | None
    name: str
    join_code: str
    is_active: bool

    def approve(self) -> None:
        self.is_active = True

    def suspend(self) -> None:
        self.is_active = False


@dataclass(slots=True)
class CompanyMember:
    id: int | None
    created_at: datetime | None
    updated_at: datetime | None
    company_id: int
    user_id: int
    role: str


@dataclass(slots=True)
class CompanyMembershipRequest:
    id: int | None
    created_at: datetime | None
    updated_at: datetime | None
    company_id: int
    user_id: int
    status: str


@dataclass(slots=True)
class Project:
    id: str | None
    created_at: datetime | None
    updated_at: datetime | None
    company_id: int
    name: str
    code: str
    description: str | None
    status: str
    owner_member_id: int | None
    start_date: date | None
    end_date: date | None
