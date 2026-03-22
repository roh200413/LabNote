from pydantic import BaseModel


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
