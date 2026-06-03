from uuid import uuid4
from pathlib import Path

from fastapi.testclient import TestClient

from app.core.system_admin_registry import SystemAdminRegistry
from app.domain.accounts.use_cases import ensure_system_admin_users
from app.infrastructure.db.bootstrap import ensure_schema_extensions
from app.infrastructure.db.models import Base
from app.infrastructure.db.session import SessionLocal, engine


OWNER_PASSWORD = "OwnerPass123!"
SYSTEM_ADMIN_EMAIL = "admin@labnote.com"
SYSTEM_ADMIN_PASSWORD = "admin1234"
_DATABASE_READY = False


def ensure_test_database() -> None:
    global _DATABASE_READY
    if _DATABASE_READY:
        return

    Base.metadata.create_all(bind=engine)
    ensure_schema_extensions(engine)
    registry = SystemAdminRegistry(Path("app/core/system_admins.json"))
    with SessionLocal() as db:
        ensure_system_admin_users(db, registry.load())
    _DATABASE_READY = True


def _admin_headers(client: TestClient) -> dict[str, str]:
    ensure_test_database()
    response = client.post(
        "/auth/login",
        json={"email": SYSTEM_ADMIN_EMAIL, "password": SYSTEM_ADMIN_PASSWORD},
    )
    assert response.status_code == 200
    token = response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def create_owner_workspace(client: TestClient) -> tuple[dict[str, str], int, int]:
    ensure_test_database()
    unique = uuid4().hex
    organization_name = f"Test Org {unique}"
    owner_email = f"owner-{unique}@example.com"

    signup_response = client.post(
        "/auth/signup",
        json={
            "email": owner_email,
            "password": OWNER_PASSWORD,
            "name": "Owner User",
            "account_type": "owner",
            "organization_name": organization_name,
        },
    )
    assert signup_response.status_code == 201

    admin_headers = _admin_headers(client)
    pending_response = client.get("/admin/organizations/pending", headers=admin_headers)
    assert pending_response.status_code == 200
    organization = next(item for item in pending_response.json() if item["name"] == organization_name)
    approve_response = client.post(f"/admin/organizations/{organization['id']}/approve", headers=admin_headers)
    assert approve_response.status_code == 200

    login_response = client.post(
        "/auth/login",
        json={"email": owner_email, "password": OWNER_PASSWORD},
    )
    assert login_response.status_code == 200
    token = login_response.json()["access_token"]
    owner_headers = {"Authorization": f"Bearer {token}"}
    company_id = login_response.json()["user"]["organization_id"]
    assert company_id is not None

    members_response = client.get("/directory/company-members", headers=owner_headers)
    assert members_response.status_code == 200
    owner_member = next(item for item in members_response.json() if item["role"] == "owner")
    return owner_headers, company_id, owner_member["company_member_id"]
