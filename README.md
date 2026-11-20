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
pip install -r requirements-dev.txt
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

## LLM 연결 및 연구노트 대량 생성

기관 관리자 계정의 **플랫폼 연동 → LLM API 연결**에서 CliProxy의 Base URL
(기본 `http://127.0.0.1:8317/v1`), 클라이언트 API 키와 모델을 설정합니다.
**모델 목록 불러오기 → 생성 연결 테스트 → 연결 저장** 순서로 확인하세요.
실제 주소와 키를 입력하기 전에는 외부 LLM에 연결되지 않습니다.

프로젝트의 **연구노트 → AI 대량 생성**에서 제목·작성일·작업 메모를 입력하거나 CSV를
불러옵니다. 기존 노트 본문과 첨부 페이지(최대 4장)도 참고할 수 있습니다.
한 번에 최대 100개를 서버에서 생성하며, 각 결과를 편집 가능한 초안으로 저장합니다.
작업 내역에서 진행률 확인, 초안 열기, 남은 작업 취소, 실패·취소 항목 재시도가 가능합니다.

설치·운영·API와 입력 예시는 [LLM 사용 안내](docs/llm-generation.md)를 참고하세요.
