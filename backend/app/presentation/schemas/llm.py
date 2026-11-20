from datetime import date
from typing import Literal
from urllib.parse import urlsplit

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


class ConnectionInput(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    provider: Literal["cliproxy", "openai", "compatible"] = "cliproxy"
    base_url: str = Field(default="http://127.0.0.1:8317/v1", max_length=500)
    model: str = Field(default="", max_length=200)
    api_key: str | None = Field(default=None, max_length=4096, repr=False)
    clear_api_key: bool = False
    enabled: bool = True
    json_mode: bool = False
    timeout_seconds: int = Field(default=120, ge=10, le=180)

    @field_validator("base_url")
    @classmethod
    def valid_url(cls, value: str) -> str:
        try:
            parsed = urlsplit(value)
            port = parsed.port
        except ValueError as exc:
            raise ValueError("올바른 API Base URL을 입력하세요") from exc
        if (
            parsed.scheme not in {"http", "https"}
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ValueError(
                "인증 정보와 쿼리가 없는 http(s) API Base URL을 입력하세요"
            )
        if port == 0:
            raise ValueError("유효한 포트를 입력하세요")
        value = value.rstrip("/")
        if value.endswith(("/chat/completions", "/responses", "/models")):
            raise ValueError("개별 API 경로 대신 /v1까지의 Base URL을 입력하세요")
        return value


class BatchEntry(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)
    title: str = Field(min_length=1, max_length=255)
    written_date: date
    memo: str = Field(default="", max_length=20000)
    source_note_id: str | None = None
    page_ids: list[int] = Field(default_factory=list, max_length=4)

    @model_validator(mode="after")
    def require_evidence(self):
        if not self.memo and not self.source_note_id:
            raise ValueError("각 노트에 작업 메모 또는 기존 참고 노트가 필요합니다")
        if self.page_ids and not self.source_note_id:
            raise ValueError("참고 페이지에는 원본 노트 ID가 필요합니다")
        return self


class BatchInput(BaseModel):
    request_id: str = Field(min_length=8, max_length=80)
    project_id: str
    owner_member_id: int | None = None
    language: Literal["ko", "en"] = "ko"
    context: str = Field(default="", max_length=20000)
    entries: list[BatchEntry] = Field(min_length=1, max_length=100)
