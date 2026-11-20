"""Sequential, persisted batch jobs. Each successful note is committed atomically."""

import json
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import timezone

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.accounts.use_cases import get_user_by_id
from app.domain.note_formats.use_cases import get_company_note_format
from app.domain.research_notes.note_generation import (
    NoteGenerationFailedError,
    NoteGenerationInput,
    NoteGenerationUnavailableError,
    _downscale_image,
    _load_note_pages,
)
from app.domain.research_notes.use_cases import (
    _default_author_member_id,
    _get_project,
    _require_project_access,
    get_research_note,
)
from app.infrastructure.db.models import (
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
    ResearchNoteORM,
)
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.llm.connections import resolve_settings
from app.infrastructure.llm.models import NoteGenerationItemORM, NoteGenerationJobORM
from app.infrastructure.llm.openai_note_generator import build_note_generator
from app.infrastructure.storage.local_storage import LocalStorageService
from app.presentation.schemas.llm import BatchInput

logger = logging.getLogger(__name__)
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="labnote-generation")
ACTIVE = {"queued", "running"}


def prepare_input(db, user, project, entry, payload, *, load_images=True):
    memo = [f"Research date: {entry.written_date.isoformat()}", entry.memo]
    images = []
    if payload.context.strip():
        memo += [
            "Project background (not evidence of this entry's results):",
            payload.context.strip(),
        ]
    if entry.source_note_id:
        source = get_research_note(db, entry.source_note_id, user)
        if source.project_id != project.id:
            raise ValueError("참고 노트는 같은 프로젝트에 속해야 합니다")
        texts = [source.content or ""]
        for document in db.scalars(
            select(ResearchNoteDocumentORM).where(
                ResearchNoteDocumentORM.note_id == source.id
            )
        ):
            blocks = json.loads(document.document_payload).get("blocks", [])
            frame_ids = {
                "note-title",
                "continued-page",
                "recorded-by",
                "recorded-date",
                "witnessed-by",
                "witnessed-date",
            }
            texts += [
                b.get("content", "")
                for b in blocks
                if b.get("type") == "text"
                and b.get("id") not in frame_ids
                and not (
                    b.get("id", "").startswith("section-")
                    and b.get("id", "").endswith("-heading")
                )
            ]
        source_text = "\n".join(texts).strip()
        if not entry.memo and not source_text and not entry.page_ids:
            raise ValueError(
                "참고 노트에 본문이 없습니다. 메모를 입력하거나 참고 페이지를 선택하세요"
            )
        if len(source_text) > 40000:
            raise ValueError(
                "참고 노트 본문이 너무 큽니다. 필요한 내용을 작업 메모에 옮겨 입력하세요"
            )
        memo += [
            f"Reference note: {source.id} / {source.title} / {source.written_date}",
            source_text,
        ]
        pages = _load_note_pages(db, source.id, entry.page_ids)
        if load_images:
            for page in pages:
                path = LocalStorageService().absolute_path(page.image_storage_key)
                if not path.is_file():
                    raise ValueError("참고 페이지 파일을 찾을 수 없습니다")
                images.append(
                    _downscale_image(
                        path.read_bytes(), get_settings().llm_image_max_side
                    )
                )
    note_format = get_company_note_format(db, project.company_id)
    return NoteGenerationInput(
        note_title=entry.title,
        project_name=project.name,
        memo="\n\n".join(memo),
        language=payload.language,
        images=images,
        sections=[(s.title, s.guide) for s in note_format.sections],
    )


def create_job(db: Session, user, payload: BatchInput):
    project = _get_project(db, payload.project_id)
    _require_project_access(db, project, user)
    owner = _default_author_member_id(
        db,
        project=project,
        current_user=user,
        requested_owner_member_id=payload.owner_member_id,
    )
    existing = db.scalar(
        select(NoteGenerationJobORM).where(
            NoteGenerationJobORM.created_by == user.id,
            NoteGenerationJobORM.request_id == payload.request_id,
        )
    )
    if existing:
        if existing.payload != payload.model_dump_json():
            raise ValueError("같은 요청 ID에 다른 입력을 사용할 수 없습니다")
        return existing, False
    if len(payload.entries) > get_settings().llm_batch_max_items:
        raise ValueError(
            f"한 번에 {get_settings().llm_batch_max_items}개까지 생성할 수 있습니다"
        )
    if (
        db.scalar(
            select(func.count())
            .select_from(NoteGenerationJobORM)
            .where(NoteGenerationJobORM.status.in_(ACTIVE))
        )
        >= 20
    ):
        raise ValueError(
            "현재 대기 중인 생성 작업이 많습니다. 기존 작업이 끝난 뒤 다시 시작하세요"
        )
    if resolve_settings(db, project.company_id) is None:
        raise NoteGenerationUnavailableError(
            "플랫폼 연동에서 LLM 연결을 먼저 설정하세요"
        )
    for entry in payload.entries:
        prepare_input(db, user, project, entry, payload, load_images=False)
    if owner is None:
        raise ValueError("작성자를 지정하세요")
    job = NoteGenerationJobORM(
        request_id=payload.request_id,
        project_id=project.id,
        created_by=user.id,
        payload=payload.model_dump_json(),
    )
    db.add(job)
    db.flush()
    db.add_all(
        [
            NoteGenerationItemORM(job_id=job.id, position=i, title=entry.title)
            for i, entry in enumerate(payload.entries)
        ]
    )
    db.commit()
    return job, True


def require_job(db, user, job_id, *, manage=False):
    job = db.get(NoteGenerationJobORM, job_id)
    if job is None:
        raise LookupError("생성 작업을 찾을 수 없습니다")
    project = _get_project(db, job.project_id)
    _require_project_access(db, project, user)
    if manage and job.created_by != user.id and not user.is_system_admin:
        raise PermissionError("작업을 요청한 사용자만 취소하거나 재시도할 수 있습니다")
    return job


def job_view(db, job):
    items = db.scalars(
        select(NoteGenerationItemORM)
        .where(NoteGenerationItemORM.job_id == job.id)
        .order_by(NoteGenerationItemORM.position)
    ).all()
    return {
        "id": job.id,
        "project_id": job.project_id,
        "created_by": job.created_by,
        "status": job.status,
        "cancel_requested": job.cancel_requested,
        "created_at": job.created_at
        if job.created_at.tzinfo
        else job.created_at.replace(tzinfo=timezone.utc),
        "total": len(items),
        "succeeded": sum(i.status == "succeeded" for i in items),
        "failed": sum(i.status == "failed" for i in items),
        "items": [
            {
                "id": i.id,
                "title": i.title,
                "status": i.status,
                "note_id": i.note_id,
                "model": i.model,
                "error": i.error,
                "attempts": i.attempts,
            }
            for i in items
        ],
    }


def retry_job(db, job):
    # Atomic state transition prevents two retries from resetting a running worker.
    claimed = db.execute(
        update(NoteGenerationJobORM)
        .where(
            NoteGenerationJobORM.id == job.id,
            NoteGenerationJobORM.status.not_in(ACTIVE),
        )
        .values(status="queued", cancel_requested=False)
    ).rowcount
    if not claimed:
        db.rollback()
        raise ValueError("진행 중인 작업은 재시도할 수 없습니다")
    changed = db.execute(
        update(NoteGenerationItemORM)
        .where(
            NoteGenerationItemORM.job_id == job.id,
            NoteGenerationItemORM.status.in_(["failed", "cancelled"]),
            NoteGenerationItemORM.note_id.is_(None),
        )
        .values(status="queued", error=None)
    ).rowcount
    if not changed:
        db.rollback()
        raise ValueError("재시도할 항목이 없습니다")
    db.commit()


def _save_result(db, user, project, payload, entry, generated, item):
    owner = _default_author_member_id(
        db,
        project=project,
        current_user=user,
        requested_owner_member_id=payload.owner_member_id,
    )
    note = ResearchNoteORM(
        project_id=project.id,
        title=entry.title,
        content=generated.as_text(),
        status="draft",
        owner_member_id=owner,
        written_date=entry.written_date,
        reviewer_member_id=project.owner_member_id,
        last_updated_by=user.id,
    )
    db.add(note)
    db.flush()
    document = ResearchNoteDocumentORM(
        note_id=note.id,
        title=entry.title,
        status="draft",
        schema_version=1,
        document_payload="{}",
    )
    db.add(document)
    db.flush()
    document.document_payload = json.dumps(
        {
            "schemaVersion": 1,
            "id": document.id,
            "title": entry.title,
            "page": {"width": 794, "height": 1123, "background": "#ffffff"},
            "meta": {"noteId": note.id},
            "blocks": [
                {
                    "id": "ai-batch-body",
                    "type": "text",
                    "x": 34,
                    "y": 64,
                    "w": 726,
                    "h": 884,
                    "content": generated.as_text(),
                    "style": {"fontSize": 12},
                }
            ],
        },
        ensure_ascii=False,
    )
    revision = ResearchNoteDocumentRevisionORM(
        document_id=document.id,
        revision_no=1,
        payload_json=document.document_payload,
        created_by=user.id,
        change_summary=f"AI batch {item.job_id}; model={generated.model}; source={entry.source_note_id or 'memo'}",
    )
    db.add(revision)
    db.flush()
    document.current_revision_id = revision.id
    item.note_id, item.model, item.status, item.error = (
        note.id,
        generated.model,
        "succeeded",
        None,
    )
    db.commit()


def run_job(job_id: str):
    with SessionLocal() as db:
        claimed = db.execute(
            update(NoteGenerationJobORM)
            .where(
                NoteGenerationJobORM.id == job_id,
                NoteGenerationJobORM.status == "queued",
            )
            .values(status="running")
        ).rowcount
        db.commit()
        if not claimed:
            return
        generator = None
        try:
            job = db.get(NoteGenerationJobORM, job_id)
            payload = BatchInput.model_validate_json(job.payload)
            user = get_user_by_id(db, job.created_by)
            project = _get_project(db, job.project_id)
            settings = resolve_settings(db, project.company_id)
            generator = build_note_generator(settings) if settings else None
            if generator is None:
                raise NoteGenerationUnavailableError("LLM 연결이 비활성화되었습니다")
            ids = list(
                db.scalars(
                    select(NoteGenerationItemORM.id)
                    .where(
                        NoteGenerationItemORM.job_id == job_id,
                        NoteGenerationItemORM.status == "queued",
                    )
                    .order_by(NoteGenerationItemORM.position)
                )
            )
            db.commit()
            for item_id in ids:
                db.expire_all()
                job = db.get(NoteGenerationJobORM, job_id)
                item = db.get(NoteGenerationItemORM, item_id)
                if job.cancel_requested:
                    item.status = "cancelled"
                    db.commit()
                    continue
                item.status, item.attempts = "running", item.attempts + 1
                db.commit()
                try:
                    user = get_user_by_id(db, job.created_by)
                    if not user.is_active or not user.is_approved:
                        raise PermissionError("사용자 계정이 비활성화되었습니다")
                    project = _get_project(db, job.project_id)
                    _require_project_access(db, project, user)
                    entry = payload.entries[item.position]
                    data = prepare_input(db, user, project, entry, payload)
                    db.commit()  # Do not hold a database transaction during the network call.
                    generated = generator.generate(data)
                    db.expire_all()
                    job = db.get(NoteGenerationJobORM, job_id)
                    item = db.get(NoteGenerationItemORM, item_id)
                    if job.cancel_requested:
                        item.status = "cancelled"
                        db.commit()
                        continue
                    user = get_user_by_id(db, job.created_by)
                    project = _get_project(db, job.project_id)
                    if not user.is_active or not user.is_approved:
                        raise PermissionError("사용자 계정이 비활성화되었습니다")
                    _require_project_access(db, project, user)
                    _save_result(db, user, project, payload, entry, generated, item)
                except Exception as exc:
                    db.rollback()
                    item = db.get(NoteGenerationItemORM, item_id)
                    item.status = "failed"
                    item.error = (
                        str(exc)
                        if isinstance(
                            exc,
                            (
                                ValueError,
                                PermissionError,
                                NoteGenerationFailedError,
                                NoteGenerationUnavailableError,
                            ),
                        )
                        else "노트 생성 또는 저장에 실패했습니다"
                    )
                    db.commit()
            job = db.get(NoteGenerationJobORM, job_id)
            states = list(
                db.scalars(
                    select(NoteGenerationItemORM.status).where(
                        NoteGenerationItemORM.job_id == job_id
                    )
                )
            )
            job.status = (
                "cancelled"
                if job.cancel_requested
                else "completed"
                if all(s == "succeeded" for s in states)
                else "partial"
                if "succeeded" in states
                else "failed"
            )
            db.commit()
        except Exception as exc:
            db.rollback()
            message = (
                str(exc)
                if isinstance(
                    exc, (NoteGenerationFailedError, NoteGenerationUnavailableError)
                )
                else "작업을 실행할 수 없습니다. 연결과 프로젝트 권한을 확인하세요."
            )
            db.execute(
                update(NoteGenerationItemORM)
                .where(
                    NoteGenerationItemORM.job_id == job_id,
                    NoteGenerationItemORM.status.in_(ACTIVE),
                )
                .values(status="failed", error=message)
            )
            db.execute(
                update(NoteGenerationJobORM)
                .where(NoteGenerationJobORM.id == job_id)
                .values(status="failed")
            )
            db.commit()
            logger.warning("Generation job %s failed (%s)", job_id, type(exc).__name__)
        finally:
            if generator and hasattr(generator, "close"):
                generator.close()


def dispatch_job(job_id: str):
    _executor.submit(run_job, job_id)


def recover_interrupted_jobs():
    """Single API process: preserve successes; explicitly retry interrupted work after restart."""
    with SessionLocal() as db:
        ids = list(
            db.scalars(
                select(NoteGenerationJobORM.id).where(
                    NoteGenerationJobORM.status.in_(ACTIVE)
                )
            )
        )
        if ids:
            db.execute(
                update(NoteGenerationItemORM)
                .where(
                    NoteGenerationItemORM.job_id.in_(ids),
                    NoteGenerationItemORM.status.in_(ACTIVE),
                )
                .values(
                    status="failed",
                    error="서버가 재시작되어 중단되었습니다. 실패 항목을 재시도하세요.",
                )
            )
            db.execute(
                update(NoteGenerationJobORM)
                .where(NoteGenerationJobORM.id.in_(ids))
                .values(status="interrupted")
            )
            db.commit()
