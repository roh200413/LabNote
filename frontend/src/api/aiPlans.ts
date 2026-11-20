import { apiFetch } from "./client";
import type { BatchJob } from "./llm";

export type PlanItem = {
  title: string;
  written_date: string | null;
  focus: string;
  source_hint: string;
};

export type PlanProposal = {
  message?: string;
  rationale?: string;
  recommended_count?: number;
  items?: PlanItem[];
  model?: string;
};

export type AiPlan = {
  id: string;
  project_id: string;
  created_by: number;
  mode: "expand" | "document";
  status: "drafting" | "confirmed";
  source_label: string;
  source_chars: number;
  source_truncated: boolean;
  options: {
    requested_count: number | null;
    date_from: string | null;
    date_to: string | null;
    instructions: string;
    language: string;
  };
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  proposal: PlanProposal;
  job_id: string | null;
  created_at: string | null;
};

// Planning waits for the LLM, which can take a while for long documents.
const LLM_TIMEOUT_MS = 200000;

async function send<T>(path: string, init: RequestInit & { timeoutMs?: number }, fallback: string): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(
      typeof detail === "string"
        ? detail
        : Array.isArray(detail)
          ? detail.map((item: { msg: string }) => item.msg).join(" / ")
          : fallback
    );
  }
  return body as T;
}

const json = (method: string, payload: unknown) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

export function createAiPlan(
  projectId: string,
  input: {
    mode: "expand" | "document";
    noteIds: string[];
    files: File[];
    requestedCount: string;
    dateFrom: string;
    dateTo: string;
    instructions: string;
    language: string;
  }
): Promise<AiPlan> {
  const form = new FormData();
  form.append("mode", input.mode);
  form.append("note_ids", input.noteIds.join(","));
  if (input.requestedCount) form.append("requested_count", input.requestedCount);
  if (input.dateFrom) form.append("date_from", input.dateFrom);
  if (input.dateTo) form.append("date_to", input.dateTo);
  form.append("instructions", input.instructions);
  form.append("language", input.language);
  if (input.mode === "document") input.files.forEach((file) => form.append("files", file));
  return send<AiPlan>(
    `/projects/${projectId}/ai-plans`,
    { method: "POST", body: form, timeoutMs: LLM_TIMEOUT_MS },
    "AI 계획을 만들지 못했습니다"
  );
}

export const listAiPlans = (projectId: string) =>
  send<AiPlan[]>(`/projects/${projectId}/ai-plans`, {}, "AI 계획 목록을 불러오지 못했습니다");

export const replyToAiPlan = (planId: string, message: string) =>
  send<AiPlan>(`/ai-plans/${planId}/messages`, { ...json("POST", { message }), timeoutMs: LLM_TIMEOUT_MS }, "AI에게 요청하지 못했습니다");

export const saveAiPlanItems = (planId: string, items: PlanItem[]) =>
  send<AiPlan>(`/ai-plans/${planId}/items`, json("PUT", { items }), "목록을 저장하지 못했습니다");

export const confirmAiPlan = (planId: string) =>
  send<{ plan: AiPlan; job: BatchJob }>(`/ai-plans/${planId}/confirm`, { ...json("POST", {}), timeoutMs: 30000 }, "생성을 시작하지 못했습니다");
