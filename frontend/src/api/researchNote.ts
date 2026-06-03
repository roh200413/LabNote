import { apiFetch } from "./client";

export type ResearchNote = {
  id: string;
  created_at: string;
  updated_at: string;
  project_id: string;
  title: string;
  content: string | null;
  status: string;
  owner_member_id: number;
  written_date: string | null;
  reviewer_member_id: number | null;
  reviewed_date: string | null;
  last_updated_by: number | null;
  is_deleted: boolean;
};

export type ResearchNoteApprovalEvent = {
  id: number;
  created_at: string;
  note_id: string;
  document_id: string | null;
  document_revision_id: number | null;
  actor_user_id: number;
  actor_member_id: number | null;
  event_type: string;
  comment: string | null;
  signature_snapshot_id: number | null;
};

export type CreateResearchNotePayload = {
  project_id: string;
  title: string;
  content?: string;
  owner_member_id: number;
  written_date?: string;
  reviewer_member_id?: number;
  reviewed_date?: string;
  last_updated_by?: number;
};

async function parseResearchNoteError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function listResearchNotes(projectId: string): Promise<ResearchNote[]> {
  const response = await apiFetch(`/research-notes?project_id=${projectId}`);
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to fetch research notes"));
  return response.json();
}

export async function createResearchNote(
  payload: CreateResearchNotePayload
): Promise<ResearchNote> {
  const response = await apiFetch("/research-notes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to create research note"));
  return response.json();
}

export async function getResearchNote(noteId: string): Promise<ResearchNote> {
  const response = await apiFetch(`/research-notes/${noteId}`);
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to fetch research note detail"));
  return response.json();
}

export async function updateResearchNote(
  noteId: string,
  payload: {
    title?: string;
    content?: string;
    owner_member_id?: number;
    written_date?: string;
    reviewer_member_id?: number;
    reviewed_date?: string;
    last_updated_by?: number;
  }
): Promise<ResearchNote> {
  const response = await apiFetch(`/research-notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to update research note"));
  return response.json();
}

export async function assignResearchNoteMembers(
  noteId: string,
  payload: {
    author_member_id: number;
    reviewer_member_id?: number | null;
  }
): Promise<ResearchNote> {
  const response = await apiFetch(`/research-notes/${noteId}/assignments`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to assign research note members"));
  return response.json();
}

export async function deleteResearchNote(noteId: string): Promise<void> {
  const response = await apiFetch(`/research-notes/${noteId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to delete research note"));
}

async function postApprovalAction(noteId: string, action: string, comment?: string): Promise<ResearchNoteApprovalEvent> {
  const response = await apiFetch(`/research-notes/${noteId}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment: comment ?? null }),
  });
  if (!response.ok) throw new Error(await parseResearchNoteError(response, `Failed to ${action} research note`));
  return response.json();
}

export function submitResearchNote(noteId: string, comment?: string): Promise<ResearchNoteApprovalEvent> {
  return postApprovalAction(noteId, "submit", comment);
}

export function approveResearchNote(noteId: string, comment?: string): Promise<ResearchNoteApprovalEvent> {
  return postApprovalAction(noteId, "approve", comment);
}

export function rejectResearchNote(noteId: string, comment: string): Promise<ResearchNoteApprovalEvent> {
  return postApprovalAction(noteId, "reject", comment);
}

export function reopenResearchNote(noteId: string, comment: string): Promise<ResearchNoteApprovalEvent> {
  return postApprovalAction(noteId, "reopen", comment);
}

export async function listResearchNoteApprovalEvents(noteId: string): Promise<ResearchNoteApprovalEvent[]> {
  const response = await apiFetch(`/research-notes/${noteId}/approval-events`);
  if (!response.ok) throw new Error(await parseResearchNoteError(response, "Failed to fetch approval events"));
  return response.json();
}
