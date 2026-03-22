from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.domain.projects.use_cases import (
    ProjectAccessDeniedError,
    ProjectManageDeniedError,
    ProjectNotFoundError,
    assign_project_member,
    create_project,
    delete_project,
    get_project,
    get_project_cover,
    list_project_members,
    list_projects,
    remove_project_member,
    update_project,
    upsert_project_cover,
)
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user
from app.presentation.schemas.project import (
    ProjectCreateRequest,
    ProjectMemberAssignRequest,
    ProjectMemberResponse,
    ProjectNoteCoverResponse,
    ProjectNoteCoverUpsertRequest,
    ProjectResponse,
    ProjectUpdateRequest,
)

router = APIRouter(prefix="/projects", tags=["projects"])


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project_endpoint(payload: ProjectCreateRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        project = create_project(db, current_user, **payload.model_dump())
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Project code already exists in company") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ProjectAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    except ProjectManageDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return project


@router.get("", response_model=list[ProjectResponse])
def list_projects_endpoint(
    company_id: int | None = Query(default=None),
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_projects(db, current_user, company_id=company_id)


@router.get("/{project_id}", response_model=ProjectResponse)
def get_project_endpoint(project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return get_project(db, project_id, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ProjectAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/{project_id}", response_model=ProjectResponse)
def update_project_endpoint(
    project_id: str, payload: ProjectUpdateRequest, current_user=Depends(get_current_user), db: Session = Depends(get_db)
):
    try:
        return update_project(db, project_id, current_user, **payload.model_dump(exclude_unset=True))
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except IntegrityError as exc:
        raise HTTPException(status_code=409, detail="Project code already exists in company") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ProjectAccessDeniedError, ProjectManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_project_endpoint(
    project_id: str,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        delete_project(db, project_id, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except (ProjectAccessDeniedError, ProjectManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{project_id}/members", response_model=ProjectMemberResponse)
def assign_project_member_endpoint(
    project_id: str,
    payload: ProjectMemberAssignRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return assign_project_member(db, project_id, payload.company_member_id, payload.role, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (ProjectAccessDeniedError, ProjectManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.get("/{project_id}/members", response_model=list[ProjectMemberResponse])
def list_project_members_endpoint(project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return list_project_members(db, project_id, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ProjectAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.delete("/{project_id}/members/{company_member_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_project_member_endpoint(
    project_id: str,
    company_member_id: int,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Response:
    try:
        get_project(db, project_id, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ProjectAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc

    try:
        removed = remove_project_member(db, project_id, company_member_id, current_user)
    except ProjectManageDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    if not removed:
        raise HTTPException(status_code=404, detail="Project member not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{project_id}/cover", response_model=ProjectNoteCoverResponse | None)
def get_project_cover_endpoint(project_id: str, current_user=Depends(get_current_user), db: Session = Depends(get_db)):
    try:
        return get_project_cover(db, project_id, current_user)
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except ProjectAccessDeniedError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc


@router.put("/{project_id}/cover", response_model=ProjectNoteCoverResponse)
def upsert_project_cover_endpoint(
    project_id: str,
    payload: ProjectNoteCoverUpsertRequest,
    current_user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    try:
        return upsert_project_cover(db, project_id, current_user, **payload.model_dump())
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=404, detail="Project not found") from exc
    except (ProjectAccessDeniedError, ProjectManageDeniedError) as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
