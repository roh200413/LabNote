import { apiFetch, getAccessToken, getBackendApiUrl } from "./client";
import type { DocumentSchema, ResearchNoteDocument, ResearchNoteDocumentSummary } from "../types/document";

type DownloadProgress = {
  loaded: number;
  total: number | null;
  percent: number | null;
};

export type NoteGenerationStatus = {
  enabled: boolean;
  provider: string;
  model: string | null;
  max_pages: number;
};

export type GeneratedNoteDraft = {
  sections: { heading: string; body: string }[];
  text: string;
  model: string;
};

const AI_GENERATION_TIMEOUT_MS = 180_000;

async function readErrorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") return body.detail;
  } catch {
    // Non-JSON error bodies fall back to the generic message.
  }
  return fallback;
}

export async function getNoteGenerationStatus(): Promise<NoteGenerationStatus> {
  const response = await apiFetch("/research-note-documents/ai/status");
  if (!response.ok) throw new Error(await readErrorDetail(response, "AI 상태를 불러오지 못했습니다"));
  return response.json();
}

export async function generateNoteDraft(payload: {
  noteId: string;
  pageIds: number[];
  memo: string;
  language: "ko" | "en";
  existingText?: string;
}): Promise<GeneratedNoteDraft> {
  const response = await apiFetch("/research-note-documents/ai/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    timeoutMs: AI_GENERATION_TIMEOUT_MS,
  });
  if (!response.ok) throw new Error(await readErrorDetail(response, "노트 초안 생성에 실패했습니다"));
  return response.json();
}

export async function listResearchNoteDocuments(noteId: string): Promise<ResearchNoteDocumentSummary[]> {
  const response = await apiFetch(`/research-note-documents/notes/${noteId}`);
  if (!response.ok) throw new Error("노트 문서 목록을 불러오지 못했습니다");
  return response.json();
}

export async function getResearchNoteDocument(documentId: string): Promise<ResearchNoteDocument> {
  const response = await apiFetch(`/research-note-documents/${documentId}`);
  if (!response.ok) throw new Error("노트 문서를 불러오지 못했습니다");
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
  if (!response.ok) throw new Error("노트 문서 생성에 실패했습니다");
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
  if (!response.ok) throw new Error("노트 문서 저장에 실패했습니다");
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
  if (!response.ok) throw new Error("편집기 이미지 업로드에 실패했습니다");
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
  if (!response.ok) throw new Error("노트 PDF 다운로드에 실패했습니다");
  if (!response.body) {
    const fallbackBlob = await response.blob();
    if (fallbackBlob.size === 0) throw new Error("다운로드한 PDF가 비어 있습니다");
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
  if (blob.size === 0) throw new Error("다운로드한 PDF가 비어 있습니다");
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
