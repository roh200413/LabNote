from functools import lru_cache
from pathlib import Path
from urllib.parse import quote_plus

from pydantic import Field, computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]
ENV_FILE = BASE_DIR / ".env"


class Settings(BaseSettings):
    app_name: str = "LabNote API"
    app_env: str = "local"
    app_debug: bool = True
    app_host: str = "0.0.0.0"
    app_port: int = 8000
    app_secret_key: str = "change-me-in-production"
    access_token_expire_minutes: int = 60 * 24
    system_admin_password: str = "LabnoteAdmin!123"

    db: str = "postgresql"
    db_user: str = ""
    db_password: str = ""
    db_host: str = ""
    db_port: int = 0
    db_name: str = ""
    db_set: str = ""

    database_url: str | None = None
    storage_root: str = "./storage"

    model_config = SettingsConfigDict(
        env_file=str(ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    postgres_user: str = Field(default="labnote", alias="POSTGRES_USER")
    postgres_password: str = Field(default="labnote", alias="POSTGRES_PASSWORD")
    postgres_db: str = Field(default="labnote", alias="POSTGRES_DB")
    postgres_host: str = Field(default="localhost", alias="POSTGRES_HOST")
    postgres_port: int = Field(default=5432, alias="POSTGRES_PORT")

    @computed_field  # type: ignore[prop-decorator]
    @property
    def sqlalchemy_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        db_kind = self.db.lower()

        if db_kind == "sqlite":
            db_name = self.db_name or "labnote.db"
            db_path = Path(db_name)
            if not db_path.is_absolute():
                db_path = Path.cwd() / db_path
            return f"sqlite:///{db_path.resolve().as_posix()}"

        if db_kind in {"postgres", "postgresql"}:
            driver = "postgresql+psycopg"
        elif db_kind == "mysql":
            driver = "mysql+pymysql"
        else:
            raise ValueError(f"Unsupported DB engine: {self.db}")

        user = quote_plus(self.db_user or self.postgres_user)
        password = quote_plus(self.db_password or self.postgres_password)
        host = self.db_host or self.postgres_host
        port = self.db_port or self.postgres_port
        name = self.db_name or self.postgres_db
        query = f"?{self.db_set}" if self.db_set else ""
        return f"{driver}://{user}:{password}@{host}:{port}/{name}{query}"

    @computed_field  # type: ignore[prop-decorator]
    @property
    def storage_root_path(self) -> Path:
        return Path(self.storage_root).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
