from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _create_project() -> str:
    response = client.post(
        "/projects",
        json={
            "company_id": 1,
            "name": f"Project-{uuid4()}",
            "code": f"CODE-{uuid4()}",
            "description": "desc",
            "status": "active",
            "owner_member_id": 1,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def test_research_note_crud() -> None:
    project_id = _create_project()

    create_response = client.post(
        "/research-notes",
        json={
            "project_id": project_id,
            "title": "노트 제목",
            "content": "초기 본문",
            "owner_member_id": 1,
            "last_updated_by": 1,
        },
    )
    assert create_response.status_code == 201
    note_id = create_response.json()["id"]

    list_response = client.get(f"/research-notes?project_id={project_id}")
    assert list_response.status_code == 200
    assert any(item["id"] == note_id for item in list_response.json())

    detail_response = client.get(f"/research-notes/{note_id}")
    assert detail_response.status_code == 200
    assert detail_response.json()["content"] == "초기 본문"

    update_response = client.put(
        f"/research-notes/{note_id}",
        json={"title": "수정된 제목", "content": "수정 본문", "last_updated_by": 2},
    )
    assert update_response.status_code == 200
    assert update_response.json()["title"] == "수정된 제목"

    delete_response = client.delete(f"/research-notes/{note_id}")
    assert delete_response.status_code == 204
