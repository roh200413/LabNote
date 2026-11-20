from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.domain.feedback.use_cases import (
    FeedbackNotFoundError,
    answer_feedback,
    count_open_feedback,
    create_feedback,
    list_all_feedback,
    list_my_feedback,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_admin, get_current_user

router = APIRouter(tags=["feedback"])


class FeedbackCreateRequest(BaseModel):
    category: str = "improvement"
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=1, max_length=5000)
    page: str | None = Field(default=None, max_length=200)


class FeedbackAnswerRequest(BaseModel):
    status: str | None = None
    admin_reply: str | None = Field(default=None, max_length=5000)


@router.post("/feedback", status_code=status.HTTP_201_CREATED)
def create_feedback_endpoint(
    payload: FeedbackCreateRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        return create_feedback(db, current_user, **payload.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/feedback/mine")
def list_my_feedback_endpoint(current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    return list_my_feedback(db, current_user)


@router.get("/admin/feedback")
def list_feedback_endpoint(
    status_filter: str | None = Query(default=None, alias="status"),
    category: str | None = None,
    _admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    return {"items": list_all_feedback(db, status=status_filter, category=category), "open_count": count_open_feedback(db)}


@router.put("/admin/feedback/{feedback_id}")
def answer_feedback_endpoint(
    feedback_id: int,
    payload: FeedbackAnswerRequest,
    admin=Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    try:
        return answer_feedback(db, admin, feedback_id, **payload.model_dump(exclude_unset=True))
    except FeedbackNotFoundError as exc:
        raise HTTPException(status_code=404, detail="의견을 찾을 수 없습니다") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
