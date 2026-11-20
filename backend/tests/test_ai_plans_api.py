import io
import json
import re
import zipfile
from uuid import uuid4

import fitz
import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.domain.research_notes import batch_generation, generation_plans
from app.infrastructure.db.models import ResearchNoteDocumentORM
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.llm.models import NoteGenerationJobORM
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


class FakePlanner:
    """Proposes one note per '=== ' source section, or exactly the count the user asks for."""

    calls: list[tuple[str, list[dict]]] = []

    def complete_json(self, system, messages):
        FakePlanner.calls.append((system, messages))
        source = messages[0]["content"]
        sections = re.findall(r"=== (?:노트|문서): ([^=\n]+?) (?:\(|===)", source)
        wanted = None
        for message in reversed(messages):
            if message["role"] == "user":
                match = re.search(r"(\d+)\s*(?:장|notes)", message["content"])
                if match:
                    wanted = int(match.group(1))
                break
        count = wanted or max(1, len(sections))
        items = [
            {"title": f"계획 {index + 1}", "written_date": None, "focus": f"범위 {index + 1}", "source_hint": "p.1"}
            for index in range(count)
        ]
        return (
            {
                "message": f"{count}장을 제안합니다.",
                "recommended_count": max(1, len(sections)),
                "rationale": "자료 구간 수 기준",
                "items": items,
            },
            "fake-model",
        )

    def close(self):
        pass


@pytest.fixture
def planner(monkeypatch):
    FakePlanner.calls = []
    monkeypatch.setattr(generation_plans, "resolve_settings", lambda db, company_id: get_settings())
    monkeypatch.setattr(generation_plans, "build_note_generator", lambda settings: FakePlanner())
    monkeypatch.setattr(batch_generation, "resolve_settings", lambda db, company_id: get_settings())
    monkeypatch.setattr("app.presentation.routers.ai_plans.dispatch_job", lambda job_id: None)
    return FakePlanner


def _project(headers, company_id, owner_member_id) -> str:
    response = client.post(
        "/projects",
        headers=headers,
        json={"company_id": company_id, "name": "AI 계획", "code": f"AP-{uuid4().hex[:6]}", "owner_member_id": owner_member_id},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _note_with_body(headers, project_id, owner_member_id, title, body) -> str:
    note = client.post(
        "/research-notes",
        headers=headers,
        json={"project_id": project_id, "title": title, "owner_member_id": owner_member_id, "written_date": "2026-03-02"},
    ).json()
    with SessionLocal() as db:
        db.add(
            ResearchNoteDocumentORM(
                note_id=note["id"],
                title=title,
                document_payload=json.dumps({"blocks": [{"id": "b", "type": "text", "content": body}]}),
            )
        )
        db.commit()
    return note["id"]


def _pdf_bytes(text: str) -> bytes:
    document = fitz.open()
    page = document.new_page()
    page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def _docx_bytes(text: str) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr(
            "word/document.xml",
            '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'
            f"<w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>",
        )
    return buffer.getvalue()


def test_expand_existing_notes_negotiate_count_and_confirm(planner) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    first = _note_with_body(headers, project_id, owner_member_id, "PCR 1차", "55도에서 밴드 확인. 58도 약함.")
    second = _note_with_body(headers, project_id, owner_member_id, "PCR 2차", "MgCl2 2mM 조건 비교.")

    created = client.post(
        f"/projects/{project_id}/ai-plans",
        headers=headers,
        data={"mode": "expand", "note_ids": f"{first},{second}", "date_from": "2026-03-01", "date_to": "2026-03-10"},
    )
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["status"] == "drafting" and plan["proposal"]["recommended_count"] == 2
    assert len(plan["proposal"]["items"]) == 2
    assert plan["messages"][0]["content"] == "자료에 맞는 장수를 추천해 주세요."
    assert "55도에서 밴드 확인" in planner.calls[0][1][0]["content"]  # the planner saw the note body
    assert "Never plan notes about work the material does not describe" in planner.calls[0][0]

    revised = client.post(f"/ai-plans/{plan['id']}/messages", headers=headers, json={"message": "4장으로 나눠줘"})
    assert revised.status_code == 200, revised.text
    assert len(revised.json()["proposal"]["items"]) == 4
    assert [m["role"] for m in revised.json()["messages"]] == ["user", "assistant", "user", "assistant"]
    assert revised.json()["messages"][2]["content"] == "4장으로 나눠줘"
    assert "Current list:" in planner.calls[-1][1][-1]["content"]

    edited = client.put(
        f"/ai-plans/{plan['id']}/items",
        headers=headers,
        json={"items": [{"title": "온도 비교", "focus": "55/58도"}, {"title": "MgCl2 비교", "written_date": "2026-03-05"}]},
    )
    assert edited.status_code == 200 and [i["title"] for i in edited.json()["proposal"]["items"]] == ["온도 비교", "MgCl2 비교"]

    confirmed = client.post(f"/ai-plans/{plan['id']}/confirm", headers=headers, json={})
    assert confirmed.status_code == 202, confirmed.text
    body = confirmed.json()
    assert body["plan"]["status"] == "confirmed" and body["job"]["total"] == 2
    assert [item["title"] for item in body["job"]["items"]] == ["온도 비교", "MgCl2 비교"]
    with SessionLocal() as db:
        payload = json.loads(db.get(NoteGenerationJobORM, body["job"]["id"]).payload)
    assert payload["entries"][0]["written_date"] == "2026-03-01"  # spread across the requested period
    assert payload["entries"][1]["written_date"] == "2026-03-05"  # explicit date kept
    assert "55도에서 밴드 확인" in payload["entries"][0]["memo"]

    again = client.post(f"/ai-plans/{plan['id']}/messages", headers=headers, json={"message": "더"})
    assert again.status_code == 400
    listed = client.get(f"/projects/{project_id}/ai-plans", headers=headers).json()
    assert listed[0]["id"] == plan["id"]


def test_document_upload_pdf_docx_and_validation(planner) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)

    created = client.post(
        f"/projects/{project_id}/ai-plans",
        headers=headers,
        data={"mode": "document", "requested_count": "3"},
        files=[
            ("files", ("protocol.pdf", _pdf_bytes("Western blot protocol: transfer 100V for 60 min."), "application/pdf")),
            ("files", ("report.docx", _docx_bytes("Cell culture passage 12, confluence 80 percent."), "application/octet-stream")),
        ],
    )
    assert created.status_code == 201, created.text
    plan = created.json()
    assert plan["source_label"] == "protocol.pdf, report.docx"
    assert len(plan["proposal"]["items"]) == 3
    source = planner.calls[0][1][0]["content"]
    assert "Western blot protocol" in source and "Cell culture passage 12" in source

    bad_type = client.post(
        f"/projects/{project_id}/ai-plans",
        headers=headers,
        data={"mode": "document"},
        files=[("files", ("paper.hwp", b"binary", "application/octet-stream"))],
    )
    assert bad_type.status_code == 400 and "PDF" in bad_type.json()["detail"]
    empty_pdf = client.post(
        f"/projects/{project_id}/ai-plans",
        headers=headers,
        data={"mode": "document"},
        files=[("files", ("scan.pdf", _pdf_bytes(""), "application/pdf"))],
    )
    assert empty_pdf.status_code == 400
    no_files = client.post(f"/projects/{project_id}/ai-plans", headers=headers, data={"mode": "document"})
    assert no_files.status_code == 400
    too_many = client.post(
        f"/projects/{project_id}/ai-plans",
        headers=headers,
        data={"mode": "document", "requested_count": "500"},
        files=[("files", ("a.txt", "실험 기록 내용이 충분히 길게 들어 있는 텍스트 파일입니다.".encode(), "text/plain"))],
    )
    assert too_many.status_code == 400


def test_plan_access_is_limited_to_project_and_creator(planner) -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    note_id = _note_with_body(headers, project_id, owner_member_id, "기록", "측정 기록 본문")
    plan = client.post(
        f"/projects/{project_id}/ai-plans", headers=headers, data={"mode": "expand", "note_ids": note_id}
    ).json()

    other_headers, other_company, other_owner = create_owner_workspace(client)
    assert client.get(f"/ai-plans/{plan['id']}", headers=other_headers).status_code == 403
    assert client.post(f"/ai-plans/{plan['id']}/confirm", headers=other_headers, json={}).status_code == 403

    other_project = _project(other_headers, other_company, other_owner)
    foreign = client.post(
        f"/projects/{other_project}/ai-plans", headers=other_headers, data={"mode": "expand", "note_ids": note_id}
    )
    assert foreign.status_code == 400  # notes from another project cannot be used as a source
    assert client.get("/ai-plans/does-not-exist", headers=headers).status_code == 404
