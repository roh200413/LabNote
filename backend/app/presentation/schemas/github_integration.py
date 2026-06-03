from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class GitHubRepositoryIntegrationCreateRequest(BaseModel):
    company_id: int
    repo_owner: str = Field(min_length=1, max_length=120)
    repo_name: str = Field(min_length=1, max_length=160)
    repository_url: str | None = Field(default=None, max_length=500)
    default_branch: str | None = Field(default="main", max_length=120)
    status: str = Field(default="active", pattern="^(active|paused)$")
    notes: str | None = None


class GitHubRepositoryIntegrationUpdateRequest(BaseModel):
    repo_owner: str | None = Field(default=None, min_length=1, max_length=120)
    repo_name: str | None = Field(default=None, min_length=1, max_length=160)
    repository_url: str | None = Field(default=None, max_length=500)
    default_branch: str | None = Field(default=None, max_length=120)
    status: str | None = Field(default=None, pattern="^(active|paused)$")
    notes: str | None = None


class GitHubRepositoryIntegrationResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    company_id: int
    created_by: int | None
    repo_owner: str
    repo_name: str
    repository_url: str | None
    default_branch: str | None
    webhook_configured: bool = False
    webhook_url: str | None = None
    status: str
    notes: str | None


class GitHubWebhookSecretResponse(BaseModel):
    integration_id: int
    webhook_secret: str
    webhook_url: str


class GitHubProjectMappingCreateRequest(BaseModel):
    project_id: str
    branch_pattern: str | None = Field(default=None, max_length=120)
    path_pattern: str | None = Field(default=None, max_length=500)
    note_creation_mode: str = Field(default="pr_merge", pattern="^(manual|pr_merge|every_push)$")
    default_author_member_id: int | None = None
    default_reviewer_member_id: int | None = None
    is_active: bool = True


class GitHubProjectMappingUpdateRequest(BaseModel):
    project_id: str | None = None
    branch_pattern: str | None = Field(default=None, max_length=120)
    path_pattern: str | None = Field(default=None, max_length=500)
    note_creation_mode: str | None = Field(default=None, pattern="^(manual|pr_merge|every_push)$")
    default_author_member_id: int | None = None
    default_reviewer_member_id: int | None = None
    is_active: bool | None = None


class GitHubProjectMappingResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    updated_at: datetime
    integration_id: int
    project_id: str
    branch_pattern: str | None
    path_pattern: str | None
    note_creation_mode: str
    default_author_member_id: int | None
    default_reviewer_member_id: int | None
    is_active: bool


class GitHubEventResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
    processed_at: datetime | None
    integration_id: int
    project_mapping_id: int | None
    project_id: str | None
    delivery_id: str
    github_event_id: str | None
    event_type: str
    action: str | None
    source_url: str | None
    status: str
    error_message: str | None
    generated_note_id: str | None = None


class GitHubWebhookResponse(BaseModel):
    event_id: int
    status: str
    note_id: str | None = None
    message: str
