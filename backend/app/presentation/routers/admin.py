from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from pydantic import BaseModel

from app.domain.accounts.use_cases import (
    AdminUpdateRefused,
    UserAlreadyExistsError,
    UserNotFoundError,
    admin_create_user,
    admin_set_organization_role,
    list_users,
    update_user,
)
from app.domain.audit.use_cases import get_admin_dashboard
from app.domain.companies.use_cases import (
    approve_organization,
    create_organization,
    list_organizations,
    list_pending_organizations,
    reject_organization,
    update_organization,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_admin, get_current_user
from app.presentation.schemas.admin import (
    AdminDashboardResponse,
    AdminUserCreateRequest,
    AdminUserCreateResponse,
    AdminUserResponse,
    AdminUserUpdateRequest,
    OrganizationCreateRequest,
    OrganizationResponse,
    OrganizationUpdateRequest,
)

router = APIRouter(prefix="/admin", tags=["admin"], dependencies=[Depends(get_current_admin)])


@router.get("/dashboard", response_model=AdminDashboardResponse)
def get_dashboard_endpoint(db: Session = Depends(get_db)):
    return get_admin_dashboard(db)


@router.get("/users", response_model=list[AdminUserResponse])
def list_users_endpoint(db: Session = Depends(get_db)):
    return list_users(db)


@router.post("/users", response_model=AdminUserCreateResponse, status_code=status.HTTP_201_CREATED)
def create_user_endpoint(
    payload: AdminUserCreateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        user, temporary_password = admin_create_user(
            db,
            current_user.id or 0,
            name=payload.name,
            email=payload.email,
            password=payload.password or None,
            organization_id=payload.organization_id,
            role=payload.role,
        )
    except UserAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {"user": user, "temporary_password": temporary_password}


class OrganizationRoleRequest(BaseModel):
    role: str


@router.put("/users/{user_id}/organization-role", response_model=AdminUserResponse)
def set_organization_role_endpoint(
    user_id: int,
    payload: OrganizationRoleRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return admin_set_organization_role(db, current_user.id or 0, user_id, role=payload.role)
    except UserNotFoundError as exc:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/users/{user_id}", response_model=AdminUserResponse)
def update_user_endpoint(
    user_id: int,
    payload: AdminUserUpdateRequest,
    db: Session = Depends(get_db),
    admin=Depends(get_current_admin),
):
    try:
        return update_user(db, user_id, actor_user_id=admin.id, **payload.model_dump(exclude_unset=True))
    except AdminUpdateRefused as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="사용자를 찾을 수 없습니다") from exc


@router.get("/organizations", response_model=list[OrganizationResponse])
def list_organizations_endpoint(db: Session = Depends(get_db)):
    return list_organizations(db)


@router.get("/organizations/pending", response_model=list[OrganizationResponse])
def list_pending_organizations_endpoint(db: Session = Depends(get_db)):
    return list_pending_organizations(db)


@router.post("/organizations", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
def create_organization_endpoint(payload: OrganizationCreateRequest, db: Session = Depends(get_db)):
    try:
        return create_organization(db, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="이미 사용 중인 기관 코드입니다") from exc


@router.put("/organizations/{organization_id}", response_model=OrganizationResponse)
def update_organization_endpoint(
    organization_id: int, payload: OrganizationUpdateRequest, db: Session = Depends(get_db)
):
    try:
        return update_organization(db, organization_id, **payload.model_dump(exclude_unset=True))
    except ValueError as exc:
        detail = str(exc)
        status_code = 404 if "not found" in detail.lower() else 400
        raise HTTPException(status_code=status_code, detail=detail) from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="이미 사용 중인 기관 코드입니다") from exc


@router.post("/organizations/{organization_id}/approve", response_model=OrganizationResponse)
def approve_organization_endpoint(organization_id: int, db: Session = Depends(get_db)):
    try:
        return approve_organization(db, organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다") from exc


@router.post("/organizations/{organization_id}/reject", response_model=OrganizationResponse)
def reject_organization_endpoint(organization_id: int, db: Session = Depends(get_db)):
    try:
        return reject_organization(db, organization_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail="기관을 찾을 수 없습니다") from exc
