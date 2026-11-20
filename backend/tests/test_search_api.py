import json
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ProjectMemberORM,
    ResearchNoteDocumentORM,
    ResearchNoteFileORM,
    UserAccountORM,
)
from app.infrastructure.db.session import SessionLocal
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _project(headers: dict[str, str], company_id: int, owner_member_id: int, name: str) -> str:
    response = client.post(
        "/projects",
        headers=headers,
        json={
            "company_id": company_id,
            "name": name,
            "code": f"CODE-{uuid4().hex[:8]}",
            "description": "desc",
            "status": "active",
            "owner_member_id": owner_member_id,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _note(headers: dict[str, str], project_id: str, owner_member_id: int, title: str, **extra) -> str:
    response = client.post(
        "/research-notes",
        headers=headers,
        json={"project_id": project_id, "title": title, "owner_member_id": owner_member_id, **extra},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _set_body(note_id: str, text: str, locked_label: str = "작성자") -> None:
    payload = {
        "blocks": [
            {"id": "label", "type": "text", "content": locked_label, "locked": True},
            {"id": "body", "type": "text", "content": text, "locked": False},
        ]
    }
    with SessionLocal() as db:
        db.add(ResearchNoteDocumentORM(note_id=note_id, title="doc", document_payload=json.dumps(payload)))
        db.commit()


def _attach_file(note_id: str, name: str, user_id: int) -> None:
    with SessionLocal() as db:
        db.add(
            ResearchNoteFileORM(
                note_id=note_id,
                uploaded_by=user_id,
                file_type="image",
                original_name=name,
                storage_key=f"test/{uuid4().hex}",
                mime_type="image/png",
                file_size=1,
            )
        )
        db.commit()


def _add_member(company_id: int, name: str) -> tuple[dict[str, str], int]:
    email = f"member-{uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = UserAccountORM(
            username=email.split("@")[0],
            display_name=name,
            email=email,
            password=hash_password("MemberPass123!"),
            global_role="user",
            is_active=True,
            is_approved=True,
        )
        db.add(user)
        db.flush()
        member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
        db.add(member)
        db.commit()
        member_id = member.id
    login = client.post("/auth/login", json={"email": email, "password": "MemberPass123!"})
    assert login.status_code == 200, login.text
    return {"Authorization": f"Bearer {login.json()['access_token']}"}, member_id


def _owner_user_id(headers: dict[str, str]) -> int:
    return client.get("/auth/me", headers=headers).json()["id"]


def test_search_matches_title_body_files_and_projects() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    marker = uuid4().hex[:6]
    project_id = _project(headers, company_id, owner_member_id, f"촉매 합성 {marker}")
    by_title = _note(headers, project_id, owner_member_id, f"PCR 조건 최적화 {marker}")
    by_body = _note(headers, project_id, owner_member_id, "주간 실험 기록")
    _set_body(by_body, f"오늘 {marker} 샘플의 PCR 밴드를 확인함. 55도에서 가장 선명함.")
    by_file = _note(headers, project_id, owner_member_id, "데이터 정리")
    _attach_file(by_file, f"gel_{marker}.png", _owner_user_id(headers))
    _note(headers, project_id, owner_member_id, "관계없는 노트")

    response = client.get("/search", headers=headers, params={"q": marker})
    assert response.status_code == 200, response.text
    body = response.json()
    assert [project["id"] for project in body["projects"]] == [project_id]
    ids = [note["id"] for note in body["notes"]]
    assert set(ids) == {by_title, by_body, by_file}
    assert ids[0] == by_title  # title matches rank first
    hits = {note["id"]: note for note in body["notes"]}
    assert hits[by_body]["matched_in"] == ["body"]
    assert marker in hits[by_body]["snippet"]
    assert hits[by_file]["matched_files"] == [f"gel_{marker}.png"]
    assert body["note_total"] == 3


def test_search_requires_every_term_and_ignores_template_labels() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    marker = uuid4().hex[:6]
    project_id = _project(headers, company_id, owner_member_id, "P")
    both = _note(headers, project_id, owner_member_id, f"{marker} 전기영동")
    _set_body(both, "아가로스 겔 1% 사용")
    _note(headers, project_id, owner_member_id, f"{marker} 다른 실험")

    body = client.get("/search", headers=headers, params={"q": f"{marker} 아가로스"}).json()
    assert [note["id"] for note in body["notes"]] == [both]

    # Locked template labels such as "작성자" must not make every note match.
    labels = client.get("/search", headers=headers, params={"q": "작성자", "project_id": project_id}).json()
    assert labels["notes"] == []


def test_search_filters_by_author_status_and_date() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    member_headers, member_id = _add_member(company_id, "김연구")
    project_id = _project(headers, company_id, owner_member_id, "필터 프로젝트")
    early = _note(headers, project_id, owner_member_id, "초기 노트", written_date="2026-01-10")
    late = _note(headers, project_id, owner_member_id, "후기 노트", written_date="2026-06-01")
    by_member = _note(headers, project_id, member_id, "연구원 노트", written_date="2026-06-02")

    in_range = client.get(
        "/search", headers=headers, params={"project_id": project_id, "date_from": "2026-05-01"}
    ).json()
    assert {note["id"] for note in in_range["notes"]} == {late, by_member}

    by_author = client.get(
        "/search", headers=headers, params={"project_id": project_id, "author_member_id": member_id}
    ).json()
    assert [note["id"] for note in by_author["notes"]] == [by_member]
    assert by_author["notes"][0]["author_name"] == "김연구"

    drafts = client.get("/search", headers=headers, params={"project_id": project_id, "status": "approved"}).json()
    assert drafts["notes"] == []

    bad_range = client.get(
        "/search", headers=headers, params={"date_from": "2026-06-01", "date_to": "2026-01-01"}
    )
    assert bad_range.status_code == 400
    assert early not in {note["id"] for note in in_range["notes"]}


def test_search_respects_project_membership_and_company() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    marker = uuid4().hex[:6]
    member_headers, member_id = _add_member(company_id, f"박연구 {marker}")
    visible_project = _project(headers, company_id, owner_member_id, f"공개 {marker}")
    hidden_project = _project(headers, company_id, owner_member_id, f"비공개 {marker}")
    with SessionLocal() as db:
        db.add(ProjectMemberORM(project_id=visible_project, company_member_id=member_id, role="member"))
        db.commit()
    visible_note = _note(headers, visible_project, owner_member_id, f"보이는 {marker}")
    _note(headers, hidden_project, owner_member_id, f"숨은 {marker}")

    member_view = client.get("/search", headers=member_headers, params={"q": marker}).json()
    assert [project["id"] for project in member_view["projects"]] == [visible_project]
    assert [note["id"] for note in member_view["notes"]] == [visible_note]
    assert [person["company_member_id"] for person in member_view["researchers"]] == [member_id]

    # A project id the member cannot open returns nothing rather than leaking notes.
    probe = client.get("/search", headers=member_headers, params={"project_id": hidden_project}).json()
    assert probe["notes"] == []

    other_headers, _, _ = create_owner_workspace(client)
    outsider = client.get("/search", headers=other_headers, params={"q": marker}).json()
    assert outsider["projects"] == [] and outsider["notes"] == [] and outsider["researchers"] == []


def test_empty_query_without_filters_returns_nothing() -> None:
    headers, _, _ = create_owner_workspace(client)
    body = client.get("/search", headers=headers).json()
    assert body == {"query": "", "projects": [], "notes": [], "note_total": 0, "researchers": []}
    assert client.get("/search").status_code in {401, 403}
