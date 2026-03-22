from datetime import date, datetime

from pydantic import BaseModel, Field


class ProjectCreateRequest(BaseModel):
    company_id: int
    name: str = Field(min_length=1, max_length=255)
    code: str = Field(min_length=1, max_length=100)
    description: str | None = None
    status: str = "active"
    owner_member_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    monthly_note_target: int | None = None


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    status: str | None = None
    owner_member_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    monthly_note_target: int | None = None


class ProjectResponse(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    company_id: int
    name: str
    code: str
    description: str | None
    status: str
    owner_member_id: int | None
    start_date: date | None
    end_date: date | None
    monthly_note_target: int | None


class ProjectNoteCoverResponse(BaseModel):
    id: int
    project_id: str
    cover_image_data_url: str | None
    template_payload: str | None
    show_business_name: bool
    show_title: bool
    show_code: bool
    show_org: bool
    show_manager: bool
    show_period: bool
    created_at: datetime
    updated_at: datetime


class ProjectNoteCoverUpsertRequest(BaseModel):
    cover_image_data_url: str | None = None
    template_payload: str | None = None
    show_business_name: bool = True
    show_title: bool = True
    show_code: bool = True
    show_org: bool = True
    show_manager: bool = True
    show_period: bool = True


class ProjectMemberAssignRequest(BaseModel):
    company_member_id: int
    role: str = "member"


class ProjectMemberResponse(BaseModel):
    id: int
    project_id: str
    company_member_id: int
    company_id: int
    user_id: int
    name: str
    email: str
    company_role: str
    role: str
    is_active: bool
    is_approved: bool
    created_at: datetime
    updated_at: datetime
