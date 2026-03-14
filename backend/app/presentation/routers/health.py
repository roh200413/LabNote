from fastapi import APIRouter

from app.application.services import now_utc_iso
from app.core.config import get_settings

router = APIRouter(prefix="/health", tags=["health"])


@router.get("")
def health_check() -> dict[str, str | bool]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
        "debug": settings.app_debug,
        "timestamp": now_utc_iso(),
    }
