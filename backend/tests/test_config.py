from app.core.config import Settings


def test_postgresql_database_url_from_db_config() -> None:
    settings = Settings(
        _env_file=None,
        db="postgresql",
        db_user="postgres",
        db_password="paul!8036",
        db_host="localhost",
        db_port=5432,
        db_name="deep-data-bank3",
    )

    assert (
        settings.sqlalchemy_database_url
        == "postgresql+psycopg://postgres:paul%218036@localhost:5432/deep-data-bank3"
    )


def test_mysql_database_url_from_db_config() -> None:
    settings = Settings(
        _env_file=None,
        db="mysql",
        db_user="root",
        db_password="secret",
        db_host="127.0.0.1",
        db_port=3306,
        db_name="labnote",
        db_set="charset=utf8mb4",
    )

    assert (
        settings.sqlalchemy_database_url
        == "mysql+pymysql://root:secret@127.0.0.1:3306/labnote?charset=utf8mb4"
    )


def test_sqlite_database_url_from_db_config() -> None:
    settings = Settings(_env_file=None, db="sqlite", db_name="data/labnote.db")

    assert settings.sqlalchemy_database_url.endswith("/data/labnote.db")
    assert settings.sqlalchemy_database_url.startswith("sqlite:///")
