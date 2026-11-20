from uuid import uuid4

import fitz
from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.infrastructure.db.models import CompanyMemberORM, UserAccountORM
from app.infrastructure.db.session import SessionLocal
from app.main import app
from app.presentation.routers.document_editor import get_note_generator
from tests.helpers import create_owner_workspace
from tests.test_note_generation_api import FakeGenerator, _create_note

client = TestClient(app)

CUSTOM_FORMAT = {
    "version": 1,
    "sections": [
        {"id": "goal", "title": "실험 목표", "guide": "무엇을 확인하려는지"},
        {"id": "data", "title": "측정 데이터", "guide": ""},
    ],
    "layout": {"mode": "text_top", "imageRatio": 0.4},
    "header": {"show": True, "titleLabel": "과제명 :"},
    "footer": {
        "show": True,
        "recordedLabel": "작성자",
        "witnessedLabel": "확인자",
        "signatureLabel": "서명",
        "dateLabel": "일자",
    },
    "typography": {"bodyFontSize": 11, "headingFontSize": 14, "headingBold": True},
}


def _add_member(company_id: int) -> dict[str, str]:
    email = f"member-{uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = UserAccountORM(
            username=email.split("@")[0],
            display_name="Member",
            email=email,
            password=hash_password("MemberPass123!"),
            global_role="user",
            is_active=True,
            is_approved=True,
        )
        db.add(user)
        db.flush()
        db.add(CompanyMemberORM(company_id=company_id, user_id=user.id, role="member"))
        db.commit()
    login = client.post("/auth/login", json={"email": email, "password": "MemberPass123!"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_default_format_and_owner_save() -> None:
    headers, company_id, _ = create_owner_workspace(client)

    initial = client.get("/note-format", headers=headers)
    assert initial.status_code == 200
    body = initial.json()
    assert body["company_id"] == company_id
    assert body["is_custom"] is False
    assert body["can_manage"] is True
    assert [section["title"] for section in body["format"]["sections"]][0] == "연구 목적"

    saved = client.put("/note-format", headers=headers, json=CUSTOM_FORMAT)
    assert saved.status_code == 200, saved.text
    assert saved.json()["is_custom"] is True
    assert saved.json()["format"]["layout"] == {"mode": "text_top", "imageRatio": 0.4}

    again = client.get("/note-format", headers=headers).json()
    assert again["format"]["footer"]["recordedLabel"] == "작성자"


def test_member_can_read_but_not_change() -> None:
    _, company_id, _ = create_owner_workspace(client)
    member_headers = _add_member(company_id)

    read = client.get("/note-format", headers=member_headers)
    assert read.status_code == 200
    assert read.json()["can_manage"] is False

    write = client.put("/note-format", headers=member_headers, json=CUSTOM_FORMAT)
    assert write.status_code == 403


def test_invalid_format_is_rejected() -> None:
    headers, _, _ = create_owner_workspace(client)
    duplicate_ids = {**CUSTOM_FORMAT, "sections": [{"id": "a", "title": "A"}, {"id": "a", "title": "B"}]}
    assert client.put("/note-format", headers=headers, json=duplicate_ids).status_code == 422
    bad_ratio = {**CUSTOM_FORMAT, "layout": {"mode": "image_top", "imageRatio": 0.95}}
    assert client.put("/note-format", headers=headers, json=bad_ratio).status_code == 422


def test_pdf_uses_format_labels_and_hidden_footer() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)

    labelled = client.put("/note-format", headers=headers, json=CUSTOM_FORMAT)
    assert labelled.status_code == 200
    pdf = client.post("/research-note-documents/export-pdf", headers=headers, json={"noteId": note_id})
    assert pdf.status_code == 200, pdf.text
    with fitz.open(stream=pdf.content, filetype="pdf") as document:
        text = document[0].get_text()
    assert "작성자" in text and "확인자" in text and "과제명" in text
    assert "Recorded By" not in text

    no_footer = {**CUSTOM_FORMAT, "footer": {**CUSTOM_FORMAT["footer"], "show": False}}
    assert client.put("/note-format", headers=headers, json=no_footer).status_code == 200
    pdf = client.post("/research-note-documents/export-pdf", headers=headers, json={"noteId": note_id})
    with fitz.open(stream=pdf.content, filetype="pdf") as document:
        text = document[0].get_text()
    assert "작성자" not in text
    assert "과제명" in text


def test_ai_generation_receives_format_sections() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    note_id = _create_note(headers, company_id, owner_member_id)
    assert client.put("/note-format", headers=headers, json=CUSTOM_FORMAT).status_code == 200

    fake = FakeGenerator()
    app.dependency_overrides[get_note_generator] = lambda: fake
    try:
        response = client.post(
            "/research-note-documents/ai/generate", headers=headers, json={"noteId": note_id, "memo": "측정"}
        )
        assert response.status_code == 200, response.text
        assert fake.calls[-1].sections == [("실험 목표", "무엇을 확인하려는지"), ("측정 데이터", "")]
    finally:
        app.dependency_overrides.pop(get_note_generator, None)


def test_system_prompt_lists_format_sections() -> None:
    from app.infrastructure.llm.openai_note_generator import build_system_prompt

    prompt = build_system_prompt("ko", [("실험 목표", "무엇을 확인하려는지"), ("측정 데이터", "")])
    assert "1. 실험 목표 — 무엇을 확인하려는지" in prompt
    assert "2. 측정 데이터" in prompt
    assert "연구 목적" not in prompt
    assert "[확인 필요]" in prompt
    assert "Write the section bodies in Korean" in prompt


def test_owner_deletes_company_format_and_member_cannot() -> None:
    headers, company_id, _ = create_owner_workspace(client)
    assert client.put("/note-format", headers=headers, json=CUSTOM_FORMAT).json()["is_custom"] is True

    member_headers = _add_member(company_id)
    assert client.delete("/note-format", headers=member_headers).status_code == 403

    deleted = client.delete("/note-format", headers=headers)
    assert deleted.status_code == 200, deleted.text
    body = deleted.json()
    assert body["is_custom"] is False
    assert [section["title"] for section in body["format"]["sections"]][0] == "연구 목적"
    assert client.delete("/note-format", headers=headers).status_code == 200  # deleting again is harmless
