"""Minimal GitHub REST client: who owns a token, which repositories it can see, adding a webhook,
and reading the code changes of a push or pull request.

Injected through ``get_github_client`` so tests can replace it with a fake.
"""

from dataclasses import dataclass

import httpx

from app.core.config import get_settings


class GitHubApiError(Exception):
    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


@dataclass
class GitHubViewer:
    login: str
    name: str | None
    avatar_url: str | None
    profile_url: str | None
    scopes: str | None
    id: int | None = None


@dataclass
class GitHubRepository:
    full_name: str
    owner: str
    name: str
    private: bool
    default_branch: str
    html_url: str
    description: str | None
    updated_at: str | None
    can_admin: bool


def _error_message(status_code: int) -> str:
    return {
        401: "GitHub 토큰이 올바르지 않거나 만료되었습니다.",
        403: "GitHub 토큰 권한이 부족하거나 요청 한도에 도달했습니다.",
        404: "GitHub 저장소를 찾을 수 없거나 접근 권한이 없습니다.",
        422: "GitHub가 요청을 거부했습니다. 이미 같은 웹훅이 있는지 확인하세요.",
    }.get(status_code, f"GitHub API 요청에 실패했습니다 (HTTP {status_code}).")


def _to_repository(item: dict) -> GitHubRepository:
    owner = (item.get("owner") or {}).get("login") or item["full_name"].split("/")[0]
    return GitHubRepository(
        full_name=item["full_name"],
        owner=owner,
        name=item["name"],
        private=bool(item.get("private")),
        default_branch=item.get("default_branch") or "main",
        html_url=item.get("html_url") or f"https://github.com/{item['full_name']}",
        description=item.get("description"),
        updated_at=item.get("updated_at"),
        can_admin=bool((item.get("permissions") or {}).get("admin")),
    )


class GitHubClient:
    def __init__(self, base_url: str | None = None, timeout: float | None = None) -> None:
        settings = get_settings()
        self.base_url = (base_url or settings.github_api_base_url).rstrip("/")
        self.timeout = timeout or settings.github_timeout_seconds

    def _request(self, method: str, path: str, token: str, **kwargs) -> httpx.Response:
        headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "LabNote",
        }
        try:
            response = httpx.request(method, f"{self.base_url}{path}", headers=headers, timeout=self.timeout, **kwargs)
        except httpx.HTTPError as exc:
            raise GitHubApiError("GitHub에 연결할 수 없습니다. 네트워크 상태를 확인하세요.") from exc
        if response.status_code >= 400:
            # Never echo GitHub's body back: it can contain request details.
            raise GitHubApiError(_error_message(response.status_code), response.status_code)
        return response

    def get_viewer(self, token: str) -> GitHubViewer:
        response = self._request("GET", "/user", token)
        body = response.json()
        return GitHubViewer(
            login=body["login"],
            name=body.get("name"),
            avatar_url=body.get("avatar_url"),
            profile_url=body.get("html_url"),
            scopes=response.headers.get("X-OAuth-Scopes"),
            id=body.get("id"),
        )

    def list_repositories(self, token: str, *, max_pages: int = 5) -> list[GitHubRepository]:
        repositories: list[GitHubRepository] = []
        for page in range(1, max_pages + 1):
            response = self._request(
                "GET",
                "/user/repos",
                token,
                params={
                    "per_page": 100,
                    "page": page,
                    "sort": "updated",
                    "affiliation": "owner,collaborator,organization_member",
                },
            )
            items = response.json()
            repositories.extend(_to_repository(item) for item in items)
            if len(items) < 100:
                break
        return repositories

    # ── GitHub App ─────────────────────────────────────────────────────────

    def get_app_installation(self, app_jwt: str, installation_id: int) -> dict:
        return self._request("GET", f"/app/installations/{installation_id}", app_jwt).json()

    def create_installation_token(self, app_jwt: str, installation_id: int) -> tuple[str, str | None]:
        """A short-lived (1 hour) token for one installation: (token, expires_at ISO text)."""
        body = self._request("POST", f"/app/installations/{installation_id}/access_tokens", app_jwt).json()
        return body["token"], body.get("expires_at")

    def list_installation_repositories(self, token: str, *, max_pages: int = 5) -> list[GitHubRepository]:
        repositories: list[GitHubRepository] = []
        for page in range(1, max_pages + 1):
            body = self._request("GET", "/installation/repositories", token, params={"per_page": 100, "page": page}).json()
            items = body.get("repositories") or []
            repositories.extend(_to_repository(item) for item in items)
            if len(items) < 100:
                break
        return repositories

    def exchange_oauth_code(self, *, client_id: str, client_secret: str, code: str) -> str:
        """Trades a sign-in code for a user token (used once to learn who the user is on GitHub)."""
        web_base = get_settings().github_web_base_url.rstrip("/")
        try:
            response = httpx.post(
                f"{web_base}/login/oauth/access_token",
                data={"client_id": client_id, "client_secret": client_secret, "code": code},
                headers={"Accept": "application/json", "User-Agent": "LabNote"},
                timeout=self.timeout,
            )
        except httpx.HTTPError as exc:
            raise GitHubApiError("GitHub에 연결할 수 없습니다. 네트워크 상태를 확인하세요.") from exc
        body = response.json() if response.status_code < 500 else {}
        token = body.get("access_token") if isinstance(body, dict) else None
        if response.status_code >= 400 or not token:
            raise GitHubApiError("GitHub 로그인 확인에 실패했습니다. 다시 시도하세요.", response.status_code)
        return token

    def create_webhook(self, token: str, *, owner: str, repo: str, url: str, secret: str) -> None:
        self._request(
            "POST",
            f"/repos/{owner}/{repo}/hooks",
            token,
            json={
                "name": "web",
                "active": True,
                "events": ["push", "pull_request"],
                "config": {"url": url, "content_type": "json", "secret": secret, "insecure_ssl": "0"},
            },
        )


    # ── Reading code changes (used to explain a push or PR in a research note) ──────────

    def list_commits(self, token: str, *, owner: str, repo: str, branch: str, limit: int = 10) -> list[dict]:
        response = self._request(
            "GET", f"/repos/{owner}/{repo}/commits", token, params={"sha": branch, "per_page": max(1, min(limit, 100))}
        )
        return list(response.json())

    def get_commit(self, token: str, *, owner: str, repo: str, sha: str) -> dict:
        """One commit with its changed files (``files[].patch`` is the unified diff, when GitHub has one)."""
        return self._request("GET", f"/repos/{owner}/{repo}/commits/{sha}", token).json()

    def compare_commits(self, token: str, *, owner: str, repo: str, base: str, head: str) -> dict:
        """Commits and changed files between two refs (GitHub caps this at 300 files)."""
        return self._request("GET", f"/repos/{owner}/{repo}/compare/{base}...{head}", token).json()

    def list_pull_files(self, token: str, *, owner: str, repo: str, number: int, max_pages: int = 3) -> list[dict]:
        files: list[dict] = []
        for page in range(1, max_pages + 1):
            items = self._request(
                "GET", f"/repos/{owner}/{repo}/pulls/{number}/files", token, params={"per_page": 100, "page": page}
            ).json()
            files.extend(items)
            if len(items) < 100:
                break
        return files

    def list_pull_commits(self, token: str, *, owner: str, repo: str, number: int) -> list[dict]:
        return list(self._request("GET", f"/repos/{owner}/{repo}/pulls/{number}/commits", token, params={"per_page": 100}).json())


def get_github_client() -> GitHubClient:
    return GitHubClient()
