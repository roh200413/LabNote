import { FormEvent, useEffect, useRef, useState } from "react";

import {
  SEARCH_MATCH_LABELS,
  SEARCH_NOTE_STATUS_LABELS,
  searchWorkspace,
  type SearchNavigation,
  type SearchResponse,
} from "../api/search";
import { Highlight } from "./GlobalSearch";

type Option = { value: string; label: string };

type Props = {
  /** Query handed over from the top-bar search; a new token re-applies it. */
  initialQuery: string;
  initialAuthorId?: number;
  initialToken: number;
  projectOptions: Option[];
  authorOptions: Option[];
  onNavigate: (target: SearchNavigation) => void;
};

type Filters = {
  q: string;
  projectId: string;
  authorId: string;
  status: string;
  dateFrom: string;
  dateTo: string;
};

const EMPTY_FILTERS: Filters = { q: "", projectId: "", authorId: "", status: "", dateFrom: "", dateTo: "" };
const DEBOUNCE_MS = 250;

export function SearchResults({ initialQuery, initialAuthorId, initialToken, projectOptions, authorOptions, onNavigate }: Props) {
  const [filters, setFilters] = useState<Filters>({
    ...EMPTY_FILTERS,
    q: initialQuery,
    authorId: initialAuthorId ? String(initialAuthorId) : "",
  });
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => {
    // A new request from the top bar starts a fresh search instead of stacking on old filters.
    setFilters({ ...EMPTY_FILTERS, q: initialQuery, authorId: initialAuthorId ? String(initialAuthorId) : "" });
  }, [initialQuery, initialAuthorId, initialToken]);

  const q = filters.q.trim();
  const hasFilter = Boolean(filters.projectId || filters.authorId || filters.status || filters.dateFrom || filters.dateTo);

  useEffect(() => {
    if (!q && !hasFilter) {
      setResult(null);
      setError(null);
      setLoading(false);
      return;
    }
    const seq = ++requestSeq.current;
    setLoading(true);
    const timer = window.setTimeout(() => {
      searchWorkspace({
        q,
        project_id: filters.projectId || undefined,
        author_member_id: filters.authorId ? Number(filters.authorId) : undefined,
        status: filters.status || undefined,
        date_from: filters.dateFrom || undefined,
        date_to: filters.dateTo || undefined,
        limit: 100,
      })
        .then((data) => {
          if (seq !== requestSeq.current) return;
          setResult(data);
          setError(null);
        })
        .catch((err: Error) => {
          if (seq === requestSeq.current) setError(err.message);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [q, hasFilter, filters.projectId, filters.authorId, filters.status, filters.dateFrom, filters.dateTo]);

  const update = (patch: Partial<Filters>) => setFilters((current) => ({ ...current, ...patch }));
  const onSubmit = (event: FormEvent) => event.preventDefault();

  const notes = result?.notes ?? [];
  const projects = result?.projects ?? [];
  const researchers = result?.researchers ?? [];
  const nothing = result && !notes.length && !projects.length && !researchers.length;

  return (
    <section className="search-page">
      <form className="card search-filter-card" onSubmit={onSubmit}>
        <div className="search-page-query">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden>
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="search"
            autoFocus
            value={filters.q}
            placeholder="노트 제목, 본문, 첨부파일 이름, 작성자, 프로젝트로 검색"
            aria-label="검색어"
            onChange={(event) => update({ q: event.target.value })}
          />
        </div>
        <div className="search-filter-row">
          <label>
            프로젝트
            <select value={filters.projectId} onChange={(event) => update({ projectId: event.target.value })}>
              <option value="">전체</option>
              {projectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            작성자
            <select value={filters.authorId} onChange={(event) => update({ authorId: event.target.value })}>
              <option value="">전체</option>
              {authorOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            상태
            <select value={filters.status} onChange={(event) => update({ status: event.target.value })}>
              <option value="">전체</option>
              {Object.entries(SEARCH_NOTE_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            작성일 시작
            <input type="date" value={filters.dateFrom} onChange={(event) => update({ dateFrom: event.target.value })} />
          </label>
          <label>
            작성일 끝
            <input type="date" value={filters.dateTo} onChange={(event) => update({ dateTo: event.target.value })} />
          </label>
          {(hasFilter || filters.q) && (
            <button type="button" className="secondary-button compact-button search-reset" onClick={() => setFilters(EMPTY_FILTERS)}>
              초기화
            </button>
          )}
        </div>
      </form>

      {!q && !hasFilter && (
        <div className="card search-hint">
          <strong>무엇을 찾으시나요?</strong>
          <p>
            검색어를 입력하거나 조건을 고르면 바로 결과가 나옵니다. 여러 단어를 띄어 쓰면 모두 포함한 노트만 찾습니다.
            어디서든 <kbd>Ctrl</kbd>+<kbd>K</kbd> 로 상단 검색창을 열 수 있습니다.
          </p>
        </div>
      )}

      {error && <p className="error">오류: {error}</p>}
      {loading && !result && <p className="search-status">검색 중...</p>}
      {nothing && !loading && <div className="card search-hint"><strong>결과가 없습니다</strong><p>검색어를 줄이거나 조건을 풀어 보세요.</p></div>}

      {notes.length > 0 && (
        <div className="card search-section">
          <div className="search-section-head">
            <h3>연구노트</h3>
            <span>
              {result!.note_total}건{result!.note_total > notes.length ? ` 중 ${notes.length}건 표시` : ""}
              {loading ? " · 갱신 중..." : ""}
            </span>
          </div>
          <ul className="search-note-list">
            {notes.map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  className="search-note-item"
                  onClick={() => onNavigate({ kind: "note", projectId: note.project_id, noteId: note.id })}
                >
                  <div className="search-note-title">
                    <strong>
                      <Highlight text={note.title} query={q} />
                    </strong>
                    <span className={`search-status-pill status-${note.status}`}>
                      {SEARCH_NOTE_STATUS_LABELS[note.status] ?? note.status}
                    </span>
                  </div>
                  <span className="search-note-meta">
                    {note.project_name} · {note.author_name || "작성자 미상"}
                    {note.written_date ? ` · ${note.written_date}` : ""}
                  </span>
                  {note.snippet && (
                    <span className="search-note-snippet">
                      <Highlight text={note.snippet} query={q} />
                    </span>
                  )}
                  {note.matched_files.length > 0 && (
                    <span className="search-note-snippet">
                      첨부: <Highlight text={note.matched_files.join(", ")} query={q} />
                    </span>
                  )}
                  {note.matched_in.length > 0 && (
                    <span className="search-match-tags">
                      {note.matched_in.map((field) => (
                        <em key={field}>{SEARCH_MATCH_LABELS[field] ?? field}</em>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(projects.length > 0 || researchers.length > 0) && (
        <div className="search-side-grid">
          {projects.length > 0 && (
            <div className="card search-section">
              <div className="search-section-head">
                <h3>프로젝트</h3>
                <span>{projects.length}건</span>
              </div>
              <ul className="search-simple-list">
                {projects.map((project) => (
                  <li key={project.id}>
                    <button type="button" onClick={() => onNavigate({ kind: "project", projectId: project.id })}>
                      <strong>
                        <Highlight text={project.name} query={q} />
                      </strong>
                      <span>
                        <Highlight text={project.code} query={q} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {researchers.length > 0 && (
            <div className="card search-section">
              <div className="search-section-head">
                <h3>연구원</h3>
                <span>{researchers.length}명</span>
              </div>
              <ul className="search-simple-list">
                {researchers.map((person) => (
                  <li key={person.company_member_id}>
                    <button
                      type="button"
                      onClick={() => update({ authorId: String(person.company_member_id), q: "" })}
                      title="이 연구원이 작성한 노트 보기"
                    >
                      <strong>
                        <Highlight text={person.name} query={q} />
                      </strong>
                      <span>
                        <Highlight text={person.email} query={q} /> · 작성 노트 보기
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
