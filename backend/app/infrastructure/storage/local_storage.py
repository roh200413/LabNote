from pathlib import Path
import shutil
from uuid import uuid4

from app.core.config import get_settings


class LocalStorageService:
    def __init__(self) -> None:
        self.root = get_settings().storage_root_path
        self.root.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, content: bytes, subdir: str, filename: str) -> str:
        safe_name = f"{uuid4()}_{filename}"
        target_dir = self.root / subdir
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / safe_name
        target.write_bytes(content)
        return target.relative_to(self.root).as_posix()

    def absolute_path(self, storage_key: str) -> Path:
        return self.root / storage_key

    def delete_tree(self, subdir: str) -> None:
        target = self.root / subdir
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
