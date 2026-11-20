"""Workspace search across projects, research notes (title, body, attachments) and researchers.

Only rows the current user may already open are searched: the project list comes from
``list_projects`` and researchers from the user's own company, so search never widens access.
"""

import json
from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.projects.use_cases import list_projects
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ResearchNoteDocumentORM,
    ResearchNoteFileORM,
    ResearchNoteORM,
    UserAccountORM,
)

SNIPPET_RADIUS = 40
MAX_LIMIT = 100


@dataclass
class SearchFilters:
    q: str = ""
    project_id: str | None = None
    author_member_id: int | None = None
    status: str | None = None
    date_from: date | None = None
    date_to: date | None = None
    limit: int = 30

    @property
    def terms(self) -> list[str]:
        return [term.casefold() for term in self.q.split() if term.strip()]

    @property
    def has_note_filters(self) -> bool:
        return any(
            value is not None
            for value in (self.project_id, self.author_member_id, self.status, self.date_from, self.date_to)
        )


@dataclass
class SearchResult:
    projects: list[dict] = field(default_factory=list)
    notes: list[dict] = field(default_factory=list)
    researchers: list[dict] = field(default_factory=list)
    note_total: int = 0


def _matches_all(terms: list[str], text: str) -> bool:
    folded = text.casefold()
    return all(term in folded for term in terms)


def _matches_any(terms: list[str], text: str) -> bool:
    folded = text.casefold()
    return any(term in folded for term in terms)


def _document_text(payload: str | None) -> str:
    """Plain text of the editable text blocks; locked template labels (작성자, 서명…) are skipped."""
    if not payload:
        return ""
    try:
        document = json.loads(payload)
    except ValueError:
        return ""
    blocks = document.get("blocks") if isinstance(document, dict) else None
    if not isinstance(blocks, list):
        return ""
    parts = []
    for block in blocks:
        if not isinstance(block, dict) or block.get("type") != "text" or block.get("locked"):
            continue
        content = str(block.get("content") or "").strip()
        if content:
            parts.append(content)
    return "\n".join(parts)


def _snippet(text: str, terms: list[str]) -> str:
    flat = " ".join(text.split())
    if not flat:
        return ""
    folded = flat.casefold()
    positions = [folded.find(term) for term in terms if folded.find(term) >= 0]
    if not positions:
        return flat[: SNIPPET_RADIUS * 2] + ("…" if len(flat) > SNIPPET_RADIUS * 2 else "")
    start = max(0, min(positions) - SNIPPET_RADIUS)
    end = min(len(flat), min(positions) + SNIPPET_RADIUS * 2)
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")


def _latest_document_text(db: Session, note_ids: list[str]) -> dict[str, str]:
    if not note_ids:
        return {}
    rows = db.execute(
        select(ResearchNoteDocumentORM.note_id, ResearchNoteDocumentORM.document_payload)
        .where(ResearchNoteDocumentORM.note_id.in_(note_ids))
        .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
    ).all()
    latest: dict[str, str] = {}
    for note_id, payload in rows:
        if note_id not in latest:
            latest[note_id] = _document_text(payload)
    return latest


def _file_names(db: Session, note_ids: list[str]) -> dict[str, list[str]]:
    if not note_ids:
        return {}
    rows = db.execute(
        select(ResearchNoteFileORM.note_id, ResearchNoteFileORM.original_name).where(
            ResearchNoteFileORM.note_id.in_(note_ids),
            ResearchNoteFileORM.is_deleted.is_(False),
        )
    ).all()
    names: dict[str, list[str]] = {}
    for note_id, name in rows:
        names.setdefault(note_id, []).append(name)
    return names


def _member_names(db: Session, member_ids: set[int]) -> dict[int, str]:
    if not member_ids:
        return {}
    rows = db.execute(
        select(CompanyMemberORM.id, UserAccountORM.display_name)
        .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
        .where(CompanyMemberORM.id.in_(member_ids))
    ).all()
    return {member_id: name for member_id, name in rows}


def _note_date(note: ResearchNoteORM) -> date | None:
    if note.written_date:
        return note.written_date
    return note.created_at.date() if note.created_at else None


def _search_researchers(db: Session, current_user: UserAccount, terms: list[str], limit: int) -> list[dict]:
    if not terms or current_user.is_system_admin:
        return []
    company_ids = db.scalars(
        select(CompanyMemberORM.company_id).where(CompanyMemberORM.user_id == (current_user.id or 0))
    ).all()
    if not company_ids:
        return []
    rows = db.execute(
        select(CompanyMemberORM, UserAccountORM)
        .join(UserAccountORM, UserAccountORM.id == CompanyMemberORM.user_id)
        .where(CompanyMemberORM.company_id.in_(company_ids))
        .order_by(UserAccountORM.display_name.asc())
    ).all()
    return [
        {
            "company_member_id": member.id,
            "name": user.display_name,
            "email": user.email,
            "role": member.role,
        }
        for member, user in rows
        if _matches_all(terms, f"{user.display_name} {user.email}")
    ][:limit]


def search_workspace(db: Session, current_user: UserAccount, filters: SearchFilters) -> SearchResult:
    terms = filters.terms
    limit = max(1, min(filters.limit, MAX_LIMIT))
    if not terms and not filters.has_note_filters:
        return SearchResult()

    projects = list_projects(db, current_user)
    projects_by_id = {project.id: project for project in projects}

    result = SearchResult()
    if terms and filters.project_id is None:
        result.projects = [
            {
                "id": project.id,
                "name": project.name,
                "code": project.code,
                "status": project.status,
                "description": project.description or "",
            }
            for project in projects
            if _matches_all(terms, f"{project.name} {project.code} {project.description or ''}")
        ][:limit]
    result.researchers = _search_researchers(db, current_user, terms, limit)

    project_ids = list(projects_by_id)
    if filters.project_id is not None:
        project_ids = [filters.project_id] if filters.project_id in projects_by_id else []
    if not project_ids:
        return result

    stmt = select(ResearchNoteORM).where(
        ResearchNoteORM.is_deleted.is_(False),
        ResearchNoteORM.project_id.in_(project_ids),
    )
    if filters.author_member_id is not None:
        stmt = stmt.where(ResearchNoteORM.owner_member_id == filters.author_member_id)
    if filters.status:
        stmt = stmt.where(ResearchNoteORM.status == filters.status)
    notes = [
        note
        for note in db.scalars(stmt.order_by(ResearchNoteORM.updated_at.desc())).all()
        if (filters.date_from is None or (_note_date(note) or date.min) >= filters.date_from)
        and (filters.date_to is None or (_note_date(note) or date.max) <= filters.date_to)
    ]

    note_ids = [note.id for note in notes]
    bodies = _latest_document_text(db, note_ids) if terms else {}
    files = _file_names(db, note_ids) if terms else {}
    authors = _member_names(db, {note.owner_member_id for note in notes})

    hits: list[tuple[int, dict]] = []
    for note in notes:
        body = "\n".join(part for part in (bodies.get(note.id, ""), note.content or "") if part)
        file_names = files.get(note.id, [])
        author = authors.get(note.owner_member_id, "")
        project = projects_by_id[note.project_id]
        matched_in: list[str] = []
        if terms:
            haystack = "\n".join([note.title, body, *file_names, author])
            if not _matches_all(terms, haystack):
                continue
            if _matches_any(terms, note.title):
                matched_in.append("title")
            if _matches_any(terms, body):
                matched_in.append("body")
            if any(_matches_any(terms, name) for name in file_names):
                matched_in.append("file")
            if _matches_any(terms, author):
                matched_in.append("author")
        matched_files = [name for name in file_names if terms and _matches_any(terms, name)]
        note_date = _note_date(note)
        hits.append(
            (
                0 if "title" in matched_in else 1,
                {
                    "id": note.id,
                    "title": note.title,
                    "project_id": project.id,
                    "project_name": project.name,
                    "status": note.status,
                    "written_date": note_date.isoformat() if note_date else None,
                    "updated_at": note.updated_at.isoformat() if note.updated_at else None,
                    "author_member_id": note.owner_member_id,
                    "author_name": author,
                    "matched_in": matched_in,
                    "matched_files": matched_files[:3],
                    "snippet": _snippet(body, terms) if "body" in matched_in else "",
                },
            )
        )

    # Title matches first; within a group the query order (most recently updated) is kept.
    hits.sort(key=lambda item: item[0])
    result.note_total = len(hits)
    result.notes = [hit for _, hit in hits[:limit]]
    return result
