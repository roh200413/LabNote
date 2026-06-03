import { apiFetch, getAccessToken, getBackendApiUrl } from "./client";
import type { DocumentSchema, ResearchNoteDocument, ResearchNoteDocumentSummary } from "../types/document";

type DownloadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export async function listResearchNoteDocuments(noteId: string): Promise<ResearchNoteDocumentSummary[]> {
  const response = await apiFetch(`/research-note-documents/notes/${noteId}`);
  if (!response.ok) throw new Error("Failed to fetch note documents");
  return response.json();
}

export async function getResearchNoteDocument(documentId: string): Promise<ResearchNoteDocument> {
  const response = await apiFetch(`/research-note-documents/${documentId}`);
  if (!response.ok) throw new Error("Failed to fetch note document");
  return response.json();
}

export async function createResearchNoteDocument(payload: {
  note_id: string;
  title: string;
  source_file_id?: number | null;
  source_page_id?: number | null;
  document: DocumentSchema;
}): Promise<ResearchNoteDocument> {
  const response = await apiFetch("/research-note-documents", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to create note document");
  return response.json();
}

export async function updateResearchNoteDocument(
  documentId: string,
  payload: {
    note_id: string;
    title: string;
    source_file_id?: number | null;
    source_page_id?: number | null;
    document: DocumentSchema;
  }
): Promise<ResearchNoteDocument> {
  const response = await apiFetch(`/research-note-documents/${documentId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to save note document");
  return response.json();
}

export async function uploadEditorImage(noteId: string, file: File): Promise<{ url: string; storage_key: string; filename: string }> {
  const form = new FormData();
  form.append("note_id", noteId);
  form.append("upload", file);
  const response = await apiFetch("/research-note-documents/uploads/image", {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error("Failed to upload editor image");
  return response.json();
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = window.document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = filename;
  anchor.style.display = "none";
  window.document.body.appendChild(anchor);
  anchor.click();
  window.setTimeout(() => {
    if (window.document.body.contains(anchor)) {
      window.document.body.removeChild(anchor);
    }
  }, 100);
  window.setTimeout(() => {
    window.URL.revokeObjectURL(downloadUrl);
  }, 60000);
}

async function fetchDownload(
  path: string,
  body: unknown,
  onProgress?: (progress: DownloadProgress) => void
): Promise<Blob> {
  const token = getAccessToken();
  const response = await fetch(getBackendApiUrl(path), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error("Failed to download note PDF");
  if (!response.body) {
    const fallbackBlob = await response.blob();
    if (fallbackBlob.size === 0) throw new Error("Downloaded PDF was empty");
    onProgress?.({ loaded: fallbackBlob.size, total: fallbackBlob.size, percent: 100 });
    return fallbackBlob;
  }

  const totalHeader = response.headers.get("Content-Length");
  const total = totalHeader ? Number(totalHeader) : null;
  const reader = response.body.getReader();
  const chunks: BlobPart[] = [];
  let loaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value.slice().buffer);
    loaded += value.length;
    onProgress?.({
      loaded,
      total,
      percent: total ? Math.min(100, Math.round((loaded / total) * 100)) : null,
    });
  }

  const blob = new Blob(chunks, { type: "application/pdf" });
  if (blob.size === 0) throw new Error("Downloaded PDF was empty");
  onProgress?.({ loaded: blob.size, total: total ?? blob.size, percent: 100 });
  return blob;
}

export async function downloadResearchNotePdf(
  payload: { documentId?: string | null; noteId?: string | null; filename?: string },
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const blob = await fetchDownload(
    "/research-note-documents/export-pdf",
    {
      documentId: payload.documentId ?? null,
      noteId: payload.noteId ?? null,
    },
    onProgress
  );
  triggerBlobDownload(blob, `${payload.filename ?? "research-note"}.pdf`);
}

export async function downloadSelectedResearchNotesPdf(
  noteIds: string[],
  onProgress?: (progress: DownloadProgress) => void
): Promise<void> {
  const blob = await fetchDownload("/research-note-documents/export-batch-pdf", { noteIds }, onProgress);
  triggerBlobDownload(blob, "research-notes.pdf");
}
