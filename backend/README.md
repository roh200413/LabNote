# LabNote Backend

FastAPI + DDD 기반 백엔드 초기 구조입니다.

## Run (local)
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## Run (docker)
```bash
docker compose up --build backend postgres
```

## Implemented APIs
- `GET /health`
- `POST /projects`
- `GET /projects`
- `GET /projects/{project_id}`
- `PUT /projects/{project_id}`
- `DELETE /projects/{project_id}`
- `POST /projects/{project_id}/members`
- `GET /projects/{project_id}/members`
- `DELETE /projects/{project_id}/members/{company_member_id}`
- `POST /research-notes`
- `GET /research-notes`
- `GET /research-notes/{note_id}`
- `PUT /research-notes/{note_id}`
- `DELETE /research-notes/{note_id}`

## Structure
- `app/domain`: 도메인 모델
- `app/application`: 유스케이스/서비스
- `app/infrastructure`: DB/외부 연동
- `app/presentation`: API 라우터/스키마
- `app/core`: 공통 설정
