from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.research_notes.batch_generation import (
    create_job,
    dispatch_job,
    job_view,
    require_job,
    retry_job,
)
from app.domain.research_notes.note_generation import (
    NoteGenerationFailedError,
    NoteGenerationInput,
    NoteGenerationUnavailableError,
)
from app.domain.research_notes.use_cases import (
    ProjectNotFoundError,
    ResearchNoteAccessDeniedError,
    ResearchNoteManageDeniedError,
    ResearchNoteNotFoundError,
    _get_project,
    _require_project_access,
)
from app.infrastructure.db.session import get_db
from app.infrastructure.llm.connections import (
    connection_view,
    require_company,
    resolve_settings,
    save_connection,
)
from app.infrastructure.llm.models import NoteGenerationJobORM
from app.infrastructure.llm.openai_note_generator import OpenAINoteGenerator
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.llm import BatchInput, ConnectionInput

router = APIRouter(prefix="/llm", tags=["llm"])


@contextmanager
def api_errors():
    try:
        yield
    except (
        PermissionError,
        ResearchNoteAccessDeniedError,
        ResearchNoteManageDeniedError,
    ) as exc:
        raise HTTPException(403, str(exc)) from exc
    except (LookupError, ProjectNotFoundError, ResearchNoteNotFoundError) as exc:
        raise HTTPException(
            404, "프로젝트, 노트 또는 생성 작업을 찾을 수 없습니다"
        ) from exc
    except NoteGenerationUnavailableError as exc:
        raise HTTPException(503, str(exc)) from exc
    except NoteGenerationFailedError as exc:
        raise HTTPException(502, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/connection")
def get_connection(
    company_id: int | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        company_id, can_manage = require_company(db, user, company_id)
        return connection_view(db, company_id, can_manage)


@router.put("/connection")
def put_connection(
    payload: ConnectionInput,
    company_id: int | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        company_id, can_manage = require_company(db, user, company_id, manage=True)
        if payload.enabled:
            resolve_settings(db, company_id, payload)
        save_connection(db, company_id, payload)
        return connection_view(db, company_id, can_manage)


@router.post("/models")
def list_models(
    payload: ConnectionInput,
    company_id: int | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        company_id, _ = require_company(db, user, company_id, manage=True)
        generator = OpenAINoteGenerator(resolve_settings(db, company_id, payload))
        try:
            return {"models": generator.list_models()}
        finally:
            generator.close()


@router.post("/test")
def test_connection(
    payload: ConnectionInput,
    company_id: int | None = None,
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        company_id, _ = require_company(db, user, company_id, manage=True)
        if not payload.model:
            raise ValueError("먼저 테스트할 모델을 선택하세요")
        generator = OpenAINoteGenerator(resolve_settings(db, company_id, payload))
        try:
            generated = generator.generate(
                NoteGenerationInput(
                    note_title="연결 테스트",
                    project_name="LabNote",
                    memo="연결 테스트 요청임. 실험 자료는 없음.",
                    language="ko",
                    sections=[("연결 확인", "짧은 확인 문장만 작성")],
                )
            )
            return {"ok": True, "model": generated.model, "text": generated.as_text()}
        finally:
            generator.close()


@router.post("/batches", status_code=202)
def post_batch(
    payload: BatchInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        try:
            job, created = create_job(db, user, payload)
        except IntegrityError:
            db.rollback()
            job, created = create_job(db, user, payload)
        result = job_view(db, job)
        if created:
            dispatch_job(job.id)
        return result


@router.get("/batches")
def list_batches(
    project_id: str,
    limit: int = Query(20, ge=1, le=100),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        _require_project_access(db, _get_project(db, project_id), user)
        jobs = db.scalars(
            select(NoteGenerationJobORM)
            .where(NoteGenerationJobORM.project_id == project_id)
            .order_by(
                NoteGenerationJobORM.created_at.desc(), NoteGenerationJobORM.id.desc()
            )
            .limit(limit)
        )
        return [job_view(db, job) for job in jobs]


@router.get("/batches/{job_id}")
def get_batch(
    job_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        return job_view(db, require_job(db, user, job_id))


@router.post("/batches/{job_id}/cancel")
def cancel_batch(
    job_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        job = require_job(db, user, job_id, manage=True)
        if job.status in {"queued", "running"}:
            job.cancel_requested = True
            db.commit()
        return job_view(db, job)


@router.post("/batches/{job_id}/retry", status_code=202)
def retry_batch(
    job_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        job = require_job(db, user, job_id, manage=True)
        retry_job(db, job)
        result = job_view(db, job)
        dispatch_job(job.id)
        return result
