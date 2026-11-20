from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.domain.research_notes.home_stats import approval_turnaround
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(prefix="/home", tags=["home"])


@router.get("/approval-stats")
def approval_stats_endpoint(
    scope: str = Query(default="mine", pattern="^(mine|all)$"),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return approval_turnaround(db, current_user, mine=scope == "mine")
