from datetime import date, datetime
from uuid import uuid4

from sqlalchemy import (
    BIGINT,
    BOOLEAN,
    INTEGER,
    Date,
    DateTime,
    ForeignKey,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.infrastructure.db.base import Base


class ProjectORM(Base):
    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_project_company_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    company_id: Mapped[int] = mapped_column(nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    owner_member_id: Mapped[int | None] = mapped_column(nullable=True)
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)


class ProjectMemberORM(Base):
    __tablename__ = "project_member"
    __table_args__ = (
        UniqueConstraint("project_id", "company_member_id", name="uq_project_member"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_member_id: Mapped[int] = mapped_column(nullable=False)
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="member")


class ResearchNoteORM(Base):
    __tablename__ = "research_note"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    owner_member_id: Mapped[int] = mapped_column(nullable=False)
    last_updated_by: Mapped[int | None] = mapped_column(nullable=True)
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)


class ResearchNoteFileORM(Base):
    __tablename__ = "research_note_file"

    id: Mapped[int] = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by: Mapped[int] = mapped_column(nullable=False)
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(BIGINT, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)


class ResearchNotePageORM(Base):
    __tablename__ = "research_note_page"
    __table_args__ = (UniqueConstraint("file_id", "page_no", name="uq_note_file_page"),)

    id: Mapped[int] = mapped_column(BIGINT, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    file_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("research_note_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page_no: Mapped[int] = mapped_column(INTEGER, nullable=False)
    page_type: Mapped[str] = mapped_column(String(20), nullable=False)
    image_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    sort_order: Mapped[int] = mapped_column(INTEGER, nullable=False)
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)
