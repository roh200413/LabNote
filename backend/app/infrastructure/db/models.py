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

SQLITE_PK = BIGINT().with_variant(INTEGER(), "sqlite")


class UserAccountORM(Base):
    __tablename__ = "useraccount"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    username: Mapped[str] = mapped_column(String(80), nullable=False, unique=True, index=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    email: Mapped[str] = mapped_column(String(254), nullable=False, unique=True, index=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    global_role: Mapped[str] = mapped_column(String(20), nullable=False, default="user")
    is_active: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    is_approved: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)
    signature_data_url: Mapped[str | None] = mapped_column(Text)


class CompanyORM(Base):
    __tablename__ = "company"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    join_code: Mapped[str] = mapped_column(String(9), nullable=False, unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)


class CompanyMemberORM(Base):
    __tablename__ = "company_member"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_member"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    company_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="member")


class CompanyMembershipRequestORM(Base):
    __tablename__ = "company_membership_request"
    __table_args__ = (UniqueConstraint("company_id", "user_id", name="uq_company_membership_request"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    company_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")


class ProjectORM(Base):
    __tablename__ = "project"
    __table_args__ = (UniqueConstraint("company_id", "code", name="uq_project_company_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    company_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(100), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    owner_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True
    )
    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)
    monthly_note_target: Mapped[int | None] = mapped_column(INTEGER)


class ProjectMemberORM(Base):
    __tablename__ = "project_member"
    __table_args__ = (UniqueConstraint("project_id", "company_member_id", name="uq_project_member"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    company_member_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(30), nullable=False, default="member")


class ProjectNoteCoverORM(Base):
    __tablename__ = "project_note_cover"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    cover_image_data_url: Mapped[str | None] = mapped_column(Text)
    template_payload: Mapped[str | None] = mapped_column(Text)
    show_business_name: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    show_title: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    show_code: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    show_org: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    show_manager: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)
    show_period: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)


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
    owner_member_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="RESTRICT"), nullable=False
    )
    written_date: Mapped[date | None] = mapped_column(Date)
    reviewer_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True
    )
    reviewed_date: Mapped[date | None] = mapped_column(Date)
    last_updated_by: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True
    )
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)


class ResearchNoteDocumentORM(Base):
    __tablename__ = "research_note_document"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")
    schema_version: Mapped[int] = mapped_column(INTEGER, nullable=False, default=1)
    current_revision_id: Mapped[int | None] = mapped_column(BIGINT, nullable=True, index=True)
    source_file_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("research_note_file.id", ondelete="SET NULL"), nullable=True, index=True
    )
    source_page_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("research_note_page.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_payload: Mapped[str] = mapped_column(Text, nullable=False)


class ResearchNoteDocumentRevisionORM(Base):
    __tablename__ = "research_note_document_revision"
    __table_args__ = (UniqueConstraint("document_id", "revision_no", name="uq_note_document_revision"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    document_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note_document.id", ondelete="CASCADE"), nullable=False, index=True
    )
    revision_no: Mapped[int] = mapped_column(INTEGER, nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_by: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True, index=True
    )
    change_summary: Mapped[str | None] = mapped_column(Text)


class ResearchNoteFileORM(Base):
    __tablename__ = "research_note_file"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    uploaded_by: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="RESTRICT"), nullable=False
    )
    file_type: Mapped[str] = mapped_column(String(20), nullable=False)
    original_name: Mapped[str] = mapped_column(String(255), nullable=False)
    storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(BIGINT, nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ready")
    page_count: Mapped[int | None] = mapped_column(INTEGER)
    error_message: Mapped[str | None] = mapped_column(Text)
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)


class ResearchNotePageORM(Base):
    __tablename__ = "research_note_page"
    __table_args__ = (UniqueConstraint("file_id", "page_no", name="uq_note_file_page"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    file_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("research_note_file.id", ondelete="CASCADE"), nullable=False, index=True
    )
    note_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=True, index=True
    )
    page_no: Mapped[int] = mapped_column(INTEGER, nullable=False)
    page_type: Mapped[str] = mapped_column(String(20), nullable=False)
    image_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_storage_key: Mapped[str | None] = mapped_column(String(500))
    width: Mapped[int | None] = mapped_column(INTEGER)
    height: Mapped[int | None] = mapped_column(INTEGER)
    active_asset_version_id: Mapped[int | None] = mapped_column(BIGINT, nullable=True, index=True)
    sort_order: Mapped[int] = mapped_column(INTEGER, nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="ready")
    is_deleted: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=False)


class ResearchNotePageAssetVersionORM(Base):
    __tablename__ = "research_note_page_asset_version"
    __table_args__ = (UniqueConstraint("page_id", "version_no", name="uq_note_page_asset_version"),)

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    page_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("research_note_page.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_no: Mapped[int] = mapped_column(INTEGER, nullable=False)
    image_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    thumbnail_storage_key: Mapped[str | None] = mapped_column(String(500))
    width: Mapped[int | None] = mapped_column(INTEGER)
    height: Mapped[int | None] = mapped_column(INTEGER)
    mime_type: Mapped[str | None] = mapped_column(String(100))
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    created_by: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True, index=True
    )
    change_reason: Mapped[str | None] = mapped_column(Text)


class UserSignatureORM(Base):
    __tablename__ = "user_signature"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    user_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="CASCADE"), nullable=False, index=True
    )
    image_storage_key: Mapped[str] = mapped_column(String(500), nullable=False)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")


class ResearchNoteSignatureSnapshotORM(Base):
    __tablename__ = "research_note_signature_snapshot"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    signed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("research_note_document.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_revision_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("research_note_document_revision.id", ondelete="SET NULL"), nullable=True, index=True
    )
    signer_user_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    signer_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True, index=True
    )
    signature_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("user_signature.id", ondelete="SET NULL"), nullable=True, index=True
    )
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    signature_image_storage_key_snapshot: Mapped[str | None] = mapped_column(String(500))


class ResearchNoteApprovalEventORM(Base):
    __tablename__ = "research_note_approval_event"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    document_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("research_note_document.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_revision_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("research_note_document_revision.id", ondelete="SET NULL"), nullable=True, index=True
    )
    actor_user_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    actor_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True, index=True
    )
    event_type: Mapped[str] = mapped_column(String(20), nullable=False)
    comment: Mapped[str | None] = mapped_column(Text)
    signature_snapshot_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("research_note_signature_snapshot.id", ondelete="SET NULL"), nullable=True
    )


class ResearchNoteExportORM(Base):
    __tablename__ = "research_note_export"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True, index=True
    )
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="pending")
    cover_snapshot_payload: Mapped[str | None] = mapped_column(Text)
    toc_snapshot_payload: Mapped[str | None] = mapped_column(Text)
    included_note_ids_json: Mapped[str | None] = mapped_column(Text)
    included_revision_ids_json: Mapped[str | None] = mapped_column(Text)
    pdf_storage_key: Mapped[str | None] = mapped_column(String(500))
    file_size: Mapped[int | None] = mapped_column(BIGINT)
    checksum: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    error_message: Mapped[str | None] = mapped_column(Text)


class GitHubRepositoryIntegrationORM(Base):
    __tablename__ = "github_repository_integration"
    __table_args__ = (
        UniqueConstraint("company_id", "repo_owner", "repo_name", name="uq_github_repository_integration"),
    )

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    company_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("company.id", ondelete="CASCADE"), nullable=False, index=True
    )
    created_by: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True, index=True
    )
    repo_owner: Mapped[str] = mapped_column(String(120), nullable=False)
    repo_name: Mapped[str] = mapped_column(String(160), nullable=False)
    repository_url: Mapped[str | None] = mapped_column(String(500))
    default_branch: Mapped[str | None] = mapped_column(String(120))
    webhook_secret: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active")
    notes: Mapped[str | None] = mapped_column(Text)


class GitHubProjectMappingORM(Base):
    __tablename__ = "github_project_mapping"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
    integration_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("github_repository_integration.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="CASCADE"), nullable=False, index=True
    )
    branch_pattern: Mapped[str | None] = mapped_column(String(120))
    path_pattern: Mapped[str | None] = mapped_column(String(500))
    note_creation_mode: Mapped[str] = mapped_column(String(30), nullable=False, default="pr_merge")
    default_author_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True
    )
    default_reviewer_member_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company_member.id", ondelete="SET NULL"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(BOOLEAN, nullable=False, default=True)


class GitHubEventORM(Base):
    __tablename__ = "github_event"
    __table_args__ = (
        UniqueConstraint("integration_id", "delivery_id", name="uq_github_event_delivery"),
    )

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    integration_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("github_repository_integration.id", ondelete="CASCADE"), nullable=False, index=True
    )
    project_mapping_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("github_project_mapping.id", ondelete="SET NULL"), nullable=True, index=True
    )
    project_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("project.id", ondelete="SET NULL"), nullable=True, index=True
    )
    delivery_id: Mapped[str] = mapped_column(String(120), nullable=False)
    github_event_id: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False, index=True)
    action: Mapped[str | None] = mapped_column(String(60))
    source_url: Mapped[str | None] = mapped_column(String(500))
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False, default="pending")
    error_message: Mapped[str | None] = mapped_column(Text)


class GitHubGeneratedNoteORM(Base):
    __tablename__ = "github_generated_note"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    event_id: Mapped[int] = mapped_column(
        BIGINT, ForeignKey("github_event.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    note_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("research_note.id", ondelete="CASCADE"), nullable=False, index=True
    )
    generation_type: Mapped[str] = mapped_column(String(40), nullable=False, default="automatic")


class AuditLogORM(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(SQLITE_PK, primary_key=True, autoincrement=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    actor_user_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("useraccount.id", ondelete="SET NULL"), nullable=True, index=True
    )
    company_id: Mapped[int | None] = mapped_column(
        BIGINT, ForeignKey("company.id", ondelete="SET NULL"), nullable=True, index=True
    )
    target_type: Mapped[str] = mapped_column(String(50), nullable=False)
    target_id: Mapped[str] = mapped_column(String(100), nullable=False)
    action: Mapped[str] = mapped_column(String(50), nullable=False)
    detail: Mapped[str | None] = mapped_column(Text)


# Compatibility aliases for presentation/infrastructure code that still imports legacy names.
UserORM = UserAccountORM
OrganizationORM = CompanyORM
LoginAuditORM = AuditLogORM
