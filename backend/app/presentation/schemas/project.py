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


class ProjectUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    code: str | None = Field(default=None, min_length=1, max_length=100)
    description: str | None = None
    status: str | None = None
    owner_member_id: int | None = None
    start_date: date | None = None
    end_date: date | None = None


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


class ProjectMemberAssignRequest(BaseModel):
    company_member_id: int
    role: str = "member"


class ProjectMemberResponse(BaseModel):
    id: int
    project_id: str
    company_member_id: int
    role: str
    created_at: datetime
    updated_at: datetime
