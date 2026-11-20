"""Note bundles: named groups of research notes inside a project.

Any project participant can see bundles and create one. Renaming or deleting a bundle, and moving
notes, follow the note rules: managers (project owner, company owner, system admin) can do it for
any note; other participants only for notes they wrote. Deleting a bundle keeps its notes; they
simply go back to "no bundle".
"""

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.research_notes.use_cases import (
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
    _can_manage_note,
    _get_project,
    _require_project_access,
)
from app.infrastructure.db.models import GitHubProjectMappingORM, ResearchNoteBundleORM, ResearchNoteORM


class NoteBundleNotFoundError(Exception):
    pass


def require_bundle_in_project(db: Session, bundle_id: str, project_id: str) -> ResearchNoteBundleORM:
    bundle = db.get(ResearchNoteBundleORM, bundle_id)
    if bundle is None or bundle.project_id != project_id:
        raise ValueError("이 프로젝트의 묶음이 아닙니다")
    return bundle


def _clean_name(name: str) -> str:
    cleaned = " ".join((name or "").split())
    if not cleaned:
        raise ValueError("묶음 이름을 입력하세요")
    if len(cleaned) > 100:
        raise ValueError("묶음 이름은 100자 이하로 입력하세요")
    return cleaned


def _ensure_unique(db: Session, project_id: str, name: str, exclude_id: str | None = None) -> None:
    stmt = select(ResearchNoteBundleORM.id).where(
        ResearchNoteBundleORM.project_id == project_id,
        func.lower(ResearchNoteBundleORM.name) == name.lower(),
    )
    if exclude_id:
        stmt = stmt.where(ResearchNoteBundleORM.id != exclude_id)
    if db.scalar(stmt):
        raise ValueError("같은 이름의 묶음이 이미 있습니다")


def _summary(bundle: ResearchNoteBundleORM, note_count: int) -> dict:
    return {
        "id": bundle.id,
        "project_id": bundle.project_id,
        "name": bundle.name,
        "description": bundle.description,
        "note_count": note_count,
        "created_at": bundle.created_at,
    }


def _note_counts(db: Session, project_id: str) -> dict[str | None, int]:
    rows = db.execute(
        select(ResearchNoteORM.bundle_id, func.count(ResearchNoteORM.id))
        .where(ResearchNoteORM.project_id == project_id, ResearchNoteORM.is_deleted.is_(False))
        .group_by(ResearchNoteORM.bundle_id)
    ).all()
    return {bundle_id: count for bundle_id, count in rows}


def list_bundles(db: Session, user: UserAccount, project_id: str) -> list[dict]:
    project = _get_project(db, project_id)
    _require_project_access(db, project, user)
    counts = _note_counts(db, project.id)
    bundles = db.scalars(
        select(ResearchNoteBundleORM)
        .where(ResearchNoteBundleORM.project_id == project.id)
        .order_by(ResearchNoteBundleORM.created_at.asc())
    ).all()
    return [_summary(bundle, counts.get(bundle.id, 0)) for bundle in bundles]


def create_bundle(db: Session, user: UserAccount, project_id: str, *, name: str, description: str | None = None) -> dict:
    project = _get_project(db, project_id)
    _require_project_access(db, project, user)
    cleaned = _clean_name(name)
    _ensure_unique(db, project.id, cleaned)
    bundle = ResearchNoteBundleORM(
        project_id=project.id,
        name=cleaned,
        description=(description or "").strip() or None,
        created_by=user.id,
    )
    db.add(bundle)
    db.commit()
    db.refresh(bundle)
    return _summary(bundle, 0)


def _bundle_for_change(db: Session, user: UserAccount, bundle_id: str) -> ResearchNoteBundleORM:
    bundle = db.get(ResearchNoteBundleORM, bundle_id)
    if bundle is None:
        raise NoteBundleNotFoundError(bundle_id)
    project = _get_project(db, bundle.project_id)
    member = _require_project_access(db, project, user)
    if not _can_manage_note(user, project, member) and bundle.created_by != user.id:
        raise ResearchNoteManageDeniedError("묶음은 만든 사람, 프로젝트 책임자, 기관 관리자만 바꿀 수 있습니다")
    return bundle


def update_bundle(
    db: Session, user: UserAccount, bundle_id: str, *, name: str | None = None, description: str | None = None
) -> dict:
    bundle = _bundle_for_change(db, user, bundle_id)
    if name is not None:
        cleaned = _clean_name(name)
        _ensure_unique(db, bundle.project_id, cleaned, exclude_id=bundle.id)
        bundle.name = cleaned
    if description is not None:
        bundle.description = description.strip() or None
    db.commit()
    db.refresh(bundle)
    return _summary(bundle, _note_counts(db, bundle.project_id).get(bundle.id, 0))


def delete_bundle(db: Session, user: UserAccount, bundle_id: str) -> None:
    bundle = _bundle_for_change(db, user, bundle_id)
    db.execute(update(ResearchNoteORM).where(ResearchNoteORM.bundle_id == bundle.id).values(bundle_id=None))
    db.execute(
        update(GitHubProjectMappingORM).where(GitHubProjectMappingORM.bundle_id == bundle.id).values(bundle_id=None)
    )
    db.delete(bundle)
    db.commit()


def move_notes(db: Session, user: UserAccount, project_id: str, *, note_ids: list[str], bundle_id: str | None) -> int:
    """Puts the notes in a bundle (or takes them out with bundle_id=None). Returns how many moved."""
    project = _get_project(db, project_id)
    member = _require_project_access(db, project, user)
    if bundle_id:
        require_bundle_in_project(db, bundle_id, project.id)
    can_manage = _can_manage_note(user, project, member)
    notes = db.scalars(
        select(ResearchNoteORM).where(
            ResearchNoteORM.id.in_(list(dict.fromkeys(note_ids))),
            ResearchNoteORM.project_id == project.id,
            ResearchNoteORM.is_deleted.is_(False),
        )
    ).all()
    if len(notes) != len(set(note_ids)):
        raise ResearchNoteNotFoundError("일부 연구노트를 이 프로젝트에서 찾을 수 없습니다")
    if not can_manage and any(member is None or note.owner_member_id != member.id for note in notes):
        raise ResearchNoteManageDeniedError("다른 사람이 쓴 노트는 프로젝트 책임자나 기관 관리자만 옮길 수 있습니다")
    for note in notes:
        note.bundle_id = bundle_id or None
    db.commit()
    return len(notes)
