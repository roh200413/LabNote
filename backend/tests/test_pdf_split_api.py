from uuid import uuid4

import fitz
from fastapi.testclient import TestClient

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _pdf(pages: int) -> bytes:
    document = fitz.open()
    for index in range(pages):
        page = document.new_page()
        page.insert_text((72, 72), f"page {index + 1}")
    data = document.tobytes()
    document.close()
    return data


def _project(headers: dict[str, str], company_id: int, owner_member_id: int) -> str:
    response = client.post(
        "/projects",
        headers=headers,
        json={
            "company_id": company_id,
            "name": f"Split-{uuid4().hex[:6]}",
            "code": f"SP-{uuid4().hex[:6]}",
            "description": "d",
            "status": "active",
            "owner_member_id": owner_member_id,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def _split(headers, project_id, owner_member_id, pdf: bytes, pages_per_note: int, title: str = "실험 기록", name: str = "lab.pdf"):
    return client.post(
        "/research-notes/from-pdf",
        headers=headers,
        data={
            "project_id": project_id,
            "title": title,
            "pages_per_note": str(pages_per_note),
            "owner_member_id": str(owner_member_id),
            "written_date": "2026-11-19",
        },
        files={"upload": (name, pdf, "application/pdf")},
    )


def test_one_note_per_page_and_groups_of_pages() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)

    per_page = _split(headers, project_id, owner_member_id, _pdf(3), 1)
    assert per_page.status_code == 201, per_page.text
    notes = per_page.json()["notes"]
    assert [note["title"] for note in notes] == ["실험 기록 (1p)", "실험 기록 (2p)", "실험 기록 (3p)"]
    for note in notes:
        files = client.get(f"/research-note-files/notes/{note['id']}", headers=headers).json()
        assert len(files) == 1 and files[0]["page_count"] == 1
        detail = client.get(f"/research-notes/{note['id']}", headers=headers).json()
        assert detail["written_date"] == "2026-11-19"

    listed = client.get("/research-notes", headers=headers, params={"project_id": project_id}).json()
    assert [note["title"] for note in listed] == ["실험 기록 (3p)", "실험 기록 (2p)", "실험 기록 (1p)"]  # newest first

    grouped = _split(headers, project_id, owner_member_id, _pdf(5), 2, title="", name="masks/scan.pdf").json()["notes"]
    assert [(note["first_page"], note["last_page"]) for note in grouped] == [(1, 2), (3, 4), (5, 5)]
    assert grouped[0]["title"] == "scan (1-2p)"  # no title given: file name without folder or extension
    counts = [client.get(f"/research-note-files/notes/{note['id']}", headers=headers).json()[0]["page_count"] for note in grouped]
    assert counts == [2, 2, 1]

    whole = _split(headers, project_id, owner_member_id, _pdf(2), 10).json()["notes"]
    assert len(whole) == 1 and whole[0]["title"] == "실험 기록"


def test_rejects_bad_input_and_outsiders() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)

    assert _split(headers, project_id, owner_member_id, b"not a pdf", 1).status_code == 400
    assert _split(headers, project_id, owner_member_id, _pdf(1), 0).status_code == 400
    image = client.post(
        "/research-notes/from-pdf",
        headers=headers,
        data={"project_id": project_id, "pages_per_note": "1", "owner_member_id": str(owner_member_id)},
        files={"upload": ("photo.png", b"\x89PNG", "image/png")},
    )
    assert image.status_code == 400

    other_headers, _, other_member_id = create_owner_workspace(client)
    assert _split(other_headers, project_id, other_member_id, _pdf(1), 1).status_code == 403
