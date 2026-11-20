from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app.infrastructure.db.models import ResearchNoteApprovalEventORM
from app.infrastructure.db.session import SessionLocal
from app.main import app
from tests.helpers import create_owner_workspace
from tests.test_note_generation_api import _create_note

client = TestClient(app)


def _events(note_id: str, user_id: int, *pairs: tuple[str, datetime]) -> None:
    with SessionLocal() as db:
        for event_type, when in pairs:
            db.add(ResearchNoteApprovalEventORM(note_id=note_id, actor_user_id=user_id, event_type=event_type, created_at=when))
        db.commit()


def test_average_days_from_submission_to_approval() -> None:
    headers, company_id, owner_member_id = create_owner_workspace(client)
    user_id = client.get("/auth/me", headers=headers).json()["id"]
    now = datetime.now(timezone.utc)

    empty = client.get("/home/approval-stats", headers=headers).json()
    assert empty["average_days"] is None and empty["approved_count"] == 0

    fast = _create_note(headers, company_id, owner_member_id)
    slow = _create_note(headers, company_id, owner_member_id)
    old = _create_note(headers, company_id, owner_member_id)
    pending = _create_note(headers, company_id, owner_member_id)
    _events(fast, user_id, ("submitted", now - timedelta(days=3)), ("approved", now - timedelta(days=2)))
    # Rejected once: the clock restarts at the last submission.
    _events(
        slow,
        user_id,
        ("submitted", now - timedelta(days=20)),
        ("rejected", now - timedelta(days=15)),
        ("submitted", now - timedelta(days=10)),
        ("approved", now - timedelta(days=7)),
    )
    _events(old, user_id, ("submitted", now - timedelta(days=200)), ("approved", now - timedelta(days=150)))  # outside 90 days
    _events(pending, user_id, ("submitted", now - timedelta(days=1)))

    stats = client.get("/home/approval-stats", headers=headers, params={"scope": "all"}).json()
    assert stats["approved_count"] == 2
    assert stats["average_days"] == 2.0  # (1 + 3) / 2

    other_headers, _, _ = create_owner_workspace(client)
    assert client.get("/home/approval-stats", headers=other_headers, params={"scope": "all"}).json()["approved_count"] == 0
    assert client.get("/home/approval-stats", headers=headers, params={"scope": "everyone"}).status_code == 422
