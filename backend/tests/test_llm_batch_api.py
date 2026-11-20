import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from uuid import uuid4

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.domain.research_notes import batch_generation
from app.infrastructure.db.models import (
    ResearchNoteDocumentORM,
    ResearchNoteDocumentRevisionORM,
)
from app.infrastructure.db.session import SessionLocal
from app.infrastructure.llm.models import LLMConnectionORM
from app.main import app
from tests.helpers import create_owner_workspace

client = TestClient(app)


@pytest.fixture
def proxy():
    calls = []

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def do_GET(self):
            calls.append((self.path, None, self.headers.get("Authorization")))
            self.respond(
                {
                    "object": "list",
                    "data": [
                        {
                            "id": "proxy-model",
                            "object": "model",
                            "created": 0,
                            "owned_by": "test",
                        }
                    ],
                }
            )

        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            calls.append((self.path, body, self.headers.get("Authorization")))
            if (
                "FAIL-ONCE" in json.dumps(body)
                and sum("FAIL-ONCE" in json.dumps(c[1]) for c in calls) == 1
            ):
                self.respond(
                    {
                        "error": {
                            "message": "secret-key and confidential memo",
                            "type": "rate_limit",
                        }
                    },
                    429,
                )
                return
            content = json.dumps(
                {
                    "sections": [
                        {"heading": "연구 목적", "body": "센서 반복 측정 수행함."},
                        {"heading": "결과", "body": "측정값 10.1 확인함. [확인 필요]"},
                    ]
                },
                ensure_ascii=False,
            )
            self.respond(
                {
                    "id": "chatcmpl-test",
                    "object": "chat.completion",
                    "created": 0,
                    "model": "proxy-model",
                    "choices": [
                        {
                            "index": 0,
                            "message": {
                                "role": "assistant",
                                "content": f"```json\n{content}\n```",
                            },
                            "finish_reason": "stop",
                        }
                    ],
                }
            )

        def respond(self, payload, status=200):
            data = json.dumps(payload).encode()
            self.send_response(status)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_port}/v1", calls
    server.shutdown()
    server.server_close()
    thread.join()


@pytest.fixture
def workspace(monkeypatch, proxy):
    # Keep tests isolated from both provider credentials and the server encryption key file.
    from app.core.config import get_settings

    monkeypatch.setattr(
        get_settings(), "llm_encryption_key", Fernet.generate_key().decode()
    )
    headers, company_id, owner_id = create_owner_workspace(client)
    project = client.post(
        "/projects",
        headers=headers,
        json={
            "company_id": company_id,
            "name": "LLM Test",
            "code": f"AI-{uuid4()}",
            "owner_member_id": owner_id,
        },
    ).json()
    config = {
        "provider": "cliproxy",
        "base_url": proxy[0],
        "model": "proxy-model",
        "api_key": "secret-key",
    }
    response = client.put("/llm/connection", headers=headers, json=config)
    assert response.status_code == 200, response.text
    return headers, company_id, owner_id, project["id"], config


def batch_payload(project_id, **kwargs):
    return {
        "request_id": str(uuid4()),
        "project_id": project_id,
        "entries": [
            {
                "title": "센서 측정",
                "written_date": "2026-11-17",
                "memo": "센서 출력 10.1 측정",
            },
            {
                "title": "FAIL-ONCE",
                "written_date": "2026-11-18",
                "memo": "반복 측정 10.1",
            },
        ],
        **kwargs,
    }


def test_connection_key_is_encrypted_and_not_disclosed(workspace, proxy):
    headers, company, _, _, config = workspace
    result = client.get("/llm/connection", headers=headers)
    assert result.json()["has_api_key"] is True
    assert "secret-key" not in result.text and "encrypted" not in result.text
    with SessionLocal() as db:
        assert "secret-key" not in db.get(LLMConnectionORM, company).encrypted_api_key
    config.pop("api_key")
    assert client.post("/llm/models", headers=headers, json=config).json()[
        "models"
    ] == ["proxy-model"]
    test = client.post("/llm/test", headers=headers, json=config)
    assert test.status_code == 200, test.text
    assert proxy[1][-1][2] == "Bearer secret-key"
    assert "response_format" not in proxy[1][-1][1]
    # Never send an old credential to a newly entered endpoint.
    from app.infrastructure.llm.connections import resolve_settings
    from app.presentation.schemas.llm import ConnectionInput

    with SessionLocal() as db:
        resolved = resolve_settings(
            db,
            company,
            ConnectionInput(**{**config, "base_url": "http://localhost:1/v1"}),
        )
        assert resolved.openai_api_key != "secret-key"
    cleared = client.put(
        "/llm/connection", headers=headers, json={**config, "clear_api_key": True}
    )
    assert cleared.json()["has_api_key"] is False


def test_batch_partial_retry_idempotency_and_saved_documents(
    workspace, proxy, monkeypatch
):
    headers, _, _, project, _ = workspace
    monkeypatch.setattr("app.presentation.routers.llm.dispatch_job", lambda _: None)
    payload = batch_payload(project)
    response = client.post("/llm/batches", headers=headers, json=payload)
    assert response.status_code == 202, response.text
    job_id = response.json()["id"]
    duplicate = client.post("/llm/batches", headers=headers, json=payload)
    assert duplicate.json()["id"] == job_id
    batch_generation.run_job(job_id)
    result = client.get(f"/llm/batches/{job_id}", headers=headers).json()
    assert (
        result["status"] == "partial"
        and result["succeeded"] == 1
        and result["failed"] == 1
    )
    assert "secret-key" not in json.dumps(result)
    assert "한도" in result["items"][1]["error"]
    first_id = result["items"][0]["note_id"]
    assert (
        client.post(f"/llm/batches/{job_id}/retry", headers=headers).status_code == 202
    )
    assert (
        client.post(f"/llm/batches/{job_id}/retry", headers=headers).status_code == 400
    )
    batch_generation.run_job(job_id)
    batch_generation.run_job(job_id)  # A duplicate worker must be harmless.
    result = client.get(f"/llm/batches/{job_id}", headers=headers).json()
    assert result["status"] == "completed" and result["succeeded"] == 2
    assert result["items"][0]["note_id"] == first_id
    assert result["items"][0]["attempts"] == 1 and result["items"][1]["attempts"] == 2
    notes = client.get(f"/research-notes?project_id={project}", headers=headers).json()
    assert len(notes) == 2 and all(
        n["status"] == "draft" and "10.1" in n["content"] for n in notes
    )
    with SessionLocal() as db:
        document = db.scalar(
            select(ResearchNoteDocumentORM).where(
                ResearchNoteDocumentORM.note_id == first_id
            )
        )
        assert document.current_revision_id
        assert (
            db.get(
                ResearchNoteDocumentRevisionORM, document.current_revision_id
            ).created_by
            == result["created_by"]
        )
        assert (
            json.loads(document.document_payload)["blocks"][0]["content"]
            == notes[1]["content"]
        )


def test_validation_and_tenant_boundaries(workspace, monkeypatch):
    headers, company, _, project, config = workspace
    monkeypatch.setattr("app.presentation.routers.llm.dispatch_job", lambda _: None)
    payload = batch_payload(project)
    payload["entries"][0]["memo"] = "   "
    assert client.post("/llm/batches", headers=headers, json=payload).status_code == 422
    assert (
        client.put(
            "/llm/connection",
            headers=headers,
            json={**config, "base_url": "file:///etc/passwd"},
        ).status_code
        == 422
    )
    assert (
        client.put(
            "/llm/connection",
            headers=headers,
            json={**config, "base_url": "http://a:123/v1?key=secret"},
        ).status_code
        == 422
    )
    other_headers, _, _ = create_owner_workspace(client)
    assert (
        client.get(
            f"/llm/connection?company_id={company}", headers=other_headers
        ).status_code
        == 403
    )
    assert (
        client.put(
            f"/llm/connection?company_id={company}", headers=other_headers, json=config
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/llm/batches", headers=other_headers, json=batch_payload(project)
        ).status_code
        == 403
    )
    job = client.post(
        "/llm/batches", headers=headers, json=batch_payload(project)
    ).json()
    assert (
        client.get(f"/llm/batches/{job['id']}", headers=other_headers).status_code
        == 403
    )
    assert client.get("/llm/connection").status_code == 401
    assert (
        client.put(
            "/llm/connection", headers=headers, json={**config, "enabled": False}
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/llm/batches", headers=headers, json=batch_payload(project)
        ).status_code
        == 503
    )
    assert (
        client.get("/research-note-documents/ai/status", headers=headers).json()[
            "enabled"
        ]
        is False
    )


def test_cancel_restart_and_sources(workspace, monkeypatch, proxy):
    headers, _, owner, project, _ = workspace
    monkeypatch.setattr("app.presentation.routers.llm.dispatch_job", lambda _: None)
    source = client.post(
        "/research-notes",
        headers=headers,
        json={
            "project_id": project,
            "title": "원자료",
            "owner_member_id": owner,
            "content": "SOURCE-EVIDENCE 10.1",
        },
    ).json()
    payload = batch_payload(
        project,
        entries=[
            {
                "title": "자료 기반 정리",
                "written_date": "2026-11-17",
                "source_note_id": source["id"],
            }
        ],
    )
    job = client.post("/llm/batches", headers=headers, json=payload).json()
    client.post(f"/llm/batches/{job['id']}/cancel", headers=headers)
    batch_generation.run_job(job["id"])
    result = client.get(f"/llm/batches/{job['id']}", headers=headers).json()
    assert result["status"] == "cancelled" and result["succeeded"] == 0
    client.post(f"/llm/batches/{job['id']}/retry", headers=headers)
    batch_generation.recover_interrupted_jobs()
    result = client.get(f"/llm/batches/{job['id']}", headers=headers).json()
    assert result["status"] == "interrupted"
    client.post(f"/llm/batches/{job['id']}/retry", headers=headers)
    batch_generation.run_job(job["id"])
    assert "SOURCE-EVIDENCE" in json.dumps(proxy[1][-1][1])
    result = client.get(f"/llm/batches/{job['id']}", headers=headers).json()
    assert result["succeeded"] == 1
    # The same saved provider also powers the existing single-note endpoint.
    response = client.post(
        "/research-note-documents/ai/generate",
        headers=headers,
        json={"noteId": source["id"], "memo": "Single-note test"},
    )
    assert response.status_code == 200 and response.json()["model"] == "proxy-model"


def test_atomic_rollback_and_cancellation_during_call(workspace, monkeypatch):
    from app.infrastructure.db.models import ResearchNoteORM
    from app.infrastructure.llm.openai_note_generator import OpenAINoteGenerator

    headers, _, owner, project, _ = workspace
    monkeypatch.setattr("app.presentation.routers.llm.dispatch_job", lambda _: None)
    payload = batch_payload(project)
    payload["entries"] = payload["entries"][:1]
    job = client.post("/llm/batches", headers=headers, json=payload).json()
    original_save = batch_generation._save_result

    def broken_save(db, *_args):
        db.add(
            ResearchNoteORM(
                project_id=project, title="Must roll back", owner_member_id=owner
            )
        )
        db.flush()
        raise RuntimeError("simulated database failure")

    monkeypatch.setattr(batch_generation, "_save_result", broken_save)
    batch_generation.run_job(job["id"])
    result = client.get(f"/llm/batches/{job['id']}", headers=headers).json()
    assert result["status"] == "failed"
    assert (
        client.get(f"/research-notes?project_id={project}", headers=headers).json()
        == []
    )
    monkeypatch.setattr(batch_generation, "_save_result", original_save)
    original_generate = OpenAINoteGenerator.generate

    def cancel_during_call(self, data):
        generated = original_generate(self, data)
        assert (
            client.post(f"/llm/batches/{job['id']}/cancel", headers=headers).status_code
            == 200
        )
        return generated

    monkeypatch.setattr(OpenAINoteGenerator, "generate", cancel_during_call)
    client.post(f"/llm/batches/{job['id']}/retry", headers=headers)
    batch_generation.run_job(job["id"])
    assert (
        client.get(f"/llm/batches/{job['id']}", headers=headers).json()["status"]
        == "cancelled"
    )
    assert (
        client.get(f"/research-notes?project_id={project}", headers=headers).json()
        == []
    )


def test_page_inputs_and_foreign_sources_are_checked(workspace, monkeypatch, proxy):
    from io import BytesIO

    from PIL import Image

    headers, _, owner, project, _ = workspace
    monkeypatch.setattr("app.presentation.routers.llm.dispatch_job", lambda _: None)
    source = client.post(
        "/research-notes",
        headers=headers,
        json={
            "project_id": project,
            "title": "이미지 원자료",
            "owner_member_id": owner,
        },
    ).json()
    payload = batch_payload(
        project,
        entries=[
            {
                "title": "이미지 분석",
                "written_date": "2026-11-17",
                "source_note_id": source["id"],
            }
        ],
    )
    assert client.post("/llm/batches", headers=headers, json=payload).status_code == 400
    picture = BytesIO()
    Image.new("RGB", (100, 100), "white").save(picture, format="PNG")
    uploaded = client.post(
        "/research-note-files/upload",
        headers=headers,
        data={"note_id": source["id"], "uploaded_by": owner},
        files={"upload": ("reference.png", picture.getvalue(), "image/png")},
    )
    assert uploaded.status_code == 201, uploaded.text
    payload["entries"][0]["page_ids"] = [uploaded.json()["pages"][0]["id"]]
    job = client.post("/llm/batches", headers=headers, json=payload).json()
    batch_generation.run_job(job["id"])
    assert (
        client.get(f"/llm/batches/{job['id']}", headers=headers).json()["succeeded"]
        == 1
    )
    content = proxy[1][-1][1]["messages"][1]["content"]
    assert content[1]["type"] == "image_url" and content[1]["image_url"][
        "url"
    ].startswith("data:image/jpeg;base64,")
    payload["request_id"] = str(uuid4())
    payload["entries"][0]["page_ids"] = [99999999]
    assert client.post("/llm/batches", headers=headers, json=payload).status_code == 400
    other_headers, _, _ = create_owner_workspace(client)
    assert (
        client.post("/llm/batches", headers=other_headers, json=payload).status_code
        == 403
    )
