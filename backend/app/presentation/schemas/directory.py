from pydantic import BaseModel, Field


class CompanyMemberDirectoryResponse(BaseModel):
    company_member_id: int
    company_id: int
    user_id: int
    name: str
    email: str
    role: str
    is_active: bool
    is_approved: bool
    signature_data_url: str | None = None


class ResearcherInvitationCreateRequest(BaseModel):
    email: str


class ResearcherInvitationResponse(BaseModel):
    id: int
    email: str
    status: str
    created_at: str | None


class ResearcherCompanyResponse(BaseModel):
    id: int
    name: str
    code: str
    is_active: bool


class ResearcherManagementResponse(BaseModel):
    company: ResearcherCompanyResponse
    members: list[CompanyMemberDirectoryResponse]
    pending_requests: list["ResearcherMembershipRequestResponse"] = []


class ResearcherMembershipRequestResponse(BaseModel):
    request_id: int
    user_id: int
    name: str
    email: str
    requested_at: str | None


class ResearcherRegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=254)
    password: str | None = Field(default=None, max_length=128)


class ResearcherRegisterResponse(BaseModel):
    company_member_id: int
    user_id: int
    name: str
    email: str
    temporary_password: str | None = None


class ResearcherApprovalResponse(BaseModel):
    company_member_id: int
    user_id: int
    name: str
    email: str


ResearcherManagementResponse.model_rebuild()
