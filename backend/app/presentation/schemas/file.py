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
    checksum: str | None = None
    status: str = "ready"
    page_count: int | None = None
    error_message: str | None = None
    is_deleted: bool


class ResearchNotePageResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    note_id: str | None = None
    file_id: int
    page_no: int
    page_type: str
    image_storage_key: str
    thumbnail_storage_key: str | None = None
    width: int | None = None
    height: int | None = None
    active_asset_version_id: int | None = None
    sort_order: int
    status: str = "ready"
    is_deleted: bool


class ResearchNotePageAssetVersionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    page_id: int
    version_no: int
    image_storage_key: str
    thumbnail_storage_key: str | None = None
    width: int | None = None
    height: int | None = None
    mime_type: str | None = None
    checksum: str | None = None
    created_by: int | None = None
    change_reason: str | None = None


class FileUploadResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    file: ResearchNoteFileResponse
    pages: list[ResearchNotePageResponse]
