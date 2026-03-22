from pydantic import BaseModel, Field, field_validator


class SignUpRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)
    name: str = Field(min_length=1, max_length=120)
    account_type: str = Field(default="user", pattern="^(owner|user)$")
    organization_name: str | None = Field(default=None, min_length=1, max_length=255)
    organization_code: str | None = Field(default=None)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Invalid email")
        return normalized

    @field_validator("organization_name", "organization_code")
    @classmethod
    def normalize_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class LoginRequest(BaseModel):
    email: str
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if "@" not in normalized or "." not in normalized.split("@")[-1]:
            raise ValueError("Invalid email")
        return normalized


class UserResponse(BaseModel):
    id: int
    email: str
    name: str
    username: str
    is_active: bool
    is_admin: bool
    is_org_owner: bool
    approval_status: str
    organization_id: int | None
    signature_data_url: str | None

    model_config = {"from_attributes": True}


class SignatureUpdateRequest(BaseModel):
    signature_data_url: str | None = None


class AuthResponse(BaseModel):
    access_token: str | None = None
    token_type: str | None = "bearer"
    user: UserResponse
    message: str | None = None


class CompanyAccessRequestPayload(BaseModel):
    organization_name: str = Field(min_length=1, max_length=255)
    organization_code: str = Field(min_length=1, max_length=32)

    @field_validator("organization_name", "organization_code")
    @classmethod
    def normalize_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("This field is required")
        return normalized


class CompanyAccessRequestInfo(BaseModel):
    company_id: int
    company_name: str
    company_code: str
    status: str


class CompanyAccessRequestResponse(BaseModel):
    user: UserResponse
    request: CompanyAccessRequestInfo | None = None
    message: str
