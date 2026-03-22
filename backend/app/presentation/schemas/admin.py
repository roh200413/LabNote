from datetime import datetime

from pydantic import BaseModel, Field


class AdminLoginEventResponse(BaseModel):
    id: int
    occurred_at: datetime
    user_id: int | None
    email: str
    event_type: str


class AdminDashboardPointResponse(BaseModel):
    date: str
    count: int


class AdminDashboardResponse(BaseModel):
    total_users: int
    total_organizations: int
    active_admins: int
    pending_organizations: int
    logins_by_day: list[AdminDashboardPointResponse]
    recent_logins: list[AdminLoginEventResponse]


class AdminUserResponse(BaseModel):
    id: int
    email: str
    name: str
    is_active: bool
    is_admin: bool
    is_org_owner: bool
    approval_status: str
    organization_id: int | None
    created_at: datetime


class AdminUserUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    is_admin: bool | None = None
    organization_id: int | None = None


class OrganizationResponse(BaseModel):
    id: int
    name: str
    code: str
    description: str | None
    is_active: bool
    owner_user_id: int | None
    approval_status: str
    created_at: datetime


class OrganizationCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=6, max_length=6)


class OrganizationUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=6, max_length=6)
    description: str | None = None
    is_active: bool | None = None
