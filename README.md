# LabNote

연구노트 관리 플랫폼 초기 프로젝트입니다.

## 구성
- `backend`: FastAPI + DDD 기반 백엔드 초기 구조
- `frontend`: React + TypeScript + Vite 기반 프론트엔드 초기 구조
- `docs`: 기획서 및 DBML 스키마

## 빠른 시작 (로컬)
### Backend
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -e .
cp .env.example .env
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

### Frontend
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## 빠른 시작 (Docker Compose)
```bash
cp .env.example .env
docker compose up --build
```

- Frontend: http://localhost:5173
- Backend: http://localhost:8000/health
- PostgreSQL: localhost:5432
