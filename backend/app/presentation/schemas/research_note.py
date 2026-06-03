from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field


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


class ResearchNoteApprovalRequest(BaseModel):
    comment: str | None = None


class ResearchNoteAssignmentRequest(BaseModel):
    author_member_id: int
    reviewer_member_id: int | None = None


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


class ResearchNoteApprovalEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    note_id: str
    document_id: str | None
    document_revision_id: int | None
    actor_user_id: int
    actor_member_id: int | None
    event_type: str
    comment: str | None
    signature_snapshot_id: int | None
