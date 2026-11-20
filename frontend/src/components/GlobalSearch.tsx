import { KeyboardEvent, useEffect, useRef, useState } from "react";

import {
  SEARCH_NOTE_STATUS_LABELS,
  highlightParts,
  searchWorkspace,
  type SearchNavigation,
  type SearchResearcherHit,
  type SearchResponse,
} from "../api/search";

const RESULT_LIMIT = 30;
const DEBOUNCE_MS = 220;

type Props = {
  onNavigate: (target: SearchNavigation) => void;
};

type OptionTarget = SearchNavigation | { kind: "author"; researcher: SearchResearcherHit };
type Option = { key: string; target: OptionTarget };

export function Highlight({ text, query }: { text: string; query: string }) {
  return (
    <>
      {highlightParts(text, query).map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>
      )}
    </>
  );
}

/** Keep search results and author filtering in the top-bar dropdown. */
export function GlobalSearch({ onNavigate }: Props) {
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState<SearchResearcherHit | null>(null);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const requestSeq = useRef(0);

  const trimmed = query.trim();

  useEffect(() => {
    const seq = ++requestSeq.current;
    if (!trimmed && !author) {
      setResult(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setResult(null);
    setError(null);
    setActiveIndex(-1);
    const timer = window.setTimeout(() => {
      searchWorkspace(author ? { author_member_id: author.company_member_id, limit: RESULT_LIMIT } : { q: trimmed, limit: RESULT_LIMIT })
        .then((data) => {
          if (seq !== requestSeq.current) return;
          setResult(data);
          setError(null);
        })
        .catch((err: Error) => {
          if (seq !== requestSeq.current) return;
          setError(err.message);
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [trimmed, author]);

  // Ctrl+K or "/" focuses the search box from anywhere (except while typing in another field).
  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      } else if (event.key === "/" && !typing) {
        event.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (boxRef.current && !boxRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const notes = result?.notes ?? [];
  const projects = author ? [] : (result?.projects ?? []);
  const researchers = author ? [] : (result?.researchers ?? []);

  const options: Option[] = [
      ...notes.map((note) => ({
        key: `note-${note.id}`,
        target: { kind: "note" as const, projectId: note.project_id, noteId: note.id },
      })),
      ...projects.map((project) => ({
        key: `project-${project.id}`,
        target: { kind: "project" as const, projectId: project.id },
      })),
      ...researchers.map((person) => ({
        key: `researcher-${person.company_member_id}`,
        target: { kind: "author" as const, researcher: person },
      })),
  ];

  const go = (target: OptionTarget) => {
    if (target.kind === "author") {
      setAuthor(target.researcher);
      inputRef.current?.focus();
      return;
    }
    setOpen(false);
    inputRef.current?.blur();
    onNavigate(target);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(options.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(-1, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const selected = options[activeIndex] ?? options[0];
      if (open && selected) go(selected.target);
      else setOpen(true);
    } else if (event.key === "Escape") {
      if (author) setAuthor(null);
      else if (query) setQuery("");
      else inputRef.current?.blur();
      setOpen(false);
    }
  };

  const optionClass = (key: string) =>
    `global-search-option${options[activeIndex]?.key === key ? " active" : ""}`;
  const isEmpty = result && !notes.length && !projects.length && !researchers.length;

  return (
    <div className="global-search" ref={boxRef}>
      <div className="topbar-search">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden className="global-search-icon">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="노트 제목·본문, 프로젝트, 연구원 검색"
          aria-label="검색"
          maxLength={200}
          aria-expanded={open && Boolean(trimmed || author)}
          onChange={(event) => {
            setQuery(event.target.value);
            setAuthor(null);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        {query ? (
          <button type="button" className="global-search-clear" aria-label="검색어 지우기" onClick={() => { setQuery(""); setAuthor(null); inputRef.current?.focus(); }}>
            ×
          </button>
        ) : (
          <kbd className="global-search-kbd">Ctrl K</kbd>
        )}
      </div>

      {open && (trimmed || author) && (
        <div className="global-search-dropdown" role="listbox">
          {author && <button type="button" className="global-search-option" onClick={() => setAuthor(null)}>
            ← {author.name} 작성 노트 · 검색 결과로 돌아가기
          </button>}
          {loading && !result && <p className="global-search-status">검색 중...</p>}
          {error && <p className="global-search-status error">{error}</p>}
          {isEmpty && !loading && <p className="global-search-status">{author ? "작성한 노트가 없습니다." : `"${trimmed}"에 대한 결과가 없습니다.`}</p>}

          {notes.length > 0 && (
            <div className="global-search-group">
              <p className="global-search-group-title">
                연구노트 <span>{result?.note_total}</span>
              </p>
              {notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={optionClass(`note-${note.id}`)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go({ kind: "note", projectId: note.project_id, noteId: note.id })}
                >
                  <strong>
                    <Highlight text={note.title} query={author ? "" : trimmed} />
                  </strong>
                  <span className="global-search-meta">
                    {note.project_name} · {note.author_name || "작성자 미상"}
                    {note.written_date ? ` · ${note.written_date}` : ""} · {SEARCH_NOTE_STATUS_LABELS[note.status] ?? note.status}
                  </span>
                  {note.snippet && (
                    <span className="global-search-snippet">
                      <Highlight text={note.snippet} query={trimmed} />
                    </span>
                  )}
                  {!note.snippet && note.matched_files.length > 0 && (
                    <span className="global-search-snippet">
                      첨부: <Highlight text={note.matched_files.join(", ")} query={trimmed} />
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}

          {projects.length > 0 && (
            <div className="global-search-group">
              <p className="global-search-group-title">프로젝트</p>
              {projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  className={optionClass(`project-${project.id}`)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go({ kind: "project", projectId: project.id })}
                >
                  <strong>
                    <Highlight text={project.name} query={trimmed} />
                  </strong>
                  <span className="global-search-meta">
                    <Highlight text={project.code} query={trimmed} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {researchers.length > 0 && (
            <div className="global-search-group">
              <p className="global-search-group-title">연구원</p>
              {researchers.map((person) => (
                <button
                  key={person.company_member_id}
                  type="button"
                  className={optionClass(`researcher-${person.company_member_id}`)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => go({ kind: "author", researcher: person })}
                  title="이 연구원이 작성한 노트 보기"
                >
                  <strong>
                    <Highlight text={person.name} query={trimmed} />
                  </strong>
                  <span className="global-search-meta">
                    <Highlight text={person.email} query={trimmed} />
                  </span>
                </button>
              ))}
            </div>
          )}

          {result && result.note_total > notes.length && (
            <p className="global-search-status">노트 {result.note_total}건 중 {notes.length}건 표시 · 검색어를 구체화해 주세요.</p>
          )}
        </div>
      )}
    </div>
  );
}
