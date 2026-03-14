from sqlalchemy import select
from sqlalchemy.orm import Session

from app.infrastructure.db.models import ProjectORM, ResearchNoteORM


class ResearchNoteNotFoundError(Exception):
    pass


class ProjectNotFoundError(Exception):
    pass


def _ensure_project_exists(db: Session, project_id: str) -> None:
    project = db.get(ProjectORM, project_id)
    if not project:
        raise ProjectNotFoundError(project_id)


def create_research_note(db: Session, **kwargs) -> ResearchNoteORM:
    _ensure_project_exists(db, kwargs["project_id"])
    note = ResearchNoteORM(**kwargs)
    db.add(note)
    db.commit()
    db.refresh(note)
    return note


def list_research_notes(db: Session, project_id: str | None = None) -> list[ResearchNoteORM]:
    stmt = select(ResearchNoteORM).where(ResearchNoteORM.is_deleted.is_(False))
    if project_id is not None:
        stmt = stmt.where(ResearchNoteORM.project_id == project_id)
    return list(db.scalars(stmt.order_by(ResearchNoteORM.created_at.desc())).all())


def get_research_note(db: Session, note_id: str) -> ResearchNoteORM:
    note = db.get(ResearchNoteORM, note_id)
    if not note or note.is_deleted:
        raise ResearchNoteNotFoundError(note_id)
    return note


def update_research_note(db: Session, note_id: str, **kwargs) -> ResearchNoteORM:
    note = get_research_note(db, note_id)
    for key, value in kwargs.items():
        setattr(note, key, value)
    db.commit()
    db.refresh(note)
    return note


def delete_research_note(db: Session, note_id: str) -> None:
    note = get_research_note(db, note_id)
    note.is_deleted = True
    db.commit()
