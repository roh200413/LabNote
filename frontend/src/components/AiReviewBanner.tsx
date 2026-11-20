import { useEffect, useState } from "react";

import { apiFetch } from "../api/client";

export type AiReviewState = {
  required: boolean;
  reviewed: boolean;
  source: string | null;
  model: string | null;
  reviewed_by_name: string | null;
  reviewed_at: string | null;
};

async function readError(response: Response, fallback: string) {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // keep the fallback message
  }
  return fallback;
}

type Props = {
  noteId: string;
  noteStatus: string;
  canConfirm: boolean;
  /** Reports the review state so the page can hold back submission. */
  onChange: (state: AiReviewState | null) => void;
};

/** Shown on notes written by the LLM from GitHub changes: a person must check them before submission. */
export function AiReviewBanner({ noteId, noteStatus, canConfirm, onChange }: Props) {
  const [state, setState] = useState<AiReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const update = (next: AiReviewState | null) => {
    setState(next);
    onChange(next);
  };

  useEffect(() => {
    let cancelled = false;
    update(null);
    setError(null);
    apiFetch(`/research-notes/${noteId}/ai-review`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readError(response, "AI 검토 상태를 불러오지 못했습니다"));
        return response.json() as Promise<AiReviewState>;
      })
      .then((next) => {
        if (!cancelled) update(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId, noteStatus]);

  const confirm = async () => {
    if (
      !window.confirm(
        "AI가 쓴 설명을 실제 코드 변경과 대조해 확인하셨나요?\n틀린 내용은 노트 편집에서 고친 뒤 검토 완료를 눌러 주세요. 검토 완료 후에 제출할 수 있습니다."
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      const response = await apiFetch(`/research-notes/${noteId}/ai-review/confirm`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response, "검토 완료 처리에 실패했습니다"));
      update(await response.json());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error">{error}</p>;
  if (!state?.required) return null;

  if (state.reviewed) {
    return (
      <div className="ai-review-banner done" role="status">
        <span className="ai-review-icon" aria-hidden>✓</span>
        <div>
          <strong>AI 작성 내용 검토 완료</strong>
          <span>
            {state.reviewed_by_name ?? "검토자"} ·{" "}
            {state.reviewed_at ? new Date(state.reviewed_at).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : ""}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="ai-review-banner" role="alert">
      <span className="ai-review-icon" aria-hidden>!</span>
      <div>
        <strong>AI가 작성한 노트 · 검토가 필요합니다</strong>
        <span>
          GitHub 코드 변경을 AI{state.model ? `(${state.model})` : ""}가 설명한 내용입니다. 실제 변경과 맞는지 확인하고, 틀린 부분은
          고친 뒤 검토 완료를 눌러야 제출할 수 있습니다.
        </span>
      </div>
      {canConfirm && noteStatus !== "submitted" && noteStatus !== "approved" && (
        <button type="button" className="compact-button" disabled={busy} onClick={() => void confirm()}>
          {busy ? "처리 중..." : "검토 완료"}
        </button>
      )}
    </div>
  );
}
