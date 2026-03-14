# LabNote Frontend

React + TypeScript + Vite 기반 프론트엔드 초기 구조입니다.

## Run (local)
```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

## Run (docker)
```bash
docker compose up --build frontend backend
```

## Implemented UI
- 프로젝트 생성 폼
- 프로젝트 목록/선택
- 프로젝트 멤버 할당 및 멤버 목록
- 연구노트 목록 화면
- 연구노트 상세 화면
- 연구노트 본문 입력/저장

## Structure
- `src/api`: API 호출 함수
- `src/pages`: 라우트 단위 페이지
- `src/components`: 공용 컴포넌트
- `src/layout`: 공용 레이아웃
