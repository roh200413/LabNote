from datetime import date, datetime

from pydantic import BaseModel, Field


class ResearchNoteCreateRequest(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=255)
    content: str | None = None
    status: str = "draft"
    owner_member_id: int
    written_date: date | None = None
    reviewer_member_id: int | None = None
    reviewed_date: date | None = None
    last_updated_by: int | None = None


class ResearchNoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    status: str | None = None
    owner_member_id: int | None = None
    written_date: date | None = None
    reviewer_member_id: int | None = None
    reviewed_date: date | None = None
    last_updated_by: int | None = None


class ResearchNoteResponse(BaseModel):
    id: str
    created_at: datetime
    updated_at: datetime
    project_id: str
    title: str
    content: str | None
    status: str
    owner_member_id: int
    written_date: date | None
    reviewer_member_id: int | None
    reviewed_date: date | None
    last_updated_by: int | None
    is_deleted: bool
