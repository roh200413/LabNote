import { apiFetch } from "./client";

/** A named group of research notes inside a project. */
export type NoteBundle = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  note_count: number;
  created_at: string | null;
};

async function request<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    let message = fallback;
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // keep fallback
    }
    throw new Error(message);
  }
  return response.status === 204 ? (undefined as T) : response.json();
}

const jsonBody = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const listNoteBundles = (projectId: string) =>
  request<NoteBundle[]>(`/projects/${projectId}/note-bundles`, "노트 묶음을 불러오지 못했습니다");

export const createNoteBundle = (projectId: string, name: string, description?: string) =>
  request<NoteBundle>(`/projects/${projectId}/note-bundles`, "묶음을 만들지 못했습니다", jsonBody("POST", { name, description }));

export const renameNoteBundle = (bundleId: string, name: string) =>
  request<NoteBundle>(`/note-bundles/${bundleId}`, "묶음 이름을 바꾸지 못했습니다", jsonBody("PATCH", { name }));

export const deleteNoteBundle = (bundleId: string) =>
  request<void>(`/note-bundles/${bundleId}`, "묶음을 삭제하지 못했습니다", { method: "DELETE" });

/** Puts notes in a bundle, or takes them out with bundleId null. */
export const moveNotesToBundle = (projectId: string, noteIds: string[], bundleId: string | null) =>
  request<{ moved: number }>(
    `/projects/${projectId}/note-bundles/move`,
    "노트를 옮기지 못했습니다",
    jsonBody("POST", { note_ids: noteIds, bundle_id: bundleId })
  );
