from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _email() -> str:
    return f"r-{uuid4().hex[:10]}@example.com"


def _login(email: str, password: str):
    return client.post("/auth/login", json={"email": email, "password": password})


def _company(headers: dict[str, str]) -> dict:
    response = client.get("/directory/researcher-management", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()


def test_owner_registers_researcher_with_temporary_password() -> None:
    headers, company_id, _ = create_owner_workspace(client)
    email = _email()

    created = client.post(
        "/directory/researcher-management/researchers",
        headers=headers,
        json={"name": "김연구", "email": email.upper()},
    )
    assert created.status_code == 201, created.text
    body = created.json()
    assert body["email"] == email
    temporary = body["temporary_password"]
    assert temporary and len(temporary) >= 12

    login = _login(email, temporary)
    assert login.status_code == 200, login.text
    assert login.json()["user"]["organization_id"] == company_id

    members = _company(headers)["members"]
    assert any(member["email"] == email and member["role"] == "member" for member in members)

    duplicate = client.post(
        "/directory/researcher-management/researchers", headers=headers, json={"name": "중복", "email": email}
    )
    assert duplicate.status_code == 400


def test_owner_sets_password_and_researcher_changes_it() -> None:
    headers, _, _ = create_owner_workspace(client)
    email = _email()
    created = client.post(
        "/directory/researcher-management/researchers",
        headers=headers,
        json={"name": "이연구", "email": email, "password": "Initial123"},
    )
    assert created.status_code == 201, created.text
    assert created.json()["temporary_password"] is None

    too_short = client.post(
        "/directory/researcher-management/researchers",
        headers=headers,
        json={"name": "짧음", "email": _email(), "password": "abc"},
    )
    assert too_short.status_code == 400

    token = _login(email, "Initial123").json()["access_token"]
    researcher = {"Authorization": f"Bearer {token}"}
    wrong = client.put(
        "/auth/me/password", headers=researcher, json={"current_password": "nope", "new_password": "Changed456"}
    )
    assert wrong.status_code == 400
    changed = client.put(
        "/auth/me/password", headers=researcher, json={"current_password": "Initial123", "new_password": "Changed456"}
    )
    assert changed.status_code == 204, changed.text
    assert _login(email, "Initial123").status_code != 200
    assert _login(email, "Changed456").status_code == 200


def test_only_owner_can_register() -> None:
    headers, _, _ = create_owner_workspace(client)
    email = _email()
    created = client.post(
        "/directory/researcher-management/researchers",
        headers=headers,
        json={"name": "박연구", "email": email, "password": "Member1234"},
    )
    assert created.status_code == 201
    member_headers = {"Authorization": f"Bearer {_login(email, 'Member1234').json()['access_token']}"}

    denied = client.post(
        "/directory/researcher-management/researchers",
        headers=member_headers,
        json={"name": "몰래", "email": _email()},
    )
    assert denied.status_code == 403


def test_signup_with_company_code_then_owner_approves() -> None:
    headers, company_id, _ = create_owner_workspace(client)
    company = _company(headers)["company"]
    email = _email()

    signup = client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": "Signup1234",
            "name": "최연구",
            "account_type": "user",
            "organization_code": company["code"],
        },
    )
    assert signup.status_code == 201, signup.text
    assert _login(email, "Signup1234").status_code != 200  # waits for approval

    pending = _company(headers)["pending_requests"]
    request = next(item for item in pending if item["email"] == email)
    assert request["name"] == "최연구"

    approved = client.post(f"/directory/researcher-management/requests/{request['request_id']}/approve", headers=headers)
    assert approved.status_code == 200, approved.text

    login = _login(email, "Signup1234")
    assert login.status_code == 200, login.text
    assert login.json()["user"]["organization_id"] == company_id
    assert all(item["email"] != email for item in _company(headers)["pending_requests"])

    again = client.post(f"/directory/researcher-management/requests/{request['request_id']}/approve", headers=headers)
    assert again.status_code == 404


def test_owner_rejects_request_and_other_company_cannot_touch_it() -> None:
    headers, _, _ = create_owner_workspace(client)
    other_headers, _, _ = create_owner_workspace(client)
    company = _company(headers)["company"]
    email = _email()
    client.post(
        "/auth/signup",
        json={
            "email": email,
            "password": "Signup1234",
            "name": "정연구",
            "account_type": "user",
            "organization_code": company["code"],
        },
    )
    request_id = next(item for item in _company(headers)["pending_requests"] if item["email"] == email)["request_id"]

    foreign = client.post(f"/directory/researcher-management/requests/{request_id}/approve", headers=other_headers)
    assert foreign.status_code == 404

    rejected = client.post(f"/directory/researcher-management/requests/{request_id}/reject", headers=headers)
    assert rejected.status_code == 204
    assert all(item["email"] != email for item in _company(headers)["pending_requests"])
    assert _login(email, "Signup1234").status_code != 200
