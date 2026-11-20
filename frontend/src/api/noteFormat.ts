import { apiFetch } from "./client";
import type { NoteFormat } from "../lib/noteFormat";

export type NoteFormatInfo = {
  company_id: number | null;
  is_custom: boolean;
  can_manage: boolean;
  format: NoteFormat;
  default_format: NoteFormat;
};

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
    if (Array.isArray(body?.detail) && body.detail[0]?.msg) return String(body.detail[0].msg);
  } catch {
    // Non-JSON error bodies fall back to the generic message.
  }
  return fallback;
}

export async function getNoteFormat(): Promise<NoteFormatInfo> {
  const response = await apiFetch("/note-format");
  if (!response.ok) throw new Error(await readErrorDetail(response, "노트 포맷을 불러오지 못했습니다"));
  return response.json();
}

export async function saveNoteFormat(format: NoteFormat): Promise<NoteFormatInfo> {
  const response = await apiFetch("/note-format", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(format),
  });
  if (!response.ok) throw new Error(await readErrorDetail(response, "노트 포맷 저장에 실패했습니다"));
  return response.json();
}

/** Deletes the company's saved format; notes go back to the built-in default. */
export async function deleteNoteFormat(): Promise<NoteFormatInfo> {
  const response = await apiFetch("/note-format", { method: "DELETE" });
  if (!response.ok) throw new Error(await readErrorDetail(response, "노트 포맷 삭제에 실패했습니다"));
  return response.json();
}
