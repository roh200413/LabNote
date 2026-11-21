from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.infrastructure.db.models import ProjectDataFileORM
from app.infrastructure.db.session import SessionLocal
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def test_project_data_is_not_publicly_served_but_downloadable_when_logged_in() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project = client.post(
        "/projects", headers=headers,
        json={"company_id": company_id, "name": "비공개", "code": f"P-{uuid4().hex[:6]}", "owner_member_id": owner_member_id},
    ).json()
    uploaded = client.post(
        f"/projects/{project['id']}/data", headers=headers, files=[("files", ("secret.txt", b"top secret", "text/plain"))]
    ).json()["files"][0]
    with SessionLocal() as db:
        storage_key = db.get(ProjectDataFileORM, uploaded["id"]).storage_key

    assert client.get(f"/storage/{storage_key}").status_code == 404  # no login needed otherwise
    assert client.get(f"/data-files/{uploaded['id']}/download").status_code in {401, 403}
    assert client.get(f"/data-files/{uploaded['id']}/download", headers=headers).content == b"top secret"


def test_autoflow_key_is_enforced_when_configured(monkeypatch, tmp_path) -> None:
    from app.presentation.routers import autoflow_attachment

    monkeypatch.setattr(autoflow_attachment, "WORKSPACE_STATE_DIR", tmp_path)  # keep test output out of the repo
    body = {"projectSlug": "demo", "sourceDocuments": []}
    monkeypatch.setattr(get_settings(), "autoflow_api_key", "k-123")
    assert client.post("/api/autoflow/executions", json=body).status_code == 401
    assert client.post("/api/autoflow/executions", json=body, headers={"X-AutoFlow-Key": "wrong"}).status_code == 401
    ok = client.post("/api/autoflow/executions", json=body, headers={"X-AutoFlow-Key": "k-123"})
    assert ok.status_code == 200
    too_big = {"projectSlug": "demo", "sourceDocuments": [{"relative_path": "a.md", "content": "x" * 300_000}]}
    assert client.post("/api/autoflow/executions", json=too_big, headers={"X-AutoFlow-Key": "k-123"}).status_code == 422


def test_password_hash_format_and_legacy_upgrade_on_login() -> None:
    import base64
    import hashlib

    from app.core.security import hash_password, password_needs_rehash, verify_password

    new_hash = hash_password("S3cret-pass")
    assert new_hash.startswith("pbkdf2_sha256$") and verify_password("S3cret-pass", new_hash)
    assert not verify_password("wrong", new_hash) and not password_needs_rehash(new_hash)

    salt = b"0123456789abcdef"
    legacy = f"{base64.b64encode(salt).decode()}${base64.b64encode(hashlib.pbkdf2_hmac('sha256', b'old-pass', salt, 100000)).decode()}"
    assert verify_password("old-pass", legacy) and password_needs_rehash(legacy)

    from app.infrastructure.db.models import UserAccountORM

    headers, _, _ = create_owner_workspace(client)
    me = client.get("/auth/me", headers=headers).json()
    with SessionLocal() as db:
        user = db.get(UserAccountORM, me["id"])
        user.password = legacy.replace(legacy, f"{base64.b64encode(salt).decode()}${base64.b64encode(hashlib.pbkdf2_hmac('sha256', b'OwnerPass123!', salt, 100000)).decode()}")
        db.commit()
    assert client.post("/auth/login", json={"email": me["email"], "password": "OwnerPass123!"}).status_code == 200
    with SessionLocal() as db:
        assert db.get(UserAccountORM, me["id"]).password.startswith("pbkdf2_sha256$")
    assert client.post("/auth/login", json={"email": me["email"], "password": "OwnerPass123!"}).status_code == 200
