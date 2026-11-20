"""Persisted provider settings and resumable batch generation records."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base
from app.infrastructure.db.models import SQLITE_PK


class LLMConnectionORM(Base):
    __tablename__ = "llm_connection"

    company_id: Mapped[int] = mapped_column(ForeignKey("company.id"), primary_key=True)
    provider: Mapped[str] = mapped_column(String(30), default="cliproxy")
    base_url: Mapped[str] = mapped_column(String(500))
    model: Mapped[str] = mapped_column(String(200))
    encrypted_api_key: Mapped[str] = mapped_column(Text, default="")
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    json_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    timeout_seconds: Mapped[int] = mapped_column(Integer, default=120)


class NoteGenerationJobORM(Base):
    __tablename__ = "note_generation_job"
    __table_args__ = (
        UniqueConstraint("created_by", "request_id", name="uq_generation_request"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid4())
    )
    request_id: Mapped[str] = mapped_column(String(80))
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("useraccount.id"), index=True)
    status: Mapped[str] = mapped_column(String(30), default="queued")
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    payload: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )


class NoteGenerationItemORM(Base):
    __tablename__ = "note_generation_item"
    __table_args__ = (
        UniqueConstraint("job_id", "position", name="uq_generation_position"),
    )

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    job_id: Mapped[str] = mapped_column(
        ForeignKey("note_generation_job.id"), index=True
    )
    position: Mapped[int] = mapped_column(Integer)
    title: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(30), default="queued")
    note_id: Mapped[str | None] = mapped_column(
        ForeignKey("research_note.id"), nullable=True
    )
    model: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)


class NoteGenerationPlanORM(Base):
    """A project-level AI generation plan agreed with the LLM before any note is written.

    ``messages`` is the planning conversation (user requests and the model's proposals);
    ``proposal`` holds the latest proposed note list, which the user may edit before confirming.
    """

    __tablename__ = "note_generation_plan"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_id: Mapped[str] = mapped_column(ForeignKey("project.id", ondelete="CASCADE"), index=True)
    created_by: Mapped[int] = mapped_column(ForeignKey("useraccount.id"), index=True)
    mode: Mapped[str] = mapped_column(String(20))  # "expand" (existing notes) | "document" (uploaded files)
    status: Mapped[str] = mapped_column(String(20), default="drafting")  # drafting | confirmed
    source_label: Mapped[str] = mapped_column(Text, default="")
    source_note_ids: Mapped[str] = mapped_column(Text, default="[]")
    source_text: Mapped[str] = mapped_column(Text, default="")
    options: Mapped[str] = mapped_column(Text, default="{}")
    messages: Mapped[str] = mapped_column(Text, default="[]")
    proposal: Mapped[str] = mapped_column(Text, default="{}")
    job_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
