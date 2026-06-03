from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine


def _sqlite_columns(connection: Connection, table_name: str) -> set[str]:
    return {row[1] for row in connection.exec_driver_sql(f"PRAGMA table_info('{table_name}')").fetchall()}


def _sqlite_tables(connection: Connection) -> set[str]:
    return {
        row[0]
        for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
    }


def _postgres_column_exists(connection: Connection, table_name: str, column_name: str) -> bool:
    return (
        connection.execute(
            text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = :table_name AND column_name = :column_name"
            ),
            {"table_name": table_name, "column_name": column_name},
        ).first()
        is not None
    )


def _postgres_table_exists(connection: Connection, table_name: str) -> bool:
    return (
        connection.execute(
            text("SELECT table_name FROM information_schema.tables WHERE table_name = :table_name"),
            {"table_name": table_name},
        ).first()
        is not None
    )


def _add_column_if_missing(
    connection: Connection,
    *,
    dialect: str,
    table_name: str,
    column_name: str,
    sqlite_definition: str,
    postgres_definition: str,
) -> None:
    if dialect == "sqlite":
        if column_name not in _sqlite_columns(connection, table_name):
            connection.exec_driver_sql(f"ALTER TABLE {table_name} ADD COLUMN {sqlite_definition}")
        return

    if not _postgres_column_exists(connection, table_name, column_name):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {postgres_definition}"))


def _drop_table_if_exists(connection: Connection, *, dialect: str, table_name: str) -> None:
    if dialect == "sqlite":
        if table_name in _sqlite_tables(connection):
            connection.exec_driver_sql(f"DROP TABLE {table_name}")
        return
    if _postgres_table_exists(connection, table_name):
        connection.execute(text(f"DROP TABLE {table_name}"))


def _ensure_sqlite_project_member_pk(connection: Connection) -> None:
    project_member_columns = connection.exec_driver_sql("PRAGMA table_info('project_member')").fetchall()
    if not project_member_columns:
        return
    project_member_id_column = next((row for row in project_member_columns if row[1] == "id"), None)
    if not project_member_id_column or str(project_member_id_column[2]).upper() == "INTEGER":
        return

    connection.exec_driver_sql("PRAGMA foreign_keys=OFF")
    connection.exec_driver_sql("ALTER TABLE project_member RENAME TO project_member_legacy")
    connection.exec_driver_sql(
        """
        CREATE TABLE project_member (
            id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            project_id VARCHAR(36) NOT NULL,
            company_member_id BIGINT NOT NULL,
            role VARCHAR(30) NOT NULL,
            CONSTRAINT uq_project_member UNIQUE (project_id, company_member_id),
            FOREIGN KEY(project_id) REFERENCES project (id) ON DELETE CASCADE,
            FOREIGN KEY(company_member_id) REFERENCES company_member (id) ON DELETE CASCADE
        )
        """
    )
    connection.exec_driver_sql(
        """
        INSERT INTO project_member (id, created_at, updated_at, project_id, company_member_id, role)
        SELECT id, created_at, updated_at, project_id, company_member_id, role
        FROM project_member_legacy
        """
    )
    connection.exec_driver_sql("DROP TABLE project_member_legacy")
    connection.exec_driver_sql("CREATE INDEX IF NOT EXISTS ix_project_member_project_id ON project_member (project_id)")
    connection.exec_driver_sql(
        "CREATE INDEX IF NOT EXISTS ix_project_member_company_member_id ON project_member (company_member_id)"
    )
    connection.exec_driver_sql("PRAGMA foreign_keys=ON")


def ensure_schema_extensions(engine: Engine) -> None:
    with engine.begin() as connection:
        dialect = engine.dialect.name

        _drop_table_if_exists(connection, dialect=dialect, table_name="company_invitation")

        if dialect == "postgresql":
            connection.execute(text("ALTER TABLE company ALTER COLUMN join_code TYPE VARCHAR(9)"))

        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="project_note_cover",
            column_name="template_payload",
            sqlite_definition="template_payload TEXT",
            postgres_definition="template_payload TEXT",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="useraccount",
            column_name="signature_data_url",
            sqlite_definition="signature_data_url TEXT",
            postgres_definition="signature_data_url TEXT",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="research_note",
            column_name="written_date",
            sqlite_definition="written_date DATE",
            postgres_definition="written_date DATE",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="research_note",
            column_name="reviewer_member_id",
            sqlite_definition="reviewer_member_id BIGINT",
            postgres_definition="reviewer_member_id BIGINT",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="research_note",
            column_name="reviewed_date",
            sqlite_definition="reviewed_date DATE",
            postgres_definition="reviewed_date DATE",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="project",
            column_name="monthly_note_target",
            sqlite_definition="monthly_note_target INTEGER",
            postgres_definition="monthly_note_target INTEGER",
        )

        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="research_note_document",
            column_name="status",
            sqlite_definition="status VARCHAR(20) NOT NULL DEFAULT 'draft'",
            postgres_definition="status VARCHAR(20) NOT NULL DEFAULT 'draft'",
        )
        _add_column_if_missing(
            connection,
            dialect=dialect,
            table_name="research_note_document",
            column_name="current_revision_id",
            sqlite_definition="current_revision_id BIGINT",
            postgres_definition="current_revision_id BIGINT",
        )

        for column_name, sqlite_definition, postgres_definition in [
            ("checksum", "checksum VARCHAR(64)", "checksum VARCHAR(64)"),
            ("status", "status VARCHAR(20) NOT NULL DEFAULT 'ready'", "status VARCHAR(20) NOT NULL DEFAULT 'ready'"),
            ("page_count", "page_count INTEGER", "page_count INTEGER"),
            ("error_message", "error_message TEXT", "error_message TEXT"),
        ]:
            _add_column_if_missing(
                connection,
                dialect=dialect,
                table_name="research_note_file",
                column_name=column_name,
                sqlite_definition=sqlite_definition,
                postgres_definition=postgres_definition,
            )

        for column_name, sqlite_definition, postgres_definition in [
            ("note_id", "note_id VARCHAR(36)", "note_id VARCHAR(36)"),
            ("thumbnail_storage_key", "thumbnail_storage_key VARCHAR(500)", "thumbnail_storage_key VARCHAR(500)"),
            ("width", "width INTEGER", "width INTEGER"),
            ("height", "height INTEGER", "height INTEGER"),
            ("active_asset_version_id", "active_asset_version_id BIGINT", "active_asset_version_id BIGINT"),
            ("status", "status VARCHAR(20) NOT NULL DEFAULT 'ready'", "status VARCHAR(20) NOT NULL DEFAULT 'ready'"),
        ]:
            _add_column_if_missing(
                connection,
                dialect=dialect,
                table_name="research_note_page",
                column_name=column_name,
                sqlite_definition=sqlite_definition,
                postgres_definition=postgres_definition,
            )

        if (dialect == "sqlite" and "github_repository_integration" in _sqlite_tables(connection)) or (
            dialect != "sqlite" and _postgres_table_exists(connection, "github_repository_integration")
        ):
            _add_column_if_missing(
                connection,
                dialect=dialect,
                table_name="github_repository_integration",
                column_name="webhook_secret",
                sqlite_definition="webhook_secret VARCHAR(120)",
                postgres_definition="webhook_secret VARCHAR(120)",
            )

        if dialect == "sqlite":
            _ensure_sqlite_project_member_pk(connection)
            connection.exec_driver_sql(
                """
                UPDATE research_note_page
                SET note_id = (
                    SELECT research_note_file.note_id
                    FROM research_note_file
                    WHERE research_note_file.id = research_note_page.file_id
                )
                WHERE note_id IS NULL
                """
            )
            return

        connection.execute(
            text(
                """
                UPDATE research_note_page
                SET note_id = research_note_file.note_id
                FROM research_note_file
                WHERE research_note_file.id = research_note_page.file_id
                  AND research_note_page.note_id IS NULL
                """
            )
        )
