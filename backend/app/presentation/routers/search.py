from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.domain.search.use_cases import SearchFilters, search_workspace
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/search", tags=["search"])


class SearchProjectHit(BaseModel):
    id: str
    name: str
    code: str
    status: str
    description: str


class SearchNoteHit(BaseModel):
    id: str
    title: str
    project_id: str
    project_name: str
    status: str
    written_date: str | None
    updated_at: str | None
    author_member_id: int
    author_name: str
    matched_in: list[str]
    matched_files: list[str]
    snippet: str


class SearchResearcherHit(BaseModel):
    company_member_id: int
    name: str
    email: str
    role: str


class SearchResponse(BaseModel):
    query: str
    projects: list[SearchProjectHit]
    notes: list[SearchNoteHit]
    note_total: int
    researchers: list[SearchResearcherHit]


@router.get("", response_model=SearchResponse)
def search_endpoint(
    q: str = Query(default="", max_length=200),
    project_id: str | None = None,
    author_member_id: int | None = None,
    status: str | None = Query(default=None, max_length=20),
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = Query(default=30, ge=1, le=100),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> SearchResponse:
    if date_from and date_to and date_from > date_to:
        raise HTTPException(status_code=400, detail="시작일이 종료일보다 늦습니다")
    result = search_workspace(
        db,
        current_user,
        SearchFilters(
            q=q.strip(),
            project_id=project_id or None,
            author_member_id=author_member_id,
            status=status or None,
            date_from=date_from,
            date_to=date_to,
            limit=limit,
        ),
    )
    return SearchResponse(
        query=q.strip(),
        projects=result.projects,
        notes=result.notes,
        note_total=result.note_total,
        researchers=result.researchers,
    )
