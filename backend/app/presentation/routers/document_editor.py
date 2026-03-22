import base64
import math
import io
import json
from pathlib import Path
from urllib.parse import unquote_to_bytes

import fitz
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.domain.research_notes.document_editor_use_cases import (
    ResearchNoteDocumentNotFoundError,
    get_note_document,
    list_note_documents,
    save_note_document,
    upload_editor_image,
)
from app.infrastructure.db.models import (
    CompanyORM,
    CompanyMemberORM,
    ProjectORM,
    ProjectNoteCoverORM,
    ResearchNoteDocumentORM,
    ResearchNoteFileORM,
    ResearchNoteORM,
    ResearchNotePageORM,
    UserAccountORM,
)
from app.infrastructure.db.session import get_db
from app.infrastructure.storage.local_storage import LocalStorageService
from app.presentation.schemas.document_editor import (
    DocumentSchemaPayload,
    EditorImageUploadResponse,
    ImageBlockSchema,
    ResearchNoteBatchExportRequest,
    ResearchNoteDocumentResponse,
    ResearchNoteDocumentSaveRequest,
    ResearchNoteDocumentSummaryResponse,
    ResearchNotePdfExportRequest,
    TextBlockSchema,
    TextStyleSchema,
)

router = APIRouter(prefix="/research-note-documents", tags=["research-note-documents"])

PAGE_WIDTH = 794
PAGE_HEIGHT = 1123
CONTENT_IMAGE_RECT = (34, 64, 726, 884)
ROOT_DIR = Path(__file__).resolve().parents[4]
COVER_LAYOUT = json.loads((ROOT_DIR / "shared" / "cover_layout.json").read_text(encoding="utf-8"))
FIXED_TEXT_IDS = {
    "note-title",
    "continued-page",
    "recorded-by",
    "recorded-date",
    "witnessed-by",
    "witnessed-date",
}
FIXED_IMAGE_IDS = {"author-signature", "reviewer-signature", "content-image"}
FIXED_BLOCK_IDS = FIXED_TEXT_IDS | FIXED_IMAGE_IDS


def _safe_json_loads(payload: str | None) -> dict:
    if not payload:
        return {}
    try:
        return json.loads(payload)
    except Exception:
        return {}


def _payload_str(payload: dict, *keys: str) -> str:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _payload_bool(payload: dict, *keys: str, default: bool = False) -> bool:
    for key in keys:
        value = payload.get(key)
        if isinstance(value, bool):
            return value
    return default


def _resolve_image_bytes(src: str, cache: dict[str, bytes] | None = None) -> bytes:
    if cache is not None and src in cache:
        return cache[src]
    if src.startswith("data:image/"):
        header, encoded = src.split(",", 1)
        if ";base64" in header:
            resolved = base64.b64decode(encoded)
        else:
            resolved = unquote_to_bytes(encoded)
        if cache is not None:
            cache[src] = resolved
        return resolved

    storage = LocalStorageService()
    normalized = src.replace("\\", "/")
    if "/storage/" in normalized:
        storage_key = normalized.split("/storage/", 1)[1]
    else:
        storage_key = normalized.lstrip("/")

    image_path = storage.absolute_path(storage_key)
    if not image_path.exists():
        raise FileNotFoundError(storage_key)
    resolved = image_path.read_bytes()
    if cache is not None:
        cache[src] = resolved
    return resolved


def _fit_image_rect(image_width: int, image_height: int) -> tuple[int, int, int, int]:
    frame_x, frame_y, frame_w, frame_h = CONTENT_IMAGE_RECT
    if image_width <= 0 or image_height <= 0:
        return CONTENT_IMAGE_RECT

    fitted_width = image_width
    fitted_height = image_height

    if image_width > frame_w or image_height > frame_h:
        scale = min(frame_w / image_width, frame_h / image_height)
        fitted_width = round(image_width * scale)
        fitted_height = round(image_height * scale)

    offset_x = round(frame_x + (frame_w - fitted_width) / 2)
    offset_y = round(frame_y + (frame_h - fitted_height) / 2)
    return (offset_x, offset_y, fitted_width, fitted_height)


def _fit_image_rect_from_src(src: str, cache: dict[str, bytes] | None = None) -> tuple[int, int, int, int]:
    image_bytes = _resolve_image_bytes(src, cache)
    pix = fitz.Pixmap(image_bytes)
    return _fit_image_rect(pix.width, pix.height)


def _build_research_note_page_template_svg() -> str:
    svg = """
    <svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123">
      <rect x="20" y="25" width="754" height="1073" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5" />
      <line x1="20" y1="55" x2="774" y2="55" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="20" y1="955" x2="774" y2="955" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="20" y1="1026" x2="774" y2="1026" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="250" y1="955" x2="250" y2="1098" stroke="#94a3b8" stroke-width="1.2" />
      <line x1="510" y1="955" x2="510" y2="1098" stroke="#94a3b8" stroke-width="1.2" />
      <text x="32" y="44" font-size="12" fill="#334155" font-family="Arial">Title :</text>
      <text x="32" y="971" font-size="11" fill="#334155" font-family="Arial">Recorded By</text>
      <text x="270" y="971" font-size="11" fill="#334155" font-family="Arial">Signature</text>
      <text x="528" y="971" font-size="11" fill="#334155" font-family="Arial">Date</text>
      <text x="32" y="1042" font-size="11" fill="#334155" font-family="Arial">Witnessed By</text>
      <text x="270" y="1042" font-size="11" fill="#334155" font-family="Arial">Signature</text>
      <text x="528" y="1042" font-size="11" fill="#334155" font-family="Arial">Date</text>
    </svg>
    """
    return f"data:image/svg+xml;charset=UTF-8,{svg.strip()}"


def _draw_research_note_template(page: fitz.Page, page_number: int | None = None) -> None:
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(20, 25, 774, 1098))
    shape.draw_line(fitz.Point(20, 55), fitz.Point(774, 55))
    shape.draw_line(fitz.Point(20, 955), fitz.Point(774, 955))
    shape.draw_line(fitz.Point(20, 1026), fitz.Point(774, 1026))
    shape.draw_line(fitz.Point(250, 955), fitz.Point(250, 1098))
    shape.draw_line(fitz.Point(510, 955), fitz.Point(510, 1098))
    shape.finish(color=(0.58, 0.64, 0.72), width=1)
    shape.commit()

    labels = [
        ("Title :", fitz.Point(32, 44), 12),
        ("Recorded By", fitz.Point(32, 971), 11),
        ("Signature", fitz.Point(270, 971), 11),
        ("Date", fitz.Point(528, 971), 11),
        ("Witnessed By", fitz.Point(32, 1042), 11),
        ("Signature", fitz.Point(270, 1042), 11),
        ("Date", fitz.Point(528, 1042), 11),
    ]
    for text, point, size in labels:
        page.insert_text(point, text, fontsize=size, fontname="helv", color=(0.2, 0.25, 0.31))
    if page_number is not None:
        page.insert_text(
            fitz.Point(388, 1116),
            f"- {page_number} -",
            fontsize=10,
            fontname="helv",
            color=(0.39, 0.45, 0.55),
        )


def _make_text_block(
    block_id: str,
    x: int,
    y: int,
    w: int,
    h: int,
    content: str,
    *,
    font_size: int,
    align: str,
) -> TextBlockSchema:
    return TextBlockSchema(
        id=block_id,
        type="text",
        x=x,
        y=y,
        w=w,
        h=h,
        locked=True,
        content=content,
        style=TextStyleSchema(fontSize=font_size, textAlign=align, fontWeight="normal"),
    )


def _get_note_or_404(db: Session, note_id: str) -> ResearchNoteORM:
    note = db.get(ResearchNoteORM, note_id)
    if note is None or note.is_deleted:
        raise HTTPException(status_code=404, detail="Research note not found")
    return note


def _get_latest_note_document(db: Session, note_id: str) -> ResearchNoteDocumentORM | None:
    stmt = (
        select(ResearchNoteDocumentORM)
        .where(ResearchNoteDocumentORM.note_id == note_id)
        .order_by(ResearchNoteDocumentORM.updated_at.desc(), ResearchNoteDocumentORM.created_at.desc())
    )
    return db.scalars(stmt).first()


def _get_project_or_404(db: Session, project_id: str) -> ProjectORM:
    project = db.get(ProjectORM, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


def _get_company_name(db: Session, company_id: int | None) -> str:
    if not company_id:
        return "LABNOTE"
    company = db.get(CompanyORM, company_id)
    return company.name if company else "LABNOTE"


def _get_member_display_name(db: Session, company_member_id: int | None) -> str:
    if not company_member_id:
        return ""
    member = db.get(CompanyMemberORM, company_member_id)
    if member is None:
        return ""
    user = db.get(UserAccountORM, member.user_id)
    return user.display_name if user else ""


def _get_project_cover(db: Session, project_id: str) -> ProjectNoteCoverORM | None:
    return db.scalar(select(ProjectNoteCoverORM).where(ProjectNoteCoverORM.project_id == project_id))


def _get_note_source_page(db: Session, note_id: str, preferred_page_id: int | None) -> ResearchNotePageORM | None:
    if preferred_page_id is not None:
        page = db.get(ResearchNotePageORM, preferred_page_id)
        if page is not None and not page.is_deleted:
            return page

    stmt = (
        select(ResearchNotePageORM)
        .join(ResearchNoteFileORM, ResearchNoteFileORM.id == ResearchNotePageORM.file_id)
        .where(
            ResearchNoteFileORM.note_id == note_id,
            ResearchNoteFileORM.is_deleted.is_(False),
            ResearchNotePageORM.is_deleted.is_(False),
        )
        .order_by(ResearchNotePageORM.sort_order.asc(), ResearchNotePageORM.page_no.asc())
    )
    return db.scalars(stmt).first()


def _list_note_source_pages(db: Session, note_id: str) -> list[ResearchNotePageORM]:
    stmt = (
        select(ResearchNotePageORM)
        .join(ResearchNoteFileORM, ResearchNoteFileORM.id == ResearchNotePageORM.file_id)
        .where(
            ResearchNoteFileORM.note_id == note_id,
            ResearchNoteFileORM.is_deleted.is_(False),
            ResearchNotePageORM.is_deleted.is_(False),
        )
        .order_by(
            ResearchNoteFileORM.created_at.asc(),
            ResearchNoteFileORM.id.asc(),
            ResearchNotePageORM.sort_order.asc(),
            ResearchNotePageORM.page_no.asc(),
        )
    )
    return list(db.scalars(stmt).all())


def _get_company_member(db: Session, company_member_id: int | None) -> CompanyMemberORM | None:
    if company_member_id is None:
        return None
    return db.get(CompanyMemberORM, company_member_id)


def _get_user(db: Session, user_id: int | None) -> UserAccountORM | None:
    if user_id is None:
        return None
    return db.get(UserAccountORM, user_id)


def _build_note_template_context(db: Session, note: ResearchNoteORM) -> dict[str, str | None]:
    project = db.get(ProjectORM, note.project_id)
    author_member = _get_company_member(db, note.owner_member_id)
    reviewer_member = _get_company_member(db, note.reviewer_member_id or (project.owner_member_id if project else None))
    author_user = _get_user(db, author_member.user_id if author_member else None)
    reviewer_user = _get_user(db, reviewer_member.user_id if reviewer_member else None)

    return {
        "author_name": author_user.display_name if author_user else "",
        "reviewer_name": reviewer_user.display_name if reviewer_user else "",
        "written_date": note.written_date.isoformat() if note.written_date else note.updated_at.date().isoformat(),
        "reviewed_date": note.reviewed_date.isoformat() if note.reviewed_date else note.updated_at.date().isoformat(),
        "author_signature_url": author_user.signature_data_url if author_user and author_user.signature_data_url else None,
        "reviewer_signature_url": reviewer_user.signature_data_url if reviewer_user and reviewer_user.signature_data_url else None,
    }


def _build_note_template_blocks(db: Session, note: ResearchNoteORM) -> list[TextBlockSchema | ImageBlockSchema]:
    context = _build_note_template_context(db, note)
    blocks: list[TextBlockSchema | ImageBlockSchema] = [
        _make_text_block("note-title", 82, 26, 640, 20, note.title, font_size=13, align="left"),
        _make_text_block("continued-page", 652, 946, 92, 14, "", font_size=11, align="left"),
        _make_text_block("recorded-by", 34, 983, 200, 38, str(context["author_name"] or ""), font_size=16, align="center"),
        _make_text_block("recorded-date", 528, 983, 140, 38, str(context["written_date"] or ""), font_size=16, align="center"),
        _make_text_block("witnessed-by", 34, 1054, 200, 38, str(context["reviewer_name"] or ""), font_size=16, align="center"),
        _make_text_block("witnessed-date", 528, 1054, 140, 38, str(context["reviewed_date"] or ""), font_size=16, align="center"),
    ]

    if context["author_signature_url"]:
        blocks.append(
            ImageBlockSchema(
                id="author-signature",
                type="image",
                x=258,
                y=975,
                w=194,
                h=58,
                locked=True,
                src=str(context["author_signature_url"]),
            )
        )

    if context["reviewer_signature_url"]:
        blocks.append(
            ImageBlockSchema(
                id="reviewer-signature",
                type="image",
                x=258,
                y=1046,
                w=194,
                h=52,
                locked=True,
                src=str(context["reviewer_signature_url"]),
            )
        )

    return blocks


def _build_default_note_document(db: Session, note: ResearchNoteORM, source_page: ResearchNotePageORM | None) -> DocumentSchemaPayload:
    blocks: list[TextBlockSchema | ImageBlockSchema] = _build_note_template_blocks(db, note)
    if source_page is not None:
        blocks.append(
            ImageBlockSchema(
                id="content-image",
                type="image",
                x=CONTENT_IMAGE_RECT[0],
                y=CONTENT_IMAGE_RECT[1],
                w=CONTENT_IMAGE_RECT[2],
                h=CONTENT_IMAGE_RECT[3],
                locked=False,
                src=f"/storage/{source_page.image_storage_key}",
            )
        )

    return DocumentSchemaPayload.model_validate(
        {
            "schemaVersion": 1,
            "id": f"draft-{note.id}",
            "title": f"{note.title} Layout",
            "page": {
                "width": PAGE_WIDTH,
                "height": PAGE_HEIGHT,
                "background": "#ffffff",
                "backgroundImage": _build_research_note_page_template_svg(),
            },
            "meta": {
                "noteId": note.id,
                "sourceFileId": source_page.file_id if source_page else None,
                "sourcePageId": source_page.id if source_page else None,
            },
            "blocks": [block.model_dump(by_alias=True) for block in blocks],
        }
    )


def _normalize_document_for_export(
    db: Session,
    note: ResearchNoteORM,
    document: DocumentSchemaPayload | None,
) -> DocumentSchemaPayload:
    image_cache: dict[str, bytes] = {}
    source_page = _get_note_source_page(db, note.id, document.meta.source_page_id if document else None)
    template_blocks = _build_note_template_blocks(db, note)
    template_by_id = {block.id: block for block in template_blocks}

    if document is None:
        return _build_default_note_document(db, note, source_page)

    kept_blocks: list[TextBlockSchema | ImageBlockSchema] = []
    has_content_image = False

    for block in document.blocks:
        if block.type == "image":
            if block.id == "content-image":
                has_content_image = True
                src = block.src
                if not src and source_page is not None:
                    src = f"/storage/{source_page.image_storage_key}"
                fitted_x, fitted_y, fitted_w, fitted_h = (
                    _fit_image_rect_from_src(src, image_cache) if src else CONTENT_IMAGE_RECT
                )
                kept_blocks.append(
                    ImageBlockSchema(
                        id="content-image",
                        type="image",
                        x=fitted_x,
                        y=fitted_y,
                        w=fitted_w,
                        h=fitted_h,
                        locked=False,
                        src=src,
                    )
                )
                continue

            if block.id in {"author-signature", "reviewer-signature"}:
                template_block = template_by_id.get(block.id)
                if isinstance(template_block, ImageBlockSchema):
                    kept_blocks.append(template_block)
                continue

            kept_blocks.append(block)
            continue

        if block.id in template_by_id:
            template_block = template_by_id[block.id]
            if isinstance(template_block, TextBlockSchema):
                kept_blocks.append(template_block)

    existing_ids = {block.id for block in kept_blocks}
    for template_block in template_blocks:
        if template_block.id not in existing_ids:
            kept_blocks.append(template_block)

    if not has_content_image and source_page is not None:
        src = f"/storage/{source_page.image_storage_key}"
        fitted_x, fitted_y, fitted_w, fitted_h = _fit_image_rect_from_src(src, image_cache)
        kept_blocks.append(
            ImageBlockSchema(
                id="content-image",
                type="image",
                x=fitted_x,
                y=fitted_y,
                w=fitted_w,
                h=fitted_h,
                locked=False,
                src=src,
            )
        )

    return DocumentSchemaPayload.model_validate(
        {
            "schemaVersion": document.schema_version,
            "id": document.id,
            "title": document.title,
            "page": {
                "width": document.page.width,
                "height": document.page.height,
                "background": document.page.background,
                "backgroundImage": _build_research_note_page_template_svg(),
            },
            "meta": {
                "noteId": note.id,
                "sourceFileId": document.meta.source_file_id or (source_page.file_id if source_page else None),
                "sourcePageId": document.meta.source_page_id or (source_page.id if source_page else None),
            },
            "blocks": [block.model_dump(by_alias=True) for block in kept_blocks],
        }
    )


def _get_export_document(db: Session, *, note_id: str | None = None, document_id: str | None = None) -> tuple[ResearchNoteORM, DocumentSchemaPayload]:
    if document_id:
        stored_document = get_note_document(db, document_id)
        note = _get_note_or_404(db, stored_document.note_id)
        parsed_document = DocumentSchemaPayload.model_validate_json(stored_document.document_payload)
        return note, _normalize_document_for_export(db, note, parsed_document)

    if note_id:
        note = _get_note_or_404(db, note_id)
        latest_document = _get_latest_note_document(db, note_id)
        parsed_document = (
            DocumentSchemaPayload.model_validate_json(latest_document.document_payload) if latest_document else None
        )
        return note, _normalize_document_for_export(db, note, parsed_document)

    raise HTTPException(status_code=400, detail="documentId or noteId is required")


def _draw_text_in_rect(
    page: fitz.Page,
    text: str,
    rect: fitz.Rect,
    *,
    font_name: str,
    font_size: int,
    align: str,
) -> None:
    if not text:
        return

    if font_name == "notekr":
        text_width = max(font_size, len(text) * font_size * 0.55)
    else:
        try:
            text_width = fitz.get_text_length(text, fontname=font_name, fontsize=font_size)
        except Exception:
            text_width = max(font_size, len(text) * font_size * 0.55)

    if align == "center":
        x = rect.x0 + max(0, (rect.width - text_width) / 2)
    elif align == "right":
        x = max(rect.x0, rect.x1 - text_width)
    else:
        x = rect.x0

    y = rect.y0 + (rect.height / 2) + (font_size * 0.35)
    page.insert_text(
        fitz.Point(x, y),
        text,
        fontsize=font_size,
        fontname=font_name,
        color=(0, 0, 0),
        overlay=True,
    )


def _render_cover_page(
    pdf: fitz.Document,
    *,
    project: ProjectORM,
    company_name: str,
    principal_investigator: str,
    cover: ProjectNoteCoverORM | None,
) -> None:
    page = pdf.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    if cover and cover.cover_image_data_url:
        try:
            cover_bytes = _resolve_image_bytes(cover.cover_image_data_url)
            page.insert_image(
                fitz.Rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT),
                stream=cover_bytes,
                keep_proportion=False,
                overlay=False,
            )
            return
        except Exception:
            pass

    text_font_name = "helv"
    korean_font_path = Path("C:/Windows/Fonts/malgun.ttf")
    if korean_font_path.exists():
        page.insert_font(fontname="notekr", fontfile=str(korean_font_path))
        text_font_name = "notekr"

    payload = _safe_json_loads(cover.template_payload if cover else None)
    override_organization = _payload_bool(payload, "overrideOrganization", default=False)
    override_project_title = _payload_bool(payload, "overrideProjectTitle", default=False)
    override_principal_investigator = _payload_bool(payload, "overridePrincipalInvestigator", default=False)
    show_organization = _payload_bool(payload, "showOrganization", "showBusinessName", "show_org", default=True)
    show_project_title = _payload_bool(payload, "showProjectTitle", "showTitle", "show_title", default=True)
    show_code = _payload_bool(payload, "showCode", "show_code", default=True)
    show_principal_investigator = _payload_bool(payload, "showPrincipalInvestigator", "showManager", "show_manager", default=True)
    show_project_period = _payload_bool(payload, "showProjectPeriod", "showPeriod", "show_period", default=True)

    default_title = (project.name or "Research Note").strip()
    default_organization = (company_name or "LABNOTE").strip()
    default_investigator = (principal_investigator or "").strip()
    default_project_code = (project.code or "").strip()
    default_period = f"{project.start_date or 'TBD'} - {project.end_date or 'TBD'}"

    title = _payload_str(payload, "projectTitle", "title") if override_project_title else default_title
    organization = _payload_str(payload, "organization", "businessName") if override_organization else default_organization
    investigator = _payload_str(payload, "principalInvestigator", "managerName") if override_principal_investigator else default_investigator
    project_code = default_project_code
    period = default_period
    footer_note = "Research records are maintained according to the registered project information."

    frame = COVER_LAYOUT["frame"]
    top_label = COVER_LAYOUT["top_label"]
    title_rect = COVER_LAYOUT["title"]
    table = COVER_LAYOUT["table"]
    footer = COVER_LAYOUT["footer"]

    page.draw_rect(
        fitz.Rect(
            frame["x"],
            frame["y"],
            frame["x"] + frame["width"],
            frame["y"] + frame["height"],
        ),
        color=(0.85, 0.89, 0.94),
        width=1,
    )

    page.insert_textbox(
        fitz.Rect(0, top_label["top"], PAGE_WIDTH, top_label["top"] + top_label["height"]),
        "연구노트",
        fontname=text_font_name,
        fontsize=top_label["font_size"],
        align=fitz.TEXT_ALIGN_CENTER,
        color=(0.39, 0.45, 0.55),
    )
    page.insert_textbox(
        fitz.Rect(
            title_rect["x"],
            title_rect["y"],
            title_rect["x"] + title_rect["width"],
            title_rect["y"] + title_rect["height"],
        ),
        title if show_project_title else "",
        fontname=text_font_name,
        fontsize=title_rect["font_size"],
        align=fitz.TEXT_ALIGN_CENTER,
        color=(0.06, 0.09, 0.16),
    )

    table_x = table["x"]
    table_y = table["y"]
    label_w = table["label_width"]
    value_w = table["value_width"]
    row_h = table["row_height"]
    font_size = table["font_size"]
    rows = [
        ("과제번호", project_code if show_code else ""),
        ("연구책임자", investigator if show_principal_investigator else ""),
        ("연구기관", organization if show_organization else ""),
        ("기간", period if show_project_period else ""),
    ]
    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(table_x, table_y, table_x + label_w + value_w, table_y + row_h * len(rows)))
    for idx in range(1, len(rows)):
        y = table_y + row_h * idx
        shape.draw_line(fitz.Point(table_x, y), fitz.Point(table_x + label_w + value_w, y))
    shape.draw_line(fitz.Point(table_x + label_w, table_y), fitz.Point(table_x + label_w, table_y + row_h * len(rows)))
    shape.finish(color=(0.07, 0.1, 0.15), width=0.9)
    shape.commit()

    for idx, (label, value) in enumerate(rows):
        y0 = table_y + row_h * idx
        y1 = y0 + row_h
        page.insert_textbox(
            fitz.Rect(table_x + 10, y0 + 11, table_x + label_w - 10, y1 - 8),
            label,
            fontname=text_font_name,
            fontsize=font_size,
            align=fitz.TEXT_ALIGN_CENTER,
            color=(0.07, 0.1, 0.15),
        )
        page.insert_textbox(
            fitz.Rect(table_x + label_w + 12, y0 + 11, table_x + label_w + value_w - 12, y1 - 8),
            value,
            fontname=text_font_name,
            fontsize=font_size,
            align=fitz.TEXT_ALIGN_LEFT,
            color=(0.07, 0.1, 0.15),
        )

    page.insert_textbox(
        fitz.Rect(footer["x"], footer["y"], footer["x"] + footer["width"], footer["y"] + footer["height"]),
        footer_note,
        fontname=text_font_name,
        fontsize=footer["font_size"],
        align=fitz.TEXT_ALIGN_CENTER,
        color=(0.39, 0.45, 0.55),
    )


def _render_toc_page(
    pdf: fitz.Document,
    *,
    entries: list[dict[str, str | int]],
    show_title: bool,
) -> None:
    page = pdf.new_page(width=PAGE_WIDTH, height=PAGE_HEIGHT)
    text_font_name = "helv"
    korean_font_path = Path("C:/Windows/Fonts/malgun.ttf")
    if korean_font_path.exists():
        page.insert_font(fontname="notekr", fontfile=str(korean_font_path))
        text_font_name = "notekr"

    page.draw_rect(fitz.Rect(34, 34, PAGE_WIDTH - 34, PAGE_HEIGHT - 34), color=(0.85, 0.89, 0.94), width=1)

    top_y = 72
    if show_title:
        page.insert_textbox(
            fitz.Rect(0, 72, PAGE_WIDTH, 110),
            "목차",
            fontname=text_font_name,
            fontsize=18,
            align=fitz.TEXT_ALIGN_CENTER,
            color=(0.06, 0.09, 0.16),
        )
        top_y = 150

    table_x = 76
    table_y = top_y
    table_w = PAGE_WIDTH - 152
    row_h = 38
    index_w = 58
    title_w = 430
    date_w = 110
    page_w = table_w - index_w - title_w - date_w

    shape = page.new_shape()
    shape.draw_rect(fitz.Rect(table_x, table_y, table_x + table_w, table_y + row_h * 21))
    for idx in range(1, 21):
        y = table_y + row_h * idx
        shape.draw_line(fitz.Point(table_x, y), fitz.Point(table_x + table_w, y))
    for x in [table_x + index_w, table_x + index_w + title_w, table_x + index_w + title_w + date_w]:
        shape.draw_line(fitz.Point(x, table_y), fitz.Point(x, table_y + row_h * 21))
    shape.finish(color=(0.58, 0.64, 0.72), width=1)
    shape.commit()

    headers = [
        (fitz.Rect(table_x, table_y, table_x + index_w, table_y + row_h), "Index"),
        (fitz.Rect(table_x + index_w, table_y, table_x + index_w + title_w, table_y + row_h), "Title"),
        (fitz.Rect(table_x + index_w + title_w, table_y, table_x + index_w + title_w + date_w, table_y + row_h), "Created"),
        (fitz.Rect(table_x + index_w + title_w + date_w, table_y, table_x + table_w, table_y + row_h), "Page"),
    ]
    for rect, label in headers:
        page.insert_textbox(
            rect + (0, 9, 0, -8),
            label,
            fontname=text_font_name,
            fontsize=10,
            align=fitz.TEXT_ALIGN_CENTER,
            color=(0.2, 0.25, 0.32),
        )

    for idx, entry in enumerate(entries, start=1):
        y0 = table_y + row_h * idx
        y1 = y0 + row_h
        row_cells = [
            (fitz.Rect(table_x, y0, table_x + index_w, y1), str(entry["index"]), fitz.TEXT_ALIGN_CENTER),
            (fitz.Rect(table_x + index_w + 8, y0, table_x + index_w + title_w - 8, y1), str(entry["title"]), fitz.TEXT_ALIGN_LEFT),
            (
                fitz.Rect(table_x + index_w + title_w + 6, y0, table_x + index_w + title_w + date_w - 6, y1),
                str(entry["created_at"]),
                fitz.TEXT_ALIGN_CENTER,
            ),
            (
                fitz.Rect(table_x + index_w + title_w + date_w, y0, table_x + table_w, y1),
                str(entry["page"]),
                fitz.TEXT_ALIGN_CENTER,
            ),
        ]
        for rect, value, align in row_cells:
            page.insert_textbox(
                rect + (0, 9, 0, -8),
                value,
                fontname=text_font_name,
                fontsize=10,
                align=align,
                color=(0.06, 0.09, 0.16),
            )


def _render_document_page(
    pdf: fitz.Document,
    document: DocumentSchemaPayload,
    image_cache: dict[str, bytes] | None = None,
    *,
    page_number: int | None = None,
) -> None:
    page = pdf.new_page(width=document.page.width, height=document.page.height)
    text_font_name = "helv"
    korean_font_path = Path("C:/Windows/Fonts/malgun.ttf")
    if korean_font_path.exists():
        page.insert_font(fontname="notekr", fontfile=str(korean_font_path))
        text_font_name = "notekr"

    if document.page.background_image:
        if document.page.background_image.startswith("data:image/svg+xml"):
            _draw_research_note_template(page, page_number)
        else:
            try:
                background_bytes = _resolve_image_bytes(document.page.background_image, image_cache)
                page.insert_image(
                    fitz.Rect(0, 0, document.page.width, document.page.height),
                    stream=background_bytes,
                    keep_proportion=False,
                    overlay=False,
                )
            except FileNotFoundError:
                pass

    fixed_text_blocks = {block.id: block for block in document.blocks if block.type == "text" and block.id in FIXED_TEXT_IDS}

    for block_id in ["note-title", "continued-page", "recorded-by", "recorded-date", "witnessed-by", "witnessed-date"]:
        block = fixed_text_blocks.get(block_id)
        if not block:
            continue
        rect = fitz.Rect(block.x, block.y, block.x + block.w, block.y + block.h)
        style = block.style or TextStyleSchema()
        _draw_text_in_rect(
            page,
            block.content,
            rect,
            font_name=text_font_name,
            font_size=style.font_size,
            align=style.text_align,
        )

    for block in document.blocks:
        rect = fitz.Rect(block.x, block.y, block.x + block.w, block.y + block.h)
        if block.type == "image":
            try:
                image_bytes = _resolve_image_bytes(block.src, image_cache)
                if block.id in {"author-signature", "reviewer-signature"}:
                    pix = fitz.Pixmap(image_bytes)
                    aspect = pix.width / max(1, pix.height)
                    target_w = rect.width
                    target_h = target_w / aspect
                    if target_h > rect.height:
                        target_h = rect.height
                        target_w = target_h * aspect
                    fitted = fitz.Rect(
                        rect.x0 + (rect.width - target_w) / 2,
                        rect.y0 + (rect.height - target_h) / 2,
                        rect.x0 + (rect.width - target_w) / 2 + target_w,
                        rect.y0 + (rect.height - target_h) / 2 + target_h,
                    )
                    page.insert_image(fitted, stream=image_bytes, keep_proportion=True, overlay=True)
                else:
                    page.insert_image(rect, stream=image_bytes, keep_proportion=False, overlay=True)
            except FileNotFoundError:
                continue
            continue

        if block.id in FIXED_TEXT_IDS:
            continue

        style = block.style or TextStyleSchema()
        inserted = page.insert_textbox(
            rect,
            block.content,
            fontsize=style.font_size,
            fontname=text_font_name,
            align={"left": 0, "center": 1, "right": 2}.get(style.text_align, 0),
            color=(0, 0, 0),
            overlay=True,
        )
        if inserted < 0:
            _draw_text_in_rect(
                page,
                block.content,
                rect,
                font_name=text_font_name,
                font_size=style.font_size,
                align=style.text_align,
            )


def _build_pdf_bytes(document: DocumentSchemaPayload) -> bytes:
    pdf = fitz.open()
    _render_document_page(pdf, document, {}, page_number=1)
    return pdf.tobytes(deflate=True, garbage=3)


def _build_document_for_page(
    document: DocumentSchemaPayload,
    page: ResearchNotePageORM,
    *,
    page_index: int,
    total_pages: int,
) -> DocumentSchemaPayload:
    next_blocks: list[TextBlockSchema | ImageBlockSchema] = []
    page_src = f"/storage/{page.image_storage_key}"
    fitted_x, fitted_y, fitted_w, fitted_h = _fit_image_rect_from_src(page_src, {})

    for block in document.blocks:
        if block.id == "content-image" and block.type == "image":
            next_blocks.append(
                ImageBlockSchema(
                    id="content-image",
                    type="image",
                    x=fitted_x,
                    y=fitted_y,
                    w=fitted_w,
                    h=fitted_h,
                    locked=False,
                    src=page_src,
                )
            )
            continue

        if block.id == "continued-page" and block.type == "text":
            next_blocks.append(
                TextBlockSchema(
                    id="continued-page",
                    type="text",
                    x=block.x,
                    y=block.y,
                    w=block.w,
                    h=block.h,
                    locked=block.locked,
                    content=f"{page_index + 1}/{total_pages}" if total_pages > 1 else "",
                    style=block.style,
                )
            )
            continue

        next_blocks.append(block)

    if not any(block.id == "content-image" for block in next_blocks):
        next_blocks.append(
            ImageBlockSchema(
                id="content-image",
                type="image",
                x=fitted_x,
                y=fitted_y,
                w=fitted_w,
                h=fitted_h,
                locked=False,
                src=page_src,
            )
        )

    return DocumentSchemaPayload.model_validate(
        {
            "schemaVersion": document.schema_version,
            "id": f"{document.id}-page-{page.id}",
            "title": document.title,
            "page": document.page.model_dump(by_alias=True),
            "meta": {
                "noteId": document.meta.note_id,
                "sourceFileId": page.file_id,
                "sourcePageId": page.id,
            },
            "blocks": [block.model_dump(by_alias=True) for block in next_blocks],
        }
    )


def _to_response(document) -> ResearchNoteDocumentResponse:
    return ResearchNoteDocumentResponse(
        id=document.id,
        note_id=document.note_id,
        title=document.title,
        schema_version=document.schema_version,
        source_file_id=document.source_file_id,
        source_page_id=document.source_page_id,
        document=DocumentSchemaPayload.model_validate_json(document.document_payload),
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


@router.get("/notes/{note_id}", response_model=list[ResearchNoteDocumentSummaryResponse])
def list_note_documents_endpoint(note_id: str, db: Session = Depends(get_db)):
    try:
        documents = list_note_documents(db, note_id)
    except ResearchNoteDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note not found") from exc
    return [
        ResearchNoteDocumentSummaryResponse(
            id=document.id,
            note_id=document.note_id,
            title=document.title,
            schema_version=document.schema_version,
            source_file_id=document.source_file_id,
            source_page_id=document.source_page_id,
            created_at=document.created_at,
            updated_at=document.updated_at,
        )
        for document in documents
    ]


@router.get("/{document_id}", response_model=ResearchNoteDocumentResponse)
def get_note_document_endpoint(document_id: str, db: Session = Depends(get_db)):
    try:
        return _to_response(get_note_document(db, document_id))
    except ResearchNoteDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note document not found") from exc


@router.post("", response_model=ResearchNoteDocumentResponse, status_code=status.HTTP_201_CREATED)
def create_note_document_endpoint(payload: ResearchNoteDocumentSaveRequest, db: Session = Depends(get_db)):
    try:
        document = save_note_document(
            db,
            document_id=None,
            note_id=payload.note_id,
            title=payload.title,
            source_file_id=payload.source_file_id,
            source_page_id=payload.source_page_id,
            document_payload=payload.document.model_dump(by_alias=True),
        )
        return _to_response(document)
    except ResearchNoteDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note document not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/{document_id}", response_model=ResearchNoteDocumentResponse)
def update_note_document_endpoint(
    document_id: str,
    payload: ResearchNoteDocumentSaveRequest,
    db: Session = Depends(get_db),
):
    try:
        document = save_note_document(
            db,
            document_id=document_id,
            note_id=payload.note_id,
            title=payload.title,
            source_file_id=payload.source_file_id,
            source_page_id=payload.source_page_id,
            document_payload=payload.document.model_dump(by_alias=True),
        )
        return _to_response(document)
    except ResearchNoteDocumentNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Research note document not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/uploads/image", response_model=EditorImageUploadResponse, status_code=status.HTTP_201_CREATED)
async def upload_editor_image_endpoint(
    request: Request,
    note_id: str = Form(...),
    upload: UploadFile = File(...),
):
    try:
        file_bytes = await upload.read()
        filename = upload.filename or "editor-image.png"
        storage_key, stored_name = upload_editor_image(note_id=note_id, filename=filename, file_bytes=file_bytes)
        suffix = Path(storage_key).name if storage_key else stored_name
        return EditorImageUploadResponse(
            url=str(request.base_url).rstrip("/") + f"/storage/{storage_key}",
            storage_key=storage_key,
            filename=suffix,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export-pdf")
def export_note_document_pdf_endpoint(
    payload: ResearchNotePdfExportRequest,
    db: Session = Depends(get_db),
):
    note, document = _get_export_document(db, note_id=payload.note_id, document_id=payload.document_id)
    pdf_bytes = _build_pdf_bytes(document)
    filename = f"{note.title or document.title or 'research-note'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/export-batch-pdf")
def export_selected_note_documents_pdf_endpoint(
    payload: ResearchNoteBatchExportRequest,
    db: Session = Depends(get_db),
):
    merged_pdf = fitz.open()
    image_cache: dict[str, bytes] = {}
    note_export_data: list[tuple[ResearchNoteORM, DocumentSchemaPayload, list[ResearchNotePageORM]]] = []

    if payload.note_ids:
        first_note = _get_note_or_404(db, payload.note_ids[0])
        project = _get_project_or_404(db, first_note.project_id)
        _render_cover_page(
            merged_pdf,
            project=project,
            company_name=_get_company_name(db, project.company_id),
            principal_investigator=_get_member_display_name(db, project.owner_member_id),
            cover=_get_project_cover(db, project.id),
        )

    for note_id in payload.note_ids:
        note, document = _get_export_document(db, note_id=note_id)
        note_pages = _list_note_source_pages(db, note.id)
        note_export_data.append((note, document, note_pages))

    if note_export_data:
        toc_pages = max(1, math.ceil(len(note_export_data) / 20))
        next_note_page_number = 1 + toc_pages + 1
        toc_entries: list[dict[str, str | int]] = []

        for index, (note, _, note_pages) in enumerate(note_export_data, start=1):
            page_count = len(note_pages) if note_pages else 1
            toc_entries.append(
                {
                    "index": index,
                    "title": note.title,
                    "created_at": note.created_at.strftime("%Y-%m-%d"),
                    "page": next_note_page_number,
                }
            )
            next_note_page_number += page_count

        for toc_page_index in range(toc_pages):
            chunk = toc_entries[toc_page_index * 20 : (toc_page_index + 1) * 20]
            _render_toc_page(merged_pdf, entries=chunk, show_title=toc_page_index == 0)

    for note, document, note_pages in note_export_data:
        if not note_pages:
            _render_document_page(merged_pdf, document, image_cache, page_number=merged_pdf.page_count + 1)
            continue

        for page_index, note_page in enumerate(note_pages):
            page_document = _build_document_for_page(
                document,
                note_page,
                page_index=page_index,
                total_pages=len(note_pages),
            )
            _render_document_page(merged_pdf, page_document, image_cache, page_number=merged_pdf.page_count + 1)

    if merged_pdf.page_count == 0:
        raise HTTPException(status_code=404, detail="No research notes available for PDF export")

    pdf_bytes = merged_pdf.tobytes(deflate=True, garbage=3)
    merged_pdf.close()
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="research-notes.pdf"'},
    )
