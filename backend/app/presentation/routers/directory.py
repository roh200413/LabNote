from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.orm import Session

from fastapi import HTTPException

from app.domain.accounts.use_cases import list_company_members_for_user
from app.domain.companies.use_cases import (
    create_researcher_invitation,
    get_researcher_management,
    remove_researcher_member,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.directory import (
    CompanyMemberDirectoryResponse,
    ResearcherInvitationCreateRequest,
    ResearcherInvitationResponse,
    ResearcherManagementResponse,
)

router = APIRouter(prefix="/directory", tags=["directory"])


@router.get("/company-members", response_model=list[CompanyMemberDirectoryResponse])
def list_company_members_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return list_company_members_for_user(db, current_user.id or 0)


@router.get("/researcher-management", response_model=ResearcherManagementResponse)
def get_researcher_management_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return get_researcher_management(db, current_user.id or 0)
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if "owner access" in detail.lower() else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.post("/researcher-management/invitations", response_model=ResearcherInvitationResponse)
def create_researcher_invitation_endpoint(
    payload: ResearcherInvitationCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return create_researcher_invitation(db, current_user.id or 0, email=payload.email)
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if "owner access" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc


@router.delete("/researcher-management/members/{company_member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_researcher_member_endpoint(
    company_member_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        remove_researcher_member(db, current_user.id or 0, company_member_id=company_member_id)
    except ValueError as exc:
        detail = str(exc)
        status_code = 403 if "owner" in detail.lower() else 404
        raise HTTPException(status_code=status_code, detail=detail) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)
