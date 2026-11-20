from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import _admin_headers, create_owner_workspace

client = TestClient(app)


def _email() -> str:
    return f"u-{uuid4().hex[:10]}@example.com"


def _login(email: str, password: str):
    return client.post("/auth/login", json={"email": email, "password": password})


def test_admin_creates_member_and_owner_accounts() -> None:
    admin = _admin_headers(client)
    _, company_id, _ = create_owner_workspace(client)

    email = _email()
    created = client.post(
        "/admin/users", headers=admin, json={"name": "새 연구원", "email": email, "organization_id": company_id}
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["user"]["organization_id"] == company_id and body["user"]["is_org_owner"] is False
    login = _login(email, body["temporary_password"])
    assert login.status_code == 200 and login.json()["user"]["organization_id"] == company_id

    owner_email = _email()
    owner = client.post(
        "/admin/users",
        headers=admin,
        json={"name": "관리자2", "email": owner_email, "password": "Owner12345", "organization_id": company_id, "role": "owner"},
    )
    assert owner.status_code == 201, owner.text
    assert owner.json()["temporary_password"] is None
    assert owner.json()["user"]["is_org_owner"] is True
    owner_headers = {"Authorization": f"Bearer {_login(owner_email, 'Owner12345').json()['access_token']}"}
    assert client.get("/directory/researcher-management", headers=owner_headers).status_code == 200

    standalone = client.post("/admin/users", headers=admin, json={"name": "개인", "email": _email()})
    assert standalone.status_code == 201 and standalone.json()["user"]["organization_id"] is None

    assert client.post("/admin/users", headers=admin, json={"name": "중복", "email": email}).status_code == 409
    assert client.post("/admin/users", headers=admin, json={"name": "x", "email": _email(), "role": "owner"}).status_code == 400
    assert client.post("/admin/users", headers=admin, json={"name": "x", "email": "not-an-email"}).status_code == 400

    member_headers = {"Authorization": f"Bearer {login.json()['access_token']}"}
    assert client.post("/admin/users", headers=member_headers, json={"name": "x", "email": _email()}).status_code == 403


def test_user_sends_feedback_and_admin_answers() -> None:
    headers, _, _ = create_owner_workspace(client)
    admin = _admin_headers(client)

    bad = client.post("/feedback", headers=headers, json={"category": "spam", "title": "t", "content": "c"})
    assert bad.status_code == 400

    sent = client.post(
        "/feedback",
        headers=headers,
        json={"category": "bug", "title": "PDF 서명이 잘려요", "content": "내보낸 PDF에서 서명이 칸 밖으로 나갑니다.", "page": "연구노트"},
    )
    assert sent.status_code == 201, sent.text
    feedback_id = sent.json()["id"]
    mine = client.get("/feedback/mine", headers=headers).json()
    assert [item["id"] for item in mine] == [feedback_id] and mine[0]["status"] == "open"

    listing = client.get("/admin/feedback", headers=admin, params={"status": "open"}).json()
    item = next(entry for entry in listing["items"] if entry["id"] == feedback_id)
    assert item["user_email"] and item["company_name"] and listing["open_count"] >= 1

    answered = client.put(
        f"/admin/feedback/{feedback_id}",
        headers=admin,
        json={"status": "resolved", "admin_reply": "수정했습니다. 서명을 다시 올려 주세요."},
    )
    assert answered.status_code == 200, answered.text
    mine = client.get("/feedback/mine", headers=headers).json()[0]
    assert mine["status"] == "resolved" and mine["admin_reply"].startswith("수정했습니다") and mine["replied_at"]

    assert client.get("/admin/feedback", headers=headers).status_code == 403
    assert client.put(f"/admin/feedback/{feedback_id}", headers=headers, json={"status": "closed"}).status_code == 403
    assert client.put(f"/admin/feedback/{feedback_id}", headers=admin, json={"status": "weird"}).status_code == 400
    assert client.put("/admin/feedback/999999", headers=admin, json={"status": "closed"}).status_code == 404

    other_headers, _, _ = create_owner_workspace(client)
    assert client.get("/feedback/mine", headers=other_headers).json() == []
