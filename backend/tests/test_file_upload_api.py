from io import BytesIO
from uuid import uuid4

from fastapi.testclient import TestClient
from PIL import Image
from pypdf import PdfWriter

from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _create_project_id(headers: dict[str, str], company_id: int, owner_member_id: int) -> str:
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


def _create_note_id(headers: dict[str, str], project_id: str, owner_member_id: int) -> str:
    response = client.post(
        "/research-notes",
        headers=headers,
        json={
            "project_id": project_id,
            "title": "Upload note",
            "content": "",
            "owner_member_id": owner_member_id,
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


def _build_png() -> bytes:
    output = BytesIO()
    Image.new("RGB", (64, 64), color=(255, 255, 255)).save(output, format="PNG")
    return output.getvalue()


def test_pdf_upload_creates_pages() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _create_project_id(headers, company_id, owner_member_id)
    note_id = _create_note_id(headers, project_id, owner_member_id)

    response = client.post(
        "/research-note-files/upload",
        headers=headers,
        data={"note_id": note_id, "uploaded_by": str(owner_member_id)},
        files={"upload": ("sample.pdf", _build_one_page_pdf(), "application/pdf")},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["file"]["file_type"] == "pdf"
    assert len(payload["pages"]) == 1


def test_image_upload_creates_single_page() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _create_project_id(headers, company_id, owner_member_id)
    note_id = _create_note_id(headers, project_id, owner_member_id)

    response = client.post(
        "/research-note-files/upload",
        headers=headers,
        data={"note_id": note_id, "uploaded_by": str(owner_member_id)},
        files={"upload": ("sample.png", _build_png(), "image/png")},
    )
    assert response.status_code == 201
    payload = response.json()
    assert payload["file"]["file_type"] == "image"
    assert len(payload["pages"]) == 1
