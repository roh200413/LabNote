"""Events delivered to the GitHub App's single webhook URL.

GitHub sends every installed repository's push / pull_request events to one endpoint. Each event
names its installation and repository; it is routed to that organization's linked repository and
then handled exactly like a per-repository webhook (``ingest_github_event``).
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.domain.github_integrations.connections import companies_for_installation, remove_installation
from app.domain.github_integrations.use_cases import ingest_github_event
from app.infrastructure.db.models import GitHubRepositoryIntegrationORM
from app.infrastructure.github.client import GitHubClient

NOTE_EVENTS = {"push", "pull_request"}


def handle_app_event(
    db: Session, *, event_type: str, delivery_id: str, payload: dict, client: GitHubClient | None = None
) -> dict:
    installation_id = (payload.get("installation") or {}).get("id")

    if event_type == "installation" and payload.get("action") == "deleted" and installation_id:
        removed = remove_installation(db, int(installation_id))
        return {"status": "uninstalled", "events": [], "message": f"{removed}개 기관의 GitHub App 연결을 해제했습니다"}

    if event_type not in NOTE_EVENTS or not installation_id:
        return {"status": "ignored", "events": [], "message": f"'{event_type}' 이벤트는 노트를 만들지 않습니다"}

    company_ids = companies_for_installation(db, int(installation_id))
    full_name = str((payload.get("repository") or {}).get("full_name") or "")
    owner, _, name = full_name.partition("/")
    if not company_ids or not owner or not name:
        return {"status": "ignored", "events": [], "message": "이 설치나 저장소에 연결된 기관이 없습니다"}

    integrations = db.scalars(
        select(GitHubRepositoryIntegrationORM).where(
            GitHubRepositoryIntegrationORM.company_id.in_(company_ids),
            func.lower(GitHubRepositoryIntegrationORM.repo_owner) == owner.lower(),
            func.lower(GitHubRepositoryIntegrationORM.repo_name) == name.lower(),
            GitHubRepositoryIntegrationORM.status == "active",
        )
    ).all()
    results = []
    for integration in integrations:
        event, note_id = ingest_github_event(
            db,
            integration_id=integration.id,
            delivery_id=delivery_id,
            event_type=event_type,
            payload=payload,
            client=client,
        )
        results.append({"event_id": event.id, "status": event.status, "note_id": note_id})
    if not results:
        return {"status": "ignored", "events": [], "message": "어느 프로젝트에도 연결되지 않은 저장소입니다"}
    return {"status": "received", "events": results, "message": "GitHub event received"}
