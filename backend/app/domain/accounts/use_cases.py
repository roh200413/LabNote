import re
import secrets
import string
from collections.abc import Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import create_access_token, hash_password, verify_password
from app.core.system_admin_registry import SystemAdmin
from app.domain.accounts.entities import UserAccount
from app.domain.audit.entities import AuditLogEntry
from app.domain.companies.entities import Company, CompanyMember, CompanyMembershipRequest
from app.infrastructure.db.models import CompanyMembershipRequestORM, CompanyORM
from app.infrastructure.repositories.sqlalchemy_identity import (
    SqlAlchemyAuditLogRepository,
    SqlAlchemyCompanyMemberRepository,
    SqlAlchemyCompanyMembershipRequestRepository,
    SqlAlchemyCompanyRepository,
    SqlAlchemyDirectoryQueries,
    SqlAlchemyUserAccountRepository,
)


class UserAlreadyExistsError(Exception):
    pass


class InvalidCredentialsError(Exception):
    pass


class UserNotFoundError(Exception):
    pass


class PendingApprovalError(Exception):
    pass


def _build_username(name: str, email: str, users: SqlAlchemyUserAccountRepository) -> str:
    seed = re.sub(r"[^a-z0-9]+", "", name.lower()) or re.sub(r"[^a-z0-9]+", "", email.split("@")[0].lower())
    seed = seed[:40] or "user"
    candidate = seed
    suffix = 1
    while users.get_by_username(candidate):
        candidate = f"{seed}{suffix}"
        suffix += 1
    return candidate[:80]


def _record_audit(
    audits: SqlAlchemyAuditLogRepository,
    *,
    actor_user_id: int | None,
    company_id: int | None,
    target_type: str,
    target_id: str,
    action: str,
    detail: str | None = None,
) -> None:
    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=actor_user_id,
            company_id=company_id,
            target_type=target_type,
            target_id=target_id,
            action=action,
            detail=detail,
        )
    )


def _generate_join_code(companies: SqlAlchemyCompanyRepository, length: int = 9) -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        candidate = "".join(secrets.choice(alphabet) for _ in range(length))
        if companies.get_by_join_code(candidate) is None:
            return candidate


def register_user(
    db: Session,
    email: str,
    password: str,
    name: str,
    account_type: str = "user",
    organization_name: str | None = None,
    organization_code: str | None = None,
) -> tuple[UserAccount, str | None, str | None]:
    users = SqlAlchemyUserAccountRepository(db)
    companies = SqlAlchemyCompanyRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    membership_requests = SqlAlchemyCompanyMembershipRequestRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)

    normalized_email = email.strip().lower()
    if users.get_by_email(normalized_email):
        raise UserAlreadyExistsError(normalized_email)

    username = _build_username(name, normalized_email, users)

    if account_type == "owner":
        if not organization_name:
            raise ValueError("Organization name is required for owners")
        if companies.get_by_name(organization_name.strip()):
            raise ValueError("Organization name already exists")
        join_code = _generate_join_code(companies)

        company = companies.add(
            Company(
                id=None,
                created_at=None,
                updated_at=None,
                name=organization_name.strip(),
                join_code=join_code,
                is_active=False,
            )
        )
        user = users.add(
            UserAccount(
                id=None,
                created_at=None,
                updated_at=None,
                username=username,
                display_name=name.strip(),
                email=normalized_email,
                password=hash_password(password),
                global_role="company_owner",
                is_active=False,
                is_approved=False,
                signature_data_url=None,
            )
        )
        company_members.add(
            CompanyMember(
                id=None,
                created_at=None,
                updated_at=None,
                company_id=company.id or 0,
                user_id=user.id or 0,
                role="owner",
            )
        )
        _record_audit(
            audits,
            actor_user_id=user.id,
            company_id=company.id,
            target_type="company",
            target_id=str(company.id),
            action="owner_signup_requested",
            detail=f"Owner signup requested for {company.name}",
        )
        db.commit()
        return user, None, f"Organization owner signup submitted. Waiting for admin approval. Your company code is {join_code}."

    if not organization_code:
        if organization_name:
            raise ValueError("Organization code is required when joining an organization")
        user = users.add(
            UserAccount(
                id=None,
                created_at=None,
                updated_at=None,
                username=username,
                display_name=name.strip(),
                email=normalized_email,
                password=hash_password(password),
                global_role="user",
                is_active=True,
                is_approved=True,
                signature_data_url=None,
            )
        )
        _record_audit(
            audits,
            actor_user_id=user.id,
            company_id=None,
            target_type="useraccount",
            target_id=str(user.id),
            action="signup",
            detail=f"Standalone user signup for {user.email}",
        )
        db.commit()
        return user, create_access_token(user.id or 0, user.email), "Account created."

    join_code = organization_code.strip().upper()
    if len(join_code) != 9:
        raise ValueError("Organization code must be exactly 9 characters")
    company = companies.get_by_join_code(join_code)
    if company is None:
        raise ValueError("Organization code not found")
    if organization_name and company.name.strip().lower() != organization_name.strip().lower():
        raise ValueError("Organization name does not match the organization code")

    user = users.add(
        UserAccount(
            id=None,
            created_at=None,
            updated_at=None,
            username=username,
            display_name=name.strip(),
            email=normalized_email,
            password=hash_password(password),
            global_role="user",
            is_active=False,
            is_approved=False,
            signature_data_url=None,
        )
    )

    message = "Signup request submitted. Waiting for owner approval."
    access_token = None
    membership_requests.add(
        CompanyMembershipRequest(
            id=None,
            created_at=None,
            updated_at=None,
            company_id=company.id or 0,
            user_id=user.id or 0,
            status="pending",
        )
    )
    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=company.id,
        target_type="company_membership_request",
        target_id=str(user.id),
        action="create_company_membership_request",
        detail=f"Membership request for {user.email}",
    )
    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=company.id,
        target_type="useraccount",
        target_id=str(user.id),
        action="signup",
        detail=f"User signup for {user.email}",
    )
    db.commit()
    return user, access_token, message


def login_user(db: Session, email: str, password: str) -> tuple[UserAccount, str]:
    users = SqlAlchemyUserAccountRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    normalized_email = email.strip().lower()
    user = users.get_by_email(normalized_email)
    if not user or not verify_password(password, user.password):
        raise InvalidCredentialsError()
    if not user.is_approved:
        raise PendingApprovalError()
    if not user.is_active:
        raise InvalidCredentialsError()

    _record_audit(
        audits,
        actor_user_id=user.id,
        company_id=directory.get_primary_company_id_for_user(user.id or 0),
        target_type="useraccount",
        target_id=str(user.id),
        action="login",
        detail=f"Successful login for {user.email}",
    )
    db.commit()
    return user, create_access_token(user.id or 0, user.email)


def get_user_by_id(db: Session, user_id: int) -> UserAccount:
    user = SqlAlchemyUserAccountRepository(db).get(user_id)
    if not user:
        raise UserNotFoundError(user_id)
    return user


def ensure_system_admin_users(db: Session, admins: Iterable[SystemAdmin]) -> list[UserAccount]:
    users = SqlAlchemyUserAccountRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    settings = get_settings()
    seeded_users: list[UserAccount] = []

    for admin in admins:
        normalized_email = admin.email.strip().lower()
        existing = users.get_by_email(normalized_email)
        if existing is None:
            existing = users.get_by_username(admin.username)
        if existing is None:
            user = users.add(
                UserAccount(
                    id=None,
                    created_at=None,
                    updated_at=None,
                    username=admin.username,
                    display_name=admin.display_name.strip(),
                    email=normalized_email,
                    password=hash_password(settings.system_admin_password),
                    global_role="system_admin",
                    is_active=admin.is_active,
                    is_approved=True,
                    signature_data_url=None,
                )
            )
            _record_audit(
                audits,
                actor_user_id=user.id,
                company_id=None,
                target_type="useraccount",
                target_id=str(user.id),
                action="seed_system_admin",
                detail=f"Seeded system admin {user.email}",
            )
            seeded_users.append(user)
            continue

        existing.email = normalized_email
        existing.display_name = admin.display_name.strip()
        existing.username = admin.username
        existing.global_role = "system_admin"
        existing.is_active = admin.is_active
        existing.is_approved = True
        seeded_users.append(users.update(existing))

    db.commit()
    return seeded_users


def list_users(db: Session) -> list[dict]:
    users = SqlAlchemyUserAccountRepository(db).list_all()
    directory = SqlAlchemyDirectoryQueries(db)
    return [
        {
            "id": user.id,
            "email": user.email,
            "name": user.display_name,
            "is_active": user.is_active,
            "is_admin": user.global_role == "system_admin",
            "is_org_owner": directory.is_company_owner(user.id or 0),
            "approval_status": "approved" if user.is_approved else "pending",
            "organization_id": directory.get_primary_company_id_for_user(user.id or 0),
            "created_at": user.created_at,
            "signature_data_url": user.signature_data_url,
        }
        for user in users
    ]


def update_user(db: Session, user_id: int, **kwargs) -> dict:
    users = SqlAlchemyUserAccountRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    user = users.get(user_id)
    if user is None:
        raise ValueError("User not found")

    if "name" in kwargs and kwargs["name"] is not None:
        user.display_name = kwargs["name"]
    if "is_active" in kwargs and kwargs["is_active"] is not None:
        user.is_active = kwargs["is_active"]
    if "is_admin" in kwargs and kwargs["is_admin"] is not None:
        user.global_role = "system_admin" if kwargs["is_admin"] else "user"
    updated_user = users.update(user)

    organization_id = kwargs.get("organization_id")
    if organization_id is not None:
        existing_memberships = list(company_members.list_by_user(user_id))
        if existing_memberships:
            primary = existing_memberships[0]
            primary.company_id = organization_id
            company_members.update(primary)

    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=user_id,
            company_id=organization_id,
            target_type="useraccount",
            target_id=str(user_id),
            action="admin_update_user",
            detail="Admin updated user account",
        )
    )
    db.commit()

    directory = SqlAlchemyDirectoryQueries(db)
    return {
        "id": updated_user.id,
        "email": updated_user.email,
        "name": updated_user.display_name,
        "is_active": updated_user.is_active,
        "is_admin": updated_user.global_role == "system_admin",
        "is_org_owner": directory.is_company_owner(updated_user.id or 0),
        "approval_status": "approved" if updated_user.is_approved else "pending",
        "organization_id": directory.get_primary_company_id_for_user(updated_user.id or 0),
        "created_at": updated_user.created_at,
        "signature_data_url": updated_user.signature_data_url,
    }


def list_company_members_for_user(db: Session, user_id: int) -> list[dict]:
    directory = SqlAlchemyDirectoryQueries(db)
    company_id = directory.get_primary_company_id_for_user(user_id)
    if company_id is None:
        return []
    return directory.list_company_members_with_users(company_id)


def get_company_access_request_status(db: Session, user_id: int) -> dict | None:
    directory = SqlAlchemyDirectoryQueries(db)
    if directory.get_primary_company_id_for_user(user_id) is not None:
        return None

    row = db.execute(
        select(CompanyMembershipRequestORM, CompanyORM)
        .join(CompanyORM, CompanyORM.id == CompanyMembershipRequestORM.company_id)
        .where(
            CompanyMembershipRequestORM.user_id == user_id,
            CompanyMembershipRequestORM.status == "pending",
        )
        .order_by(CompanyMembershipRequestORM.created_at.desc())
    ).first()
    if row is None:
        return None

    request, company = row
    return {
        "company_id": company.id,
        "company_name": company.name,
        "company_code": company.join_code,
        "status": request.status,
    }


def request_company_access(
    db: Session,
    *,
    user_id: int,
    organization_name: str,
    organization_code: str,
) -> tuple[UserAccount, dict | None, str]:
    users = SqlAlchemyUserAccountRepository(db)
    companies = SqlAlchemyCompanyRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    membership_requests = SqlAlchemyCompanyMembershipRequestRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    if directory.get_primary_company_id_for_user(user_id) is not None:
        raise ValueError("This account is already connected to a company")

    normalized_name = organization_name.strip()
    normalized_code = organization_code.strip().upper()
    company = companies.get_by_join_code(normalized_code)
    if company is None:
        raise ValueError("Organization code not found")
    if company.name.strip().lower() != normalized_name.lower():
        raise ValueError("Organization name does not match the organization code")

    if company_members.get_by_company_and_user(company.id or 0, user_id) is not None:
        raise ValueError("This account is already a member of the company")

    pending_request = membership_requests.get_pending_by_company_and_user(company.id or 0, user_id)
    if pending_request is not None:
        return user, {
            "company_id": company.id,
            "company_name": company.name,
            "company_code": company.join_code,
            "status": pending_request.status,
        }, "Your access request is already waiting for owner approval."

    request = membership_requests.add(
        CompanyMembershipRequest(
            id=None,
            created_at=None,
            updated_at=None,
            company_id=company.id or 0,
            user_id=user_id,
            status="pending",
        )
    )
    _record_audit(
        audits,
        actor_user_id=user_id,
        company_id=company.id,
        target_type="company_membership_request",
        target_id=str(request.id),
        action="create_company_membership_request",
        detail=f"Membership request for {user.email}",
    )
    db.commit()
    return user, {
        "company_id": company.id,
        "company_name": company.name,
        "company_code": company.join_code,
        "status": request.status,
    }, "Your company access request has been submitted."


def update_user_signature(db: Session, user_id: int, signature_data_url: str | None) -> UserAccount:
    users = SqlAlchemyUserAccountRepository(db)
    user = users.get(user_id)
    if user is None:
        raise UserNotFoundError(user_id)
    user.signature_data_url = signature_data_url
    updated_user = users.update(user)
    db.commit()
    return updated_user
