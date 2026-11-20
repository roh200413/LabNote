import { apiFetch } from "./client";

export type FeedbackCategory = "bug" | "improvement" | "question" | "other";
export type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed";

export type FeedbackItem = {
  id: number;
  created_at: string | null;
  updated_at: string | null;
  category: FeedbackCategory;
  title: string;
  content: string;
  page: string | null;
  status: FeedbackStatus;
  admin_reply: string | null;
  replied_at: string | null;
  user_id: number;
  user_name: string | null;
  user_email: string | null;
  company_name: string | null;
};

export const FEEDBACK_CATEGORY_LABELS: Record<FeedbackCategory, string> = {
  bug: "버그",
  improvement: "개선 제안",
  question: "문의",
  other: "기타",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "접수",
  in_progress: "처리 중",
  resolved: "해결됨",
  closed: "종료",
};

async function request<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let message = fallback;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return response.json();
}

export const sendFeedback = (payload: { category: FeedbackCategory; title: string; content: string; page?: string }) =>
  request<FeedbackItem>("/feedback", "의견을 보내지 못했습니다", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

export const listMyFeedback = () => request<FeedbackItem[]>("/feedback/mine", "내 의견을 불러오지 못했습니다");

export const listAdminFeedback = (status?: string) =>
  request<{ items: FeedbackItem[]; open_count: number }>(
    `/admin/feedback${status ? `?status=${encodeURIComponent(status)}` : ""}`,
    "의견 목록을 불러오지 못했습니다"
  );

export const answerFeedback = (id: number, payload: { status?: FeedbackStatus; admin_reply?: string }) =>
  request<FeedbackItem>(`/admin/feedback/${id}`, "답변을 저장하지 못했습니다", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
