from sqlalchemy import text
from sqlalchemy.engine import Engine


def ensure_schema_extensions(engine: Engine) -> None:
    with engine.begin() as connection:
        if engine.dialect.name == "sqlite":
            table_names = {
                row[0]
                for row in connection.exec_driver_sql("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            }
            if "company_invitation" in table_names:
                connection.exec_driver_sql("DROP TABLE company_invitation")

            cover_columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info('project_note_cover')").fetchall()
            }
            if "template_payload" not in cover_columns:
                connection.exec_driver_sql("ALTER TABLE project_note_cover ADD COLUMN template_payload TEXT")

            user_columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info('useraccount')").fetchall()
            }
            if "signature_data_url" not in user_columns:
                connection.exec_driver_sql("ALTER TABLE useraccount ADD COLUMN signature_data_url TEXT")

            note_columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info('research_note')").fetchall()
            }
            if "written_date" not in note_columns:
                connection.exec_driver_sql("ALTER TABLE research_note ADD COLUMN written_date DATE")
            if "reviewer_member_id" not in note_columns:
                connection.exec_driver_sql("ALTER TABLE research_note ADD COLUMN reviewer_member_id BIGINT")
            if "reviewed_date" not in note_columns:
                connection.exec_driver_sql("ALTER TABLE research_note ADD COLUMN reviewed_date DATE")

            project_columns = {
                row[1]
                for row in connection.exec_driver_sql("PRAGMA table_info('project')").fetchall()
            }
            if "monthly_note_target" not in project_columns:
                connection.exec_driver_sql("ALTER TABLE project ADD COLUMN monthly_note_target INTEGER")

            project_member_columns = connection.exec_driver_sql("PRAGMA table_info('project_member')").fetchall()
            if project_member_columns:
                project_member_id_column = next((row for row in project_member_columns if row[1] == "id"), None)
                if project_member_id_column and str(project_member_id_column[2]).upper() != "INTEGER":
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
                    connection.exec_driver_sql(
                        "CREATE INDEX IF NOT EXISTS ix_project_member_project_id ON project_member (project_id)"
                    )
                    connection.exec_driver_sql(
                        "CREATE INDEX IF NOT EXISTS ix_project_member_company_member_id ON project_member (company_member_id)"
                    )
                    connection.exec_driver_sql("PRAGMA foreign_keys=ON")
            return

        cover_inspector_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'project_note_cover' AND column_name = 'template_payload'"
        )
        invitation_table_sql = text(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_name = 'company_invitation'"
        )
        if connection.execute(invitation_table_sql).first():
            connection.execute(text("DROP TABLE company_invitation"))

        exists = connection.execute(cover_inspector_sql).first()
        if not exists:
            connection.execute(text("ALTER TABLE project_note_cover ADD COLUMN template_payload TEXT"))

        user_inspector_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'useraccount' AND column_name = 'signature_data_url'"
        )
        signature_exists = connection.execute(user_inspector_sql).first()
        if not signature_exists:
            connection.execute(text("ALTER TABLE useraccount ADD COLUMN signature_data_url TEXT"))

        note_written_date_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'research_note' AND column_name = 'written_date'"
        )
        note_reviewer_member_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'research_note' AND column_name = 'reviewer_member_id'"
        )
        note_reviewed_date_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'research_note' AND column_name = 'reviewed_date'"
        )
        if not connection.execute(note_written_date_sql).first():
            connection.execute(text("ALTER TABLE research_note ADD COLUMN written_date DATE"))
        if not connection.execute(note_reviewer_member_sql).first():
            connection.execute(text("ALTER TABLE research_note ADD COLUMN reviewer_member_id BIGINT"))
        if not connection.execute(note_reviewed_date_sql).first():
            connection.execute(text("ALTER TABLE research_note ADD COLUMN reviewed_date DATE"))

        project_monthly_target_sql = text(
            "SELECT column_name FROM information_schema.columns "
            "WHERE table_name = 'project' AND column_name = 'monthly_note_target'"
        )
        if not connection.execute(project_monthly_target_sql).first():
            connection.execute(text("ALTER TABLE project ADD COLUMN monthly_note_target INTEGER"))
