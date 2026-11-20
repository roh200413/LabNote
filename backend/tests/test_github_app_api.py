"""GitHub App connection: install for an organization, one App webhook, and each user's GitHub login."""

import base64
import hashlib
import hmac
import json
from urllib.parse import parse_qs, urlparse
from uuid import uuid4

import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.core.config import get_settings
from app.core.security import hash_password
from app.domain.github_integrations import use_cases
from app.infrastructure.db.models import (
    CompanyMemberORM,
    GitHubAccountConnectionORM,
    ProjectMemberORM,
    ResearchNoteORM,
    UserAccountORM,
)
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.github import app_auth
from app.infrastructure.github.client import GitHubApiError, GitHubRepository, GitHubViewer, get_github_client
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)
WEBHOOK_SECRET = "app-webhook-secret"
SHA = "c" * 40
KEY = rsa.generate_private_key(public_exponent=65537, key_size=2048)
PEM = KEY.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()


def _verify_app_jwt(token: str) -> dict:
    header, payload, signature = token.split(".")
    pad = lambda v: base64.urlsafe_b64decode(v + "=" * (-len(v) % 4))  # noqa: E731
    KEY.public_key().verify(pad(signature), f"{header}.{payload}".encode(), padding.PKCS1v15(), hashes.SHA256())
    return json.loads(pad(payload))


class FakeGitHubApp:
    def __init__(self) -> None:
        self.minted = 0
        self.installation_id = 0

    def get_app_installation(self, app_jwt, installation_id):
        assert _verify_app_jwt(app_jwt)["iss"] == "4242"
        return {"id": installation_id, "repository_selection": "selected",
                "account": {"login": "lab-org", "type": "Organization", "html_url": "https://github.com/lab-org"}}

    def create_installation_token(self, app_jwt, installation_id):
        _verify_app_jwt(app_jwt)
        self.minted += 1
        return f"ghs_install_{installation_id}", "2099-01-01T00:00:00Z"

    def list_installation_repositories(self, token):
        assert token.startswith("ghs_install_")
        return [GitHubRepository("lab-org/vision", "lab-org", "vision", True, "main", "https://github.com/lab-org/vision", None, None, False)]

    def list_repositories(self, token):
        raise AssertionError("App connections list the installation's repositories")

    def create_webhook(self, token, **kwargs):
        raise AssertionError("App connections need no repository webhook")

    def get_commit(self, token, *, owner, repo, sha):
        assert token.startswith("ghs_install_")
        return {"sha": SHA, "html_url": "https://github.com/lab-org/vision/commit/" + SHA, "author": {"login": "kim-dev"},
                "commit": {"message": "Tune threshold", "author": {"name": "Kim"}}, "files": []}

    def exchange_oauth_code(self, *, client_id, client_secret, code):
        assert (client_id, client_secret) == ("Iv1.client", "client-secret")
        if code == "bad":
            raise GitHubApiError("GitHub 로그인 확인에 실패했습니다.")
        return f"ghu_{code}"

    def get_viewer(self, token):
        login = token.removeprefix("ghu_")
        return GitHubViewer(login=login, name=None, avatar_url=None, profile_url=f"https://github.com/{login}",
                            scopes=None, id=abs(hash(login)) % 10_000_000)


@pytest.fixture()
def github(monkeypatch):
    settings = get_settings()
    for key, value in {
        "github_app_id": "4242", "github_app_slug": "labnote-test", "github_app_private_key": PEM,
        "github_app_webhook_secret": WEBHOOK_SECRET, "github_app_client_id": "Iv1.client",
        "github_app_client_secret": "client-secret",
    }.items():
        monkeypatch.setattr(settings, key, value)
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    fake = FakeGitHubApp()
    app.dependency_overrides[get_github_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_github_client, None)


def _state_from(url: str) -> str:
    return parse_qs(urlparse(url).query)["state"][0]


def _install(headers, installation_id: int) -> dict:
    url = client.get("/github/app/install-url", headers=headers).json()["url"]
    assert url.startswith("https://github.com/apps/labnote-test/installations/new?state=")
    done = client.post("/github/app/installations", headers=headers,
                       json={"installation_id": installation_id, "state": _state_from(url)})
    assert done.status_code == 200, done.text
    return done.json()


def _project(headers, company_id, owner_member_id, mode="every_push"):
    project_id = client.post("/projects", headers=headers, json={
        "company_id": company_id, "name": f"A-{uuid4().hex[:6]}", "code": f"A-{uuid4().hex[:6]}", "description": "d",
        "status": "active", "owner_member_id": owner_member_id}).json()["id"]
    linked = client.post(f"/projects/{project_id}/github/links", headers=headers, json={
        "repo_owner": "lab-org", "repo_name": "vision", "default_branch": "main", "branch_pattern": "main",
        "note_creation_mode": mode})
    assert linked.status_code == 201, linked.text
    return project_id, linked.json()


def _member(company_id: int, project_id: str) -> tuple[dict, int]:
    email = f"app-{uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = UserAccountORM(username=email.split("@")[0], display_name="Kim", email=email,
                              password=hash_password("MemberPass123!"), global_role="user", is_active=True, is_approved=True)
        db.add(user)
        db.flush()
        member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
        db.add(member)
        db.flush()
        db.add(ProjectMemberORM(project_id=project_id, company_member_id=member.id, role="member"))
        db.commit()
        member_id = member.id
    token = client.post("/auth/login", json={"email": email, "password": "MemberPass123!"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, member_id


def _deliver(event: str, payload: dict, secret: str = WEBHOOK_SECRET):
    body = json.dumps(payload).encode()
    return client.post("/github/app/webhook", content=body, headers={
        "Content-Type": "application/json", "X-GitHub-Event": event, "X-GitHub-Delivery": str(uuid4()),
        "X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()})


def _push(installation_id: int, author_login: str | None = None) -> dict:
    head = {"id": SHA, "message": "Tune threshold", "author": {"name": "Kim", "username": author_login}}
    return {"ref": "refs/heads/main", "before": "0" * 40, "after": SHA, "installation": {"id": installation_id},
            "repository": {"full_name": "lab-org/vision", "html_url": "https://github.com/lab-org/vision"},
            "head_commit": head, "commits": [head], "sender": {"login": author_login or "someone"}}


def test_install_app_lists_installation_repositories_without_repo_webhooks(github) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    before = client.get("/github/account", headers=headers).json()
    assert before["connected"] is False and before["app_available"] is True and before["user_login_available"] is True

    installation_id = 9_000_000 + int(uuid4().int % 100_000)
    account = _install(headers, installation_id)
    assert account["connected"] and account["auth_type"] == "app" and account["login"] == "lab-org"
    assert account["scopes"] == "선택한 저장소만"
    assert account["manage_url"] == f"https://github.com/organizations/lab-org/settings/installations/{installation_id}"
    with SessionLocal() as db:
        assert db.get(GitHubAccountConnectionORM, company_id).encrypted_token == ""  # nothing long-lived is stored

    project_id, linked = _project(headers, company_id, owner_member_id)
    assert linked["webhook"] == {"installed": True, "error": None, "mode": "app"}
    repos = client.get(f"/projects/{project_id}/github/repositories", headers=headers).json()
    assert [(r["full_name"], r["linked"]) for r in repos] == [("lab-org/vision", True)]
    state = client.get(f"/projects/{project_id}/github", headers=headers).json()
    assert state["links"][0]["webhook_mode"] == "app" and state["links"][0]["webhook_url"].endswith("/github/app/webhook")
    assert github.minted == 1  # the installation token is cached between calls


def test_install_state_must_match_user_and_organization(github) -> None:
    headers, _, _ = create_owner_workspace(client)
    other_headers, _, _ = create_owner_workspace(client)
    state = _state_from(client.get("/github/app/install-url", headers=headers).json()["url"])
    stolen = client.post("/github/app/installations", headers=other_headers, json={"installation_id": 5, "state": state})
    assert stolen.status_code == 400
    forged = client.post("/github/app/installations", headers=headers, json={"installation_id": 5, "state": state[:-2] + "xx"})
    assert forged.status_code == 400


def test_app_webhook_routes_push_to_linked_project_and_handles_uninstall(github) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    installation_id = 8_000_000 + int(uuid4().int % 100_000)
    _install(headers, installation_id)
    project_id, _ = _project(headers, company_id, owner_member_id)

    assert _deliver("push", _push(installation_id), secret="wrong").status_code == 403
    response = _deliver("push", _push(installation_id))
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "received" and response.json()["events"][0]["note_id"]
    events = client.get(f"/projects/{project_id}/github/events", headers=headers).json()
    assert events[0]["status"] == "processed"

    unknown = _push(installation_id)
    unknown["repository"] = {"full_name": "lab-org/other"}
    assert _deliver("push", unknown).json()["status"] == "ignored"
    assert _deliver("ping", {"zen": "hi"}).json()["status"] == "ignored"

    removed = _deliver("installation", {"action": "deleted", "installation": {"id": installation_id}})
    assert removed.json()["status"] == "uninstalled"
    assert client.get("/github/account", headers=headers).json()["connected"] is False


def test_linked_github_user_becomes_note_author(github) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    installation_id = 7_000_000 + int(uuid4().int % 100_000)
    _install(headers, installation_id)
    project_id, _ = _project(headers, company_id, owner_member_id)
    member_headers, member_id = _member(company_id, project_id)
    login = f"kim-{uuid4().hex[:6]}"

    url = client.get("/github/me/link-url", headers=member_headers).json()["url"]
    assert url.startswith("https://github.com/login/oauth/authorize?client_id=Iv1.client")
    assert client.post("/github/me/link", headers=member_headers, json={"code": "bad", "state": _state_from(url)}).status_code == 502
    linked = client.post("/github/me/link", headers=member_headers, json={"code": login, "state": _state_from(url)})
    assert linked.status_code == 200, linked.text
    assert client.get("/github/account", headers=member_headers).json()["me"]["login"] == login

    # The same GitHub account cannot be claimed by another LabNote user.
    owner_url = client.get("/github/me/link-url", headers=headers).json()["url"]
    taken = client.post("/github/me/link", headers=headers, json={"code": login, "state": _state_from(owner_url)})
    assert taken.status_code == 400 and "이미 다른" in taken.json()["detail"]
    # A state issued to one user does not work for another.
    assert client.post("/github/me/link", headers=headers, json={"code": "x", "state": _state_from(url)}).status_code == 400

    note_id = _deliver("push", _push(installation_id, author_login=login.upper())).json()["events"][0]["note_id"]
    with SessionLocal() as db:
        assert db.get(ResearchNoteORM, note_id).owner_member_id == member_id

    # Unknown committers fall back to the project's default author.
    other = _push(installation_id, author_login="stranger")
    other["after"] = "d" * 40
    note_id = _deliver("push", other).json()["events"][0]["note_id"]
    with SessionLocal() as db:
        assert db.get(ResearchNoteORM, note_id).owner_member_id == owner_member_id

    assert client.delete("/github/me/link", headers=member_headers).status_code == 204
    assert client.get("/github/account", headers=member_headers).json()["me"] == {"linked": False}


def test_state_is_bound_to_its_purpose(github) -> None:
    headers, company_id, _ = create_owner_workspace(client)
    with SessionLocal() as db:
        assert db.scalar(select(GitHubAccountConnectionORM).where(GitHubAccountConnectionORM.company_id == company_id)) is None
    assert app_auth.verify_state(app_auth.sign_state("install", c=1, u=2), "install")["c"] == 1
    with pytest.raises(app_auth.InvalidStateError):
        app_auth.verify_state(app_auth.sign_state("install", c=1, u=2), "user_link")
