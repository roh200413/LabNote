import { useEffect, useState } from "react";

import { listNoteAuditLog, listProjectNoteAuditLog, type NoteAuditEntry } from "../api/researchNote";

type Props = {
  /** One note's history; or pass projectId for every note of a project (deleted notes included). */
  noteId?: string;
  projectId?: string;
  /** Changes when something happened, so an open panel reloads. */
  refreshKey?: string | number;
};

const FIELD_LABELS: Record<string, string> = {
  title: "제목",
  content: "본문",
  status: "상태",
  written_date: "작성일",
  reviewed_date: "검토일",
  owner_member_id: "작성자",
  reviewer_member_id: "검토자",
  author_member_id: "작성자",
  bundle_id: "묶음",
};

const SOURCE_LABELS: Record<string, string> = { github: "GitHub 연동", ai_batch: "AI 일괄 생성" };

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "없음";
  const text = String(value);
  return text.length > 40 ? `${text.slice(0, 40)}…` : text;
}

function changeText(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const { from, to } = value as { from?: unknown; to?: unknown };
  return `${show(from)} → ${show(to)}`;
}

/** One-line description of what an entry changed. */
function describe(entry: NoteAuditEntry): string {
  const d = entry.detail;
  const parts: string[] = [];
  if (typeof d.source === "string") parts.push(SOURCE_LABELS[d.source] ?? d.source);
  if (d.changes && typeof d.changes === "object") {
    for (const [field, value] of Object.entries(d.changes as Record<string, unknown>)) {
      const text = field === "content" ? "수정됨" : changeText(value);
      parts.push(`${FIELD_LABELS[field] ?? field}: ${text}`);
    }
  }
  for (const key of ["author_member_id", "reviewer_member_id", "bundle_id"]) {
    const text = changeText(d[key]);
    if (text) parts.push(`${FIELD_LABELS[key]} 변경`);
  }
  if (typeof d.file_name === "string") parts.push(d.file_name + (d.pages ? ` (${d.pages}쪽)` : ""));
  if (typeof d.revision_no === "number") parts.push(`리비전 ${d.revision_no}`);
  if (typeof d.summary === "string" && d.summary) parts.push(d.summary);
  if (typeof d.comment === "string" && d.comment) parts.push(`의견: ${d.comment}`);
  return parts.join(" · ");
}

/** Who did what to a research note, newest first. Collapsed until opened. */
export function NoteAuditLog({ noteId, projectId, refreshKey }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<NoteAuditEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const project = Boolean(projectId);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const load = projectId ? listProjectNoteAuditLog(projectId) : noteId ? listNoteAuditLog(noteId) : Promise.resolve([]);
    load
      .then((rows) => live && (setEntries(rows), setError(null)))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [open, noteId, projectId, refreshKey]);

  return (
    <details className="card note-audit-log" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)}>
      <summary>
        <strong>{project ? "프로젝트 노트 변경 이력" : "변경 이력"}</strong>
        <span className="field-hint">
          {project ? "삭제된 노트를 포함해 누가 무엇을 했는지 기록됩니다." : "이 노트에서 누가 언제 무엇을 했는지 기록됩니다."}
        </span>
      </summary>
      {error && <p className="error">{error}</p>}
      {!error && entries === null && <p className="field-hint">불러오는 중...</p>}
      {!error && entries !== null && entries.length === 0 && <p className="field-hint">기록된 이력이 없습니다.</p>}
      {entries !== null && entries.length > 0 && (
        <ul className="note-audit-list">
          {entries.map((entry) => (
            <li key={entry.id}>
              <span className="note-audit-time">{new Date(entry.created_at).toLocaleString()}</span>
              <span className={`note-audit-action action-${entry.action}`}>{entry.action_label}</span>
              <span className="note-audit-body">
                <strong>{entry.actor_name}</strong>
                {project && entry.note_title ? <em> · {entry.note_title}</em> : null}
                {describe(entry) ? <span className="note-audit-detail">{describe(entry)}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
