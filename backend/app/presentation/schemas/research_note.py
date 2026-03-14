from datetime import datetime

from pydantic import BaseModel, Field


class ResearchNoteCreateRequest(BaseModel):
    project_id: str
    title: str = Field(min_length=1, max_length=255)
    content: str | None = None
    status: str = "draft"
    owner_member_id: int
    last_updated_by: int | None = None


class ResearchNoteUpdateRequest(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=255)
    content: str | None = None
    status: str | None = None
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
    last_updated_by: int | None
    is_deleted: bool
