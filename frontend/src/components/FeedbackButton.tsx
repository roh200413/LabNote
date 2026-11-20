import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";

import {
  FEEDBACK_CATEGORY_LABELS,
  FEEDBACK_STATUS_LABELS,
  listMyFeedback,
  sendFeedback,
  type FeedbackCategory,
  type FeedbackItem,
} from "../api/feedback";

type Tab = "write" | "mine";

/** Best-effort label of the screen the user is on, attached so admins know where the problem was. */
function currentScreenLabel(): string {
  const parts: string[] = [];
  const project = document.querySelector(".project-context-card strong")?.textContent?.trim();
  if (project) parts.push(`프로젝트 ${project}`);
  const active = document.querySelector(".user-nav-item.active strong")?.textContent?.trim();
  if (active) parts.push(active);
  if (document.querySelector(".note-workspace-modal, .research-note-modal, .editor-canvas")) parts.push("노트 편집");
  return parts.join(" > ") || "홈";
}

export function FeedbackButton() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("write");
  const [category, setCategory] = useState<FeedbackCategory>("improvement");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [page, setPage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [items, setItems] = useState<FeedbackItem[] | null>(null);

  const loadMine = async () => {
    try {
      setItems(await listMyFeedback());
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  useEffect(() => {
    if (open && tab === "mine") void loadMine();
  }, [open, tab]);

  const openModal = () => {
    setPage(currentScreenLabel());
    setError(null);
    setNotice(null);
    setOpen(true);
  };

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await sendFeedback({ category, title: title.trim(), content: content.trim(), page });
      setTitle("");
      setContent("");
      setCategory("improvement");
      setNotice("의견을 보냈습니다. 답변은 '내 의견'에서 확인할 수 있습니다.");
      setItems(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const answered = (items ?? []).filter((item) => item.admin_reply).length;

  return (
    <>
      <button type="button" className="secondary-button compact-button feedback-trigger" onClick={openModal}>
        의견 보내기
      </button>

      {/* Portal: the top bar's backdrop-filter would otherwise become the fixed modal's containing block. */}
      {open && createPortal(
        <div className="feedback-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="feedback-modal" role="dialog" aria-modal="true" aria-label="의견 보내기">
            <header className="feedback-modal-head">
              <div>
                <h3>의견 보내기</h3>
                <p>불편한 점, 버그, 개선 아이디어를 알려 주세요. 관리자가 확인하고 답변합니다.</p>
              </div>
              <button type="button" className="secondary-button compact-button" onClick={() => setOpen(false)} aria-label="닫기">
                ×
              </button>
            </header>

            <div className="segmented-control feedback-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === "write"} className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}>
                새 의견
              </button>
              <button type="button" role="tab" aria-selected={tab === "mine"} className={tab === "mine" ? "active" : ""} onClick={() => setTab("mine")}>
                내 의견{items && answered > 0 ? ` · 답변 ${answered}` : ""}
              </button>
            </div>

            {tab === "write" ? (
              <form className="feedback-form" onSubmit={onSubmit}>
                <div className="feedback-categories" role="radiogroup" aria-label="종류">
                  {(Object.keys(FEEDBACK_CATEGORY_LABELS) as FeedbackCategory[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={category === key}
                      className={`feedback-category${category === key ? " active" : ""}`}
                      onClick={() => setCategory(key)}
                    >
                      {FEEDBACK_CATEGORY_LABELS[key]}
                    </button>
                  ))}
                </div>
                <label>
                  제목
                  <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} placeholder="한 줄로 요약해 주세요" required />
                </label>
                <label>
                  내용
                  <textarea
                    value={content}
                    onChange={(event) => setContent(event.target.value)}
                    maxLength={5000}
                    rows={6}
                    placeholder={category === "bug" ? "어떤 작업을 하다가, 무엇이 기대와 다르게 동작했는지 적어 주세요." : "자세히 적어 주실수록 빨리 반영할 수 있습니다."}
                    required
                  />
                </label>
                <p className="field-hint">현재 화면: {page} (함께 전송됩니다)</p>
                {error && <p className="error">오류: {error}</p>}
                {notice && <p className="success-copy">{notice}</p>}
                <div className="feedback-actions">
                  <button type="submit" className="compact-button" disabled={busy || !title.trim() || !content.trim()}>
                    {busy ? "보내는 중..." : "보내기"}
                  </button>
                </div>
              </form>
            ) : (
              <div className="feedback-mine">
                {error && <p className="error">오류: {error}</p>}
                {items === null ? (
                  <p className="context-copy">불러오는 중...</p>
                ) : items.length === 0 ? (
                  <div className="github-empty">아직 보낸 의견이 없습니다.</div>
                ) : (
                  <ul>
                    {items.map((item) => (
                      <li key={item.id}>
                        <div className="feedback-item-head">
                          <span className={`feedback-status status-${item.status}`}>{FEEDBACK_STATUS_LABELS[item.status] ?? item.status}</span>
                          <em>{FEEDBACK_CATEGORY_LABELS[item.category] ?? item.category}</em>
                          <strong>{item.title}</strong>
                          <span className="feedback-date">{item.created_at?.slice(0, 10)}</span>
                        </div>
                        <p className="feedback-content">{item.content}</p>
                        {item.admin_reply ? (
                          <div className="feedback-reply">
                            <strong>관리자 답변{item.replied_at ? ` · ${item.replied_at.slice(0, 10)}` : ""}</strong>
                            <p>{item.admin_reply}</p>
                          </div>
                        ) : (
                          <p className="field-hint">아직 답변이 없습니다.</p>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>
        </div>,
        document.body
      )}
    </>
  );
}
