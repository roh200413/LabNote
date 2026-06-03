from __future__ import annotations

import json
import re
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field


router = APIRouter(prefix="/api/autoflow", tags=["autoflow-attachment"])

WORKSPACE_STATE_DIR = Path(__file__).resolve().parents[4] / ".labnote" / "autoflow_workspaces"
SLUG_RE = re.compile(r"[^a-z0-9]+")


class AutoFlowSourceDocument(BaseModel):
    id: int | None = None
    title: str | None = None
    relative_path: str
    content: str | None = None


class AutoFlowExecutionRequest(BaseModel):
    projectSlug: str
    projectName: str | None = None
    taskType: str | None = None
    artifactType: str | None = None
    artifactTitle: str | None = None
    sourceDocuments: list[AutoFlowSourceDocument] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


def _normalize_slug(value: str | None) -> str:
    text = str(value or "").strip().lower()
    normalized = SLUG_RE.sub("-", text).strip("-")
    return normalized or "workspace"


def _workspace_file(project_slug: str) -> Path:
    return WORKSPACE_STATE_DIR / f"{_normalize_slug(project_slug)}.json"


def _write_workspace_state(project_slug: str, payload: dict[str, Any]) -> None:
    WORKSPACE_STATE_DIR.mkdir(parents=True, exist_ok=True)
    _workspace_file(project_slug).write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _read_workspace_state(project_slug: str) -> dict[str, Any] | None:
    path = _workspace_file(project_slug)
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None


def _excerpt(text: str | None, *, limit: int = 220) -> str | None:
    value = " ".join(str(text or "").split())
    if not value:
        return None
    if len(value) <= limit:
        return value
    return f"{value[:limit].rstrip()}..."


@router.post("/executions")
def create_autoflow_execution(payload: AutoFlowExecutionRequest, request: Request) -> dict[str, Any]:
    project_slug = _normalize_slug(payload.projectSlug)
    preview_url = str(request.url_for("get_autoflow_workspace_preview", project_slug=project_slug))
    source_documents = [
        {
            "id": item.id,
            "title": item.title or Path(item.relative_path).stem.replace("-", " ").title(),
            "relative_path": item.relative_path,
            "excerpt": _excerpt(item.content),
        }
        for item in payload.sourceDocuments
    ]
    workspace_state = {
        "project_slug": project_slug,
        "project_name": payload.projectName or project_slug,
        "task_type": payload.taskType or "research.sync",
        "artifact_type": payload.artifactType or "research_preview",
        "artifact_title": payload.artifactTitle or f"{payload.projectName or project_slug} LabNote Preview",
        "document_count": len(source_documents),
        "source_documents": source_documents,
        "metadata": payload.metadata or {},
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    _write_workspace_state(project_slug, workspace_state)
    return {
        "status": "succeeded",
        "artifact": {
            "artifact_type": workspace_state["artifact_type"],
            "title": workspace_state["artifact_title"],
            "url": preview_url,
            "path": None,
            "metadata": {
                "connector": "labnote",
                "project_slug": project_slug,
                "document_count": workspace_state["document_count"],
                "task_type": workspace_state["task_type"],
            },
        },
    }


@router.get("/workspaces/{project_slug}", name="get_autoflow_workspace_preview", response_class=HTMLResponse)
def get_autoflow_workspace_preview(project_slug: str, request: Request) -> HTMLResponse:
    state = _read_workspace_state(project_slug)
    if not state:
        return HTMLResponse(
            content="""
            <html><body style="font-family: sans-serif; padding: 32px;">
              <h1>LabNote workspace preview not found</h1>
              <p>No AutoFlowPlus execution has been stored for this workspace yet.</p>
            </body></html>
            """,
            status_code=404,
        )

    request_base = str(request.base_url).rstrip("/")
    links = [
        ("Projects", f"{request_base}/projects"),
        ("Research Notes", f"{request_base}/research-notes"),
        ("Directory", f"{request_base}/directory"),
        ("Health", f"{request_base}/health"),
    ]
    documents_html = "".join(
        f"""
        <li style="margin: 0 0 12px;">
          <strong>{escape(item['title'] or item['relative_path'])}</strong><br />
          <code>{escape(item['relative_path'])}</code>
          {f"<div style='margin-top:4px;color:#475569'>{escape(item['excerpt'])}</div>" if item.get('excerpt') else ""}
        </li>
        """
        for item in state.get("source_documents", [])
    )
    links_html = "".join(
        f"<a href='{escape(url)}' style='display:inline-block;margin-right:10px;margin-bottom:10px;padding:10px 14px;border:1px solid #c7d2fe;border-radius:12px;text-decoration:none;color:#4338ca;background:#eef2ff'>{escape(label)}</a>"
        for label, url in links
    )
    html = f"""
    <html>
      <head>
        <title>{escape(state['artifact_title'])}</title>
        <meta charset="utf-8" />
      </head>
      <body style="font-family: Inter, Arial, sans-serif; margin: 0; background: #f8faff; color: #0f172a;">
        <main style="max-width: 960px; margin: 0 auto; padding: 40px 24px 64px;">
          <p style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#4338ca;">LabNote sibling web preview</p>
          <h1 style="margin: 0 0 12px;">{escape(state['artifact_title'])}</h1>
          <p style="margin: 0 0 18px; color: #334155;">
            Project <strong>{escape(state['project_name'])}</strong> was attached from AutoFlowPlus into the LabNote research workspace.
          </p>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin:24px 0;">
            <section style="padding:16px;border:1px solid #c7d2fe;border-radius:16px;background:#fff;">
              <div style="font-size:12px;color:#4338ca;">Task</div>
              <strong>{escape(state['task_type'])}</strong>
            </section>
            <section style="padding:16px;border:1px solid #c7d2fe;border-radius:16px;background:#fff;">
              <div style="font-size:12px;color:#4338ca;">Artifact Type</div>
              <strong>{escape(state['artifact_type'])}</strong>
            </section>
            <section style="padding:16px;border:1px solid #c7d2fe;border-radius:16px;background:#fff;">
              <div style="font-size:12px;color:#4338ca;">Document Count</div>
              <strong>{state['document_count']}</strong>
            </section>
            <section style="padding:16px;border:1px solid #c7d2fe;border-radius:16px;background:#fff;">
              <div style="font-size:12px;color:#4338ca;">Updated</div>
              <strong>{escape(state['updated_at'])}</strong>
            </section>
          </div>
          <section style="padding:18px;border:1px solid #c7d2fe;border-radius:18px;background:#fff;margin-bottom:18px;">
            <h2 style="margin:0 0 12px;font-size:18px;">LabNote links</h2>
            <div>{links_html}</div>
          </section>
          <section style="padding:18px;border:1px solid #c7d2fe;border-radius:18px;background:#fff;">
            <h2 style="margin:0 0 12px;font-size:18px;">Attached source documents</h2>
            <ul style="margin:0;padding-left:18px;">
              {documents_html or "<li>No source documents were attached.</li>"}
            </ul>
          </section>
        </main>
      </body>
    </html>
    """
    return HTMLResponse(content=html)
