from sqlalchemy.orm import Session
from sqlalchemy import select

from app.domain.audit.entities import AuditLogEntry
from app.domain.companies.entities import Company, CompanyMember
from app.infrastructure.repositories.sqlalchemy_identity import (
    SqlAlchemyAuditLogRepository,
    SqlAlchemyCompanyMemberRepository,
    SqlAlchemyCompanyRepository,
    SqlAlchemyDirectoryQueries,
    SqlAlchemyUserAccountRepository,
)
from app.infrastructure.db.models import CompanyMemberORM, UserAccountORM


def list_organizations(db: Session) -> list[dict]:
    companies = SqlAlchemyCompanyRepository(db).list_all()
    company_members = SqlAlchemyCompanyMemberRepository(db)
    return [
        {
            "id": company.id,
            "name": company.name,
            "code": company.join_code,
            "description": None,
            "is_active": company.is_active,
            "owner_user_id": _find_owner_user_id(list(company_members.list_by_company(company.id or 0))),
            "approval_status": "approved" if company.is_active else "pending",
            "created_at": company.created_at,
        }
        for company in companies
    ]


def create_organization(db: Session, *, name: str, code: str, description: str | None) -> dict:
    _ = description
    companies = SqlAlchemyCompanyRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    join_code = code.strip().upper()
    if len(join_code) != 9:
        raise ValueError("Organization code must be exactly 9 characters")
    if companies.get_by_name(name.strip()):
        raise ValueError("Organization name already exists")
    if companies.get_by_join_code(join_code):
        raise ValueError("Organization code already exists")

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
        raise ValueError("Organization not found")
    if name is not None:
        company.name = name
    if code is not None:
        normalized = code.strip().upper()
        if len(normalized) != 9:
            raise ValueError("Organization code must be exactly 9 characters")
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
        "approval_status": "approved" if updated.is_active else "pending",
        "created_at": updated.created_at,
    }


def list_pending_organizations(db: Session) -> list[dict]:
    companies = SqlAlchemyCompanyRepository(db).list_pending()
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
        raise ValueError("Organization not found")
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
        raise ValueError("Organization not found")
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
        raise ValueError("Organization not found")

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
    }


def create_researcher_invitation(db: Session, owner_user_id: int, *, email: str) -> dict:
    company_id = _require_owner_company(db, owner_user_id)
    normalized_email = email.strip().lower()
    users = SqlAlchemyUserAccountRepository(db)
    members = SqlAlchemyCompanyMemberRepository(db)
    audits = SqlAlchemyAuditLogRepository(db)
    directory = SqlAlchemyDirectoryQueries(db)

    existing_user = users.get_by_email(normalized_email)
    if existing_user is not None and members.get_by_company_and_user(company_id, existing_user.id or 0):
        raise ValueError("User is already a member of this company")
    if existing_user is not None:
        existing_company_id = directory.get_primary_company_id_for_user(existing_user.id or 0)
        if existing_company_id is not None and existing_company_id != company_id:
            raise ValueError("User already belongs to another company")

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
    raise ValueError("User account not found. Ask the researcher to sign up first.")


def remove_researcher_member(db: Session, owner_user_id: int, *, company_member_id: int) -> None:
    company_id = _require_owner_company(db, owner_user_id)
    member = db.get(CompanyMemberORM, company_member_id)
    if member is None or member.company_id != company_id:
        raise ValueError("Researcher not found in this company")
    if member.role == "owner":
        raise ValueError("Owner accounts cannot be removed from researcher management")
    if member.user_id == owner_user_id:
        raise ValueError("You cannot remove your own owner membership")

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
        raise ValueError("Owner access required")
    company_id = directory.get_primary_company_id_for_user(owner_user_id)
    if company_id is None:
        raise ValueError("Organization not found")
    return company_id
