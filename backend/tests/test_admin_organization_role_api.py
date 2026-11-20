from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import OWNER_PASSWORD, _admin_headers, create_owner_workspace

client = TestClient(app)


def _member(admin: dict[str, str], company_id: int | None) -> tuple[int, str]:
    email = f"role-{uuid4().hex[:10]}@example.com"
    body = client.post(
        "/admin/users",
        headers=admin,
        json={"name": "역할 테스트", "email": email, "password": "Member1234", "organization_id": company_id},
    ).json()
    return body["user"]["id"], email


def _login_headers(email: str, password: str) -> dict[str, str]:
    token = client.post("/auth/login", json={"email": email, "password": password}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _owner_user_id(headers: dict[str, str]) -> int:
    return client.get("/auth/me", headers=headers).json()["id"]


def test_admin_promotes_member_to_org_admin_and_back() -> None:
    admin = _admin_headers(client)
    owner_headers, company_id, _ = create_owner_workspace(client)
    user_id, email = _member(admin, company_id)

    member = _login_headers(email, "Member1234")
    assert client.get("/note-format", headers=member).json()["can_manage"] is False

    promoted = client.put(f"/admin/users/{user_id}/organization-role", headers=admin, json={"role": "owner"})
    assert promoted.status_code == 200, promoted.text
    assert promoted.json()["is_org_owner"] is True

    member = _login_headers(email, "Member1234")
    assert client.get("/note-format", headers=member).json()["can_manage"] is True
    assert client.get("/directory/researcher-management", headers=member).status_code == 200

    demoted = client.put(f"/admin/users/{user_id}/organization-role", headers=admin, json={"role": "member"})
    assert demoted.status_code == 200 and demoted.json()["is_org_owner"] is False
    member = _login_headers(email, "Member1234")
    assert client.get("/note-format", headers=member).json()["can_manage"] is False

    # The original owner is still there, so the company keeps an admin.
    assert client.get("/directory/researcher-management", headers=owner_headers).status_code == 200


def test_cannot_remove_last_org_admin_or_set_role_without_company() -> None:
    admin = _admin_headers(client)
    owner_headers, _, _ = create_owner_workspace(client)
    owner_id = _owner_user_id(owner_headers)

    last = client.put(f"/admin/users/{owner_id}/organization-role", headers=admin, json={"role": "member"})
    assert last.status_code == 400

    lone_id, _ = _member(admin, None)
    assert client.put(f"/admin/users/{lone_id}/organization-role", headers=admin, json={"role": "owner"}).status_code == 400
    assert client.put(f"/admin/users/{owner_id}/organization-role", headers=admin, json={"role": "boss"}).status_code == 400
    assert client.put("/admin/users/999999/organization-role", headers=admin, json={"role": "owner"}).status_code == 404
    assert client.put(f"/admin/users/{owner_id}/organization-role", headers=owner_headers, json={"role": "owner"}).status_code == 403


def test_editing_an_org_admin_in_the_console_keeps_them_org_admin() -> None:
    admin = _admin_headers(client)
    owner_headers, company_id, _ = create_owner_workspace(client)
    owner_id = _owner_user_id(owner_headers)
    owner_email = client.get("/auth/me", headers=owner_headers).json()["email"]

    # The console sends is_admin=false along with any edit (e.g. toggling active).
    edited = client.put(
        f"/admin/users/{owner_id}",
        headers=admin,
        json={"name": "Owner User", "is_active": True, "is_admin": False, "organization_id": company_id},
    )
    assert edited.status_code == 200
    again = _login_headers(owner_email, OWNER_PASSWORD)
    assert client.get("/directory/researcher-management", headers=again).status_code == 200
