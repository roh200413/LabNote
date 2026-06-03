import { apiFetch } from "./client";

export type NoteFile = {
  id: number;
  note_id: string;
  uploaded_by: number;
  file_type: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  checksum: string | null;
  status: string;
  page_count: number | null;
  error_message: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type NotePage = {
  id: number;
  note_id: string | null;
  file_id: number;
  page_no: number;
  page_type: string;
  image_storage_key: string;
  thumbnail_storage_key: string | null;
  width: number | null;
  height: number | null;
  active_asset_version_id: number | null;
  sort_order: number;
  status: string;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type UploadResult = {
  file: NoteFile;
  pages: NotePage[];
};

export async function uploadNoteFile(
  noteId: string,
  uploadedBy: number,
  file: File
): Promise<UploadResult> {
  const form = new FormData();
  form.append("note_id", noteId);
  form.append("uploaded_by", String(uploadedBy));
  form.append("upload", file);

  const response = await apiFetch("/research-note-files/upload", {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail ?? "Failed to upload file");
  }
  return response.json();
}

export async function listNoteFiles(noteId: string): Promise<NoteFile[]> {
  const response = await apiFetch(`/research-note-files/notes/${noteId}`);
  if (!response.ok) throw new Error("Failed to fetch note files");
  return response.json();
}

export async function listNotePages(fileId: number): Promise<NotePage[]> {
  const response = await apiFetch(`/research-note-files/${fileId}/pages`);
  if (!response.ok) throw new Error("Failed to fetch note pages");
  return response.json();
}

export async function replaceNotePageAsset(
  pageId: number,
  file: File,
  changeReason?: string
): Promise<NotePage> {
  const form = new FormData();
  if (changeReason) {
    form.append("change_reason", changeReason);
  }
  form.append("upload", file);

  const response = await apiFetch(`/research-note-files/pages/${pageId}/replace`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.detail ?? "Failed to replace page image");
  }
  return response.json();
}
