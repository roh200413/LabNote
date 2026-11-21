import json
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.infrastructure.db.models import GitHubGeneratedNoteORM, ResearchNoteDocumentORM, ResearchNoteORM
from app.infrastructure.db.session import SessionLocal
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _setup():
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project = client.post(
        "/projects", headers=headers,
        json={"company_id": company_id, "name": "검토", "code": f"R-{uuid4().hex[:6]}", "owner_member_id": owner_member_id},
    ).json()
    return headers, project["id"], owner_member_id


def _note(headers, project_id, owner, title, body=None, status="draft", reviewer=None):
    note = client.post(
        "/research-notes", headers=headers,
        json={"project_id": project_id, "title": title, "owner_member_id": owner, "reviewer_member_id": reviewer or owner},
    ).json()
    with SessionLocal() as db:
        if body is not None:
            db.add(ResearchNoteDocumentORM(
                note_id=note["id"], title=title,
                document_payload=json.dumps({"blocks": [{"id": "b1", "type": "text", "content": body}]}),
            ))
        row = db.get(ResearchNoteORM, note["id"])
        row.status = status
        row.updated_at = datetime.now(timezone.utc) - timedelta(days=3)
        db.commit()
    return note["id"]


def test_review_queue_tags_and_checks() -> None:
    headers, project_id, owner = _setup()
    long_body = "55도에서 PCR 밴드를 확인했고 조건별로 비교했음. " * 3
    submitted = _note(headers, project_id, owner, "결재 대기 노트", long_body, status="submitted")
    rejected = _note(headers, project_id, owner, "반려 노트", long_body, status="rejected")
    leftover = _note(headers, project_id, owner, "확인 필요 남음", long_body + " 수치 [확인 필요] 그리고 [확인 필요]")
    empty = _note(headers, project_id, owner, "빈 노트", "짧음")
    approved = _note(headers, project_id, owner, "승인된 노트", long_body, status="approved")
    ai_note = _note(headers, project_id, owner, "AI 작성 노트", long_body)
    with SessionLocal() as db:
        db.add(GitHubGeneratedNoteORM(event_id=987654, note_id=ai_note, review_required=True, ai_model="gpt-test"))
        db.commit()

    body = client.get(f"/projects/{project_id}/note-review", headers=headers).json()
    by_title = {item["title"]: item for item in body["items"]}
    assert "승인된 노트" not in by_title  # closed notes are not in the queue
    assert by_title["결재 대기 노트"]["tags"][0] == "awaiting_approval"
    assert "rejected" in by_title["반려 노트"]["tags"]
    assert "ai_unreviewed" in by_title["AI 작성 노트"]["tags"] and by_title["AI 작성 노트"]["ai_model"] == "gpt-test"
    assert by_title["AI 작성 노트"]["can_confirm_ai"] is True
    assert any("[확인 필요]' 표시 2곳" in check for check in by_title["확인 필요 남음"]["checks"])
    assert "본문이 거의 비어 있음" in by_title["빈 노트"]["checks"]
    assert by_title["결재 대기 노트"]["updated_days"] == 3
    assert body["counts"]["awaiting_approval"] == 1 and body["counts"]["rejected"] == 1 and body["counts"]["ai_unreviewed"] == 1
    # waiting approvals come first, soft problems last
    assert body["items"][0]["title"] == "결재 대기 노트"
    assert {submitted, rejected, leftover, empty, ai_note} >= {item["id"] for item in body["items"] if item["tags"]}


def test_review_queue_requires_project_access() -> None:
    headers, project_id, _ = _setup()
    other_headers, _, _ = create_owner_workspace(client)
    assert client.get(f"/projects/{project_id}/note-review", headers=other_headers).status_code == 403
    assert client.get("/projects/not-a-project/note-review", headers=headers).status_code == 404
