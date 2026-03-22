# LabNote Backend

FastAPI + DDD 기반 백엔드 초기 구조입니다.

## Run (local)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Run (docker)
```bash
docker compose up --build backend postgres
```

## Pre-created system admins
- 시스템 관리자는 `app/core/system_admins.json`에서 별도 관리합니다.
- 서버 시작 시 해당 파일을 로드하며, 최소 1명 이상의 시스템 관리자가 있어야 합니다.
- 관리 스크립트:
```bash
cd backend
python scripts/manage_system_admins.py list
python scripts/manage_system_admins.py add --username admin2 --display-name "Admin Two" --email admin2@labnote.local
```

## Implemented APIs
- `GET /health`
- Project
  - `POST /projects`
  - `GET /projects`
  - `GET /projects/{project_id}`
  - `PUT /projects/{project_id}`
  - `DELETE /projects/{project_id}`
  - `POST /projects/{project_id}/members`
  - `GET /projects/{project_id}/members`
  - `DELETE /projects/{project_id}/members/{company_member_id}`
- Research Note
  - `POST /research-notes`
  - `GET /research-notes`
  - `GET /research-notes/{note_id}`
  - `PUT /research-notes/{note_id}`
  - `DELETE /research-notes/{note_id}`
- File Upload & PDF Split
  - `POST /research-note-files/upload` (pdf/image)
  - `GET /research-note-files/notes/{note_id}`
  - `GET /research-note-files/{file_id}/pages`

## Storage
- 원본 파일: `{STORAGE_ROOT}/notes/{note_id}/raw/*`
- 페이지 파일: `{STORAGE_ROOT}/notes/{note_id}/pages/*`

## Structure
- `app/domain`: 도메인 모델
- `app/application`: 유스케이스/서비스
- `app/infrastructure`: DB/외부 연동
- `app/presentation`: API 라우터/스키마
- `app/core`: 공통 설정
