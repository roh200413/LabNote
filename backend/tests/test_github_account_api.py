from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.infrastructure.db.models import CompanyMemberORM, GitHubAccountConnectionORM, ProjectMemberORM, UserAccountORM
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.github.client import GitHubApiError, GitHubRepository, GitHubViewer, get_github_client
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)
GOOD_TOKEN = "ghp_test_token"


class FakeGitHub:
    def __init__(self) -> None:
        self.webhooks: list[dict] = []
        self.fail_webhook = False

    def get_viewer(self, token: str) -> GitHubViewer:
        if token != GOOD_TOKEN:
            raise GitHubApiError("GitHub 토큰이 올바르지 않거나 만료되었습니다.", 401)
        return GitHubViewer(login="lab-bot", name="Lab Bot", avatar_url=None, profile_url="https://github.com/lab-bot", scopes="repo")

    def list_repositories(self, token: str) -> list[GitHubRepository]:
        assert token == GOOD_TOKEN
        return [
            GitHubRepository("lab/pcr-analysis", "lab", "pcr-analysis", True, "main", "https://github.com/lab/pcr-analysis", "PCR 분석 코드", None, True),
            GitHubRepository("lab/website", "lab", "website", False, "develop", "https://github.com/lab/website", None, None, False),
        ]

    def create_webhook(self, token: str, *, owner: str, repo: str, url: str, secret: str) -> None:
        if self.fail_webhook:
            raise GitHubApiError("GitHub 토큰 권한이 부족하거나 요청 한도에 도달했습니다.", 403)
        self.webhooks.append({"owner": owner, "repo": repo, "url": url, "secret": secret})


def _project(headers: dict[str, str], company_id: int, owner_member_id: int) -> str:
    response = client.post(
        "/projects",
        headers=headers,
        json={
            "company_id": company_id,
            "name": f"GH-{uuid4().hex[:6]}",
            "code": f"GH-{uuid4().hex[:6]}",
            "description": "d",
            "status": "active",
            "owner_member_id": owner_member_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _member(company_id: int, project_id: str | None = None) -> dict[str, str]:
    email = f"gh-{uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = UserAccountORM(
            username=email.split("@")[0], display_name="Member", email=email,
            password=hash_password("MemberPass123!"), global_role="user", is_active=True, is_approved=True,
        )
        db.add(user)
        db.flush()
        member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
        db.add(member)
        db.flush()
        if project_id:
            db.add(ProjectMemberORM(project_id=project_id, company_member_id=member.id, role="member"))
        db.commit()
    token = client.post("/auth/login", json={"email": email, "password": "MemberPass123!"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _with_fake() -> FakeGitHub:
    fake = FakeGitHub()
    app.dependency_overrides[get_github_client] = lambda: fake
    return fake


def test_owner_connects_account_and_token_is_encrypted() -> None:
    _with_fake()
    try:
        headers, company_id, _ = create_owner_workspace(client)
        assert client.get("/github/account", headers=headers).json()["connected"] is False

        bad = client.put("/github/account", headers=headers, json={"token": "wrong"})
        assert bad.status_code == 502

        good = client.put("/github/account", headers=headers, json={"token": GOOD_TOKEN})
        assert good.status_code == 200, good.text
        assert good.json()["login"] == "lab-bot" and good.json()["can_manage"] is True
        assert GOOD_TOKEN not in str(good.json()) and "encrypted_token" not in good.json()
        with SessionLocal() as db:
            row = db.get(GitHubAccountConnectionORM, company_id)
            assert row is not None and GOOD_TOKEN not in row.encrypted_token

        member_headers = _member(company_id)
        assert client.get("/github/account", headers=member_headers).json()["can_manage"] is False
        assert client.put("/github/account", headers=member_headers, json={"token": GOOD_TOKEN}).status_code == 403

        assert client.delete("/github/account", headers=headers).status_code == 204
        assert client.get("/github/account", headers=headers).json()["connected"] is False
    finally:
        app.dependency_overrides.pop(get_github_client, None)


def test_project_links_repository_and_installs_webhook() -> None:
    fake = _with_fake()
    try:
        headers, company_id, owner_member_id = create_owner_workspace(client)
        project_id = _project(headers, company_id, owner_member_id)

        not_connected = client.get(f"/projects/{project_id}/github/repositories", headers=headers)
        assert not_connected.status_code == 409

        client.put("/github/account", headers=headers, json={"token": GOOD_TOKEN})
        repos = client.get(f"/projects/{project_id}/github/repositories", headers=headers, params={"q": "pcr"}).json()
        assert [repo["full_name"] for repo in repos] == ["lab/pcr-analysis"]
        assert repos[0]["linked"] is False

        linked = client.post(
            f"/projects/{project_id}/github/links",
            headers=headers,
            json={"repo_owner": "lab", "repo_name": "pcr-analysis", "default_branch": "main", "note_creation_mode": "every_push"},
        )
        assert linked.status_code == 201, linked.text
        assert linked.json()["webhook"]["installed"] is True
        assert fake.webhooks[0]["url"].endswith(f"/github-integrations/{linked.json()['integration_id']}/webhook")
        assert fake.webhooks[0]["secret"]

        duplicate = client.post(
            f"/projects/{project_id}/github/links", headers=headers, json={"repo_owner": "lab", "repo_name": "pcr-analysis"}
        )
        assert duplicate.status_code == 400

        state = client.get(f"/projects/{project_id}/github", headers=headers).json()
        assert state["account"]["login"] == "lab-bot"
        assert [link["repo_full_name"] for link in state["links"]] == ["lab/pcr-analysis"]
        assert state["links"][0]["note_creation_mode"] == "every_push"
        assert client.get(f"/projects/{project_id}/github/repositories", headers=headers).json()[0]["linked"] is True

        overview = client.get("/github/account", headers=headers).json()["linked_repositories"]
        assert [(item["project_id"], item["repo_full_name"]) for item in overview] == [(project_id, "lab/pcr-analysis")]

        mapping_id = state["links"][0]["mapping_id"]
        updated = client.put(
            f"/projects/{project_id}/github/links/{mapping_id}",
            headers=headers,
            json={"branch_pattern": "release/*", "note_creation_mode": "manual"},
        )
        assert updated.status_code == 200
        link = client.get(f"/projects/{project_id}/github", headers=headers).json()["links"][0]
        assert (link["branch_pattern"], link["note_creation_mode"]) == ("release/*", "manual")

        assert client.delete(f"/projects/{project_id}/github/links/{mapping_id}", headers=headers).status_code == 204
        assert client.get(f"/projects/{project_id}/github", headers=headers).json()["links"] == []
    finally:
        app.dependency_overrides.pop(get_github_client, None)


def test_webhook_failure_keeps_link_and_manual_secret_is_available() -> None:
    fake = _with_fake()
    fake.fail_webhook = True
    try:
        headers, company_id, owner_member_id = create_owner_workspace(client)
        project_id = _project(headers, company_id, owner_member_id)
        client.put("/github/account", headers=headers, json={"token": GOOD_TOKEN})
        linked = client.post(
            f"/projects/{project_id}/github/links", headers=headers, json={"repo_owner": "lab", "repo_name": "website"}
        ).json()
        assert linked["webhook"]["installed"] is False and linked["webhook"]["error"]

        secret = client.post(
            f"/projects/{project_id}/github/links/{linked['mapping_id']}/webhook-secret", headers=headers
        )
        assert secret.status_code == 200 and len(secret.json()["webhook_secret"]) > 20
    finally:
        app.dependency_overrides.pop(get_github_client, None)


def test_project_member_can_view_but_not_link() -> None:
    _with_fake()
    try:
        headers, company_id, owner_member_id = create_owner_workspace(client)
        project_id = _project(headers, company_id, owner_member_id)
        client.put("/github/account", headers=headers, json={"token": GOOD_TOKEN})
        member_headers = _member(company_id, project_id)
        outsider_headers = _member(company_id)

        view = client.get(f"/projects/{project_id}/github", headers=member_headers)
        assert view.status_code == 200 and view.json()["can_manage"] is False
        assert client.get(f"/projects/{project_id}/github/repositories", headers=member_headers).status_code == 403
        assert client.post(
            f"/projects/{project_id}/github/links", headers=member_headers, json={"repo_owner": "lab", "repo_name": "website"}
        ).status_code == 403
        assert client.get(f"/projects/{project_id}/github", headers=outsider_headers).status_code == 403

        other_headers, _, _ = create_owner_workspace(client)
        assert client.get(f"/projects/{project_id}/github", headers=other_headers).status_code == 403
    finally:
        app.dependency_overrides.pop(get_github_client, None)
