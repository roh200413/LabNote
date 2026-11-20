import { useEffect, useState } from "react";

import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  answerFeedback,
  listAdminFeedback,
  type FeedbackItem,
  type FeedbackStatus,
} from "../api/feedback";

type Props = {
  onOpenCountChange: (count: number) => void;
};

type Draft = { status: FeedbackStatus; reply: string };

export function AdminFeedbackPanel({ onOpenCountChange }: Props) {
  const [statusFilter, setStatusFilter] = useState("");
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, Draft>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      const result = await listAdminFeedback(statusFilter || undefined);
      setItems(result.items);
      onOpenCountChange(result.open_count);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  const toggle = (item: FeedbackItem) => {
    setExpanded((current) => (current === item.id ? null : item.id));
    setDrafts((current) =>
      current[item.id] ? current : { ...current, [item.id]: { status: item.status, reply: item.admin_reply ?? "" } }
    );
  };

  const save = async (item: FeedbackItem) => {
    const draft = drafts[item.id];
    if (!draft) return;
    setBusy(item.id);
    setNotice(null);
    try {
      // Answering an untouched "접수" item moves it forward unless the admin chose a status.
      const status = draft.reply.trim() && draft.status === "open" && !item.admin_reply ? "in_progress" : draft.status;
      await answerFeedback(item.id, { status, admin_reply: draft.reply });
      setNotice("답변을 저장했습니다. 사용자는 '의견 보내기 → 내 의견'에서 볼 수 있습니다.");
      setDrafts((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
      setExpanded(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="card">
      <div className="section-head">
        <div>
          <p className="eyebrow">사용자 의견</p>
          <h2>불편사항·문의</h2>
        </div>
        <button type="button" className="secondary-button compact-button" onClick={() => void load()}>
          새로고침
        </button>
      </div>
      <div className="admin-filter-bar">
        <label className="admin-filter-field">
          상태
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">전체</option>
            {Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="admin-filter-summary">
          <span>{items?.length ?? 0}건 표시</span>
        </div>
      </div>
      {error && <p className="error">오류: {error}</p>}
      {notice && <p className="success-copy">{notice}</p>}

      <div className="table-shell">
        <table className="admin-table feedback-table">
          <thead>
            <tr>
              <th>상태</th>
              <th>종류</th>
              <th>제목</th>
              <th>작성자</th>
              <th>기관</th>
              <th>날짜</th>
            </tr>
          </thead>
          <tbody>
            {items !== null && items.length === 0 && (
              <tr>
                <td colSpan={6}>의견이 없습니다.</td>
              </tr>
            )}
            {(items ?? []).map((item) => {
              const draft = drafts[item.id];
              return (
                <FeedbackRows
                  key={item.id}
                  item={item}
                  expanded={expanded === item.id}
                  draft={draft}
                  busy={busy === item.id}
                  onToggle={() => toggle(item)}
                  onDraft={(next) => setDrafts((current) => ({ ...current, [item.id]: next }))}
                  onSave={() => void save(item)}
                />
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function FeedbackRows({
  item,
  expanded,
  draft,
  busy,
  onToggle,
  onDraft,
  onSave,
}: {
  item: FeedbackItem;
  expanded: boolean;
  draft: Draft | undefined;
  busy: boolean;
  onToggle: () => void;
  onDraft: (draft: Draft) => void;
  onSave: () => void;
}) {
  return (
    <>
      <tr className={`feedback-row${expanded ? " expanded" : ""}`} onClick={onToggle}>
        <td>
          <span className={`feedback-status status-${item.status}`}>{FEEDBACK_STATUS_LABELS[item.status] ?? item.status}</span>
        </td>
        <td>{FEEDBACK_CATEGORY_LABELS[item.category] ?? item.category}</td>
        <td>
          <button type="button" className="feedback-title-button" aria-expanded={expanded}>
            {item.title}
          </button>
          {item.admin_reply && <span className="feedback-answered">답변함</span>}
        </td>
        <td>
          {item.user_name}
          <span className="feedback-sub">{item.user_email}</span>
        </td>
        <td>{item.company_name ?? "-"}</td>
        <td>{item.created_at?.slice(0, 10)}</td>
      </tr>
      {expanded && draft && (
        <tr className="feedback-detail-row">
          <td colSpan={6}>
            <div className="feedback-detail">
              <p className="feedback-content">{item.content}</p>
              {item.page && <p className="field-hint">보낸 화면: {item.page}</p>}
              <label>
                답변
                <textarea
                  rows={4}
                  value={draft.reply}
                  onChange={(e) => onDraft({ ...draft, reply: e.target.value })}
                  placeholder="사용자에게 보일 답변을 적어 주세요"
                />
              </label>
              <div className="feedback-detail-actions">
                <label>
                  처리 상태
                  <select value={draft.status} onChange={(e) => onDraft({ ...draft, status: e.target.value as FeedbackStatus })}>
                    {Object.entries(FEEDBACK_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button type="button" className="compact-button" onClick={onSave} disabled={busy}>
                  {busy ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
