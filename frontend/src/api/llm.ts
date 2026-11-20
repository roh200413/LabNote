import { apiFetch } from "./client";

export type ConnectionInput = {
  provider: "cliproxy" | "openai" | "compatible";
  base_url: string;
  model: string;
  api_key?: string;
  clear_api_key?: boolean;
  enabled: boolean;
  json_mode: boolean;
  timeout_seconds: number;
};
export type LlmConnection = ConnectionInput & {
  company_id: number; can_manage: boolean; has_api_key: boolean; source: string;
};
export type BatchEntry = {
  title: string; written_date: string; memo: string; source_note_id?: string; page_ids?: number[];
};
export type BatchItem = {
  id: number; title: string; status: string; note_id: string | null;
  model: string | null; error: string | null; attempts: number;
};
export type BatchJob = {
  id: string; project_id: string; created_by: number; created_at: string;
  status: string; cancel_requested: boolean; total: number; succeeded: number; failed: number; items: BatchItem[];
};

async function request<T>(path: string, payload?: unknown, method = "POST", timeoutMs = 10000): Promise<T> {
  const response = await apiFetch(`/llm${path}`, {
    method: payload === undefined ? "GET" : method, timeoutMs,
    ...(payload === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = body?.detail;
    throw new Error(typeof detail === "string" ? detail : Array.isArray(detail)
      ? detail.map((e: { loc: (string | number)[]; msg: string }) => `${e.loc.slice(1).join(".")}: ${e.msg}`).join(" / ")
      : "요청을 처리하지 못했습니다");
  }
  return body as T;
}

const companyQuery = (id?: number) => id ? `?company_id=${id}` : "";
export const getLlmConnection = (id?: number) => request<LlmConnection>(`/connection${companyQuery(id)}`);
export const saveLlmConnection = (input: ConnectionInput, id?: number) => request<LlmConnection>(`/connection${companyQuery(id)}`, input, "PUT");
export const getLlmModels = (input: ConnectionInput, id?: number) => request<{ models: string[] }>(`/models${companyQuery(id)}`, input, "POST", 200000);
export const testLlmConnection = (input: ConnectionInput, id?: number) => request<{ model: string; text: string }>(`/test${companyQuery(id)}`, input, "POST", 200000);
export const createBatch = (input: { request_id: string; project_id: string; language: string; context: string; entries: BatchEntry[] }) => request<BatchJob>("/batches", input, "POST", 30000);
export const listBatches = (projectId: string) => request<BatchJob[]>(`/batches?project_id=${encodeURIComponent(projectId)}`);
export const getBatch = (id: string) => request<BatchJob>(`/batches/${id}`);
export const retryBatch = (id: string) => request<BatchJob>(`/batches/${id}/retry`, {});
export const cancelBatch = (id: string) => request<BatchJob>(`/batches/${id}/cancel`, {});
