from fastapi import FastAPI

from app.core.config import Settings, get_settings
from app.infrastructure.db.base import Base
from app.infrastructure.db.session import engine
from app.presentation.routers.health import router as health_router
from app.presentation.routers.project import router as project_router
from app.presentation.routers.research_note import router as research_note_router


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    app = FastAPI(title=app_settings.app_name, debug=app_settings.app_debug)

    @app.on_event("startup")
    def on_startup() -> None:
        from app.infrastructure.db import models  # noqa: F401

        Base.metadata.create_all(bind=engine)

    app.include_router(health_router)
    app.include_router(project_router)
    app.include_router(research_note_router)

    @app.get("/")
    def root() -> dict[str, str]:
        return {"message": "LabNote API is running"}

    return app


app = create_app()
