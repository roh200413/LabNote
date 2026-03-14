from fastapi import APIRouter, Request

from app.application.services import now_utc_iso
from app.core.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check(request: Request) -> dict[str, str | bool | int]:
    settings = get_settings()
    system_admins = getattr(request.app.state, "system_admins", [])
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
        "debug": settings.app_debug,
        "preconfigured_system_admin_count": len(system_admins),
        "timestamp": now_utc_iso(),
    }
