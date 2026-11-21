from pathlib import Path

from fastapi import FastAPI, HTTPException
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
from app.presentation.routers.autoflow_attachment import router as autoflow_attachment_router
from app.presentation.routers.auth import router as auth_router
from app.presentation.routers.directory import router as directory_router
from app.presentation.routers.document_editor import router as document_editor_router
from app.presentation.routers.file import router as file_router
from app.presentation.routers.github_integration import router as github_integration_router
from app.presentation.routers.health import router as health_router
from app.presentation.routers.note_format import router as note_format_router
from app.presentation.routers.search import router as search_router
from app.presentation.routers.github_account import router as github_account_router
from app.presentation.routers.github_app import router as github_app_router
from app.presentation.routers.feedback import router as feedback_router
from app.presentation.routers.home_stats import router as home_stats_router
from app.presentation.routers.llm import router as llm_router
from app.presentation.routers.ai_plans import router as ai_plans_router
from app.presentation.routers.project_data import router as project_data_router
from app.presentation.routers.project import router as project_router
from app.presentation.routers.note_bundle import router as note_bundle_router
from app.presentation.routers.research_note import router as research_note_router
from app.presentation.routers.research_note_ai_review import router as research_note_ai_review_router
from app.presentation.routers.research_note_pdf_split import router as research_note_pdf_split_router


# Folders under the storage root that must only be served through authenticated endpoints.
PRIVATE_STORAGE_PREFIXES = ("project-data/",)


class PublicStaticFiles(StaticFiles):
    """Serves uploaded page images and signatures by their unguessable names, but never private data."""

    async def get_response(self, path, scope):
        if any(path.replace("\\", "/").lstrip("/").startswith(prefix) for prefix in PRIVATE_STORAGE_PREFIXES):
            raise HTTPException(status_code=404)
        return await super().get_response(path, scope)


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    if app_settings.app_env.lower() not in {"local", "dev", "development", "test"}:
        weak = []
        if app_settings.app_secret_key == "change-me-in-production":
            weak.append("APP_SECRET_KEY")
        if app_settings.system_admin_password == "admin1234":
            weak.append("SYSTEM_ADMIN_PASSWORD")
        if weak:
            raise RuntimeError(f"운영 환경에서는 {', '.join(weak)} 기본값을 바꿔야 합니다 (.env 확인)")
    app_settings.storage_root_path.mkdir(parents=True, exist_ok=True)
    app = FastAPI(title=app_settings.app_name, debug=app_settings.app_debug)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition", "Content-Length", "X-LabNote-Export-Id", "X-LabNote-Export-Storage-Key"],
    )

    @app.on_event("startup")
    def on_startup() -> None:
        from app.infrastructure.db import models  # noqa: F401

        Base.metadata.create_all(bind=engine)
        ensure_schema_extensions(engine)
        from app.domain.research_notes.batch_generation import recover_interrupted_jobs
        recover_interrupted_jobs()
        app_settings.storage_root_path.mkdir(parents=True, exist_ok=True)

        registry = SystemAdminRegistry(Path("app/core/system_admins.json"))
        system_admins = registry.load()
        app.state.system_admins = system_admins
        with Session(engine) as db:
            app.state.seeded_system_admins = ensure_system_admin_users(db, system_admins)

    app.include_router(health_router)
    app.include_router(autoflow_attachment_router)
    app.include_router(auth_router)
    app.include_router(admin_router)
    app.include_router(directory_router)
    app.include_router(document_editor_router)
    app.include_router(note_format_router)
    app.include_router(search_router)
    app.include_router(github_account_router)
    app.include_router(github_app_router)
    app.include_router(feedback_router)
    app.include_router(home_stats_router)
    app.include_router(llm_router)
    app.include_router(ai_plans_router)
    app.include_router(project_data_router)
    app.include_router(github_integration_router)
    app.include_router(project_router)
    app.include_router(research_note_pdf_split_router)
    app.include_router(research_note_ai_review_router)
    app.include_router(note_bundle_router)
    app.include_router(research_note_router)
    app.include_router(file_router)
    app.mount("/storage", PublicStaticFiles(directory=app_settings.storage_root_path), name="storage")

    @app.get("/")
    def root() -> dict[str, str]:
        return {"message": "LabNote API is running"}

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
