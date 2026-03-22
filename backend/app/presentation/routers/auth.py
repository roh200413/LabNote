from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.domain.accounts.use_cases import (
    InvalidCredentialsError,
    PendingApprovalError,
    UserAlreadyExistsError,
    get_company_access_request_status,
    get_user_by_id,
    login_user,
    request_company_access,
    register_user,
    update_user_signature,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.auth import (
    AuthResponse,
    CompanyAccessRequestPayload,
    CompanyAccessRequestResponse,
    LoginRequest,
    SignUpRequest,
    SignatureUpdateRequest,
    UserResponse,
)

router = APIRouter(prefix="/auth", tags=["auth"])


def _build_user_response(user, db: Session) -> UserResponse:
    from app.infrastructure.repositories.sqlalchemy_identity import SqlAlchemyDirectoryQueries

    directory = SqlAlchemyDirectoryQueries(db)
    return UserResponse(
        id=user.id,
        email=user.email,
        name=user.display_name,
        username=user.username,
        is_active=user.is_active,
        is_admin=user.global_role == "system_admin",
        is_org_owner=directory.is_company_owner(user.id or 0),
        approval_status="approved" if user.is_approved else "pending",
        organization_id=directory.get_primary_company_id_for_user(user.id or 0),
        signature_data_url=user.signature_data_url,
    )


@router.post("/signup", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def signup_endpoint(payload: SignUpRequest, db: Session = Depends(get_db)):
    try:
        user, access_token, message = register_user(db, **payload.model_dump())
    except UserAlreadyExistsError as exc:
        raise HTTPException(status_code=409, detail="User already exists") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return AuthResponse(access_token=access_token, user=_build_user_response(user, db), message=message)


@router.post("/login", response_model=AuthResponse)
def login_endpoint(payload: LoginRequest, db: Session = Depends(get_db)):
    try:
        user, access_token = login_user(db, payload.email, payload.password)
    except InvalidCredentialsError as exc:
        raise HTTPException(status_code=401, detail="Invalid email or password") from exc
    except PendingApprovalError as exc:
        raise HTTPException(status_code=403, detail="Account is waiting for admin approval") from exc
    return AuthResponse(access_token=access_token, user=_build_user_response(user, db))


@router.get("/me", response_model=UserResponse)
def me_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    refreshed = get_user_by_id(db, current_user.id)
    return _build_user_response(refreshed, db)


@router.put("/me/signature", response_model=UserResponse)
def update_signature_endpoint(
    payload: SignatureUpdateRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    updated = update_user_signature(db, current_user.id, payload.signature_data_url)
    return _build_user_response(updated, db)


@router.get("/me/company-access-request", response_model=CompanyAccessRequestResponse)
def get_company_access_request_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    refreshed = get_user_by_id(db, current_user.id)
    request = get_company_access_request_status(db, current_user.id)
    message = "No pending company access request."
    if request is not None:
        message = "Your company access request is waiting for owner approval."
    return CompanyAccessRequestResponse(user=_build_user_response(refreshed, db), request=request, message=message)


@router.post("/me/company-access-request", response_model=CompanyAccessRequestResponse)
def request_company_access_endpoint(
    payload: CompanyAccessRequestPayload,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        user, request, message = request_company_access(
            db,
            user_id=current_user.id,
            organization_name=payload.organization_name,
            organization_code=payload.organization_code,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    refreshed = get_user_by_id(db, user.id)
    return CompanyAccessRequestResponse(user=_build_user_response(refreshed, db), request=request, message=message)
