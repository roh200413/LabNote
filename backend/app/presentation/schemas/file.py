from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ResearchNoteFileResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    note_id: str
    uploaded_by: int
    file_type: str
    original_name: str
    storage_key: str
    mime_type: str
    file_size: int
    is_deleted: bool


class ResearchNotePageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    file_id: int
    page_no: int
    page_type: str
    image_storage_key: str
    sort_order: int
    is_deleted: bool


class FileUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file: ResearchNoteFileResponse
    pages: list[ResearchNotePageResponse]
