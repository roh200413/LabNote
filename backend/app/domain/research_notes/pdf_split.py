"""Split one uploaded PDF into several research notes (e.g. one note per page or per N pages).

Each note gets its own slice of the PDF as the attached source file, so it goes through the
normal upload path (page images, thumbnails, checksums) like any other attachment.
"""

from dataclasses import dataclass
from datetime import date
from pathlib import Path

import fitz
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.accounts.entities import UserAccount
from app.domain.research_notes.use_cases import (
    FileUploadLimitError,
    UnsupportedFileTypeError,
    create_research_note,
    upload_note_file,
)

MAX_NOTES_PER_SPLIT = 100


@dataclass
class SplitNote:
    note_id: str
    title: str
    first_page: int
    last_page: int


def _page_label(first: int, last: int) -> str:
    return f"{first}p" if first == last else f"{first}-{last}p"


def split_pdf_into_notes(
    db: Session,
    current_user: UserAccount,
    *,
    project_id: str,
    pdf_bytes: bytes,
    original_name: str,
    pages_per_note: int,
    title: str,
    owner_member_id: int,
    reviewer_member_id: int | None = None,
    written_date: date | None = None,
    reviewed_date: date | None = None,
) -> list[SplitNote]:
    settings = get_settings()
    if pages_per_note < 1:
        raise ValueError("노트당 페이지 수는 1 이상이어야 합니다")
    if len(pdf_bytes) > settings.max_upload_bytes:
        raise FileUploadLimitError(f"파일 크기는 {settings.max_upload_bytes}바이트를 넘을 수 없습니다")
    try:
        source = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise UnsupportedFileTypeError("올바른 PDF 파일이 아닙니다") from exc

    try:
        page_count = source.page_count
        if page_count == 0:
            raise ValueError("페이지가 없는 PDF입니다")
        if page_count > settings.max_pdf_pages:
            raise FileUploadLimitError(f"PDF는 최대 {settings.max_pdf_pages}페이지까지 올릴 수 있습니다")
        ranges = [(start, min(start + pages_per_note, page_count) - 1) for start in range(0, page_count, pages_per_note)]
        if len(ranges) > MAX_NOTES_PER_SPLIT:
            raise ValueError(f"한 번에 노트를 최대 {MAX_NOTES_PER_SPLIT}개까지 만들 수 있습니다. 노트당 페이지 수를 늘리세요")

        base_title = title.strip() or Path(original_name).stem or "PDF"
        stem = Path(original_name.replace("\\", "/").rsplit("/", 1)[-1]).stem or "document"
        created: list[SplitNote] = []
        for first, last in ranges:
            label = _page_label(first + 1, last + 1)
            note_title = base_title if len(ranges) == 1 else f"{base_title} ({label})"
            part = fitz.open()
            part.insert_pdf(source, from_page=first, to_page=last)
            part_bytes = part.tobytes()
            part.close()

            note = create_research_note(
                db,
                current_user,
                project_id=project_id,
                title=note_title[:255],
                owner_member_id=owner_member_id,
                reviewer_member_id=reviewer_member_id,
                written_date=written_date,
                reviewed_date=reviewed_date,
            )
            upload_note_file(
                db,
                note_id=note.id,
                uploaded_by=current_user.id,
                original_name=f"{stem}_{label}.pdf",
                mime_type="application/pdf",
                file_bytes=part_bytes,
                current_user=current_user,
            )
            created.append(SplitNote(note_id=note.id, title=note.title, first_page=first + 1, last_page=last + 1))
        return created
    finally:
        source.close()
