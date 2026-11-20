import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import BASE_DIR, Settings, get_settings
from app.domain.note_formats.use_cases import _primary_membership
from app.domain.research_notes.note_generation import NoteGenerationUnavailableError
from app.infrastructure.db.models import CompanyMemberORM, CompanyORM
from app.infrastructure.llm.models import LLMConnectionORM
from app.presentation.schemas.llm import ConnectionInput


def require_company(db, user, company_id=None, *, manage=False):
    membership = (
        _primary_membership(db, user)
        if company_id is None
        else db.scalar(
            select(CompanyMemberORM).where(
                CompanyMemberORM.company_id == company_id,
                CompanyMemberORM.user_id == user.id,
            )
        )
    )
    company_id = company_id or (membership.company_id if membership else None)
    if company_id is None or db.get(CompanyORM, company_id) is None:
        raise PermissionError("소속 기관을 선택하세요")
    if not user.is_system_admin and (
        membership is None or (manage and membership.role != "owner")
    ):
        raise PermissionError(
            "LLM 연결 설정은 해당 기관 관리자만 변경할 수 있습니다"
            if manage
            else "기관 접근 권한이 없습니다"
        )
    return company_id, user.is_system_admin or (
        membership is not None and membership.role == "owner"
    )


def _cipher() -> Fernet:
    key = get_settings().llm_encryption_key
    if not key:
        # Never store this next to uploaded files: /storage is publicly served.
        path = Path(BASE_DIR) / ".llm-encryption.key"
        try:
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            key = path.read_text(encoding="ascii").strip()
        else:
            key = Fernet.generate_key().decode("ascii")
            with os.fdopen(descriptor, "w", encoding="ascii") as handle:
                handle.write(key)
    try:
        return Fernet(key.encode("ascii"))
    except (ValueError, UnicodeError) as exc:
        raise NoteGenerationUnavailableError(
            "LLM 암호화 키 설정이 올바르지 않습니다"
        ) from exc


def encrypt_secret(value: str) -> str:
    """Encrypts any stored credential (LLM keys, GitHub tokens) with the app's Fernet key."""
    return _cipher().encrypt(value.encode()).decode()


def decrypt_secret(value: str) -> str:
    return _cipher().decrypt(value.encode()).decode()


def decrypt_key(row: LLMConnectionORM | None) -> str:
    if row is None or not row.encrypted_api_key:
        return ""
    try:
        return _cipher().decrypt(row.encrypted_api_key.encode()).decode()
    except InvalidToken as exc:
        raise NoteGenerationUnavailableError(
            "저장된 API 키를 읽을 수 없습니다. 연결 설정에서 API 키를 다시 저장하세요"
        ) from exc


def connection_view(db: Session, company_id: int, can_manage: bool) -> dict:
    row = db.get(LLMConnectionORM, company_id)
    settings = get_settings()
    return {
        "company_id": company_id,
        "can_manage": can_manage,
        "provider": row.provider
        if row
        else (
            "compatible"
            if settings.openai_base_url
            else "openai"
            if settings.openai_api_key
            else "cliproxy"
        ),
        "base_url": row.base_url
        if row
        else (
            settings.openai_base_url
            or (
                "https://api.openai.com/v1"
                if settings.openai_api_key
                else "http://127.0.0.1:8317/v1"
            )
        ),
        "model": row.model
        if row
        else (settings.openai_model if settings.openai_api_key else ""),
        "enabled": row.enabled if row else bool(settings.openai_api_key),
        "has_api_key": bool(row.encrypted_api_key)
        if row
        else bool(settings.openai_api_key),
        "json_mode": row.json_mode if row else settings.llm_json_mode,
        "timeout_seconds": row.timeout_seconds
        if row
        else int(settings.llm_timeout_seconds),
        "source": "database" if row else "environment",
    }


def resolve_settings(
    db: Session, company_id: int, payload: ConnectionInput | None = None
) -> Settings | None:
    settings = get_settings()
    row = db.get(LLMConnectionORM, company_id)
    if payload is None and row is None:
        return settings if settings.openai_api_key else None
    config = payload or ConnectionInput(
        provider=row.provider,
        base_url=row.base_url,
        model=row.model,
        enabled=row.enabled,
        json_mode=row.json_mode,
        timeout_seconds=row.timeout_seconds,
    )
    if not config.enabled and payload is None:
        return None
    if config.clear_api_key:
        key = ""
    elif config.api_key:
        key = config.api_key
    else:
        # A saved key is never forwarded to a changed host, including in the test endpoint.
        same_destination = row is not None and row.base_url == config.base_url
        env_destination = settings.openai_base_url or "https://api.openai.com/v1"
        key = (
            decrypt_key(row)
            if same_destination
            else (
                settings.openai_api_key
                if row is None and config.base_url == env_destination
                else ""
            )
        )
    if not key and config.provider != "cliproxy":
        raise NoteGenerationUnavailableError("이 연결에는 API 키가 필요합니다")
    return settings.model_copy(
        update={
            "openai_api_key": key or "cliproxy-local",
            "openai_base_url": config.base_url,
            "openai_model": config.model,
            "llm_timeout_seconds": config.timeout_seconds,
            "llm_json_mode": config.json_mode,
        }
    )


def save_connection(db: Session, company_id: int, payload: ConnectionInput) -> None:
    if payload.enabled and not payload.model:
        raise ValueError("사용할 모델 ID를 입력하거나 선택하세요")
    row = db.get(LLMConnectionORM, company_id)
    settings = get_settings()
    inherited_key = (
        settings.openai_api_key
        if row is None
        and payload.base_url
        == (settings.openai_base_url or "https://api.openai.com/v1")
        else ""
    )
    if row is None:
        row = LLMConnectionORM(company_id=company_id)
        db.add(row)
    if payload.clear_api_key:
        row.encrypted_api_key = ""
    elif payload.api_key or inherited_key:
        row.encrypted_api_key = (
            _cipher().encrypt((payload.api_key or inherited_key).encode()).decode()
        )
    elif row.base_url != payload.base_url:
        row.encrypted_api_key = ""
    for key in (
        "provider",
        "base_url",
        "model",
        "enabled",
        "json_mode",
        "timeout_seconds",
    ):
        setattr(row, key, getattr(payload, key))
    db.commit()
