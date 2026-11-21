import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "../api/client";

type Tag = "awaiting_approval" | "rejected" | "ai_unreviewed" | "needs_check";

type ReviewItem = {
  id: string;
  title: string;
  status: string;
  written_date: string | null;
  updated_days: number;
  author_name: string;
  reviewer_name: string | null;
  tags: Tag[];
  checks: string[];
  ai_source: "github" | "ai_batch" | null;
  ai_model: string | null;
  can_confirm_ai: boolean;
};

type ReviewQueue = {
  counts: Record<Tag, number>;
  total: number;
  clean: number;
  items: ReviewItem[];
};

type Props = {
  projectId: string;
  /** Opens the note (project's 연구노트 tab, note window open). */
  onOpenNote: (noteId: string) => void;
  /** Called after a person confirmed an AI note, so lists elsewhere can refresh. */
  onChanged?: () => void;
};

const TABS: Array<{ id: Tag | "all"; label: string; hint: string }> = [
  { id: "all", label: "전체", hint: "검토가 필요한 모든 노트" },
  { id: "awaiting_approval", label: "결재 대기", hint: "제출되어 검토자의 승인을 기다리는 노트" },
  { id: "ai_unreviewed", label: "AI 작성 확인", hint: "AI가 쓴 내용을 사람이 아직 확인하지 않은 노트" },
  { id: "rejected", label: "반려됨", hint: "작성자가 고쳐서 다시 내야 하는 노트" },
  { id: "needs_check", label: "자동 점검", hint: "비어 있거나 확인이 덜 된 부분이 있는 노트" },
];

const TAG_LABELS: Record<Tag, string> = {
  awaiting_approval: "결재 대기",
  rejected: "반려",
  ai_unreviewed: "AI 확인 필요",
  needs_check: "점검 필요",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  reopened: "재개됨",
  submitted: "제출됨",
  rejected: "반려됨",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : "요청을 처리하지 못했습니다");
  return body as T;
}

/** 연구노트 > 검토: one list of every note in the project that needs someone to look at it. */
export function NoteReviewPage({ projectId, onOpenNote, onChanged }: Props) {
  const [data, setData] = useState<ReviewQueue | null>(null);
  const [tab, setTab] = useState<Tag | "all">("all");
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let live = true;
    request<ReviewQueue>(`/projects/${projectId}/note-review`)
      .then((result) => live && (setData(result), setError(null)))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [projectId, reload]);

  const items = useMemo(
    () => (data ? data.items.filter((item) => tab === "all" || item.tags.includes(tab)) : []),
    [data, tab]
  );

  const confirmAi = async (item: ReviewItem) => {
    if (!window.confirm(`'${item.title}'의 AI 작성 내용을 실제 변경과 맞는지 확인했습니까? 확인하면 제출할 수 있게 됩니다.`)) return;
    setBusyId(item.id);
    try {
      await request(`/research-notes/${item.id}/ai-review/confirm`, { method: "POST" });
      setReload((value) => value + 1);
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  if (error && !data) return <p className="error">검토 목록: {error}</p>;
  if (!data) return <p className="field-hint">검토할 노트를 불러오는 중...</p>;

  return (
    <div className="nr">
      <div className="nr-tabs" role="tablist" aria-label="검토 종류">
        {TABS.map((item) => {
          const count = item.id === "all" ? data.total : data.counts[item.id];
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              className={`nr-tab${tab === item.id ? " active" : ""}${count > 0 && item.id !== "all" ? " has" : ""}`}
              onClick={() => setTab(item.id)}
              title={item.hint}
            >
              {item.label}
              <strong>{count}</strong>
            </button>
          );
        })}
      </div>
      <p className="field-hint nr-hint">
        {TABS.find((item) => item.id === tab)?.hint}. 승인된 노트는 이 목록에 나오지 않습니다.
        {data.clean > 0 && ` 문제가 없는 진행 중 노트 ${data.clean}건은 숨겨져 있습니다.`}
      </p>
      {error && <p className="error">오류: {error}</p>}

      {items.length === 0 ? (
        <div className="nr-empty">
          <strong>{data.total === 0 ? "검토할 노트가 없습니다" : "이 항목에는 노트가 없습니다"}</strong>
          <span>{data.total === 0 ? "모든 노트가 확인된 상태입니다." : "다른 탭에서 확인하세요."}</span>
        </div>
      ) : (
        <ul className="nr-list">
          {items.map((item) => (
            <li key={item.id} className={`nr-item${item.tags.includes("awaiting_approval") ? " warn" : item.tags.includes("rejected") ? " danger" : ""}`}>
              <div className="nr-main">
                <div className="nr-title-row">
                  <strong>{item.title}</strong>
                  <span className={`note-status-badge status-${item.status}`}>{STATUS_LABELS[item.status] ?? item.status}</span>
                  {item.ai_source && (
                    <span className="nr-ai" title={item.ai_model ?? undefined}>
                      AI 작성{item.ai_source === "github" ? " (GitHub)" : ""}
                    </span>
                  )}
                </div>
                <p className="nr-meta">
                  작성자 {item.author_name || "-"} · 검토자 {item.reviewer_name ?? "미지정"}
                  {item.written_date ? ` · 작성일 ${item.written_date}` : ""} · {item.updated_days === 0 ? "오늘 수정" : `${item.updated_days}일 전 수정`}
                </p>
                <div className="nr-tags">
                  {item.tags
                    .filter((tag) => tag !== "needs_check")
                    .map((tag) => (
                      <span key={tag} className={`nr-tag ${tag}`}>
                        {TAG_LABELS[tag]}
                      </span>
                    ))}
                </div>
                {item.checks.length > 0 && (
                  <ul className="nr-checks">
                    {item.checks.map((check) => (
                      <li key={check}>{check}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="nr-actions">
                {item.can_confirm_ai && (
                  <button type="button" className="secondary-button compact-button" onClick={() => void confirmAi(item)} disabled={busyId === item.id}>
                    {busyId === item.id ? "처리 중..." : "AI 내용 확인 완료"}
                  </button>
                )}
                <button type="button" className="compact-button" onClick={() => onOpenNote(item.id)}>
                  {item.tags.includes("awaiting_approval") ? "열어서 결재" : "노트 열기"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
