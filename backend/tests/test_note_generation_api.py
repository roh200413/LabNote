from uuid import uuid4

from fastapi.testclient import TestClient

from app.domain.research_notes.note_generation import GeneratedNote, GeneratedSection, NoteGenerationInput
from app.infrastructure.llm.openai_note_generator import parse_sections
from app.main import app
from app.presentation.routers.document_editor import get_note_generator
from tests.helpers import create_owner_workspace

client = TestClient(app)


class FakeGenerator:
    model = "fake-model"

    def __init__(self) -> None:
        self.calls: list[NoteGenerationInput] = []

    def generate(self, data: NoteGenerationInput) -> GeneratedNote:
        self.calls.append(data)
        return GeneratedNote(
            sections=[
                GeneratedSection(heading="연구 목적", body="- 테스트 목적"),
                GeneratedSection(heading="결과", body="- [확인 필요]"),
            ],
            model=self.model,
        )


def _create_note(headers: dict[str, str], company_id: int, owner_member_id: int) -> str:
    project = client.post(
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
    assert project.status_code == 201
    note = client.post(
        "/research-notes",
        headers=headers,
        json={"project_id": project.json()["id"], "title": "AI note", "owner_member_id": owner_member_id},
    )
    assert note.status_code == 201
    return note.json()["id"]


def test_generate_returns_503_when_not_configured() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)
    app.dependency_overrides[get_note_generator] = lambda: None
    try:
        status_response = client.get("/research-note-documents/ai/status", headers=headers)
        assert status_response.status_code == 200
        assert status_response.json()["enabled"] is False

        response = client.post(
            "/research-note-documents/ai/generate",
            headers=headers,
            json={"noteId": note_id, "memo": "PCR 반복 실험"},
        )
        assert response.status_code == 503
    finally:
        app.dependency_overrides.pop(get_note_generator, None)


def test_generate_with_memo_uses_generator() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)
    fake = FakeGenerator()
    app.dependency_overrides[get_note_generator] = lambda: fake
    try:
        empty = client.post("/research-note-documents/ai/generate", headers=headers, json={"noteId": note_id})
        assert empty.status_code == 400

        foreign_page = client.post(
            "/research-note-documents/ai/generate",
            headers=headers,
            json={"noteId": note_id, "pageIds": [999999999], "memo": "x"},
        )
        assert foreign_page.status_code == 400

        response = client.post(
            "/research-note-documents/ai/generate",
            headers=headers,
            json={"noteId": note_id, "memo": "PCR 반복 실험", "language": "ko"},
        )
        assert response.status_code == 200
        body = response.json()
        assert body["model"] == "fake-model"
        assert [section["heading"] for section in body["sections"]] == ["연구 목적", "결과"]
        assert body["text"].startswith("■ 연구 목적\n- 테스트 목적")
        assert fake.calls[-1].note_title == "AI note"
        assert fake.calls[-1].memo == "PCR 반복 실험"
    finally:
        app.dependency_overrides.pop(get_note_generator, None)


def test_parse_sections_accepts_list_bodies_and_skips_empty() -> None:
    sections = parse_sections('{"sections": [{"heading": "A", "body": ["- 1", "- 2"]}, {"heading": "", "body": ""}]}')
    assert len(sections) == 1
    assert sections[0].body == "- 1\n- 2"


def test_free_text_blocks_are_exported_to_pdf() -> None:
    import fitz

    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)
    long_body = "\n".join(f"- 결과 항목 {index}: 측정값 확인" for index in range(80))
    document = {
        "schemaVersion": 1,
        "id": "draft",
        "title": "Layout",
        "page": {"width": 794, "height": 1123, "background": "#ffffff"},
        "meta": {"noteId": note_id},
        "blocks": [
            {"id": "text-short", "type": "text", "x": 50, "y": 100, "w": 600, "h": 80,
             "content": "UNIQUE-AI-DRAFT", "style": {"fontSize": 14, "color": "#1d4ed8"}},
            {"id": "text-long", "type": "text", "x": 50, "y": 300, "w": 600, "h": 200, "content": long_body},
        ],
    }
    created = client.post(
        "/research-note-documents",
        headers=headers,
        json={"note_id": note_id, "title": "Layout", "document": document},
    )
    assert created.status_code == 201, created.text

    exported = client.post(
        "/research-note-documents/export-pdf", headers=headers, json={"documentId": created.json()["id"]}
    )
    assert exported.status_code == 200, exported.text
    with fitz.open(stream=exported.content, filetype="pdf") as pdf:
        text = "".join(page.get_text() for page in pdf)
    assert "UNIQUE-AI-DRAFT" in text
    assert "결과 항목 0" in text
