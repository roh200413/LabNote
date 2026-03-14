import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(slots=True)
class SystemAdmin:
    username: str
    display_name: str
    email: str
    is_active: bool = True


class SystemAdminRegistryError(Exception):
    pass


class SystemAdminRegistry:
    def __init__(self, registry_path: Path) -> None:
        self.registry_path = registry_path

    def load(self) -> list[SystemAdmin]:
        if not self.registry_path.exists():
            raise SystemAdminRegistryError(f"Registry file not found: {self.registry_path}")

        payload = json.loads(self.registry_path.read_text(encoding="utf-8"))
        admins: list[SystemAdmin] = []
        for item in payload.get("system_admins", []):
            admins.append(
                SystemAdmin(
                    username=item["username"],
                    display_name=item["display_name"],
                    email=item["email"],
                    is_active=bool(item.get("is_active", True)),
                )
            )

        if not admins:
            raise SystemAdminRegistryError("At least one pre-created system admin is required")

        return admins

    def save(self, admins: list[SystemAdmin]) -> None:
        payload = {
            "system_admins": [
                {
                    "username": admin.username,
                    "display_name": admin.display_name,
                    "email": admin.email,
                    "is_active": admin.is_active,
                }
                for admin in admins
            ]
        }
        self.registry_path.parent.mkdir(parents=True, exist_ok=True)
        self.registry_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
