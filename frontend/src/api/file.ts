const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

export type NoteFile = {
  id: number;
  note_id: string;
  uploaded_by: number;
  file_type: string;
  original_name: string;
  storage_key: string;
  mime_type: string;
  file_size: number;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
};

export type NotePage = {
  id: number;
  file_id: number;
  page_no: number;
  page_type: string;
  image_storage_key: string;
  sort_order: number;
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

  const response = await fetch(`${API_BASE_URL}/research-note-files/upload`, {
    method: "POST",
    body: form,
  });

  if (!response.ok) throw new Error("Failed to upload file");
  return response.json();
}

export async function listNoteFiles(noteId: string): Promise<NoteFile[]> {
  const response = await fetch(`${API_BASE_URL}/research-note-files/notes/${noteId}`);
  if (!response.ok) throw new Error("Failed to fetch note files");
  return response.json();
}

export async function listNotePages(fileId: number): Promise<NotePage[]> {
  const response = await fetch(`${API_BASE_URL}/research-note-files/${fileId}/pages`);
  if (!response.ok) throw new Error("Failed to fetch note pages");
  return response.json();
}
