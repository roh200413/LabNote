import { apiFetch } from "./client";

export type SearchProjectHit = {
  id: string;
  name: string;
  code: string;
  status: string;
  description: string;
};

export type SearchNoteHit = {
  id: string;
  title: string;
  project_id: string;
  project_name: string;
  status: string;
  written_date: string | null;
  updated_at: string | null;
  author_member_id: number;
  author_name: string;
  matched_in: Array<"title" | "body" | "file" | "author">;
  matched_files: string[];
  snippet: string;
};

export type SearchResearcherHit = {
  company_member_id: number;
  name: string;
  email: string;
  role: string;
};

export type SearchResponse = {
  query: string;
  projects: SearchProjectHit[];
  notes: SearchNoteHit[];
  note_total: number;
  researchers: SearchResearcherHit[];
};

export type SearchParams = {
  q?: string;
  project_id?: string;
  author_member_id?: number;
  status?: string;
  date_from?: string;
  date_to?: string;
  limit?: number;
};

/** Where a search result should take the user; handled by HomePage. */
export type SearchNavigation =
  | { kind: "project"; projectId: string }
  | { kind: "note"; projectId: string; noteId: string };

export async function searchWorkspace(params: SearchParams): Promise<SearchResponse> {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  }
  const response = await apiFetch(`/search?${query.toString()}`);
  if (!response.ok) {
    let detail = "검색에 실패했습니다";
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") detail = body.detail;
    } catch {
      // keep the generic message
    }
    throw new Error(detail);
  }
  return response.json();
}

export const SEARCH_NOTE_STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  reopened: "재개됨",
  submitted: "제출됨",
  approved: "승인됨",
  rejected: "반려됨",
};

export const SEARCH_MATCH_LABELS: Record<string, string> = {
  title: "제목",
  body: "본문",
  file: "첨부파일",
  author: "작성자",
};

/** Splits text into plain and highlighted parts for every (case-insensitive) search term. */
export function highlightParts(text: string, query: string): Array<{ text: string; hit: boolean }> {
  const terms = query
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!text || terms.length === 0) return [{ text, hit: false }];
  const pattern = new RegExp(`(${terms.join("|")})`, "gi");
  return text
    .split(pattern)
    .filter((part) => part !== "")
    .map((part) => ({ text: part, hit: terms.some((term) => new RegExp(`^${term}$`, "i").test(part)) }));
}
