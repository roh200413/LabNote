import hashlib
import hmac
import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _create_project(headers: dict[str, str], company_id: int, owner_member_id: int) -> str:
    response = client.post(
        "/projects",
        headers=headers,
        json={
            "company_id": company_id,
            "name": f"GitHub Project {uuid4()}",
            "code": f"GH-{uuid4()}",
            "description": "desc",
            "status": "active",
            "owner_member_id": owner_member_id,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_github_integration_crud() -> None:
    headers, company_id, _owner_member_id = create_owner_workspace(client)

    create_response = client.post(
        "/github-integrations",
        headers=headers,
        json={
            "company_id": company_id,
            "repo_owner": "example",
            "repo_name": "labnote",
            "default_branch": "main",
            "status": "active",
        },
    )
    assert create_response.status_code == 201
    integration = create_response.json()
    assert integration["repository_url"] == "https://github.com/example/labnote"

    list_response = client.get(f"/github-integrations?company_id={company_id}", headers=headers)
    assert list_response.status_code == 200
    assert any(item["id"] == integration["id"] for item in list_response.json())

    update_response = client.put(
        f"/github-integrations/{integration['id']}",
        headers=headers,
        json={"status": "paused"},
    )
    assert update_response.status_code == 200
    assert update_response.json()["status"] == "paused"

    delete_response = client.delete(f"/github-integrations/{integration['id']}", headers=headers)
    assert delete_response.status_code == 204


def test_github_pr_merge_webhook_generates_research_note() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _create_project(headers, company_id, owner_member_id)

    create_response = client.post(
        "/github-integrations",
        headers=headers,
        json={
            "company_id": company_id,
            "repo_owner": "example",
            "repo_name": "labnote-auto",
            "default_branch": "main",
            "status": "active",
        },
    )
    assert create_response.status_code == 201
    integration = create_response.json()

    secret_response = client.post(f"/github-integrations/{integration['id']}/webhook-secret", headers=headers)
    assert secret_response.status_code == 200
    secret = secret_response.json()["webhook_secret"]

    mapping_response = client.post(
        f"/github-integrations/{integration['id']}/mappings",
        headers=headers,
        json={
            "project_id": project_id,
            "branch_pattern": "main",
            "note_creation_mode": "pr_merge",
            "default_author_member_id": owner_member_id,
            "default_reviewer_member_id": owner_member_id,
            "is_active": True,
        },
    )
    assert mapping_response.status_code == 201

    payload = {
        "action": "closed",
        "repository": {"full_name": "example/labnote-auto", "html_url": "https://github.com/example/labnote-auto"},
        "pull_request": {
            "id": 12345,
            "number": 24,
            "title": "Improve PDF workflow",
            "html_url": "https://github.com/example/labnote-auto/pull/24",
            "merged": True,
            "body": "Adds approval-safe PDF export flow.",
            "user": {"login": "octocat"},
            "merged_by": {"login": "reviewer"},
            "base": {"ref": "main"},
            "head": {"ref": "feature/pdf"},
            "commits": 3,
            "changed_files": 5,
        },
    }
    body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    signature = "sha256=" + hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    webhook_response = client.post(
        f"/github-integrations/{integration['id']}/webhook",
        content=body,
        headers={
            "Content-Type": "application/json",
            "X-GitHub-Event": "pull_request",
            "X-GitHub-Delivery": str(uuid4()),
            "X-Hub-Signature-256": signature,
        },
    )
    assert webhook_response.status_code == 200
    webhook_payload = webhook_response.json()
    assert webhook_payload["status"] == "processed"
    assert webhook_payload["note_id"]

    note_response = client.get(f"/research-notes/{webhook_payload['note_id']}", headers=headers)
    assert note_response.status_code == 200
    assert note_response.json()["title"] == "[GitHub] PR #24: Improve PDF workflow"

    events_response = client.get(f"/github-integrations/events?integration_id={integration['id']}", headers=headers)
    assert events_response.status_code == 200
    assert events_response.json()[0]["generated_note_id"] == webhook_payload["note_id"]
