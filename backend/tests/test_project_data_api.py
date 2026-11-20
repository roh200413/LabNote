from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi.testclient import TestClient

from app.core.security import hash_password
from app.infrastructure.db.models import (
    CompanyMemberORM,
    ProjectMemberORM,
    ResearchNoteORM,
    UserAccountORM,
)
from app.infrastructure.db.session import SessionLocal
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


def _project(headers, company_id, owner_member_id, target=None) -> str:
    body = {"company_id": company_id, "name": "데이터", "code": f"D-{uuid4().hex[:6]}", "owner_member_id": owner_member_id}
    if target:
        body["monthly_note_target"] = target
    response = client.post("/projects", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _member(company_id: int, project_id: str, name: str) -> tuple[dict[str, str], int]:
    email = f"m-{uuid4().hex[:8]}@example.com"
    with SessionLocal() as db:
        user = UserAccountORM(
            username=email.split("@")[0], display_name=name, email=email,
            password=hash_password("MemberPass123!"), global_role="user", is_active=True, is_approved=True,
        )
        db.add(user)
        db.flush()
        member = CompanyMemberORM(company_id=company_id, user_id=user.id, role="member")
        db.add(member)
        db.flush()
        db.add(ProjectMemberORM(project_id=project_id, company_member_id=member.id, role="member"))
        db.commit()
        member_id = member.id
    token = client.post("/auth/login", json={"email": email, "password": "MemberPass123!"}).json()["access_token"]
    return {"Authorization": f"Bearer {token}"}, member_id


def _note(project_id: str, owner_member_id: int, written: date, status: str = "draft", updated_days_ago: int = 0, reviewer=None):
    with SessionLocal() as db:
        note = ResearchNoteORM(
            project_id=project_id, title="n", owner_member_id=owner_member_id, written_date=written,
            status=status, reviewer_member_id=reviewer,
        )
        db.add(note)
        db.flush()
        note.updated_at = datetime.now(timezone.utc) - timedelta(days=updated_days_ago)
        db.commit()


def test_note_activity_flags_members_who_need_attention() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    _, active_id = _member(company_id, project_id, "가성실")
    _, idle_id = _member(company_id, project_id, "나휴면")
    _, empty_id = _member(company_id, project_id, "다신규")
    today = datetime.now(timezone.utc).date()

    _note(project_id, active_id, today, status="approved")
    _note(project_id, idle_id, today - timedelta(days=30), status="rejected")
    _note(project_id, owner_member_id, today, status="draft", updated_days_ago=10)

    response = client.get(f"/projects/{project_id}/note-activity", headers=headers)
    assert response.status_code == 200, response.text
    body = response.json()
    rows = {row["name"]: row for row in body["members"]}
    assert rows["가성실"]["needs_attention"] is False and rows["가성실"]["this_month"] == 1
    assert any("일째 연구노트 미작성" in issue for issue in rows["나휴면"]["issues"])
    assert any("반려된 노트 1건" in issue for issue in rows["나휴면"]["issues"])
    assert rows["다신규"]["issues"] == ["아직 작성한 연구노트가 없음"]
    owner_row = next(row for row in body["members"] if row["is_lead"])
    assert any("제출 안 한 초안" in issue for issue in owner_row["issues"])
    assert body["members"][-1]["name"] == "가성실"  # people needing attention come first
    assert body["attention_count"] == 3


def test_data_storage_upload_list_download_and_delete() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)

    upload = client.post(
        f"/projects/{project_id}/data",
        headers=headers,
        data={"folder": "raw", "paths": ["실험A/day1/a.csv", "실험A/day1/b.png", "memo.txt"]},
        files=[
            ("files", ("a.csv", b"x,y\n1,2", "text/csv")),
            ("files", ("b.png", b"png-bytes", "image/png")),
            ("files", ("memo.txt", "메모".encode(), "text/plain")),
        ],
    )
    assert upload.status_code == 201, upload.text
    assert [item["path"] for item in upload.json()["files"]] == ["raw/실험A/day1/a.csv", "raw/실험A/day1/b.png", "raw/memo.txt"]

    root = client.get(f"/projects/{project_id}/data", headers=headers).json()
    assert [folder["name"] for folder in root["folders"]] == ["raw"] and root["files"] == []
    assert root["total_files"] == 3

    raw = client.get(f"/projects/{project_id}/data", headers=headers, params={"folder": "raw"}).json()
    assert [folder["name"] for folder in raw["folders"]] == ["실험A"]
    assert raw["folders"][0]["file_count"] == 2
    assert [file["name"] for file in raw["files"]] == ["memo.txt"]
    assert [crumb["name"] for crumb in raw["breadcrumbs"]] == ["raw"]

    again = client.post(
        f"/projects/{project_id}/data", headers=headers, data={"folder": "raw"},
        files=[("files", ("memo.txt", b"second", "text/plain"))],
    ).json()
    assert again["files"][0]["name"] == "memo (2).txt"  # never overwrites

    file_id = raw["files"][0]["id"]
    download = client.get(f"/data-files/{file_id}/download", headers=headers)
    assert download.status_code == 200 and download.content == "메모".encode()
    assert "filename*=UTF-8''memo.txt" in download.headers["content-disposition"]

    assert client.post(f"/projects/{project_id}/data/folders", headers=headers, json={"path": "raw/../etc"}).status_code == 400
    assert client.post(f"/projects/{project_id}/data/folders", headers=headers, json={"path": "빈폴더"}).status_code == 201
    assert "빈폴더" in [f["name"] for f in client.get(f"/projects/{project_id}/data", headers=headers).json()["folders"]]

    deleted = client.post(f"/projects/{project_id}/data/delete", headers=headers, json={"folder": "raw/실험A"})
    assert deleted.status_code == 200 and deleted.json()["deleted"] == 2
    assert client.get(f"/projects/{project_id}/data", headers=headers).json()["total_files"] == 2


def test_data_storage_permissions() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    member_headers, _ = _member(company_id, project_id, "연구원")
    owner_file = client.post(
        f"/projects/{project_id}/data", headers=headers, files=[("files", ("o.txt", b"o", "text/plain"))]
    ).json()["files"][0]
    mine = client.post(
        f"/projects/{project_id}/data", headers=member_headers, files=[("files", ("m.txt", b"m", "text/plain"))]
    ).json()["files"][0]

    assert client.post(f"/projects/{project_id}/data/delete", headers=member_headers, json={"file_ids": [owner_file["id"]]}).status_code == 403
    assert client.post(f"/projects/{project_id}/data/delete", headers=member_headers, json={"file_ids": [mine["id"]]}).status_code == 200

    other_headers, _, _ = create_owner_workspace(client)
    assert client.get(f"/projects/{project_id}/data", headers=other_headers).status_code == 403
    assert client.get(f"/data-files/{owner_file['id']}/download", headers=other_headers).status_code == 403
    assert client.get(f"/projects/{project_id}/note-activity", headers=other_headers).status_code == 403


def test_activity_rules_are_configurable_per_project() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    member_headers, idle_id = _member(company_id, project_id, "라느림")
    today = datetime.now(timezone.utc).date()
    _note(project_id, idle_id, today - timedelta(days=10), status="rejected")
    _note(project_id, owner_member_id, today)

    default = client.get(f"/projects/{project_id}/note-activity", headers=headers).json()
    assert default["rules"]["inactive_days"] == 14 and default["rules"]["is_custom"] is False
    assert default["can_manage_rules"] is True
    slow = next(row for row in default["members"] if row["name"] == "라느림")
    assert slow["issues"] == ["반려된 노트 1건 미처리"]  # 10 days < 14

    rules = {"inactive_days": 7, "stale_draft_days": 0, "review_wait_days": 3, "check_rejected": False, "check_monthly_pace": True}
    assert client.put(f"/projects/{project_id}/activity-rules", headers=member_headers, json=rules).status_code == 403
    saved = client.put(f"/projects/{project_id}/activity-rules", headers=headers, json=rules)
    assert saved.status_code == 200 and saved.json()["is_custom"] is True

    custom = client.get(f"/projects/{project_id}/note-activity", headers=headers).json()
    slow = next(row for row in custom["members"] if row["name"] == "라느림")
    assert slow["issues"] == ["10일째 연구노트 미작성"]  # 7-day rule on, rejected check off
    assert client.get(f"/projects/{project_id}/note-activity", headers=member_headers).json()["can_manage_rules"] is False

    assert client.put(f"/projects/{project_id}/activity-rules", headers=headers, json={**rules, "inactive_days": 999}).status_code == 422
    reset = client.delete(f"/projects/{project_id}/activity-rules", headers=headers)
    assert reset.status_code == 200 and reset.json()["inactive_days"] == 14 and reset.json()["is_custom"] is False


def test_assigning_and_changing_member_role_returns_member() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    project_id = _project(headers, company_id, owner_member_id)
    created = client.post(
        "/directory/researcher-management/researchers", headers=headers,
        json={"name": "역할테스트", "email": f"role-{uuid4().hex[:6]}@example.com", "password": "Member1234"},
    ).json()
    added = client.post(f"/projects/{project_id}/members", headers=headers,
                        json={"company_member_id": created["company_member_id"], "role": "member"})
    assert added.status_code == 200, added.text
    assert added.json()["name"] == "역할테스트" and added.json()["role"] == "member"
    changed = client.post(f"/projects/{project_id}/members", headers=headers,
                          json={"company_member_id": created["company_member_id"], "role": "co_researcher"})
    assert changed.status_code == 200 and changed.json()["role"] == "co_researcher"
