from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from sqlalchemy.orm import Session

from app.core.config import Settings, get_settings
from app.core.system_admin_registry import SystemAdminRegistry
from app.domain.accounts.use_cases import ensure_system_admin_users
from app.infrastructure.db.base import Base
from app.infrastructure.db.bootstrap import ensure_schema_extensions
from app.infrastructure.db.session import engine
from app.presentation.routers.admin import router as admin_router
from app.presentation.routers.auth import router as auth_router
from app.presentation.routers.directory import router as directory_router
from app.presentation.routers.document_editor import router as document_editor_router
from app.presentation.routers.file import router as file_router
from app.presentation.routers.health import router as health_router
from app.presentation.routers.project import router as project_router
from app.presentation.routers.research_note import router as research_note_router


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    app_settings.storage_root_path.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title=app_settings.app_name, debug=app_settings.app_debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "Content-Length"],
    )

    @app.on_event("startup")
    def on_startup() -> None:
        from app.infrastructure.db import models  # noqa: F401

        Base.metadata.create_all(bind=engine)
        ensure_schema_extensions(engine)
        app_settings.storage_root_path.mkdir(parents=True, exist_ok=True)

        registry = SystemAdminRegistry(Path("app/core/system_admins.json"))
        system_admins = registry.load()
        app.state.system_admins = system_admins
        with Session(engine) as db:
            app.state.seeded_system_admins = ensure_system_admin_users(db, system_admins)

    app.include_router(health_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(directory_router)
    app.include_router(document_editor_router)
    app.include_router(project_router)
    app.include_router(research_note_router)
    app.include_router(file_router)
    app.mount("/storage", StaticFiles(directory=app_settings.storage_root_path), name="storage")

    @app.get("/")
    def root() -> dict[str, str]:
        return {"message": "LabNote API is running"}

    return app


app = create_app()
