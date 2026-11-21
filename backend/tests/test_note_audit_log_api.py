"""Audit trail of research notes: every change is recorded, survives deletion, and is read by project members."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _project(headers, company_id, owner_member_id) -> str:
    response = client.post("/projects", headers=headers, json={
        "company_id": company_id, "name": f"A-{uuid4().hex[:6]}", "code": f"A-{uuid4().hex[:6]}", "description": "d",
        "status": "active", "owner_member_id": owner_member_id})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _document(note_id: str) -> dict:
    return {
        "schemaVersion": 1, "id": "draft", "title": "Layout",
        "page": {"width": 794, "height": 1123, "background": "#ffffff"},
        "meta": {"noteId": note_id},
        "blocks": [{"id": "t", "type": "text", "x": 50, "y": 100, "w": 600, "h": 80, "content": "본문"}],
    }


def _actions(headers, note_id) -> list[str]:
    response = client.get(f"/research-notes/{note_id}/audit-log", headers=headers)
    assert response.status_code == 200, response.text
    return [entry["action"] for entry in response.json()][::-1]  # oldest first


def test_note_life_cycle_is_recorded_in_order() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, member_id)
    note = client.post("/research-notes", headers=headers, json={
        "project_id": project_id, "title": "첫 제목", "owner_member_id": member_id}).json()
    note_id = note["id"]

    client.put(f"/research-notes/{note_id}", headers=headers, json={"title": "바뀐 제목"})
    client.put(f"/research-notes/{note_id}", headers=headers, json={"title": "바뀐 제목"})  # no real change
    document = client.post("/research-note-documents", headers=headers, json={
        "note_id": note_id, "title": "Layout", "document": _document(note_id)})
    assert document.status_code == 201, document.text
    client.put(f"/research-note-documents/{document.json()['id']}", headers=headers, json={
        "note_id": note_id, "title": "Layout", "document": _document(note_id), "change_summary": "수정"})
    exported = client.post("/research-note-documents/export-pdf", headers=headers,
                           json={"documentId": document.json()["id"]})
    assert exported.status_code == 200, exported.text
    assert client.post(f"/research-notes/{note_id}/submit", headers=headers, json={}).status_code == 200
    assert client.post(f"/research-notes/{note_id}/approve", headers=headers, json={"comment": "좋음"}).status_code == 200

    assert _actions(headers, note_id) == [
        "note_create", "note_update", "note_document_save", "note_document_save",
        "note_export", "note_submit", "note_approve",
    ]
    entries = client.get(f"/research-notes/{note_id}/audit-log", headers=headers).json()
    approve = entries[0]
    assert approve["action_label"] == "승인" and approve["detail"]["comment"] == "좋음"
    assert approve["actor_name"] and approve["note_title"] == "바뀐 제목"
    update = next(entry for entry in entries if entry["action"] == "note_update")
    assert update["detail"]["changes"]["title"] == {"from": "첫 제목", "to": "바뀐 제목"}


def test_trail_survives_deleting_the_note_and_is_listed_per_project() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, member_id)
    note = client.post("/research-notes", headers=headers, json={
        "project_id": project_id, "title": "곧 삭제", "owner_member_id": member_id}).json()
    other_project = _project(headers, company_id, member_id)
    client.post("/research-notes", headers=headers, json={
        "project_id": other_project, "title": "다른 프로젝트", "owner_member_id": member_id})

    assert client.delete(f"/research-notes/{note['id']}", headers=headers).status_code == 204
    assert client.get(f"/research-notes/{note['id']}/audit-log", headers=headers).status_code == 404

    entries = client.get(f"/research-notes/projects/{project_id}/audit-log", headers=headers).json()
    assert [entry["action"] for entry in entries] == ["note_delete", "note_create"]
    assert {entry["note_title"] for entry in entries} == {"곧 삭제"}


def test_only_project_members_can_read_the_trail() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, member_id)
    note = client.post("/research-notes", headers=headers, json={
        "project_id": project_id, "title": "비공개", "owner_member_id": member_id}).json()

    stranger, _company, _member = create_owner_workspace(client)
    assert client.get(f"/research-notes/{note['id']}/audit-log", headers=stranger).status_code == 403
    assert client.get(f"/research-notes/projects/{project_id}/audit-log", headers=stranger).status_code == 403
    assert client.get(f"/research-notes/{note['id']}/audit-log").status_code in (401, 403)
