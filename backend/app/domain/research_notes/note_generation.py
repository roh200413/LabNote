"""AI-assisted research note draft generation.

The domain layer only knows the ``NoteGenerator`` protocol; the concrete LLM
client lives in ``app.infrastructure.llm`` and is injected by the router.
"""

import io
from dataclasses import dataclass, field
from typing import Protocol

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.accounts.entities import UserAccount
from app.domain.note_formats.page_fit import draft_char_budget
from app.domain.note_formats.use_cases import get_note_format_for_note
from app.domain.research_notes.use_cases import (
    EDITABLE_NOTE_STATUSES,
    ResearchNoteManageDeniedError,
    ResearchNoteStateError,
    _can_manage_note,
    _get_note,
    _require_note_access,
)
from app.infrastructure.db.models import ProjectORM, ResearchNoteFileORM, ResearchNotePageORM
from app.infrastructure.storage.local_storage import LocalStorageService

SUPPORTED_LANGUAGES = {"ko", "en"}


class NoteGenerationUnavailableError(Exception):
    """Raised when no LLM provider is configured."""


class NoteGenerationFailedError(Exception):
    """Raised when the LLM call fails or returns an unusable response."""


@dataclass
class NoteGenerationInput:
    note_title: str
    project_name: str
    memo: str
    language: str
    images: list[bytes] = field(default_factory=list)
    existing_text: str = ""
    # (title, guide) pairs from the company note format, in order.
    sections: list[tuple[str, str]] = field(default_factory=list)
    # Characters that fit on the note's single A4 page (0: a default budget).
    max_chars: int = 0


@dataclass
class GeneratedSection:
    heading: str
    body: str


@dataclass
class GeneratedNote:
    sections: list[GeneratedSection]
    model: str

    def as_text(self) -> str:
        parts = []
        for section in self.sections:
            heading = section.heading.strip()
            body = section.body.strip()
            parts.append(f"■ {heading}\n{body}" if heading else body)
        return "\n\n".join(part for part in parts if part)


class NoteGenerator(Protocol):
    model: str

    def generate(self, data: NoteGenerationInput) -> GeneratedNote: ...


def _downscale_image(image_bytes: bytes, max_side: int) -> bytes:
    """Re-encode as JPEG and cap the longest side to keep token usage bounded."""
    with Image.open(io.BytesIO(image_bytes)) as image:
        image = image.convert("RGB")
        image.thumbnail((max_side, max_side))
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=85)
        return buffer.getvalue()


def _load_note_pages(db: Session, note_id: str, page_ids: list[int]) -> list[ResearchNotePageORM]:
    if not page_ids:
        return []
    stmt = (
        select(ResearchNotePageORM)
        .join(ResearchNoteFileORM, ResearchNoteFileORM.id == ResearchNotePageORM.file_id)
        .where(
            ResearchNoteFileORM.note_id == note_id,
            ResearchNoteFileORM.is_deleted.is_(False),
            ResearchNotePageORM.is_deleted.is_(False),
            ResearchNotePageORM.id.in_(page_ids),
        )
    )
    pages_by_id = {page.id: page for page in db.scalars(stmt).all()}
    missing = [page_id for page_id in page_ids if page_id not in pages_by_id]
    if missing:
        raise ValueError(f"이 노트의 페이지가 아닙니다: {missing}")
    return [pages_by_id[page_id] for page_id in page_ids]


def generate_note_draft(
    db: Session,
    *,
    note_id: str,
    page_ids: list[int],
    memo: str,
    language: str,
    existing_text: str,
    current_user: UserAccount,
    generator: NoteGenerator | None,
    max_pages: int,
    image_max_side: int,
) -> GeneratedNote:
    note = _get_note(db, note_id)
    project, company_member = _require_note_access(db, note, current_user)
    can_manage = _can_manage_note(current_user, project, company_member)
    is_author = company_member is not None and company_member.id == note.owner_member_id
    if note.status not in EDITABLE_NOTE_STATUSES:
        raise ResearchNoteStateError("초안, 반려, 재개 상태의 노트만 편집할 수 있습니다")
    if not can_manage and not is_author:
        raise ResearchNoteManageDeniedError("작성자, 프로젝트 책임자, 기관 관리자만 이 문서를 편집할 수 있습니다")

    if generator is None:
        raise NoteGenerationUnavailableError("AI 생성이 설정되지 않았습니다. 플랫폼 연동에서 LLM 연결을 설정하세요.")

    language = language if language in SUPPORTED_LANGUAGES else "ko"
    unique_page_ids = list(dict.fromkeys(page_ids))
    if len(unique_page_ids) > max_pages:
        raise ValueError(f"AI 초안에는 페이지를 최대 {max_pages}개까지 고를 수 있습니다")
    if not unique_page_ids and not memo.strip():
        raise ValueError("페이지를 하나 이상 고르거나 메모를 입력하세요")

    storage = LocalStorageService()
    images: list[bytes] = []
    for page in _load_note_pages(db, note_id, unique_page_ids):
        path = storage.absolute_path(page.image_storage_key)
        if not path.exists():
            raise ValueError(f"{page.id}번 페이지 이미지가 없습니다")
        images.append(_downscale_image(path.read_bytes(), image_max_side))

    project_row = db.get(ProjectORM, note.project_id)
    note_format = get_note_format_for_note(db, note)
    return generator.generate(
        NoteGenerationInput(
            note_title=note.title,
            project_name=project_row.name if project_row else "",
            memo=memo.strip(),
            language=language,
            images=images,
            existing_text=existing_text.strip(),
            sections=[(section.title, section.guide) for section in note_format.sections],
            max_chars=draft_char_budget(note_format),
        )
    )
