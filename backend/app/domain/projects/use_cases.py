import base64
from urllib.parse import unquote_to_bytes

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ProjectMemberORM,
    ProjectNoteCoverORM,
    ProjectORM,
    UserAccountORM,
)
from app.infrastructure.storage.local_storage import LocalStorageService


class ProjectNotFoundError(Exception):
    pass


class ProjectAccessDeniedError(Exception):
    pass


class ProjectManageDeniedError(Exception):
    pass


def _persist_cover_image(raw_value: str | None, project_id: str) -> str | None:
    if not raw_value:
        return None
    if not raw_value.startswith("data:image/"):
        return raw_value

    header, encoded = raw_value.split(",", 1)
    if ";base64" in header:
        image_bytes = base64.b64decode(encoded)
    else:
        image_bytes = unquote_to_bytes(encoded)

    ext = ".png"
    if "image/jpeg" in header:
        ext = ".jpg"
    elif "image/webp" in header:
        ext = ".webp"

    storage = LocalStorageService()
    storage_key = storage.save_bytes(image_bytes, "covers", f"{project_id}_cover{ext}")
    return f"/storage/{storage_key}"


def _get_company_member(db: Session, *, user_id: int, company_id: int) -> CompanyMemberORM | None:
    stmt = select(CompanyMemberORM).where(
        CompanyMemberORM.user_id == user_id,
        CompanyMemberORM.company_id == company_id,
    )
    return db.scalar(stmt)


def _get_project_member(db: Session, *, project_id: str, company_member_id: int) -> ProjectMemberORM | None:
    stmt = select(ProjectMemberORM).where(
        ProjectMemberORM.project_id == project_id,
        ProjectMemberORM.company_member_id == company_member_id,
    )
    return db.scalar(stmt)


def _ensure_project_lead_membership(db: Session, *, project_id: str, owner_member_id: int | None) -> None:
    rows = db.scalars(select(ProjectMemberORM).where(ProjectMemberORM.project_id == project_id)).all()
    for row in rows:
        if row.role == "lead" and row.company_member_id != owner_member_id:
            row.role = "member"
    if owner_member_id is None:
        return
    existing = _get_project_member(db, project_id=project_id, company_member_id=owner_member_id)
    if existing is None:
        db.add(ProjectMemberORM(project_id=project_id, company_member_id=owner_member_id, role="lead"))
        db.flush()
        return
    if existing.role != "lead":
        existing.role = "lead"
        db.flush()


def _require_project(
    db: Session,
    *,
    project_id: str,
    current_user: UserAccount,
    manage: bool = False,
) -> tuple[ProjectORM, CompanyMemberORM | None]:
    project = db.get(ProjectORM, project_id)
    if not project:
        raise ProjectNotFoundError(project_id)

    if current_user.is_system_admin:
        return project, None

    company_member = _get_company_member(db, user_id=current_user.id or 0, company_id=project.company_id)
    if company_member is None:
        raise ProjectAccessDeniedError("You are not a member of this company")

    if current_user.is_company_owner:
        return project, company_member

    project_member = _get_project_member(db, project_id=project_id, company_member_id=company_member.id)
    if project_member is None:
        raise ProjectAccessDeniedError("Only participating researchers can open this project")

    if manage and project.owner_member_id != company_member.id:
        raise ProjectManageDeniedError("Only the project lead or company owner can manage project researchers")

    return project, company_member


def create_project(db: Session, current_user: UserAccount, **kwargs) -> ProjectORM:
    company_id = kwargs["company_id"]
    if not current_user.is_system_admin:
        company_member = _get_company_member(db, user_id=current_user.id or 0, company_id=company_id)
        if company_member is None:
            raise ProjectAccessDeniedError("You are not a member of this company")
        if not current_user.is_company_owner:
            raise ProjectManageDeniedError("Only the company owner can create projects")
    owner_member_id = kwargs.get("owner_member_id")
    if owner_member_id is not None:
        owner_member = db.get(CompanyMemberORM, owner_member_id)
        if owner_member is None or owner_member.company_id != company_id:
            raise ValueError("Lead member must belong to this company")

    project = ProjectORM(**kwargs)
    db.add(project)
    db.flush()
    _ensure_project_lead_membership(db, project_id=project.id, owner_member_id=owner_member_id)
    db.commit()
    db.refresh(project)
    return project


def list_projects(db: Session, current_user: UserAccount, company_id: int | None = None) -> list[ProjectORM]:
    stmt = select(ProjectORM)
    if current_user.is_system_admin:
        if company_id is not None:
            stmt = stmt.where(ProjectORM.company_id == company_id)
        return list(db.scalars(stmt.order_by(ProjectORM.created_at.desc())).all())

    if current_user.is_company_owner:
        owner_company = company_id
        if owner_company is None:
            membership = db.scalar(
                select(CompanyMemberORM).where(CompanyMemberORM.user_id == (current_user.id or 0)).order_by(CompanyMemberORM.id.asc())
            )
            owner_company = membership.company_id if membership else None
        if owner_company is None:
            return []
        stmt = stmt.where(ProjectORM.company_id == owner_company)
        return list(db.scalars(stmt.order_by(ProjectORM.created_at.desc())).all())

    stmt = (
        stmt.join(ProjectMemberORM, ProjectMemberORM.project_id == ProjectORM.id)
        .join(CompanyMemberORM, CompanyMemberORM.id == ProjectMemberORM.company_member_id)
        .where(CompanyMemberORM.user_id == (current_user.id or 0))
    )
    if company_id is not None:
        stmt = stmt.where(ProjectORM.company_id == company_id)
    return list(db.scalars(stmt.order_by(ProjectORM.created_at.desc())).all())


def get_project(db: Session, project_id: str, current_user: UserAccount) -> ProjectORM:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user)
    return project


def update_project(db: Session, project_id: str, current_user: UserAccount, **kwargs) -> ProjectORM:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    owner_member_id = kwargs.get("owner_member_id", project.owner_member_id)
    if owner_member_id is not None:
        owner_member = db.get(CompanyMemberORM, owner_member_id)
        if owner_member is None or owner_member.company_id != project.company_id:
            raise ValueError("Lead member must belong to this company")
    for key, value in kwargs.items():
        setattr(project, key, value)
    _ensure_project_lead_membership(db, project_id=project.id, owner_member_id=project.owner_member_id)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: str, current_user: UserAccount) -> None:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    db.delete(project)
    db.commit()


def assign_project_member(
    db: Session,
    project_id: str,
    company_member_id: int,
    role: str,
    current_user: UserAccount,
) -> ProjectMemberORM:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    company_member = db.get(CompanyMemberORM, company_member_id)
    if company_member is None or company_member.company_id != project.company_id:
        raise ValueError("Selected researcher is not a member of this company")

    stmt = select(ProjectMemberORM).where(
        ProjectMemberORM.project_id == project_id,
        ProjectMemberORM.company_member_id == company_member_id,
    )
    existing = db.scalar(stmt)
    if existing:
        existing.role = role
        db.commit()
        db.refresh(existing)
        return existing

    member = ProjectMemberORM(project_id=project_id, company_member_id=company_member_id, role=role)
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def list_project_members(db: Session, project_id: str, current_user: UserAccount) -> list[dict]:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user)
    _ensure_project_lead_membership(db, project_id=project.id, owner_member_id=project.owner_member_id)
    db.commit()
    rows = db.execute(
        select(ProjectMemberORM, CompanyMemberORM, UserAccountORM)
        .join(CompanyMemberORM, CompanyMemberORM.id == ProjectMemberORM.company_member_id)
        .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
        .where(ProjectMemberORM.project_id == project_id, CompanyMemberORM.company_id == project.company_id)
        .order_by(UserAccountORM.display_name.asc(), ProjectMemberORM.id.asc())
    ).all()
    return [
        {
            "id": project_member.id,
            "project_id": project_member.project_id,
            "company_member_id": company_member.id,
            "company_id": company_member.company_id,
            "user_id": user.id,
            "name": user.display_name,
            "email": user.email,
            "company_role": company_member.role,
            "role": project_member.role,
            "is_active": user.is_active,
            "is_approved": user.is_approved,
            "created_at": project_member.created_at,
            "updated_at": project_member.updated_at,
        }
        for project_member, company_member, user in rows
    ]


def remove_project_member(db: Session, project_id: str, company_member_id: int, current_user: UserAccount) -> bool:
    project, _ = _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    if project.owner_member_id == company_member_id:
        raise ProjectManageDeniedError("Remove the project lead from the dashboard only after changing the lead")
    stmt = select(ProjectMemberORM).where(
        ProjectMemberORM.project_id == project_id,
        ProjectMemberORM.company_member_id == company_member_id,
    )
    member = db.scalar(stmt)
    if not member:
        return False
    db.delete(member)
    db.commit()
    return True


def get_project_cover(db: Session, project_id: str, current_user: UserAccount) -> ProjectNoteCoverORM | None:
    _require_project(db, project_id=project_id, current_user=current_user)
    stmt = select(ProjectNoteCoverORM).where(ProjectNoteCoverORM.project_id == project_id)
    return db.scalar(stmt)


def upsert_project_cover(db: Session, project_id: str, current_user: UserAccount, **kwargs) -> ProjectNoteCoverORM:
    _require_project(db, project_id=project_id, current_user=current_user, manage=True)
    if "cover_image_data_url" in kwargs:
        kwargs["cover_image_data_url"] = _persist_cover_image(kwargs.get("cover_image_data_url"), project_id)
    cover = get_project_cover(db, project_id, current_user)
    if cover is None:
        cover = ProjectNoteCoverORM(project_id=project_id, **kwargs)
        db.add(cover)
    else:
        for key, value in kwargs.items():
            setattr(cover, key, value)
    db.commit()
    db.refresh(cover)
    return cover
