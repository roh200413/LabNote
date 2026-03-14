from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db.models import ProjectMemberORM, ProjectORM


class ProjectNotFoundError(Exception):
    pass


def create_project(db: Session, **kwargs) -> ProjectORM:
    project = ProjectORM(**kwargs)
    db.add(project)
    db.commit()
    db.refresh(project)
    return project


def list_projects(db: Session, company_id: int | None = None) -> list[ProjectORM]:
    stmt = select(ProjectORM)
    if company_id is not None:
        stmt = stmt.where(ProjectORM.company_id == company_id)
    return list(db.scalars(stmt.order_by(ProjectORM.created_at.desc())).all())


def get_project(db: Session, project_id: str) -> ProjectORM:
    project = db.get(ProjectORM, project_id)
    if not project:
        raise ProjectNotFoundError(project_id)
    return project


def update_project(db: Session, project_id: str, **kwargs) -> ProjectORM:
    project = get_project(db, project_id)
    for key, value in kwargs.items():
        setattr(project, key, value)
    db.commit()
    db.refresh(project)
    return project


def delete_project(db: Session, project_id: str) -> None:
    project = get_project(db, project_id)
    db.delete(project)
    db.commit()


def assign_project_member(
    db: Session, project_id: str, company_member_id: int, role: str
) -> ProjectMemberORM:
    get_project(db, project_id)
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

    member = ProjectMemberORM(
        project_id=project_id,
        company_member_id=company_member_id,
        role=role,
    )
    db.add(member)
    db.commit()
    db.refresh(member)
    return member


def list_project_members(db: Session, project_id: str) -> list[ProjectMemberORM]:
    get_project(db, project_id)
    stmt = select(ProjectMemberORM).where(ProjectMemberORM.project_id == project_id)
    return list(db.scalars(stmt.order_by(ProjectMemberORM.id.asc())).all())


def remove_project_member(db: Session, project_id: str, company_member_id: int) -> bool:
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
