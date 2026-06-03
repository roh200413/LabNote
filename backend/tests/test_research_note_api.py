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
            "name": f"Project-{uuid4()}",
            "code": f"CODE-{uuid4()}",
            "description": "desc",
            "status": "active",
            "owner_member_id": owner_member_id,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_research_note_crud() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _create_project(headers, company_id, owner_member_id)

    create_response = client.post(
        "/research-notes",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Test note",
            "content": "Initial body",
            "owner_member_id": owner_member_id,
        },
    )
    assert create_response.status_code == 201
    note_id = create_response.json()["id"]

    list_response = client.get(f"/research-notes?project_id={project_id}", headers=headers)
    assert list_response.status_code == 200
    assert any(item["id"] == note_id for item in list_response.json())

    detail_response = client.get(f"/research-notes/{note_id}", headers=headers)
    assert detail_response.status_code == 200
    assert detail_response.json()["content"] == "Initial body"

    update_response = client.put(
        f"/research-notes/{note_id}",
        headers=headers,
        json={"title": "Updated note", "content": "Updated body", "last_updated_by": 2},
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "Updated note"

    delete_response = client.delete(f"/research-notes/{note_id}", headers=headers)
    assert delete_response.status_code == 204
