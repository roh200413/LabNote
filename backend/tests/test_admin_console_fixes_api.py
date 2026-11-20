from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import _admin_headers, create_owner_workspace

client = TestClient(app)


def _payload(user: dict, **changes) -> dict:
    body = {"name": user["name"], "is_active": user["is_active"], "is_admin": user["is_admin"], "organization_id": user["organization_id"]}
    body.update(changes)
    return body


def _user(admin: dict[str, str], user_id: int) -> dict:
    return next(u for u in client.get("/admin/users", headers=admin).json() if u["id"] == user_id)


def test_create_organization_generates_code_and_toggle_works() -> None:
    admin = _admin_headers(client)
    name = f"콘솔 기관 {uuid4().hex[:6]}"
    created = client.post("/admin/organizations", headers=admin, json={"name": name})
    assert created.status_code == 201, created.text
    org = created.json()
    assert len(org["code"]) == 9

    # Updating with the existing 9-character code (what the console sends) must work.
    off = client.put(f"/admin/organizations/{org['id']}", headers=admin, json={"is_active": False, "code": org["code"]})
    assert off.status_code == 200, off.text
    assert off.json()["is_active"] is False

    renamed = client.put(f"/admin/organizations/{org['id']}", headers=admin, json={"name": f"{name} 변경"})
    assert renamed.status_code == 200 and renamed.json()["name"] == f"{name} 변경"

    explicit = client.post("/admin/organizations", headers=admin, json={"name": f"{name}-2", "code": "abc123xyz"})
    assert explicit.status_code == 201 and explicit.json()["code"] == "ABC123XYZ"
    assert client.post("/admin/organizations", headers=admin, json={"name": f"{name}-3", "code": "SHORT"}).status_code == 400


def test_assigning_organization_to_user_without_one_adds_membership() -> None:
    admin = _admin_headers(client)
    _, company_id, _ = create_owner_workspace(client)
    email = f"solo-{uuid4().hex[:8]}@example.com"
    created = client.post("/admin/users", headers=admin, json={"name": "개인", "email": email, "password": "Member1234"}).json()["user"]
    assert created["organization_id"] is None

    moved = client.put(f"/admin/users/{created['id']}", headers=admin, json=_payload(created, organization_id=company_id))
    assert moved.status_code == 200, moved.text
    assert moved.json()["organization_id"] == company_id
    assert moved.json()["is_org_owner"] is False


def test_last_owner_cannot_be_moved_and_admin_cannot_lock_self_out() -> None:
    admin = _admin_headers(client)
    owner_headers, _, _ = create_owner_workspace(client)
    _, other_company, _ = create_owner_workspace(client)
    owner_id = client.get("/auth/me", headers=owner_headers).json()["id"]
    owner = _user(admin, owner_id)
    refused = client.put(f"/admin/users/{owner_id}", headers=admin, json=_payload(owner, organization_id=other_company))
    assert refused.status_code == 400
    assert "유일한 관리자" in refused.json()["detail"]

    me = client.get("/auth/me", headers=admin).json()
    me_row = _user(admin, me["id"])
    assert client.put(f"/admin/users/{me['id']}", headers=admin, json=_payload(me_row, is_active=False)).status_code == 400
    assert client.put(f"/admin/users/{me['id']}", headers=admin, json=_payload(me_row, is_admin=False)).status_code == 400
    assert _user(admin, me["id"])["is_admin"] is True


def test_deactivated_organization_is_not_back_in_approval_queue() -> None:
    admin = _admin_headers(client)
    _, company_id, _ = create_owner_workspace(client)  # signed up and approved
    assert client.put(f"/admin/organizations/{company_id}", headers=admin, json={"is_active": False}).status_code == 200

    pending_ids = {o["id"] for o in client.get("/admin/organizations/pending", headers=admin).json()}
    assert company_id not in pending_ids
    row = next(o for o in client.get("/admin/organizations", headers=admin).json() if o["id"] == company_id)
    assert row["approval_status"] == "approved" and row["is_active"] is False

    # A fresh sign-up is pending until reviewed, then rejected stays rejected.
    name = f"반려 기관 {uuid4().hex[:6]}"
    signup = client.post("/auth/signup", json={"email": f"rej-{uuid4().hex[:8]}@example.com", "password": "OwnerPass123!",
                                                "name": "신청자", "account_type": "owner", "organization_name": name})
    assert signup.status_code == 201
    pending = next(o for o in client.get("/admin/organizations/pending", headers=admin).json() if o["name"] == name)
    assert client.post(f"/admin/organizations/{pending['id']}/reject", headers=admin).status_code == 200
    assert pending["id"] not in {o["id"] for o in client.get("/admin/organizations/pending", headers=admin).json()}
    row = next(o for o in client.get("/admin/organizations", headers=admin).json() if o["id"] == pending["id"])
    assert row["approval_status"] == "rejected"
