"""Note bundles: grouping a project's research notes, and sending GitHub notes into one bundle."""

from uuid import uuid4

from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _project(headers, company_id, owner_member_id) -> str:
    response = client.post("/projects", headers=headers, json={
        "company_id": company_id, "name": f"B-{uuid4().hex[:6]}", "code": f"B-{uuid4().hex[:6]}", "description": "d",
        "status": "active", "owner_member_id": owner_member_id})
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _note(headers, project_id, owner_member_id, title, bundle_id=None) -> dict:
    body = {"project_id": project_id, "title": title, "owner_member_id": owner_member_id}
    if bundle_id:
        body["bundle_id"] = bundle_id
    response = client.post("/research-notes", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def test_bundles_group_notes_and_deleting_a_bundle_keeps_its_notes() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, member_id)
    url = f"/projects/{project_id}/note-bundles"

    created = client.post(url, headers=headers, json={"name": "  실험 A  "})
    assert created.status_code == 201, created.text
    bundle = created.json()
    assert bundle["name"] == "실험 A" and bundle["note_count"] == 0
    assert client.post(url, headers=headers, json={"name": "실험 a"}).status_code == 400  # same name, any case

    inside = _note(headers, project_id, member_id, "in bundle", bundle["id"])
    loose = _note(headers, project_id, member_id, "loose")
    assert inside["bundle_id"] == bundle["id"] and loose["bundle_id"] is None

    moved = client.post(f"{url}/move", headers=headers, json={"note_ids": [loose["id"]], "bundle_id": bundle["id"]})
    assert moved.status_code == 200 and moved.json() == {"moved": 1}
    assert client.get(url, headers=headers).json()[0]["note_count"] == 2
    listed = client.get(f"/research-notes?project_id={project_id}", headers=headers).json()
    assert {note["bundle_id"] for note in listed} == {bundle["id"]}

    renamed = client.patch(f"/note-bundles/{bundle['id']}", headers=headers, json={"name": "실험 B"})
    assert renamed.status_code == 200 and renamed.json()["name"] == "실험 B"

    assert client.delete(f"/note-bundles/{bundle['id']}", headers=headers).status_code == 204
    assert client.get(url, headers=headers).json() == []
    listed = client.get(f"/research-notes?project_id={project_id}", headers=headers).json()
    assert len(listed) == 2 and all(note["bundle_id"] is None for note in listed)


def test_bundle_must_belong_to_the_same_project() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    first = _project(headers, company_id, member_id)
    second = _project(headers, company_id, member_id)
    other_bundle = client.post(f"/projects/{second}/note-bundles", headers=headers, json={"name": "남의 묶음"}).json()

    response = client.post("/research-notes", headers=headers, json={
        "project_id": first, "title": "x", "owner_member_id": member_id, "bundle_id": other_bundle["id"]})
    assert response.status_code == 400
    note = _note(headers, first, member_id, "x")
    moved = client.post(f"/projects/{first}/note-bundles/move", headers=headers,
                        json={"note_ids": [note["id"]], "bundle_id": other_bundle["id"]})
    assert moved.status_code == 400


def test_outsider_cannot_see_or_create_bundles() -> None:
    headers, company_id, member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, member_id)
    outsider, _, _ = create_owner_workspace(client)
    assert client.get(f"/projects/{project_id}/note-bundles", headers=outsider).status_code == 403
    assert client.post(f"/projects/{project_id}/note-bundles", headers=outsider, json={"name": "x"}).status_code == 403
