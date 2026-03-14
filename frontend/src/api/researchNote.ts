const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type ResearchNote = {
  id: string;
  created_at: string;
  updated_at: string;
  project_id: string;
  title: string;
  content: string | null;
  status: string;
  owner_member_id: number;
  last_updated_by: number | null;
  is_deleted: boolean;
};

export type CreateResearchNotePayload = {
  project_id: string;
  title: string;
  content?: string;
  owner_member_id: number;
  last_updated_by?: number;
};

export async function listResearchNotes(projectId: string): Promise<ResearchNote[]> {
  const response = await fetch(`${API_BASE_URL}/research-notes?project_id=${projectId}`);
  if (!response.ok) throw new Error("Failed to fetch research notes");
  return response.json();
}

export async function createResearchNote(
  payload: CreateResearchNotePayload
): Promise<ResearchNote> {
  const response = await fetch(`${API_BASE_URL}/research-notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to create research note");
  return response.json();
}

export async function getResearchNote(noteId: string): Promise<ResearchNote> {
  const response = await fetch(`${API_BASE_URL}/research-notes/${noteId}`);
  if (!response.ok) throw new Error("Failed to fetch research note detail");
  return response.json();
}

export async function updateResearchNote(
  noteId: string,
  payload: { title?: string; content?: string; last_updated_by?: number }
): Promise<ResearchNote> {
  const response = await fetch(`${API_BASE_URL}/research-notes/${noteId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to update research note");
  return response.json();
}
