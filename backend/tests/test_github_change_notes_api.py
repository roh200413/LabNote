"""GitHub notes that explain the code change with the organization's LLM."""

import hashlib
import hmac
import json
import time
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.domain.github_integrations import use_cases
from app.domain.research_notes.note_generation import NoteGenerationFailedError
from app.infrastructure.github.client import GitHubRepository, GitHubViewer, get_github_client
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)
TOKEN = "ghp_change_notes"
SHA_OLD = "a" * 40
SHA_NEW = "b" * 40

PATCH = "@@ -1,3 +1,5 @@\n def threshold(values):\n-    return 0.5\n+    cutoff = otsu(values)\n+    return cutoff\n"


class FakeGitHub:
    def get_viewer(self, token):
        return GitHubViewer(login="lab-bot", name=None, avatar_url=None, profile_url=None, scopes="repo")

    def list_repositories(self, token):
        return [GitHubRepository("lab/vision", "lab", "vision", True, "main", "https://github.com/lab/vision", None, None, True)]

    def create_webhook(self, token, **kwargs):
        return None

    def list_commits(self, token, *, owner, repo, branch, limit=10):
        assert (owner, repo, branch) == ("lab", "vision", "main")
        return [
            {"sha": SHA_NEW, "html_url": "https://github.com/lab/vision/commit/" + SHA_NEW,
             "commit": {"message": "Use Otsu threshold\n\nbody", "author": {"name": "Kim", "date": "2026-11-19T10:00:00Z"}}},
            {"sha": SHA_OLD, "html_url": "https://github.com/lab/vision/commit/" + SHA_OLD,
             "commit": {"message": "Initial", "author": {"name": "Kim", "date": "2026-11-18T10:00:00Z"}}},
        ]

    def _files(self):
        return [
            {"filename": "vision/threshold.py", "status": "modified", "additions": 2, "deletions": 1, "patch": PATCH},
            {"filename": "package-lock.json", "status": "modified", "additions": 900, "deletions": 850, "patch": "@@ lock noise @@"},
        ]

    def get_commit(self, token, *, owner, repo, sha):
        assert token == TOKEN
        return {"sha": SHA_NEW, "html_url": "https://github.com/lab/vision/commit/" + SHA_NEW,
                "commit": {"message": "Use Otsu threshold", "author": {"name": "Kim"}}, "files": self._files()}

    def compare_commits(self, token, *, owner, repo, base, head):
        assert (base, head) == (SHA_OLD, SHA_NEW)
        return {"commits": [{"sha": SHA_NEW, "commit": {"message": "Use Otsu threshold", "author": {"name": "Kim"}}}],
                "files": self._files()}


class FakeGenerator:
    model = "fake-llm"

    def __init__(self, calls: list, fail: bool = False) -> None:
        self.calls = calls
        self.fail = fail

    def complete_json(self, system, messages):
        self.calls.append((system, messages))
        if self.fail:
            raise NoteGenerationFailedError("LLM 요청 한도에 도달했습니다.")
        return {"sections": [
            {"heading": "연구 목적", "body": "- 고정 임계값 0.5를 데이터 기반 값으로 바꾸기 위함"},
            {"heading": "수행 내용", "body": "- vision/threshold.py의 threshold()가 otsu(values) 결과를 반환하도록 변경함"},
        ]}, self.model

    def close(self):
        pass


@pytest.fixture()
def github():
    fake = FakeGitHub()
    app.dependency_overrides[get_github_client] = lambda: fake
    yield fake
    app.dependency_overrides.pop(get_github_client, None)


def _linked_project(mode: str = "manual"):
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = client.post("/projects", headers=headers, json={
        "company_id": company_id, "name": f"V-{uuid4().hex[:6]}", "code": f"V-{uuid4().hex[:6]}", "description": "d",
        "status": "active", "owner_member_id": owner_member_id}).json()["id"]
    assert client.put("/github/account", headers=headers, json={"token": TOKEN}).status_code == 200
    linked = client.post(f"/projects/{project_id}/github/links", headers=headers, json={
        "repo_owner": "lab", "repo_name": "vision", "default_branch": "main", "branch_pattern": "main", "note_creation_mode": mode})
    assert linked.status_code == 201, linked.text
    return headers, project_id, linked.json()["mapping_id"], linked.json()["integration_id"]


def test_commit_note_explains_diff_with_llm(github, monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: FakeGenerator(calls))
    headers, project_id, mapping_id, _ = _linked_project()

    listed = client.get(f"/projects/{project_id}/github/links/{mapping_id}/commits", headers=headers).json()
    assert listed["branch"] == "main" and listed["ai_enabled"] is True
    assert [(c["short_sha"], c["message"], c["note_id"]) for c in listed["commits"]][0] == (SHA_NEW[:7], "Use Otsu threshold", None)

    created = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers)
    assert created.status_code == 200, created.text
    note = client.get(f"/research-notes/{created.json()['note_id']}", headers=headers).json()
    assert note["title"] == f"[GitHub] 커밋 {SHA_NEW[:7]}: Use Otsu threshold"
    assert "otsu(values)" in note["content"]
    assert "■ 변경 파일 (2개" in note["content"] and "vision/threshold.py [수정] +2/-1" in note["content"]

    # The model got the real diff and the note-format sections, but not the lock-file noise.
    system, messages = calls[0]
    prompt = messages[0]["content"]
    assert "+    cutoff = otsu(values)" in prompt
    assert "lock noise" not in prompt and "package-lock.json" in prompt
    assert "연구 목적" in system

    # Picking the same commit again reuses the note.
    again = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()
    assert again == {**created.json(), "created": False}
    assert client.get(f"/projects/{project_id}/github/links/{mapping_id}/commits", headers=headers).json()["commits"][0]["note_id"]


def test_without_llm_the_note_keeps_the_commit_summary(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    headers, project_id, mapping_id, _ = _linked_project()
    assert client.get(f"/projects/{project_id}/github/links/{mapping_id}/commits", headers=headers).json()["ai_enabled"] is False
    created = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()
    content = client.get(f"/research-notes/{created['note_id']}", headers=headers).json()["content"]
    assert "AI(LLM) 연결이 없어" in content and "Use Otsu threshold" in content


def test_llm_failure_still_creates_note_with_reason(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: FakeGenerator([], fail=True))
    headers, project_id, mapping_id, _ = _linked_project()
    created = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()
    content = client.get(f"/research-notes/{created['note_id']}", headers=headers).json()["content"]
    assert "AI 설명 실패" in content


def test_push_webhook_is_explained_in_background(github, monkeypatch) -> None:
    calls: list = []
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: FakeGenerator(calls))
    headers, project_id, _, integration_id = _linked_project(mode="every_push")
    secret = client.post(f"/github-integrations/{integration_id}/webhook-secret", headers=headers).json()["webhook_secret"]
    payload = {
        "ref": "refs/heads/main", "before": SHA_OLD, "after": SHA_NEW,
        "repository": {"full_name": "lab/vision", "html_url": "https://github.com/lab/vision"},
        "head_commit": {"id": SHA_NEW, "message": "Use Otsu threshold"},
        "commits": [{"id": SHA_NEW, "message": "Use Otsu threshold"}],
    }
    body = json.dumps(payload).encode()
    response = client.post(f"/github-integrations/{integration_id}/webhook", content=body, headers={
        "Content-Type": "application/json", "X-GitHub-Event": "push", "X-GitHub-Delivery": str(uuid4()),
        "X-Hub-Signature-256": "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "processing" and response.json()["note_id"] is None

    for _ in range(50):
        events = client.get(f"/projects/{project_id}/github/events", headers=headers).json()
        if events[0]["status"] != "processing":
            break
        time.sleep(0.1)
    assert events[0]["status"] == "processed", events[0]
    content = client.get(f"/research-notes/{events[0]['generated_note_id']}", headers=headers).json()["content"]
    assert "otsu(values)" in content
    assert "+    cutoff = otsu(values)" in calls[0][1][0]["content"]  # compare(before...after) diff was used


def test_ai_written_note_must_be_reviewed_before_submit(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: FakeGenerator([]))
    headers, project_id, mapping_id, _ = _linked_project()
    note_id = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()["note_id"]

    review = client.get(f"/research-notes/{note_id}/ai-review", headers=headers).json()
    assert review["required"] is True and review["reviewed"] is False and review["model"] == "fake-llm"

    blocked = client.post(f"/research-notes/{note_id}/submit", headers=headers, json={})
    assert blocked.status_code == 409 and "검토 완료" in blocked.json()["detail"]

    confirmed = client.post(f"/research-notes/{note_id}/ai-review/confirm", headers=headers)
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["reviewed"] is True and confirmed.json()["reviewed_by_name"]
    submitted = client.post(f"/research-notes/{note_id}/submit", headers=headers, json={})
    assert submitted.status_code == 200, submitted.text


def test_note_without_llm_text_needs_no_ai_review(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    headers, project_id, mapping_id, _ = _linked_project()
    note_id = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()["note_id"]
    assert client.get(f"/research-notes/{note_id}/ai-review", headers=headers).json()["required"] is False
    assert client.post(f"/research-notes/{note_id}/ai-review/confirm", headers=headers).status_code == 409
    assert client.post(f"/research-notes/{note_id}/submit", headers=headers, json={}).status_code == 200


def test_commit_note_document_leaves_the_title_to_the_note_header(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    headers, project_id, mapping_id, _ = _linked_project()
    note_id = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()["note_id"]
    note = client.get(f"/research-notes/{note_id}", headers=headers).json()
    [summary] = client.get(f"/research-note-documents/notes/{note_id}", headers=headers).json()
    document = client.get(f"/research-note-documents/{summary['id']}", headers=headers).json()["document"]

    # The note format's header prints the title; the document only carries the body, below that header.
    [body] = document["blocks"]
    assert body["id"] == "github-body" and body["y"] >= 64
    assert note["title"] not in body["content"]
    assert body["content"].startswith("- 저장소:") and "커밋 메시지\nUse Otsu threshold" in body["content"]
    assert "이벤트: push" not in body["content"]


def test_deleted_commit_note_can_be_made_again(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    headers, project_id, mapping_id, _ = _linked_project()
    url = f"/projects/{project_id}/github/links/{mapping_id}/commits"
    first = client.post(f"{url}/{SHA_NEW}/note", headers=headers).json()["note_id"]
    assert client.delete(f"/research-notes/{first}", headers=headers).status_code == 204
    assert client.get(url, headers=headers).json()["commits"][0]["note_id"] is None

    again = client.post(f"{url}/{SHA_NEW}/note", headers=headers).json()
    assert again["created"] is True and again["note_id"] != first
    assert client.get(url, headers=headers).json()["commits"][0]["note_id"] == again["note_id"]


def test_link_can_send_its_notes_into_a_bundle(github, monkeypatch) -> None:
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: None)
    headers, project_id, mapping_id, _ = _linked_project()
    bundle = client.post(f"/projects/{project_id}/note-bundles", headers=headers, json={"name": "GitHub"}).json()
    link_url = f"/projects/{project_id}/github/links/{mapping_id}"
    assert client.put(link_url, headers=headers, json={"bundle_id": bundle["id"]}).status_code == 200
    assert client.get(f"/projects/{project_id}/github", headers=headers).json()["links"][0]["bundle_id"] == bundle["id"]

    note_id = client.post(f"{link_url}/commits/{SHA_NEW}/note", headers=headers).json()["note_id"]
    assert client.get(f"/research-notes/{note_id}", headers=headers).json()["bundle_id"] == bundle["id"]

    # Clearing it sends later notes back to "no bundle"; a bundle from another project is refused.
    assert client.put(link_url, headers=headers, json={"bundle_id": None}).status_code == 200
    assert client.get(f"/projects/{project_id}/github", headers=headers).json()["links"][0]["bundle_id"] is None
    project = client.get(f"/projects/{project_id}", headers=headers).json()
    other_project = client.post("/projects", headers=headers, json={
        "company_id": project["company_id"], "name": f"O-{uuid4().hex[:6]}", "code": f"O-{uuid4().hex[:6]}",
        "description": "d", "status": "active", "owner_member_id": project["owner_member_id"]}).json()["id"]
    foreign = client.post(f"/projects/{other_project}/note-bundles", headers=headers, json={"name": "x"})
    assert foreign.status_code == 201, foreign.text
    assert client.put(link_url, headers=headers, json={"bundle_id": foreign.json()["id"]}).status_code == 400


def test_long_commit_note_shrinks_its_font_to_stay_on_one_page(github, monkeypatch) -> None:
    long_text = "\n".join(["- 조명 조건별로 Otsu 임계값을 적용해 이진화 결과를 비교하고 기록함"] * 60)

    class Wordy(FakeGenerator):
        def complete_json(self, system, messages):
            self.calls.append((system, messages))
            return {"sections": [{"heading": "수행 내용", "body": long_text}]}, "fake-model"

    calls: list = []
    monkeypatch.setattr(use_cases, "build_change_generator", lambda db, company_id: Wordy(calls))
    headers, project_id, mapping_id, _ = _linked_project()
    note_id = client.post(f"/projects/{project_id}/github/links/{mapping_id}/commits/{SHA_NEW}/note", headers=headers).json()["note_id"]
    [summary] = client.get(f"/research-note-documents/notes/{note_id}", headers=headers).json()
    [body] = client.get(f"/research-note-documents/{summary['id']}", headers=headers).json()["document"]["blocks"]
    assert 9 <= body["style"]["fontSize"] < 12

    # The model was told how much fits on the page.
    system, _ = calls[0]
    assert "single A4 page" in system
