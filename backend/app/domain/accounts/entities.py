from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class UserAccount:
    id: int | None
    created_at: datetime | None
    updated_at: datetime | None
    username: str
    display_name: str
    email: str
    password: str
    global_role: str
    is_active: bool
    is_approved: bool
    signature_data_url: str | None = None

    def approve(self) -> None:
        self.is_approved = True
        self.is_active = True

    def reject(self) -> None:
        self.is_approved = False
        self.is_active = False

    @property
    def is_system_admin(self) -> bool:
        return self.global_role == "system_admin"

    @property
    def is_company_owner(self) -> bool:
        return self.global_role == "company_owner"
