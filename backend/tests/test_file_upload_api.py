from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from pypdf import PdfWriter

from app.main import app

client = TestClient(app)


def _create_project_id() -> str:
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


def _create_note_id(project_id: str) -> str:
    response = client.post(
        "/research-notes",
        json={
            "project_id": project_id,
            "title": "Upload note",
            "content": "",
            "owner_member_id": 1,
            "last_updated_by": 1,
        },
    )
    assert response.status_code == 201
    return response.json()["id"]


def _build_one_page_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=300, height=300)
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


def test_pdf_upload_creates_pages() -> None:
    project_id = _create_project_id()
    note_id = _create_note_id(project_id)

    response = client.post(
        "/research-note-files/upload",
        data={"note_id": note_id, "uploaded_by": "1"},
        files={"upload": ("sample.pdf", _build_one_page_pdf(), "application/pdf")},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["file"]["file_type"] == "pdf"
    assert len(payload["pages"]) == 1


def test_image_upload_creates_single_page() -> None:
    project_id = _create_project_id()
    note_id = _create_note_id(project_id)

    image_bytes = b"\x89PNG\r\n\x1a\n" + b"0" * 64
    response = client.post(
        "/research-note-files/upload",
        data={"note_id": note_id, "uploaded_by": "1"},
        files={"upload": ("sample.png", image_bytes, "image/png")},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["file"]["file_type"] == "image"
    assert len(payload["pages"]) == 1
