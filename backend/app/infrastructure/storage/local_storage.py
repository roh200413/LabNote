from pathlib import Path
import re
import shutil
from uuid import uuid4

from app.core.config import get_settings

# Characters Windows refuses in file names, plus control characters.
_UNSAFE_CHARS = re.compile(r'[<>:"|?*\x00-\x1f]')


def safe_filename(filename: str) -> str:
    """Last path segment of an uploaded name, safe to use as a file name.

    Folder uploads send names like ``masks/scan_1.png``; keeping the folder part would point
    into a directory that does not exist (and ``../`` would escape the storage root).
    """
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    name = _UNSAFE_CHARS.sub("_", name).strip().strip(".")
    return name[:150] or "file"


class LocalStorageService:
    def __init__(self) -> None:
        self.root = get_settings().storage_root_path
        self.root.mkdir(parents=True, exist_ok=True)

    def save_bytes(self, content: bytes, subdir: str, filename: str) -> str:
        safe_name = f"{uuid4()}_{safe_filename(filename)}"
        target_dir = self.root / subdir
        target_dir.mkdir(parents=True, exist_ok=True)
        target = target_dir / safe_name
        target.write_bytes(content)
        return target.relative_to(self.root).as_posix()

    def absolute_path(self, storage_key: str) -> Path:
        target = (self.root / storage_key).resolve()
        if not target.is_relative_to(self.root.resolve()):
            raise ValueError("Storage key escapes storage root")
        return target

    def delete_tree(self, subdir: str) -> None:
        target = self.root / subdir
        if target.exists():
            shutil.rmtree(target, ignore_errors=True)
