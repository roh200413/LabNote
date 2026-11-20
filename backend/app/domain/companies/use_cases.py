import re
import secrets
import string

from sqlalchemy.orm import Session
from sqlalchemy import select

from app.core.security import hash_password

from app.domain.audit.entities import AuditLogEntry
from app.domain.companies.entities import Company, CompanyMember
from app.infrastructure.repositories.sqlalchemy_identity import (
    SqlAlchemyAuditLogRepository,
    SqlAlchemyCompanyMemberRepository,
    SqlAlchemyCompanyRepository,
    SqlAlchemyDirectoryQueries,
    SqlAlchemyUserAccountRepository,
)
from app.infrastructure.db.models import AuditLogORM, CompanyMemberORM, CompanyMembershipRequestORM, UserAccountORM

# Audit actions that settle an organization's sign-up review. There is no approval column, so an
# inactive company is "pending" only until an admin approves, rejects, or creates it.
_REVIEW_ACTIONS = {"approve_company": "approved", "reject_company": "rejected", "create_company": "approved"}


def _review_statuses(db: Session) -> dict[int, str]:
    rows = db.execute(
        select(AuditLogORM.company_id, AuditLogORM.action)
        .where(AuditLogORM.action.in_(list(_REVIEW_ACTIONS)), AuditLogORM.company_id.is_not(None))
        .order_by(AuditLogORM.id.asc())
    ).all()
    statuses: dict[int, str] = {}
    for company_id, action in rows:
        statuses[company_id] = _REVIEW_ACTIONS[action]  # later rows win
    return statuses


def _approval_status(company: Company, reviews: dict[int, str]) -> str:
    if company.is_active:
        return "approved"
    return reviews.get(company.id or 0, "pending")

MIN_PASSWORD_LENGTH = 8
EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def list_organizations(db: Session) -> list[dict]:
    companies = SqlAlchemyCompanyRepository(db).list_all()
    company_members = SqlAlchemyCompanyMemberRepository(db)
    reviews = _review_statuses(db)
    return [
        {
            "id": company.id,
            "name": company.name,
            "code": company.join_code,
            "description": None,
            "is_active": company.is_active,
            "owner_user_id": _find_owner_user_id(list(company_members.list_by_company(company.id or 0))),
            "approval_status": _approval_status(company, reviews),
            "created_at": company.created_at,
        }
        for company in companies
    ]


def create_organization(db: Session, *, name: str, code: str | None = None, description: str | None = None) -> dict:
    _ = description
    companies = SqlAlchemyCompanyRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    if not name.strip():
        raise ValueError("기관명을 입력해 주세요")
    join_code = (code or "").strip().upper()
    if not join_code:
        from app.domain.accounts.use_cases import _generate_join_code

        join_code = _generate_join_code(companies)
    if len(join_code) != 9:
        raise ValueError("기관 코드는 9자리여야 합니다")
    if companies.get_by_name(name.strip()):
        raise ValueError("이미 사용 중인 기관명입니다")
    if companies.get_by_join_code(join_code):
        raise ValueError("이미 사용 중인 기관 코드입니다")

    company = companies.add(Company(id=None, created_at=None, updated_at=None, name=name.strip(), join_code=join_code, is_active=True))
    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=None,
            company_id=company.id,
            target_type="company",
            target_id=str(company.id),
            action="create_company",
            detail=f"Created company {company.name}",
        )
    )
    db.commit()
    return {
        "id": company.id,
        "name": company.name,
        "code": company.join_code,
        "description": None,
        "is_active": company.is_active,
        "owner_user_id": None,
        "approval_status": "approved",
        "created_at": company.created_at,
    }


def update_organization(db: Session, organization_id: int, *, name: str | None = None, code: str | None = None, description: str | None = None, is_active: bool | None = None) -> dict:
    _ = description
    companies = SqlAlchemyCompanyRepository(db)
    company = companies.get(organization_id)
    if company is None:
        raise ValueError("기관을 찾을 수 없습니다")
    if name is not None:
        if not name.strip():
            raise ValueError("기관명을 입력해 주세요")
        existing = companies.get_by_name(name.strip())
        if existing is not None and existing.id != company.id:
            raise ValueError("이미 사용 중인 기관명입니다")
        company.name = name.strip()
    if code is not None:
        normalized = code.strip().upper()
        if len(normalized) != 9:
            raise ValueError("기관 코드는 9자리여야 합니다")
        company.join_code = normalized
    if is_active is not None:
        company.is_active = is_active
    updated = companies.update(company)
    db.commit()
    return {
        "id": updated.id,
        "name": updated.name,
        "code": updated.join_code,
        "description": None,
        "is_active": updated.is_active,
        "owner_user_id": _find_owner_user_id(list(SqlAlchemyCompanyMemberRepository(db).list_by_company(updated.id or 0))),
        "approval_status": _approval_status(updated, _review_statuses(db)),
        "created_at": updated.created_at,
    }


def list_pending_organizations(db: Session) -> list[dict]:
    reviews = _review_statuses(db)
    companies = [company for company in SqlAlchemyCompanyRepository(db).list_pending() if _approval_status(company, reviews) == "pending"]
    company_members = SqlAlchemyCompanyMemberRepository(db)
    return [
        {
            "id": company.id,
            "name": company.name,
            "code": company.join_code,
            "description": None,
            "is_active": company.is_active,
            "owner_user_id": _find_owner_user_id(list(company_members.list_by_company(company.id or 0))),
            "approval_status": "pending",
            "created_at": company.created_at,
        }
        for company in companies
    ]


def approve_organization(db: Session, organization_id: int) -> dict:
    companies = SqlAlchemyCompanyRepository(db)
    users = SqlAlchemyUserAccountRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    company = companies.get(organization_id)
    if company is None:
        raise ValueError("기관을 찾을 수 없습니다")
    company.approve()
    updated = companies.update(company)

    owner_members = [member for member in company_members.list_by_company(organization_id) if member.role == "owner"]
    for member in owner_members:
        owner = users.get(member.user_id)
        if owner is not None:
            owner.approve()
            users.update(owner)

    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=None,
            company_id=updated.id,
            target_type="company",
            target_id=str(updated.id),
            action="approve_company",
            detail=f"Approved company {updated.name}",
        )
    )
    db.commit()
    return {
        "id": updated.id,
        "name": updated.name,
        "code": updated.join_code,
        "description": None,
        "is_active": updated.is_active,
        "owner_user_id": _find_owner_user_id(list(company_members.list_by_company(updated.id or 0))),
        "approval_status": "approved",
        "created_at": updated.created_at,
    }


def reject_organization(db: Session, organization_id: int) -> dict:
    companies = SqlAlchemyCompanyRepository(db)
    users = SqlAlchemyUserAccountRepository(db)
    company_members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    company = companies.get(organization_id)
    if company is None:
        raise ValueError("기관을 찾을 수 없습니다")
    company.suspend()
    updated = companies.update(company)

    owner_members = [member for member in company_members.list_by_company(organization_id) if member.role == "owner"]
    for member in owner_members:
        owner = users.get(member.user_id)
        if owner is not None:
            owner.reject()
            users.update(owner)

    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=None,
            company_id=updated.id,
            target_type="company",
            target_id=str(updated.id),
            action="reject_company",
            detail=f"Rejected company {updated.name}",
        )
    )
    db.commit()
    return {
        "id": updated.id,
        "name": updated.name,
        "code": updated.join_code,
        "description": None,
        "is_active": updated.is_active,
        "owner_user_id": _find_owner_user_id(list(company_members.list_by_company(updated.id or 0))),
        "approval_status": "rejected",
        "created_at": updated.created_at,
    }


def get_researcher_management(db: Session, owner_user_id: int) -> dict:
    company_id = _require_owner_company(db, owner_user_id)
    company = SqlAlchemyCompanyRepository(db).get(company_id)
    if company is None:
        raise ValueError("기관을 찾을 수 없습니다")

    members = db.execute(
        select(CompanyMemberORM, UserAccountORM)
        .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
        .where(CompanyMemberORM.company_id == company_id)
        .order_by(UserAccountORM.display_name.asc())
    ).all()
    return {
        "company": {
            "id": company.id,
            "name": company.name,
            "code": company.join_code,
            "is_active": company.is_active,
        },
        "members": [
            {
                "company_member_id": member.id,
                "company_id": member.company_id,
                "user_id": user.id,
                "name": user.display_name,
                "email": user.email,
                "role": member.role,
                "is_active": user.is_active,
                "is_approved": user.is_approved,
                "signature_data_url": user.signature_data_url,
            }
            for member, user in members
        ],
        "pending_requests": _pending_requests(db, company_id),
    }


def _pending_requests(db: Session, company_id: int) -> list[dict]:
    rows = db.execute(
        select(CompanyMembershipRequestORM, UserAccountORM)
        .join(UserAccountORM, UserAccountORM.id == CompanyMembershipRequestORM.user_id)
        .where(
            CompanyMembershipRequestORM.company_id == company_id,
            CompanyMembershipRequestORM.status == "pending",
        )
        .order_by(CompanyMembershipRequestORM.created_at.asc())
    ).all()
    return [
        {
            "request_id": request.id,
            "user_id": user.id,
            "name": user.display_name,
            "email": user.email,
            "requested_at": request.created_at.isoformat() if request.created_at else None,
        }
        for request, user in rows
    ]


def create_researcher_invitation(db: Session, owner_user_id: int, *, email: str) -> dict:
    company_id = _require_owner_company(db, owner_user_id)
    normalized_email = email.strip().lower()
    users = SqlAlchemyUserAccountRepository(db)
    members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    existing_user = users.get_by_email(normalized_email)
    if existing_user is not None and members.get_by_company_and_user(company_id, existing_user.id or 0):
        raise ValueError("이미 이 기관의 구성원입니다")
    if existing_user is not None:
        existing_company_id = directory.get_primary_company_id_for_user(existing_user.id or 0)
        if existing_company_id is not None and existing_company_id != company_id:
            raise ValueError("이미 다른 기관에 소속된 사용자입니다")

    if existing_user is not None:
        members.add(
            CompanyMember(
                id=None,
                created_at=None,
                updated_at=None,
                company_id=company_id,
                user_id=existing_user.id or 0,
                role="member",
            )
        )
        existing_user.is_active = True
        existing_user.is_approved = True
        users.update(existing_user)

        audits.add(
            AuditLogEntry(
                id=None,
                created_at=None,
                actor_user_id=owner_user_id,
                company_id=company_id,
                target_type="company_member",
                target_id=str(existing_user.id),
                action="invite_company_member_immediately",
                detail=f"Immediately added existing user {normalized_email}",
            )
        )
        db.commit()
        return {
            "id": existing_user.id,
            "email": existing_user.email,
            "status": "accepted",
            "created_at": existing_user.created_at.isoformat() if existing_user.created_at else None,
        }
    raise ValueError("사용자 계정이 없습니다. 연구원에게 먼저 회원가입을 요청하세요.")


def remove_researcher_member(db: Session, owner_user_id: int, *, company_member_id: int) -> None:
    company_id = _require_owner_company(db, owner_user_id)
    member = db.get(CompanyMemberORM, company_member_id)
    if member is None or member.company_id != company_id:
        raise ValueError("이 기관에서 연구원을 찾을 수 없습니다")
    if member.role == "owner":
        raise ValueError("기관 관리자 계정은 연구원 관리에서 삭제할 수 없습니다")
    if member.user_id == owner_user_id:
        raise ValueError("자신의 기관 관리자 권한은 삭제할 수 없습니다")

    user = db.get(UserAccountORM, member.user_id)
    audits = SqlAlchemyAuditLogRepository(db)
    db.delete(member)
    if user is not None:
        remaining_membership = db.scalar(
            select(CompanyMemberORM).where(CompanyMemberORM.user_id == user.id, CompanyMemberORM.id != company_member_id)
        )
        if remaining_membership is None and user.global_role == "user":
            user.is_active = True
            user.is_approved = True
    audits.add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=owner_user_id,
            company_id=company_id,
            target_type="company_member",
            target_id=str(company_member_id),
            action="remove_company_member",
            detail=f"Removed researcher membership {company_member_id}",
        )
    )
    db.commit()


def _find_owner_user_id(memberships: list) -> int | None:
    for membership in memberships:
        if membership.role == "owner":
            return membership.user_id
    return None


def _require_owner_company(db: Session, owner_user_id: int) -> int:
    directory = SqlAlchemyDirectoryQueries(db)
    if not directory.is_company_owner(owner_user_id):
        raise ValueError("기관 관리자 권한이 필요합니다")
    company_id = directory.get_primary_company_id_for_user(owner_user_id)
    if company_id is None:
        raise ValueError("기관을 찾을 수 없습니다")
    return company_id


def generate_temporary_password(length: int = 12) -> str:
    """Readable random password with letters and digits (no look-alike characters)."""
    alphabet = "".join(ch for ch in string.ascii_letters + string.digits if ch not in "0O1lI")
    while True:
        value = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(ch.isdigit() for ch in value) and any(ch.isalpha() for ch in value):
            return value


def _audit(db: Session, *, actor: int, company_id: int, target_type: str, target_id: str, action: str, detail: str) -> None:
    SqlAlchemyAuditLogRepository(db).add(
        AuditLogEntry(
            id=None,
            created_at=None,
            actor_user_id=actor,
            company_id=company_id,
            target_type=target_type,
            target_id=target_id,
            action=action,
            detail=detail,
        )
    )


def _unique_username(db: Session, name: str, email: str) -> str:
    seed = re.sub(r"[^a-z0-9]+", "", name.lower()) or re.sub(r"[^a-z0-9]+", "", email.split("@")[0].lower())
    seed = seed[:40] or "user"
    candidate, suffix = seed, 1
    while db.scalar(select(UserAccountORM.id).where(UserAccountORM.username == candidate)) is not None:
        candidate = f"{seed}{suffix}"
        suffix += 1
    return candidate[:80]


def register_researcher(
    db: Session,
    owner_user_id: int,
    *,
    name: str,
    email: str,
    password: str | None = None,
) -> dict:
    """Owner creates a researcher account that can log in right away.

    Without a password a temporary one is generated and returned once so the owner can
    hand it over; the researcher then changes it from their profile.
    """
    company_id = _require_owner_company(db, owner_user_id)
    name = name.strip()
    normalized_email = email.strip().lower()
    if not name:
        raise ValueError("이름을 입력하세요")
    if not EMAIL_PATTERN.match(normalized_email):
        raise ValueError("올바른 이메일 주소를 입력하세요")
    if db.scalar(select(UserAccountORM.id).where(UserAccountORM.email == normalized_email)) is not None:
        raise ValueError("이미 가입된 이메일입니다. '기존 계정 추가'를 사용하세요.")

    generated = not password
    initial_password = password or generate_temporary_password()
    if len(initial_password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"비밀번호는 {MIN_PASSWORD_LENGTH}자 이상이어야 합니다")

    user = UserAccountORM(
        username=_unique_username(db, name, normalized_email),
        display_name=name,
        email=normalized_email,
        password=hash_password(initial_password),
        global_role="user",
        is_active=True,
        is_approved=True,
    )
    db.add(user)
    db.flush()
    member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
    db.add(member)
    db.flush()
    _audit(
        db,
        actor=owner_user_id,
        company_id=company_id,
        target_type="company_member",
        target_id=str(member.id),
        action="register_researcher",
        detail=f"Owner registered researcher account {normalized_email}",
    )
    db.commit()
    return {
        "company_member_id": member.id,
        "user_id": user.id,
        "name": user.display_name,
        "email": user.email,
        "temporary_password": initial_password if generated else None,
    }


def _get_pending_request(db: Session, company_id: int, request_id: int) -> CompanyMembershipRequestORM:
    request = db.get(CompanyMembershipRequestORM, request_id)
    if request is None or request.company_id != company_id or request.status != "pending":
        raise LookupError("대기 중인 가입 요청을 찾을 수 없습니다")
    return request


def approve_membership_request(db: Session, owner_user_id: int, *, request_id: int) -> dict:
    company_id = _require_owner_company(db, owner_user_id)
    request = _get_pending_request(db, company_id, request_id)
    user = db.get(UserAccountORM, request.user_id)
    if user is None:
        raise LookupError("가입 요청한 사용자를 찾을 수 없습니다")
    other_company = db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == user.id, CompanyMemberORM.company_id != company_id)
    )
    if other_company is not None:
        raise ValueError("이미 다른 기관에 소속된 사용자입니다")

    member = db.scalar(
        select(CompanyMemberORM).where(CompanyMemberORM.user_id == user.id, CompanyMemberORM.company_id == company_id)
    )
    if member is None:
        member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
        db.add(member)
    user.is_active = True
    user.is_approved = True
    request.status = "approved"
    db.flush()
    _audit(
        db,
        actor=owner_user_id,
        company_id=company_id,
        target_type="company_membership_request",
        target_id=str(request.id),
        action="approve_company_membership_request",
        detail=f"Approved membership request for {user.email}",
    )
    db.commit()
    return {"company_member_id": member.id, "user_id": user.id, "name": user.display_name, "email": user.email}


def reject_membership_request(db: Session, owner_user_id: int, *, request_id: int) -> None:
    company_id = _require_owner_company(db, owner_user_id)
    request = _get_pending_request(db, company_id, request_id)
    user = db.get(UserAccountORM, request.user_id)
    _audit(
        db,
        actor=owner_user_id,
        company_id=company_id,
        target_type="company_membership_request",
        target_id=str(request.id),
        action="reject_company_membership_request",
        detail=f"Rejected membership request for {user.email if user else request.user_id}",
    )
    # Removed rather than kept as "rejected": (company, user) is unique, and the person may
    # ask again later. The audit log keeps the history.
    db.delete(request)
    db.commit()
