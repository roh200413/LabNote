"""Project dashboard activity and project data storage (NAS-like file area)."""

from contextlib import contextmanager
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.domain.data_storage.use_cases import (
    DataFileNotFoundError,
    DataPermissionError,
    IncomingFile,
    create_folder,
    delete_files,
    get_file,
    list_folder,
    upload_files,
)
from app.domain.projects.note_activity import (
    project_note_activity,
    reset_activity_rules,
    save_activity_rules,
)
from app.domain.projects.use_cases import ProjectAccessDeniedError, ProjectManageDeniedError, ProjectNotFoundError
from app.infrastructure.db.session import get_db
from app.presentation.dependencies.auth import get_current_user

router = APIRouter(tags=["project-data"])


@contextmanager
def errors():
    try:
        yield
    except (ProjectAccessDeniedError, ProjectManageDeniedError, DataPermissionError) as exc:
        raise HTTPException(403, str(exc)) from exc
    except (ProjectNotFoundError, DataFileNotFoundError) as exc:
        raise HTTPException(404, "프로젝트나 파일을 찾을 수 없습니다") from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


class FolderInput(BaseModel):
    path: str = Field(min_length=1, max_length=500)


class DeleteInput(BaseModel):
    file_ids: list[int] = Field(default_factory=list, max_length=500)
    folder: str | None = Field(default=None, max_length=500)


@router.get("/projects/{project_id}/note-activity")
def note_activity_endpoint(project_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    with errors():
        return project_note_activity(db, project_id, user)


class ActivityRulesInput(BaseModel):
    inactive_days: int = Field(ge=0, le=365)
    stale_draft_days: int = Field(ge=0, le=365)
    review_wait_days: int = Field(ge=0, le=365)
    check_rejected: bool = True
    check_monthly_pace: bool = True


@router.put("/projects/{project_id}/activity-rules")
def save_activity_rules_endpoint(
    project_id: str, payload: ActivityRulesInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with errors():
        return save_activity_rules(db, project_id, user, **payload.model_dump())


@router.delete("/projects/{project_id}/activity-rules")
def reset_activity_rules_endpoint(project_id: str, user=Depends(get_current_user), db: Session = Depends(get_db)):
    with errors():
        return reset_activity_rules(db, project_id, user)


@router.get("/projects/{project_id}/data")
def list_data_endpoint(
    project_id: str,
    folder: str = Query(default="", max_length=500),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with errors():
        return list_folder(db, user, project_id, folder)


@router.post("/projects/{project_id}/data", status_code=201)
async def upload_data_endpoint(
    project_id: str,
    folder: str = Form(default=""),
    paths: list[str] = Form(default=[]),
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user),
    db: Session = Depends(get_db),
):
    with errors():
        incoming = []
        for index, upload in enumerate(files):
            incoming.append(
                IncomingFile(
                    name=upload.filename or "file",
                    relative_path=paths[index] if index < len(paths) else "",
                    content=await upload.read(),
                    mime_type=upload.content_type,
                )
            )
        return {"files": upload_files(db, user, project_id, folder=folder, files=incoming)}


@router.post("/projects/{project_id}/data/folders", status_code=201)
def create_folder_endpoint(
    project_id: str, payload: FolderInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with errors():
        return create_folder(db, user, project_id, payload.path)


@router.post("/projects/{project_id}/data/delete")
def delete_data_endpoint(
    project_id: str, payload: DeleteInput, user=Depends(get_current_user), db: Session = Depends(get_db)
):
    with errors():
        if not payload.file_ids and not payload.folder:
            raise ValueError("지울 파일이나 폴더를 고르세요")
        return {"deleted": delete_files(db, user, project_id, file_ids=payload.file_ids, folder=payload.folder)}


@router.get("/data-files/{file_id}/download")
def download_data_endpoint(file_id: int, user=Depends(get_current_user), db: Session = Depends(get_db)):
    with errors():
        row, path = get_file(db, user, file_id)
        return FileResponse(
            path,
            media_type=row.mime_type,
            headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(row.name)}"},
        )
