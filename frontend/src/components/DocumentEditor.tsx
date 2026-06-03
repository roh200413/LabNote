import { ChangeEvent, MouseEvent as ReactMouseEvent, useEffect, useRef, useState } from "react";

import { getBackendAssetUrl } from "../api/client";
import { downloadResearchNotePdf } from "../api/documentEditor";
import type { NotePage } from "../api/file";
import type { DocumentBlock, DocumentSchema, ResearchNoteDocument, ResearchNoteDocumentSummary } from "../types/document";

type Props = {
  noteId: string;
  document: DocumentSchema | null;
  documentSummaries: ResearchNoteDocumentSummary[];
  activeDocumentId: string | null;
  referencePages: NotePage[];
  onSelectDocument: (documentId: string) => Promise<void>;
  onCreateDocument: () => Promise<void>;
  onSaveDocument: (document: DocumentSchema) => Promise<ResearchNoteDocument>;
  onUploadNoteFiles: (files: File[]) => Promise<void>;
  onReplaceReferencePage?: (pageId: number, file: File) => Promise<NotePage>;
  isLocked?: boolean;
  lockMessage?: string;
};

type DragState =
  | { mode: "move"; blockId: string; offsetX: number; offsetY: number }
  | { mode: "resize"; blockId: string; startX: number; startY: number; startW: number; startH: number }
  | null;

function snap(value: number, gap = 5) {
  return Math.round(value / gap) * gap;
}

const CONTENT_FRAME = { x: 34, y: 64, w: 726, h: 884 };

function fitImageIntoFrame(width: number, height: number) {
  if (width <= 0 || height <= 0) {
    return CONTENT_FRAME;
  }

  let fittedWidth = width;
  let fittedHeight = height;

  if (width > CONTENT_FRAME.w || height > CONTENT_FRAME.h) {
    const scale = Math.min(CONTENT_FRAME.w / width, CONTENT_FRAME.h / height);
    fittedWidth = Math.round(width * scale);
    fittedHeight = Math.round(height * scale);
  }

  return {
    x: Math.round(CONTENT_FRAME.x + (CONTENT_FRAME.w - fittedWidth) / 2),
    y: Math.round(CONTENT_FRAME.y + (CONTENT_FRAME.h - fittedHeight) / 2),
    w: fittedWidth,
    h: fittedHeight,
  };
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("Failed to load image"));
    image.src = src;
  });
}



export function DocumentEditor({
  noteId,
  document,
  documentSummaries,
  activeDocumentId,
  referencePages,
  onSelectDocument,
  onCreateDocument,
  onSaveDocument,
  onUploadNoteFiles,
  onReplaceReferencePage,
  isLocked = false,
  lockMessage = "This note is locked.",
}: Props) {
  const [draft, setDraft] = useState<DocumentSchema | null>(document);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [replacePageId, setReplacePageId] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const applyPageToDraft = async (page: NotePage, force = false) => {
    if (isLocked) return;
    const pageUrl = getBackendAssetUrl(`/storage/${page.image_storage_key}`);
    let fitted = CONTENT_FRAME;
    try {
      const size = await loadImageSize(pageUrl);
      fitted = fitImageIntoFrame(size.width, size.height);
    } catch {
      fitted = CONTENT_FRAME;
    }

    setDraft((current) => {
      if (!current) return current;
      const hasContentImage = current.blocks.some((block) => block.id === "content-image" && block.type === "image");
      if (!force && current.meta.sourcePageId === page.id && hasContentImage) {
        return current;
      }

      return {
        ...current,
        meta: { ...current.meta, sourceFileId: page.file_id, sourcePageId: page.id },
        blocks: hasContentImage
          ? current.blocks.map((block) =>
              block.id === "content-image" && block.type === "image"
                ? { ...block, src: pageUrl, x: fitted.x, y: fitted.y, w: fitted.w, h: fitted.h }
                : block
            )
          : [
              ...current.blocks,
              {
                id: "content-image",
                type: "image",
                x: fitted.x,
                y: fitted.y,
                w: fitted.w,
                h: fitted.h,
                src: pageUrl,
                locked: false,
              },
            ],
      };
    });
  };

  useEffect(() => {
    setDraft(document);
    setSelectedBlockId(null);
  }, [document]);

  useEffect(() => {
    if (!draft || referencePages.length === 0) return;
    const hasContentImage = draft.blocks.some((block) => block.id === "content-image" && block.type === "image");
    const currentPageStillExists = draft.meta.sourcePageId
      ? referencePages.some((page) => page.id === draft.meta.sourcePageId)
      : false;
    if (draft.meta.sourcePageId && hasContentImage && currentPageStillExists) return;

    const firstPage =
      referencePages.find((page) => page.id === draft.meta.sourcePageId) ??
      referencePages[0];
    void applyPageToDraft(firstPage);
  }, [draft?.id, draft?.meta.sourcePageId, referencePages]);

  useEffect(() => {
    if (!dragState || !draft) return;

    const onMouseMove = (event: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;

      setDraft((current) => {
        if (!current) return current;
        return {
          ...current,
          blocks: current.blocks.map((block) => {
            if (block.id !== dragState.blockId || block.locked) return block;
            if (dragState.mode === "move") {
              const nextX = snap(Math.max(0, Math.min(current.page.width - block.w, event.clientX - canvasRect.left - dragState.offsetX)));
              const nextY = snap(Math.max(0, Math.min(current.page.height - block.h, event.clientY - canvasRect.top - dragState.offsetY)));
              return { ...block, x: nextX, y: nextY };
            }
            const nextW = snap(Math.max(80, dragState.startW + (event.clientX - dragState.startX)));
            const nextH = snap(Math.max(60, dragState.startH + (event.clientY - dragState.startY)));
            return {
              ...block,
              w: Math.min(nextW, current.page.width - block.x),
              h: Math.min(nextH, current.page.height - block.y),
            };
          }),
        };
      });
    };

    const onMouseUp = () => setDragState(null);

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragState, draft]);

  const updateBlock = (blockId: string, updates: Partial<DocumentBlock>) => {
    if (isLocked) return;
    setDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        blocks: current.blocks.map((block) => (block.id === blockId ? { ...block, ...updates } as DocumentBlock : block)),
      };
    });
  };

  const handleSave = async () => {
    if (!draft || isLocked) return;
    setIsSaving(true);
    try {
      const saved = await onSaveDocument(draft);
      setDraft(saved.document);
    } finally {
      setIsSaving(false);
    }
  };

  const handleExportPdf = async () => {
    if (!draft) return;
    setIsDownloading(true);
    setDownloadProgress(0);
    try {
      if (isLocked) {
        await downloadResearchNotePdf(
          {
            documentId: activeDocumentId,
            noteId: activeDocumentId ? null : noteId,
            filename: draft.title,
          },
          (progress) => {
            setDownloadProgress(progress.percent);
          }
        );
        return;
      }
      const saved = await onSaveDocument(draft);
      setDraft(saved.document);
      await downloadResearchNotePdf(
        {
          documentId: saved.id,
          noteId,
          filename: saved.document.title || draft.title,
        },
        (progress) => {
          setDownloadProgress(progress.percent);
        }
      );
    } finally {
      setIsDownloading(false);
      window.setTimeout(() => setDownloadProgress(null), 400);
    }
  };

  const setBackgroundFromPage = (page: NotePage) => {
    void applyPageToDraft(page, true);
  };

  const chooseReplacementForPage = (pageId: number) => {
    if (isLocked || !onReplaceReferencePage) return;
    setReplacePageId(pageId);
    replaceInputRef.current?.click();
  };

  const replaceReferencePage = async (file: File | null) => {
    if (!file || replacePageId == null || !onReplaceReferencePage || isLocked) return;
    const updatedPage = await onReplaceReferencePage(replacePageId, file);
    await applyPageToDraft(updatedPage, true);
  };

  const startMove = (event: ReactMouseEvent<HTMLElement>, blockId: string) => {
    event.stopPropagation();
    if (isLocked) return;
    const block = draft?.blocks.find((item) => item.id === blockId);
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (!block || !canvasRect) return;
    setSelectedBlockId(blockId);
    setDragState({
      mode: "move",
      blockId,
      offsetX: event.clientX - canvasRect.left - block.x,
      offsetY: event.clientY - canvasRect.top - block.y,
    });
  };

  const startResize = (event: ReactMouseEvent<HTMLButtonElement>, blockId: string) => {
    event.stopPropagation();
    if (isLocked) return;
    const block = draft?.blocks.find((item) => item.id === blockId);
    if (!block) return;
    setSelectedBlockId(blockId);
    setDragState({
      mode: "resize",
      blockId,
      startX: event.clientX,
      startY: event.clientY,
      startW: block.w,
      startH: block.h,
    });
  };

  if (!draft) {
    return (
      <section className="editor-shell">
        <div className="editor-empty card">
          <p className="eyebrow">Document Editor</p>
          <h3>No editor document yet</h3>
          <p>Create a document layout for this research note, then manage uploaded PDF pages and floating blocks here.</p>
          {isLocked && <p>{lockMessage}</p>}
          <button type="button" className="compact-button" onClick={() => void onCreateDocument()} disabled={isLocked}>
            Create Editor Document
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className={`editor-shell${isLocked ? " editor-shell-locked" : ""}`}>
      <div className="editor-toolbar card">
        <div className="editor-toolbar-main">
          <div>
            <p className="eyebrow">Document Editor</p>
          </div>
          <div className="editor-toolbar-actions">
            <select value={activeDocumentId ?? ""} onChange={(event) => void onSelectDocument(event.target.value)}>
              <option value="">Select a saved document</option>
              {documentSummaries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button type="button" className="secondary-button compact-button" onClick={() => fileInputRef.current?.click()} disabled={isLocked}>
              Add File
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => void handleExportPdf()} disabled={isDownloading}>
              {isDownloading ? "Downloading..." : "Download PDF"}
            </button>
            <button type="button" className="compact-button" onClick={() => void handleSave()} disabled={isSaving || isLocked}>
              {isSaving ? "Saving..." : "Save Layout"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,image/*"
              multiple
              className="hidden-input"
              onChange={async (event) => {
                const files = Array.from(event.target.files ?? []);
                if (files.length > 0 && !isLocked) {
                  await onUploadNoteFiles(files);
                }
                event.target.value = "";
              }}
            />
          </div>
        </div>
        <label className="editor-title-input">
          Title
          <input
            value={draft.title}
            onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            disabled={isLocked}
          />
        </label>
        {isLocked && <div className="editor-lock-notice">{lockMessage}</div>}
        {isDownloading && (
          <div className="download-progress">
            <div className="download-progress-head">
              <strong>Downloading PDF</strong>
              <span>{downloadProgress == null ? "Preparing..." : `${downloadProgress}%`}</span>
            </div>
            <div className="download-progress-bar">
              <div
                className={`download-progress-fill${downloadProgress == null ? " indeterminate" : ""}`}
                style={downloadProgress == null ? undefined : { width: `${downloadProgress}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="editor-layout">
        <aside className="card editor-side-panel">
          <div className="section-head">
            <h4>File Pages</h4>
            <span>{referencePages.length}</span>
          </div>
          <input
            ref={replaceInputRef}
            type="file"
            accept="image/*"
            className="hidden-input"
            onChange={async (event) => {
              const file = event.target.files?.[0] ?? null;
              try {
                await replaceReferencePage(file);
              } catch {
                // The parent handler owns user-facing error state.
              } finally {
                setReplacePageId(null);
                event.target.value = "";
              }
            }}
          />
          <div className="editor-reference-list">
            {referencePages.length === 0 && (
              <div className="plain-list-item">
                <strong>No pages</strong>
                <span>Upload a PDF or image file first to manage source pages here.</span>
              </div>
            )}
            {referencePages.map((page) => {
              const previewUrl = getBackendAssetUrl(`/storage/${page.image_storage_key}`);
              return (
                <div
                  key={page.id}
                  className={`editor-reference-item${draft.meta.sourcePageId === page.id ? " active" : ""}`}
                >
                  <button
                    type="button"
                    className="editor-reference-preview"
                    onClick={() => setBackgroundFromPage(page)}
                    disabled={isLocked}
                  >
                    <img src={previewUrl} alt={`Page ${page.page_no}`} />
                    <strong>{page.page_type === "image" ? "Image" : `Page ${page.page_no}`}</strong>
                    <span>Use as canvas background</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button editor-reference-replace"
                    onClick={() => chooseReplacementForPage(page.id)}
                    disabled={isLocked || !onReplaceReferencePage}
                  >
                    Replace Image
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="editor-canvas-wrap">
          <div className="editor-canvas-scroll" onClick={() => setSelectedBlockId(null)}>
            <div
              ref={canvasRef}
              className="editor-canvas-page"
              style={{
                width: `${draft.page.width}px`,
                height: `${draft.page.height}px`,
                backgroundColor: draft.page.background,
                backgroundImage: draft.page.backgroundImage ? `url(${draft.page.backgroundImage})` : undefined,
              }}
              onClick={(event) => event.stopPropagation()}
            >
              {draft.blocks.map((block) => (
                <div
                  key={block.id}
                  className={`editor-block${selectedBlockId === block.id ? " selected" : ""}`}
                  style={{ left: block.x, top: block.y, width: block.w, height: block.h }}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedBlockId(block.id);
                  }}
                >
                  {block.type === "text" && !block.locked && !isLocked ? (
                    <div className="editor-block-handle" onMouseDown={(event) => startMove(event, block.id)}>
                      {block.type.toUpperCase()}
                    </div>
                  ) : block.type === "image" && !isLocked ? (
                    <button
                      type="button"
                      className="editor-image-drag-handle"
                      onMouseDown={(event) => startMove(event, block.id)}
                      aria-label="Move image block"
                    />
                  ) : null}
                  {block.type === "text" ? (
                    block.locked || isLocked ? (
                      <div
                        className="editor-block-text editor-block-text-locked"
                        style={{
                          fontSize: block.style?.fontSize ?? 16,
                          fontWeight: block.style?.fontWeight ?? "normal",
                          textAlign: block.style?.textAlign ?? "left",
                        }}
                      >
                        {block.content}
                      </div>
                    ) : (
                      <textarea
                        value={block.content}
                        onChange={(event) => updateBlock(block.id, { content: event.target.value })}
                        style={{
                          fontSize: block.style?.fontSize ?? 16,
                          fontWeight: block.style?.fontWeight ?? "normal",
                          textAlign: block.style?.textAlign ?? "left",
                        }}
                      />
                    )
                  ) : (
                    <img src={block.src} alt="" />
                  )}
                  {!isLocked && <button type="button" className="editor-resize-handle" onMouseDown={(event) => startResize(event, block.id)} />}
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
