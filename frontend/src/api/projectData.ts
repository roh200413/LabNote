import { apiFetch } from "./client";
import type { UploadItem } from "../lib/folderUpload";

export type MemberActivity = {
  company_member_id: number;
  name: string;
  email: string;
  role: string;
  is_lead: boolean;
  total: number;
  this_month: number;
  monthly_share: number | null;
  last_written: string | null;
  days_since_last: number | null;
  drafts: number;
  rejected: number;
  waiting_review: number;
  issues: string[];
  needs_attention: boolean;
};

export type NoteActivity = {
  project_id: string;
  today: string;
  month_start: string;
  monthly_target: number | null;
  month_total: number;
  member_count: number;
  attention_count: number;
  rules: ActivityRules;
  can_manage_rules: boolean;
  members: MemberActivity[];
};

/** When a member counts as "needs attention". A day value of 0 turns that check off. */
export type ActivityRules = {
  inactive_days: number;
  stale_draft_days: number;
  review_wait_days: number;
  check_rejected: boolean;
  check_monthly_pace: boolean;
  is_custom?: boolean;
};

export type DataFile = {
  id: number;
  name: string;
  folder: string;
  path: string;
  size: number;
  mime_type: string;
  uploaded_by: number | null;
  created_at: string | null;
};

export type DataFolderListing = {
  project_id: string;
  folder: string;
  breadcrumbs: Array<{ name: string; path: string }>;
  folders: Array<{ name: string; path: string; file_count: number; size: number }>;
  files: DataFile[];
  total_files: number;
  total_size: number;
};

async function json<T>(path: string, init: RequestInit & { timeoutMs?: number }, fallback: string): Promise<T> {
  const response = await apiFetch(path, init);
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof body?.detail === "string" ? body.detail : fallback);
  return body as T;
}

export const getNoteActivity = (projectId: string) =>
  json<NoteActivity>(`/projects/${projectId}/note-activity`, {}, "작성 현황을 불러오지 못했습니다");

export const saveActivityRules = (projectId: string, rules: ActivityRules) =>
  json<ActivityRules>(
    `/projects/${projectId}/activity-rules`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        inactive_days: rules.inactive_days,
        stale_draft_days: rules.stale_draft_days,
        review_wait_days: rules.review_wait_days,
        check_rejected: rules.check_rejected,
        check_monthly_pace: rules.check_monthly_pace,
      }),
    },
    "기준을 저장하지 못했습니다"
  );

export const resetActivityRules = (projectId: string) =>
  json<ActivityRules>(`/projects/${projectId}/activity-rules`, { method: "DELETE" }, "기준을 되돌리지 못했습니다");

export const listDataFolder = (projectId: string, folder = "") =>
  json<DataFolderListing>(`/projects/${projectId}/data?folder=${encodeURIComponent(folder)}`, {}, "데이터 목록을 불러오지 못했습니다");

/** Uploads in small batches so one huge folder does not become one huge request. */
export async function uploadDataItems(
  projectId: string,
  folder: string,
  items: UploadItem[],
  onProgress?: (done: number, total: number) => void
): Promise<number> {
  const batchSize = 20;
  let done = 0;
  for (let start = 0; start < items.length; start += batchSize) {
    const batch = items.slice(start, start + batchSize);
    const form = new FormData();
    form.append("folder", folder);
    batch.forEach((item) => {
      form.append("files", item.file, item.file.name);
      form.append("paths", item.path);
    });
    await json(`/projects/${projectId}/data`, { method: "POST", body: form, timeoutMs: 300000 }, "업로드에 실패했습니다");
    done += batch.length;
    onProgress?.(done, items.length);
  }
  return done;
}

export const createDataFolder = (projectId: string, path: string) =>
  json<{ path: string }>(
    `/projects/${projectId}/data/folders`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) },
    "폴더를 만들지 못했습니다"
  );

export const deleteDataItems = (projectId: string, payload: { file_ids?: number[]; folder?: string }) =>
  json<{ deleted: number }>(
    `/projects/${projectId}/data/delete`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
    "삭제하지 못했습니다"
  );

/** Downloads a stored file with the user's token (storage is not public). */
export async function fetchDataFile(file: DataFile): Promise<File> {
  const response = await apiFetch(`/data-files/${file.id}/download`, { timeoutMs: 300000 });
  if (!response.ok) throw new Error(`${file.name}을(를) 가져오지 못했습니다`);
  const blob = await response.blob();
  return new File([blob], file.name, { type: file.mime_type || blob.type });
}
