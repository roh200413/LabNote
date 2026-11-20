"""Project data storage: keep raw files and folders, then turn them into notes or AI inputs later."""

import hashlib
import mimetypes
import re
from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.accounts.entities import UserAccount
from app.domain.projects.use_cases import _require_project
from app.infrastructure.db.models import ProjectDataFileORM, ProjectDataFolderORM, ProjectORM
from app.infrastructure.storage.local_storage import LocalStorageService

MAX_FILES_PER_UPLOAD = 200
_BAD_SEGMENT = re.compile(r'[<>:"|?*\x00-\x1f]')


class DataFileNotFoundError(LookupError):
    pass


class DataPermissionError(PermissionError):
    pass


@dataclass
class IncomingFile:
    name: str
    relative_path: str  # path inside an uploaded folder ("" for a single file)
    content: bytes
    mime_type: str | None


def normalize_folder(path: str | None) -> str:
    """'a\\b/../c' style input becomes a clean 'a/b' path; rejects traversal and odd characters."""
    if not path:
        return ""
    parts = []
    for part in path.replace("\\", "/").split("/"):
        part = part.strip()
        if part in {"", "."}:
            continue
        if part == ".." or _BAD_SEGMENT.search(part) or len(part) > 120:
            raise ValueError(f"폴더 이름이 올바르지 않습니다: {part}")
        parts.append(part)
    folder = "/".join(parts)
    if len(folder) > 500:
        raise ValueError("폴더 경로가 너무 깁니다")
    return folder


def _safe_name(name: str) -> str:
    name = name.replace("\\", "/").split("/")[-1].strip()
    if not name or name in {".", ".."} or _BAD_SEGMENT.search(name):
        raise ValueError(f"파일 이름이 올바르지 않습니다: {name or '(빈 이름)'}")
    return name[:255]


def _unique_name(db: Session, project_id: str, folder: str, name: str) -> str:
    existing = set(
        db.scalars(
            select(ProjectDataFileORM.name).where(
                ProjectDataFileORM.project_id == project_id, ProjectDataFileORM.folder == folder
            )
        )
    )
    if name not in existing:
        return name
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    counter = 2
    while True:
        candidate = f"{stem} ({counter}){'.' + ext if ext else ''}"
        if candidate not in existing:
            return candidate
        counter += 1


def _file_view(row: ProjectDataFileORM) -> dict:
    return {
        "id": row.id,
        "name": row.name,
        "folder": row.folder,
        "path": f"{row.folder}/{row.name}" if row.folder else row.name,
        "size": row.size,
        "mime_type": row.mime_type,
        "uploaded_by": row.uploaded_by,
        "created_at": row.created_at.isoformat() if row.created_at else None,
    }


def _can_manage(project: ProjectORM, member, user: UserAccount) -> bool:
    return user.is_system_admin or user.is_company_owner or (member is not None and project.owner_member_id == member.id)


def upload_files(
    db: Session, user: UserAccount, project_id: str, *, folder: str, files: list[IncomingFile]
) -> list[dict]:
    project, _ = _require_project(db, project_id=project_id, current_user=user)
    if not files:
        raise ValueError("올릴 파일을 고르세요")
    if len(files) > MAX_FILES_PER_UPLOAD:
        raise ValueError(f"한 번에 {MAX_FILES_PER_UPLOAD}개까지 올릴 수 있습니다")
    base = normalize_folder(folder)
    limit = get_settings().max_upload_bytes
    storage = LocalStorageService()
    created: list[ProjectDataFileORM] = []
    for incoming in files:
        if len(incoming.content) > limit:
            raise ValueError(f"{incoming.name}: 파일은 {limit // (1024 * 1024)}MB 이하여야 합니다")
        relative = normalize_folder("/".join(incoming.relative_path.replace("\\", "/").split("/")[:-1]))
        target_folder = "/".join(part for part in (base, relative) if part)
        name = _unique_name(db, project.id, target_folder, _safe_name(incoming.name))
        key = storage.save_bytes(incoming.content, f"project-data/{project.id}", re.sub(r"[^\w.\-]", "_", name))
        row = ProjectDataFileORM(
            project_id=project.id,
            folder=target_folder,
            name=name,
            size=len(incoming.content),
            mime_type=incoming.mime_type or mimetypes.guess_type(name)[0] or "application/octet-stream",
            storage_key=key,
            checksum=hashlib.sha256(incoming.content).hexdigest(),
            uploaded_by=user.id,
        )
        db.add(row)
        db.flush()
        created.append(row)
    db.commit()
    return [_file_view(row) for row in created]


def create_folder(db: Session, user: UserAccount, project_id: str, path: str) -> dict:
    project, _ = _require_project(db, project_id=project_id, current_user=user)
    folder = normalize_folder(path)
    if not folder:
        raise ValueError("폴더 이름을 입력하세요")
    exists = db.scalar(
        select(ProjectDataFolderORM.id).where(
            ProjectDataFolderORM.project_id == project.id, ProjectDataFolderORM.path == folder
        )
    )
    if exists is None:
        db.add(ProjectDataFolderORM(project_id=project.id, path=folder))
        db.commit()
    return {"path": folder}


def list_folder(db: Session, user: UserAccount, project_id: str, folder: str = "") -> dict:
    project, _ = _require_project(db, project_id=project_id, current_user=user)
    current = normalize_folder(folder)
    prefix = f"{current}/" if current else ""

    all_files = db.scalars(select(ProjectDataFileORM).where(ProjectDataFileORM.project_id == project.id)).all()
    explicit = db.scalars(
        select(ProjectDataFolderORM.path).where(ProjectDataFolderORM.project_id == project.id)
    ).all()

    children: dict[str, dict] = {}

    def touch(child_path: str) -> dict:
        name = child_path[len(prefix):].split("/")[0]
        path = f"{prefix}{name}"
        return children.setdefault(path, {"name": name, "path": path, "file_count": 0, "size": 0})

    for path in explicit:
        if path.startswith(prefix) and path != current:
            touch(path)
    files_here = []
    for row in all_files:
        if row.folder == current:
            files_here.append(row)
        elif row.folder.startswith(prefix) or (not current and row.folder):
            child = touch(row.folder)
            child["file_count"] += 1
            child["size"] += row.size

    files_here.sort(key=lambda row: row.name.lower())
    crumbs = []
    walked = []
    for part in current.split("/") if current else []:
        walked.append(part)
        crumbs.append({"name": part, "path": "/".join(walked)})
    return {
        "project_id": project.id,
        "folder": current,
        "breadcrumbs": crumbs,
        "folders": sorted(children.values(), key=lambda item: item["name"].lower()),
        "files": [_file_view(row) for row in files_here],
        "total_files": len(all_files),
        "total_size": sum(row.size for row in all_files),
    }


def get_file(db: Session, user: UserAccount, file_id: int) -> tuple[ProjectDataFileORM, str]:
    row = db.get(ProjectDataFileORM, file_id)
    if row is None:
        raise DataFileNotFoundError(file_id)
    _require_project(db, project_id=row.project_id, current_user=user)
    path = LocalStorageService().absolute_path(row.storage_key)
    if not path.is_file():
        raise DataFileNotFoundError(file_id)
    return row, str(path)


def delete_files(db: Session, user: UserAccount, project_id: str, *, file_ids: list[int], folder: str | None) -> int:
    project, member = _require_project(db, project_id=project_id, current_user=user)
    can_manage = _can_manage(project, member, user)
    rows: list[ProjectDataFileORM] = []
    if file_ids:
        rows += list(
            db.scalars(
                select(ProjectDataFileORM).where(
                    ProjectDataFileORM.project_id == project.id, ProjectDataFileORM.id.in_(file_ids)
                )
            )
        )
    target_folder = normalize_folder(folder) if folder else ""
    if target_folder:
        rows += list(
            db.scalars(
                select(ProjectDataFileORM).where(
                    ProjectDataFileORM.project_id == project.id,
                    (ProjectDataFileORM.folder == target_folder) | ProjectDataFileORM.folder.startswith(f"{target_folder}/"),
                )
            )
        )
    unique = {row.id: row for row in rows}.values()
    for row in unique:
        if not can_manage and row.uploaded_by != user.id:
            raise DataPermissionError("직접 올린 파일만 지울 수 있습니다. 다른 사람 파일은 프로젝트 책임자에게 요청하세요")
    storage = LocalStorageService()
    for row in unique:
        try:
            storage.absolute_path(row.storage_key).unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        db.delete(row)
    if target_folder:
        for marker in db.scalars(
            select(ProjectDataFolderORM).where(
                ProjectDataFolderORM.project_id == project.id,
                (ProjectDataFolderORM.path == target_folder) | ProjectDataFolderORM.path.startswith(f"{target_folder}/"),
            )
        ):
            db.delete(marker)
    db.commit()
    return len(list(unique))


def storage_usage(db: Session, project_id: str) -> tuple[int, int]:
    count, size = db.execute(
        select(func.count(ProjectDataFileORM.id), func.coalesce(func.sum(ProjectDataFileORM.size), 0)).where(
            ProjectDataFileORM.project_id == project_id
        )
    ).one()
    return int(count), int(size)
