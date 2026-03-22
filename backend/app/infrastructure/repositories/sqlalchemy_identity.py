from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.audit.entities import AuditLogEntry
from app.domain.companies.entities import Company, CompanyMember, CompanyMembershipRequest
from app.infrastructure.db.models import (
    AuditLogORM,
    CompanyMemberORM,
    CompanyMembershipRequestORM,
    CompanyORM,
    UserAccountORM,
)


def _to_user_entity(orm: UserAccountORM) -> UserAccount:
    return UserAccount(
        id=orm.id,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        username=orm.username,
        display_name=orm.display_name,
        email=orm.email,
        password=orm.password,
        global_role=orm.global_role,
        is_active=orm.is_active,
        is_approved=orm.is_approved,
        signature_data_url=orm.signature_data_url,
    )


def _to_company_entity(orm: CompanyORM) -> Company:
    return Company(
        id=orm.id,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        name=orm.name,
        join_code=orm.join_code,
        is_active=orm.is_active,
    )


def _to_company_member_entity(orm: CompanyMemberORM) -> CompanyMember:
    return CompanyMember(
        id=orm.id,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        company_id=orm.company_id,
        user_id=orm.user_id,
        role=orm.role,
    )


def _to_company_membership_request_entity(orm: CompanyMembershipRequestORM) -> CompanyMembershipRequest:
    return CompanyMembershipRequest(
        id=orm.id,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        company_id=orm.company_id,
        user_id=orm.user_id,
        status=orm.status,
    )


def _to_audit_entity(orm: AuditLogORM) -> AuditLogEntry:
    return AuditLogEntry(
        id=orm.id,
        created_at=orm.created_at,
        actor_user_id=orm.actor_user_id,
        company_id=orm.company_id,
        target_type=orm.target_type,
        target_id=orm.target_id,
        action=orm.action,
        detail=orm.detail,
    )


class SqlAlchemyUserAccountRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, user: UserAccount) -> UserAccount:
        orm = UserAccountORM(
            username=user.username,
            display_name=user.display_name,
            email=user.email,
            password=user.password,
            global_role=user.global_role,
            is_active=user.is_active,
            is_approved=user.is_approved,
            signature_data_url=user.signature_data_url,
        )
        self.db.add(orm)
        self.db.flush()
        self.db.refresh(orm)
        return _to_user_entity(orm)

    def update(self, user: UserAccount) -> UserAccount:
        orm = self.db.get(UserAccountORM, user.id)
        if orm is None:
            raise ValueError("User not found")
        orm.username = user.username
        orm.display_name = user.display_name
        orm.email = user.email
        orm.password = user.password
        orm.global_role = user.global_role
        orm.is_active = user.is_active
        orm.is_approved = user.is_approved
        orm.signature_data_url = user.signature_data_url
        self.db.flush()
        self.db.refresh(orm)
        return _to_user_entity(orm)

    def get(self, user_id: int) -> UserAccount | None:
        orm = self.db.get(UserAccountORM, user_id)
        return _to_user_entity(orm) if orm else None

    def get_by_email(self, email: str) -> UserAccount | None:
        orm = self.db.scalar(select(UserAccountORM).where(UserAccountORM.email == email))
        return _to_user_entity(orm) if orm else None

    def get_by_username(self, username: str) -> UserAccount | None:
        orm = self.db.scalar(select(UserAccountORM).where(UserAccountORM.username == username))
        return _to_user_entity(orm) if orm else None

    def list_all(self) -> Sequence[UserAccount]:
        return [_to_user_entity(item) for item in self.db.scalars(select(UserAccountORM).order_by(UserAccountORM.created_at.desc())).all()]


class SqlAlchemyCompanyRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, company: Company) -> Company:
        orm = CompanyORM(name=company.name, join_code=company.join_code, is_active=company.is_active)
        self.db.add(orm)
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_entity(orm)

    def update(self, company: Company) -> Company:
        orm = self.db.get(CompanyORM, company.id)
        if orm is None:
            raise ValueError("Company not found")
        orm.name = company.name
        orm.join_code = company.join_code
        orm.is_active = company.is_active
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_entity(orm)

    def get(self, company_id: int) -> Company | None:
        orm = self.db.get(CompanyORM, company_id)
        return _to_company_entity(orm) if orm else None

    def get_by_name(self, name: str) -> Company | None:
        orm = self.db.scalar(select(CompanyORM).where(CompanyORM.name == name))
        return _to_company_entity(orm) if orm else None

    def get_by_join_code(self, join_code: str) -> Company | None:
        orm = self.db.scalar(select(CompanyORM).where(CompanyORM.join_code == join_code))
        return _to_company_entity(orm) if orm else None

    def list_all(self) -> Sequence[Company]:
        return [_to_company_entity(item) for item in self.db.scalars(select(CompanyORM).order_by(CompanyORM.created_at.desc())).all()]

    def list_pending(self) -> Sequence[Company]:
        return [_to_company_entity(item) for item in self.db.scalars(select(CompanyORM).where(CompanyORM.is_active.is_(False)).order_by(CompanyORM.created_at.asc())).all()]


class SqlAlchemyCompanyMemberRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, member: CompanyMember) -> CompanyMember:
        orm = CompanyMemberORM(company_id=member.company_id, user_id=member.user_id, role=member.role)
        self.db.add(orm)
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_member_entity(orm)

    def update(self, member: CompanyMember) -> CompanyMember:
        orm = self.db.get(CompanyMemberORM, member.id)
        if orm is None:
            raise ValueError("Company member not found")
        orm.company_id = member.company_id
        orm.user_id = member.user_id
        orm.role = member.role
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_member_entity(orm)

    def get(self, member_id: int) -> CompanyMember | None:
        orm = self.db.get(CompanyMemberORM, member_id)
        return _to_company_member_entity(orm) if orm else None

    def get_by_company_and_user(self, company_id: int, user_id: int) -> CompanyMember | None:
        orm = self.db.scalar(
            select(CompanyMemberORM).where(
                CompanyMemberORM.company_id == company_id,
                CompanyMemberORM.user_id == user_id,
            )
        )
        return _to_company_member_entity(orm) if orm else None

    def list_by_company(self, company_id: int) -> Sequence[CompanyMember]:
        rows = self.db.scalars(select(CompanyMemberORM).where(CompanyMemberORM.company_id == company_id)).all()
        return [_to_company_member_entity(item) for item in rows]

    def list_by_user(self, user_id: int) -> Sequence[CompanyMember]:
        rows = self.db.scalars(select(CompanyMemberORM).where(CompanyMemberORM.user_id == user_id)).all()
        return [_to_company_member_entity(item) for item in rows]


class SqlAlchemyCompanyMembershipRequestRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, request: CompanyMembershipRequest) -> CompanyMembershipRequest:
        orm = CompanyMembershipRequestORM(
            company_id=request.company_id,
            user_id=request.user_id,
            status=request.status,
        )
        self.db.add(orm)
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_membership_request_entity(orm)

    def update(self, request: CompanyMembershipRequest) -> CompanyMembershipRequest:
        orm = self.db.get(CompanyMembershipRequestORM, request.id)
        if orm is None:
            raise ValueError("Company membership request not found")
        orm.status = request.status
        self.db.flush()
        self.db.refresh(orm)
        return _to_company_membership_request_entity(orm)

    def get_pending_by_company_and_user(self, company_id: int, user_id: int) -> CompanyMembershipRequest | None:
        orm = self.db.scalar(
            select(CompanyMembershipRequestORM).where(
                CompanyMembershipRequestORM.company_id == company_id,
                CompanyMembershipRequestORM.user_id == user_id,
                CompanyMembershipRequestORM.status == "pending",
            )
        )
        return _to_company_membership_request_entity(orm) if orm else None

    def list_by_company(self, company_id: int) -> Sequence[CompanyMembershipRequest]:
        rows = self.db.scalars(
            select(CompanyMembershipRequestORM)
            .where(CompanyMembershipRequestORM.company_id == company_id)
            .order_by(CompanyMembershipRequestORM.created_at.desc())
        ).all()
        return [_to_company_membership_request_entity(item) for item in rows]


class SqlAlchemyAuditLogRepository:
    def __init__(self, db: Session) -> None:
        self.db = db

    def add(self, entry: AuditLogEntry) -> AuditLogEntry:
        orm = AuditLogORM(
            actor_user_id=entry.actor_user_id,
            company_id=entry.company_id,
            target_type=entry.target_type,
            target_id=entry.target_id,
            action=entry.action,
            detail=entry.detail,
        )
        self.db.add(orm)
        self.db.flush()
        self.db.refresh(orm)
        return _to_audit_entity(orm)

    def list_recent(self, limit: int = 10) -> Sequence[AuditLogEntry]:
        rows = self.db.scalars(select(AuditLogORM).order_by(AuditLogORM.created_at.desc()).limit(limit)).all()
        return [_to_audit_entity(item) for item in rows]

    def list_by_action_since(self, action: str, since_iso_date: str) -> Sequence[AuditLogEntry]:
        rows = self.db.scalars(
            select(AuditLogORM)
            .where(AuditLogORM.action == action, func.date(AuditLogORM.created_at) >= since_iso_date)
            .order_by(AuditLogORM.created_at.asc())
        ).all()
        return [_to_audit_entity(item) for item in rows]


class SqlAlchemyDirectoryQueries:
    def __init__(self, db: Session) -> None:
        self.db = db

    def get_primary_company_id_for_user(self, user_id: int) -> int | None:
        membership = self.db.scalar(
            select(CompanyMemberORM).where(CompanyMemberORM.user_id == user_id).order_by(CompanyMemberORM.id.asc())
        )
        return membership.company_id if membership else None

    def is_company_owner(self, user_id: int) -> bool:
        membership = self.db.scalar(
            select(CompanyMemberORM).where(CompanyMemberORM.user_id == user_id, CompanyMemberORM.role == "owner")
        )
        return membership is not None

    def list_company_members_with_users(self, company_id: int) -> list[dict]:
        rows = self.db.execute(
            select(CompanyMemberORM, UserAccountORM)
            .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
            .where(CompanyMemberORM.company_id == company_id)
            .order_by(UserAccountORM.display_name.asc(), CompanyMemberORM.id.asc())
        ).all()
        return [
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
            for member, user in rows
        ]
