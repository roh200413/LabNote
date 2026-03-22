from datetime import datetime
from typing import Annotated, Literal

from pydantic import BaseModel, Field


class TextStyleSchema(BaseModel):
    font_size: int = Field(default=16, alias="fontSize")
    font_weight: Literal["normal", "bold"] = Field(default="normal", alias="fontWeight")
    text_align: Literal["left", "center", "right"] = Field(default="left", alias="textAlign")

    model_config = {"populate_by_name": True}


class DocumentBlockBaseSchema(BaseModel):
    id: str
    type: str
    x: int
    y: int
    w: int
    h: int
    locked: bool = False


class TextBlockSchema(DocumentBlockBaseSchema):
    type: Literal["text"]
    content: str
    style: TextStyleSchema | None = None


class ImageBlockSchema(DocumentBlockBaseSchema):
    type: Literal["image"]
    src: str


DocumentBlockSchema = Annotated[TextBlockSchema | ImageBlockSchema, Field(discriminator="type")]


class DocumentMetaSchema(BaseModel):
    note_id: str = Field(alias="noteId")
    source_file_id: int | None = Field(default=None, alias="sourceFileId")
    source_page_id: int | None = Field(default=None, alias="sourcePageId")

    model_config = {"populate_by_name": True}


class DocumentPageSchema(BaseModel):
    width: int
    height: int
    background: str = "#ffffff"
    background_image: str | None = Field(default=None, alias="backgroundImage")

    model_config = {"populate_by_name": True}


class DocumentSchemaPayload(BaseModel):
    schema_version: int = Field(default=1, alias="schemaVersion")
    id: str
    title: str
    page: DocumentPageSchema
    meta: DocumentMetaSchema
    blocks: list[DocumentBlockSchema]

    model_config = {"populate_by_name": True}


class ResearchNoteDocumentSaveRequest(BaseModel):
    note_id: str
    title: str = Field(min_length=1, max_length=255)
    source_file_id: int | None = None
    source_page_id: int | None = None
    document: DocumentSchemaPayload


class ResearchNoteDocumentResponse(BaseModel):
    id: str
    note_id: str
    title: str
    schema_version: int
    source_file_id: int | None
    source_page_id: int | None
    document: DocumentSchemaPayload
    created_at: datetime
    updated_at: datetime


class ResearchNoteDocumentSummaryResponse(BaseModel):
    id: str
    note_id: str
    title: str
    schema_version: int
    source_file_id: int | None
    source_page_id: int | None
    created_at: datetime
    updated_at: datetime


class EditorImageUploadResponse(BaseModel):
    url: str
    storage_key: str
    filename: str


class ResearchNoteBatchExportRequest(BaseModel):
    note_ids: list[str] = Field(min_length=1, alias="noteIds")

    model_config = {"populate_by_name": True}


class ResearchNotePdfExportRequest(BaseModel):
    document_id: str | None = Field(default=None, alias="documentId")
    note_id: str | None = Field(default=None, alias="noteId")

    model_config = {"populate_by_name": True}
