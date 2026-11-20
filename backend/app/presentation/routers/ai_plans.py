"""Project-level AI generation: plan the notes with the LLM, agree on the count, then generate."""

from datetime import date

from fastapi import APIRouter, Depends, File, Form, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.domain.research_notes.batch_generation import dispatch_job, job_view
from app.domain.research_notes.generation_plans import (
    confirm_plan,
    create_plan,
    get_plan,
    list_plans,
    reply_to_plan,
    update_plan_items,
)
from app.infrastructure.db.session import get_db
from app.infrastructure.documents.text_extract import extract_text
from app.presentation.dependencies.auth import get_current_user
from app.presentation.routers.llm import api_errors

router = APIRouter(tags=["ai-plans"])
MAX_FILES = 10


class PlanMessageInput(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class PlanItemInput(BaseModel):
    title: str = Field(min_length=1, max_length=255)
    written_date: date | None = None
    focus: str = Field(default="", max_length=2000)
    source_hint: str = Field(default="", max_length=300)


class PlanItemsInput(BaseModel):
    items: list[PlanItemInput] = Field(min_length=1, max_length=100)


class PlanConfirmInput(BaseModel):
    owner_member_id: int | None = None


def _optional_int(value: str | None) -> int | None:
    if value is None or not value.strip():
        return None
    try:
        return int(value)
    except ValueError as exc:
        raise ValueError("희망 장수는 숫자로 입력하세요") from exc


def _optional_date(value: str | None) -> date | None:
    if value is None or not value.strip():
        return None
    try:
        return date.fromisoformat(value.strip())
    except ValueError as exc:
        raise ValueError("날짜 형식이 올바르지 않습니다") from exc


@router.post("/projects/{project_id}/ai-plans", status_code=201)
async def create_plan_endpoint(
    project_id: str,
    mode: str = Form(...),
    note_ids: str = Form(default=""),
    requested_count: str | None = Form(default=None),
    date_from: str | None = Form(default=None),
    date_to: str | None = Form(default=None),
    instructions: str = Form(default=""),
    language: str = Form(default="ko"),
    files: list[UploadFile] = File(default=[]),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with api_errors():
        if len(files) > MAX_FILES:
            raise ValueError(f"문서는 한 번에 {MAX_FILES}개까지 올릴 수 있습니다")
        documents = []
        if mode == "document":
            for upload in files:
                data = await upload.read()
                documents.append((upload.filename or "문서", extract_text(upload.filename or "", data)))
        return create_plan(
            db,
            user,
            project_id,
            mode=mode,
            note_ids=[value.strip() for value in note_ids.split(",") if value.strip()],
            documents=documents,
            requested_count=_optional_int(requested_count),
            date_from=_optional_date(date_from),
            date_to=_optional_date(date_to),
            instructions=instructions[:2000],
            language=language,
        )


@router.get("/projects/{project_id}/ai-plans")
def list_plans_endpoint(project_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    with api_errors():
        return list_plans(db, user, project_id)


@router.get("/ai-plans/{plan_id}")
def get_plan_endpoint(plan_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    with api_errors():
        return get_plan(db, user, plan_id)


@router.post("/ai-plans/{plan_id}/messages")
def reply_endpoint(
    plan_id: str, payload: PlanMessageInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        return reply_to_plan(db, user, plan_id, payload.message)


@router.put("/ai-plans/{plan_id}/items")
def update_items_endpoint(
    plan_id: str, payload: PlanItemsInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        items = [
            {**item.model_dump(), "written_date": item.written_date.isoformat() if item.written_date else None}
            for item in payload.items
        ]
        return update_plan_items(db, user, plan_id, items)


@router.post("/ai-plans/{plan_id}/confirm", status_code=202)
def confirm_endpoint(
    plan_id: str, payload: PlanConfirmInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with api_errors():
        plan, job, created = confirm_plan(db, user, plan_id, owner_member_id=payload.owner_member_id)
        if created:
            dispatch_job(job.id)
        return {"plan": plan, "job": job_view(db, job)}
