import { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, useEffect, useMemo, useRef, useState } from "react";

import { getBackendAssetUrl } from "../api/client";
import {
  downloadResearchNotePdf,
  getNoteGenerationStatus,
  uploadEditorImage,
  type NoteGenerationStatus,
} from "../api/documentEditor";
import type { NotePage } from "../api/file";
import type {
  DocumentBlock,
  DocumentSchema,
  ResearchNoteDocument,
  ResearchNoteDocumentSummary,
  TextBlock,
  TextStyle,
} from "../types/document";
import { AiDraftPanel, type AiInsertMode } from "./AiDraftPanel";
import {
  DEFAULT_NOTE_FORMAT,
  applyFormatToDocument,
  fillSectionsFromDraft,
  formatImageRect,
  parseDraftText,
  parseSectionBlockId,
  type NoteFormat,
} from "../lib/noteFormat";

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
  /** Opens the note metadata form (title, author, reviewer, dates) that feeds the template fields. */
  onEditNoteDetails?: () => void;
  /** Company note format: section guides, default font, image area, AI sections. */
  noteFormat?: NoteFormat;
  isLocked?: boolean;
  lockMessage?: string;
};

type DragState =
  | { mode: "move"; blockId: string; offsetX: number; offsetY: number; startX: number; startY: number }
  | { mode: "resize"; blockId: string; startX: number; startY: number; startW: number; startH: number }
  | null;

type Rect = { x: number; y: number; w: number; h: number };

function snap(value: number, gap = 5) {
  return Math.round(value / gap) * gap;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const CONTENT_FRAME: Rect = { x: 34, y: 64, w: 726, h: 884 };
const HISTORY_LIMIT = 100;
const DRAG_THRESHOLD_PX = 4;
const NEW_TEXT_SIZE = { w: 320, h: 96 };
const MIN_BLOCK_W = 20;
const MIN_BLOCK_H = 14;
const DEFAULT_TEXT_STYLE: TextStyle = { fontSize: 14, fontWeight: "normal", textAlign: "left" };
const AI_TEXT_STYLE: TextStyle = { fontSize: 12, fontWeight: "normal", textAlign: "left" };
// Template fields managed by the server; they cannot be deleted or duplicated.
const FIXED_BLOCK_IDS = new Set([
  "note-title",
  "continued-page",
  "recorded-by",
  "recorded-date",
  "witnessed-by",
  "witnessed-date",
  "author-signature",
  "reviewer-signature",
  "content-image",
]);

const SHORTCUTS: [string, string][] = [
  ["Ctrl+Z / Ctrl+Y", "실행 취소 / 다시 실행"],
  ["Ctrl+S", "레이아웃 저장"],
  ["Ctrl+D", "블록 복제"],
  ["Delete", "블록 삭제"],
  ["방향키", "1px 이동 (Shift: 10px)"],
  ["Esc", "선택 해제"],
];

function isProtectedBlock(block: DocumentBlock) {
  return FIXED_BLOCK_IDS.has(block.id) || Boolean(block.locked);
}

function isFreeTextBlock(block: DocumentBlock | null | undefined): block is TextBlock {
  return Boolean(block && block.type === "text" && !FIXED_BLOCK_IDS.has(block.id) && !block.locked);
}

function createBlockId(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable;
}

function fitIntoRect(width: number, height: number, rect: Rect, allowUpscale: boolean): Rect {
  if (width <= 0 || height <= 0) return rect;
  const scale = Math.min(rect.w / width, rect.h / height, allowUpscale ? Number.POSITIVE_INFINITY : 1);
  const fittedWidth = Math.round(width * scale);
  const fittedHeight = Math.round(height * scale);
  return {
    x: Math.round(rect.x + (rect.w - fittedWidth) / 2),
    y: Math.round(rect.y + (rect.h - fittedHeight) / 2),
    w: fittedWidth,
    h: fittedHeight,
  };
}

function loadImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("이미지를 불러오지 못했습니다"));
    image.src = src;
  });
}

function textStyleToCss(style: TextStyle | undefined) {
  return {
    fontSize: style?.fontSize ?? 16,
    fontWeight: style?.fontWeight ?? "normal",
    textAlign: style?.textAlign ?? "left",
    color: style?.color ?? undefined,
  } as const;
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
  onEditNoteDetails,
  noteFormat = DEFAULT_NOTE_FORMAT,
  isLocked = false,
  lockMessage = "이 노트는 잠겨 있습니다.",
}: Props) {
  const [draft, setDraft] = useState<DocumentSchema | null>(document);
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [replacePageId, setReplacePageId] = useState<number | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [historySize, setHistorySize] = useState({ past: 0, future: 0 });
  const [savedSnapshot, setSavedSnapshot] = useState(() => (document ? JSON.stringify(document) : ""));
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [aiStatus, setAiStatus] = useState<NoteGenerationStatus | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const replaceInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const canvasScrollRef = useRef<HTMLDivElement | null>(null);
  // The page keeps its real size (794px) and is drawn scaled down to fit narrow editors.
  // Block coordinates stay in page px; mouse positions are divided by this factor.
  const [pageScale, setPageScale] = useState(1);
  const pageScaleRef = useRef(1);
  pageScaleRef.current = pageScale;
  const shellRef = useRef<HTMLElement | null>(null);
  const draftRef = useRef<DocumentSchema | null>(draft);
  const pastRef = useRef<DocumentSchema[]>([]);
  const futureRef = useRef<DocumentSchema[]>([]);
  const lastCoalesceRef = useRef<string | null>(null);
  const dragMovedRef = useRef(false);
  const pointerDownOnPageRef = useRef(false);
  const pendingFocusBlockIdRef = useRef<string | null>(null);
  const prevDocumentIdRef = useRef<string | null>(document?.id ?? null);
  draftRef.current = draft;

  const selectedBlock = draft?.blocks.find((block) => block.id === selectedBlockId) ?? null;
  const isDirty = useMemo(() => (draft ? JSON.stringify(draft) !== savedSnapshot : false), [draft, savedSnapshot]);
  const hasContentImage = Boolean(draft?.blocks.some((block) => block.id === "content-image" && block.type === "image"));
  const existingFreeText = useMemo(
    () =>
      (draft?.blocks ?? [])
        .filter((block): block is TextBlock => isFreeTextBlock(block))
        .map((block) => block.content.trim())
        .filter(Boolean)
        .join("\n\n"),
    [draft]
  );

  // ─── History ──────────────────────────────────────────────────────────────
  const syncHistorySize = () => setHistorySize({ past: pastRef.current.length, future: futureRef.current.length });

  const resetHistory = () => {
    pastRef.current = [];
    futureRef.current = [];
    lastCoalesceRef.current = null;
    syncHistorySize();
  };

  /** Snapshot the current draft. Consecutive calls with the same key (typing, nudging) collapse into one step. */
  const recordHistory = (coalesceKey?: string) => {
    const current = draftRef.current;
    if (!current) return;
    if (coalesceKey && lastCoalesceRef.current === coalesceKey) return;
    lastCoalesceRef.current = coalesceKey ?? null;
    pastRef.current = [...pastRef.current.slice(-(HISTORY_LIMIT - 1)), current];
    futureRef.current = [];
    syncHistorySize();
  };

  const endCoalescing = () => {
    lastCoalesceRef.current = null;
  };

  const mutateDraft = (updater: (current: DocumentSchema) => DocumentSchema, coalesceKey?: string) => {
    if (isLocked || !draftRef.current) return;
    recordHistory(coalesceKey);
    setDraft((current) => (current ? updater(current) : current));
  };

  const undo = () => {
    const previous = pastRef.current[pastRef.current.length - 1];
    const current = draftRef.current;
    if (!previous || !current) return;
    pastRef.current = pastRef.current.slice(0, -1);
    futureRef.current = [...futureRef.current, current];
    endCoalescing();
    setDraft(previous);
    syncHistorySize();
  };

  const redo = () => {
    const next = futureRef.current[futureRef.current.length - 1];
    const current = draftRef.current;
    if (!next || !current) return;
    futureRef.current = futureRef.current.slice(0, -1);
    pastRef.current = [...pastRef.current, current];
    endCoalescing();
    setDraft(next);
    syncHistorySize();
  };

  // ─── Reference pages ──────────────────────────────────────────────────────
  const applyPageToDraft = async (page: NotePage, force = false) => {
    if (isLocked) return;
    const imageArea = formatImageRect(noteFormat);
    // A text-only format does not place the page image automatically; picking a page still does.
    if (!imageArea && !force) return;
    const frame = imageArea ?? CONTENT_FRAME;
    const pageUrl = getBackendAssetUrl(`/storage/${page.image_storage_key}`);
    let fitted = frame;
    try {
      const size = await loadImageSize(pageUrl);
      fitted = fitIntoRect(size.width, size.height, frame, false);
    } catch {
      fitted = frame;
    }

    setDraft((current) => {
      if (!current) return current;
      const hasImage = current.blocks.some((block) => block.id === "content-image" && block.type === "image");
      if (!force && current.meta.sourcePageId === page.id && hasImage) {
        return current;
      }

      return {
        ...current,
        meta: { ...current.meta, sourceFileId: page.file_id, sourcePageId: page.id },
        blocks: hasImage
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
    const sameDocument = document != null && prevDocumentIdRef.current === document.id;
    prevDocumentIdRef.current = document?.id ?? null;
    setDraft(document);
    setSavedSnapshot(document ? JSON.stringify(document) : "");
    if (!sameDocument) {
      resetHistory();
      setSelectedBlockId(null);
    }
  }, [document]);

  useEffect(() => {
    let active = true;
    getNoteGenerationStatus()
      .then((status) => active && setAiStatus(status))
      .catch(() => active && setAiStatus(null));
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!draft || referencePages.length === 0) return;
    const hasImage = draft.blocks.some((block) => block.id === "content-image" && block.type === "image");
    const currentPageStillExists = draft.meta.sourcePageId
      ? referencePages.some((page) => page.id === draft.meta.sourcePageId)
      : false;
    if (draft.meta.sourcePageId && hasImage && currentPageStillExists) return;

    const firstPage = referencePages.find((page) => page.id === draft.meta.sourcePageId) ?? referencePages[0];
    void applyPageToDraft(firstPage);
  }, [draft?.id, draft?.meta.sourcePageId, referencePages]);

  // ─── Fit the page to the editor width ─────────────────────────────────────
  const pageWidth = draft?.page.width ?? 794;
  useEffect(() => {
    const scroller = canvasScrollRef.current;
    if (!scroller) return;
    const update = () => {
      const styles = getComputedStyle(scroller);
      const available = scroller.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
      // Never enlarge; never shrink below 40% (text would be unreadable).
      const next = Math.max(0.4, Math.min(1, Math.floor((available / pageWidth) * 100) / 100));
      setPageScale((current) => (Math.abs(current - next) < 0.005 ? current : next));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [pageWidth, Boolean(draft)]);

  // ─── Drag / resize ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!dragState) return;
    dragMovedRef.current = false;

    const onMouseMove = (event: MouseEvent) => {
      const canvasRect = canvasRef.current?.getBoundingClientRect();
      if (!canvasRect) return;
      if (!dragMovedRef.current) {
        // Ignore small jitter so clicking a block to select it never nudges it.
        if (Math.hypot(event.clientX - dragState.startX, event.clientY - dragState.startY) < DRAG_THRESHOLD_PX) return;
        // Record lazily so a plain click does not create an empty undo step.
        dragMovedRef.current = true;
        recordHistory();
      }

      setDraft((current) => {
        if (!current) return current;
        return {
          ...current,
          blocks: current.blocks.map((block) => {
            if (block.id !== dragState.blockId || block.locked) return block;
            if (dragState.mode === "move") {
              const scale = pageScaleRef.current;
              const nextX = snap(clamp((event.clientX - canvasRect.left) / scale - dragState.offsetX, 0, current.page.width - block.w));
              const nextY = snap(clamp((event.clientY - canvasRect.top) / scale - dragState.offsetY, 0, current.page.height - block.h));
              return { ...block, x: nextX, y: nextY };
            }
            const nextW = snap(Math.max(40, dragState.startW + (event.clientX - dragState.startX) / pageScaleRef.current));
            const nextH = snap(Math.max(30, dragState.startH + (event.clientY - dragState.startY) / pageScaleRef.current));
            return {
              ...block,
              w: Math.min(nextW, current.page.width - block.x),
              h: Math.min(nextH, current.page.height - block.y),
            };
          }),
        };
      });
    };

    const onMouseUp = () => {
      endCoalescing();
      setDragState(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragState]);

  // ─── Block operations ─────────────────────────────────────────────────────
  const updateBlock = (blockId: string, updates: Partial<DocumentBlock>, coalesceKey?: string) => {
    mutateDraft(
      (current) => ({
        ...current,
        blocks: current.blocks.map((block) => (block.id === blockId ? ({ ...block, ...updates } as DocumentBlock) : block)),
      }),
      coalesceKey
    );
  };

  const updateGeometry = (blockId: string, field: "x" | "y" | "w" | "h", rawValue: number) => {
    if (!Number.isFinite(rawValue)) return;
    mutateDraft(
      (current) => ({
        ...current,
        blocks: current.blocks.map((block) => {
          if (block.id !== blockId || block.locked) return block;
          const value = Math.round(rawValue);
          if (field === "x") return { ...block, x: clamp(value, 0, current.page.width - block.w) };
          if (field === "y") return { ...block, y: clamp(value, 0, current.page.height - block.h) };
          if (field === "w") return { ...block, w: clamp(value, MIN_BLOCK_W, current.page.width - block.x) };
          return { ...block, h: clamp(value, MIN_BLOCK_H, current.page.height - block.y) };
        }),
      }),
      `geometry:${blockId}:${field}`
    );
  };

  const updateTextStyle = (blockId: string, patch: Partial<TextStyle>, coalesceKey?: string) => {
    mutateDraft(
      (current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === blockId && block.type === "text" ? { ...block, style: { ...block.style, ...patch } } : block
        ),
      }),
      coalesceKey
    );
  };

  /** Page point at the middle of the part of the canvas currently on screen. */
  const visibleCanvasCenter = () => {
    const page = draftRef.current?.page;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!page || !rect) return { x: CONTENT_FRAME.x + 40, y: CONTENT_FRAME.y + 40 };
    const scale = pageScaleRef.current;
    const top = clamp(-rect.top / scale, 0, page.height);
    const bottom = clamp((window.innerHeight - rect.top) / scale, 0, page.height);
    return { x: page.width / 2 - NEW_TEXT_SIZE.w / 2, y: (top + bottom) / 2 - NEW_TEXT_SIZE.h / 2 };
  };

  /** Adds an empty text block at a page point (default: visible center) and puts the cursor in it. */
  const addTextBlock = (at?: { x: number; y: number }) => {
    const current = draftRef.current;
    if (!current || isLocked) return;
    const point = at ?? visibleCanvasCenter();
    const id = createBlockId("text");
    const block: TextBlock = {
      id,
      type: "text",
      x: Math.round(clamp(point.x, 0, current.page.width - NEW_TEXT_SIZE.w)),
      y: Math.round(clamp(point.y, 0, current.page.height - NEW_TEXT_SIZE.h)),
      ...NEW_TEXT_SIZE,
      content: "",
      style: { ...DEFAULT_TEXT_STYLE, fontSize: noteFormat.typography.bodyFontSize },
      locked: false,
    };
    mutateDraft((draftDocument) => ({ ...draftDocument, blocks: [...draftDocument.blocks, block] }));
    setSelectedBlockId(id);
    pendingFocusBlockIdRef.current = id;
  };

  // Keep the sticky command bar just below any sticky header of the modal that hosts the editor.
  useEffect(() => {
    const shell = shellRef.current;
    const header = shell?.closest(".note-workspace-modal")?.querySelector<HTMLElement>(":scope > .section-head");
    if (!shell || !header) return;
    const apply = () => shell.style.setProperty("--editor-sticky-top", `${header.offsetHeight}px`);
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(header);
    return () => observer.disconnect();
  }, [draft == null]);

  useEffect(() => {
    const blockId = pendingFocusBlockIdRef.current;
    if (!blockId) return;
    const textarea = canvasRef.current?.querySelector<HTMLTextAreaElement>(`[data-block-id="${blockId}"] textarea`);
    if (textarea) {
      pendingFocusBlockIdRef.current = null;
      textarea.focus({ preventScroll: true });
    }
  }, [draft]);

  const addImageBlock = async (file: File) => {
    if (!draftRef.current || isLocked) return;
    setIsUploadingImage(true);
    setEditorError(null);
    try {
      const uploaded = await uploadEditorImage(noteId, file);
      const src = getBackendAssetUrl(`/storage/${uploaded.storage_key}`);
      let size = { width: 320, height: 240 };
      try {
        size = await loadImageSize(src);
      } catch {
        // Keep the default box if the browser cannot read the image size.
      }
      const fitted = fitIntoRect(size.width, size.height, { x: CONTENT_FRAME.x + 40, y: CONTENT_FRAME.y + 40, w: 320, h: 320 }, false);
      const id = createBlockId("image");
      mutateDraft((current) => ({
        ...current,
        blocks: [...current.blocks, { id, type: "image", src, locked: false, ...fitted, x: CONTENT_FRAME.x + 40, y: CONTENT_FRAME.y + 40 }],
      }));
      setSelectedBlockId(id);
    } catch (uploadError) {
      setEditorError(uploadError instanceof Error ? uploadError.message : "이미지 업로드에 실패했습니다");
    } finally {
      setIsUploadingImage(false);
    }
  };

  const deleteSelected = () => {
    if (!selectedBlock || isProtectedBlock(selectedBlock)) return;
    const targetId = selectedBlock.id;
    mutateDraft((current) => ({ ...current, blocks: current.blocks.filter((block) => block.id !== targetId) }));
    setSelectedBlockId(null);
  };

  const duplicateSelected = () => {
    if (!selectedBlock || isProtectedBlock(selectedBlock)) return;
    const source = selectedBlock;
    const id = createBlockId(source.type);
    mutateDraft((current) => {
      const copy = {
        ...source,
        id,
        x: clamp(source.x + 20, 0, current.page.width - source.w),
        y: clamp(source.y + 20, 0, current.page.height - source.h),
      } as DocumentBlock;
      return { ...current, blocks: [...current.blocks, copy] };
    });
    setSelectedBlockId(id);
  };

  const moveLayer = (direction: "front" | "back") => {
    if (!selectedBlock) return;
    const targetId = selectedBlock.id;
    mutateDraft((current) => {
      const target = current.blocks.find((block) => block.id === targetId);
      if (!target) return current;
      const others = current.blocks.filter((block) => block.id !== targetId);
      return { ...current, blocks: direction === "front" ? [...others, target] : [target, ...others] };
    });
  };

  const nudgeSelected = (dx: number, dy: number) => {
    if (!selectedBlock || selectedBlock.locked) return;
    const targetId = selectedBlock.id;
    mutateDraft(
      (current) => ({
        ...current,
        blocks: current.blocks.map((block) =>
          block.id === targetId
            ? {
                ...block,
                x: clamp(block.x + dx, 0, current.page.width - block.w),
                y: clamp(block.y + dy, 0, current.page.height - block.h),
              }
            : block
        ),
      }),
      `nudge:${targetId}`
    );
  };

  /** Natural size of the page image (the stored rect may be a stretched default frame). */
  const contentImageSize = async (): Promise<{ width: number; height: number } | null> => {
    const image = draftRef.current?.blocks.find((block) => block.id === "content-image" && block.type === "image");
    if (!image || image.type !== "image") return null;
    try {
      return await loadImageSize(getBackendAssetUrl(image.src));
    } catch {
      return { width: image.w, height: image.h };
    }
  };

  const applyNoteFormat = async () => {
    if (!draftRef.current || isLocked) return;
    const size = await contentImageSize();
    mutateDraft((current) => applyFormatToDocument(current, noteFormat, size));
    setSelectedBlockId(null);
  };

  const insertGeneratedText = async (text: string, mode: AiInsertMode) => {
    if (!draftRef.current || isLocked) return;
    const closePanel = () => {
      setShowAiPanel(false);
      focusShell();
    };
    if (mode === "replace") {
      if (!isFreeTextBlock(selectedBlock)) return;
      updateBlock(selectedBlock.id, { content: text });
      closePanel();
      return;
    }

    if (mode === "sections") {
      const drafted = parseDraftText(text);
      const base = draftRef.current.blocks.some((block) => parseSectionBlockId(block.id))
        ? draftRef.current
        : applyFormatToDocument(draftRef.current, noteFormat, await contentImageSize());
      const { document: filledDocument, filled } = fillSectionsFromDraft(base, noteFormat, drafted);
      if (filled > 0) {
        mutateDraft(() => filledDocument);
        closePanel();
        return;
      }
      // Headings did not match the format: fall back to a single text block.
      mode = "block";
    }

    // Use the page image's real proportions; the stored rect may be a stretched default frame.
    const imageSize = await contentImageSize();

    const id = createBlockId("ai-text");
    mutateDraft((current) => {
      const frame = CONTENT_FRAME;
      const contentImage = current.blocks.find((block) => block.id === "content-image" && block.type === "image");
      let blocks = current.blocks;
      let textRect: Rect = { x: frame.x + 8, y: frame.y + 8, w: frame.w - 16, h: frame.h - 16 };

      if (mode === "split" && contentImage) {
        const imageArea: Rect = { x: frame.x, y: frame.y, w: frame.w, h: Math.round(frame.h * 0.48) };
        const fitted = fitIntoRect(imageSize?.width ?? contentImage.w, imageSize?.height ?? contentImage.h, imageArea, true);
        blocks = blocks.map((block) => (block.id === contentImage.id ? { ...block, ...fitted } : block));
        const top = imageArea.y + imageArea.h + 12;
        textRect = { x: frame.x + 8, y: top, w: frame.w - 16, h: frame.y + frame.h - top - 8 };
      }

      const textBlock: TextBlock = { id, type: "text", ...textRect, content: text, style: { ...AI_TEXT_STYLE }, locked: false };
      return { ...current, blocks: [...blocks, textBlock] };
    });
    setSelectedBlockId(id);
    closePanel();
  };

  // ─── Save / export ────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!draft || isLocked || isSaving) return;
    setIsSaving(true);
    setEditorError(null);
    try {
      const saved = await onSaveDocument(draft);
      setDraft(saved.document);
      setSavedSnapshot(JSON.stringify(saved.document));
    } catch (saveError) {
      setEditorError(saveError instanceof Error ? saveError.message : "레이아웃 저장에 실패했습니다");
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
      setSavedSnapshot(JSON.stringify(saved.document));
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
    recordHistory();
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
    recordHistory();
    await applyPageToDraft(updatedPage, true);
  };

  const sectionById = useMemo(() => new Map(noteFormat.sections.map((section) => [section.id, section])), [noteFormat]);
  const sectionInfo = (blockId: string) => {
    const parsed = parseSectionBlockId(blockId);
    if (!parsed) return null;
    const section = sectionById.get(parsed.sectionId);
    return parsed.part === "heading"
      ? { label: "섹션 제목", placeholder: section?.title ?? "섹션 제목" }
      : { label: section?.title ?? "섹션", placeholder: section?.guide || "이 섹션을 작성하세요" };
  };

  // ─── Pointer + keyboard ───────────────────────────────────────────────────
  const focusShell = () => shellRef.current?.focus({ preventScroll: true });

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
      offsetX: (event.clientX - canvasRect.left) / pageScaleRef.current - block.x,
      offsetY: (event.clientY - canvasRect.top) / pageScaleRef.current - block.y,
      startX: event.clientX,
      startY: event.clientY,
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (showAiPanel) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();

    if (mod && key === "s") {
      event.preventDefault();
      void handleSave();
      return;
    }
    if (isLocked) return;

    if (mod && key === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && key === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && key === "d") {
      event.preventDefault();
      duplicateSelected();
      return;
    }

    if (isEditableTarget(event.target)) {
      if (event.key === "Escape") {
        (event.target as HTMLElement).blur();
        focusShell();
      }
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      if (selectedBlock) {
        event.preventDefault();
        deleteSelected();
      }
      return;
    }
    if (event.key === "Escape") {
      setSelectedBlockId(null);
      return;
    }

    const step = event.shiftKey ? 10 : 1;
    const arrows: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = arrows[event.key];
    if (delta && selectedBlock) {
      event.preventDefault();
      nudgeSelected(delta[0], delta[1]);
    }
  };

  if (!draft) {
    return (
      <section className="editor-shell">
        <div className="editor-empty card">
          <p className="eyebrow">문서 편집기</p>
          <h3>아직 편집 문서가 없습니다</h3>
          <p>이 연구노트의 문서 레이아웃을 만들고, 업로드한 PDF 페이지와 블록을 여기서 관리하세요.</p>
          {isLocked && <p>{lockMessage}</p>}
          <button type="button" className="compact-button" onClick={() => void onCreateDocument()} disabled={isLocked}>
            편집 문서 만들기
          </button>
        </div>
      </section>
    );
  }

  const selectedIsProtected = selectedBlock ? isProtectedBlock(selectedBlock) : true;

  return (
    <section
      ref={shellRef}
      tabIndex={-1}
      className={`editor-shell${isLocked ? " editor-shell-locked" : ""}`}
      onKeyDown={handleKeyDown}
    >
      <div className="editor-toolbar card">
        <div className="editor-toolbar-main">
          <div>
            <p className="eyebrow">문서 편집기</p>
          </div>
          <div className="editor-toolbar-actions">
            <select value={activeDocumentId ?? ""} onChange={(event) => void onSelectDocument(event.target.value)}>
              <option value="">저장된 문서 선택</option>
              {documentSummaries.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            <button type="button" className="secondary-button compact-button" onClick={() => fileInputRef.current?.click()} disabled={isLocked}>
              파일 추가
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => void handleExportPdf()} disabled={isDownloading}>
              {isDownloading ? "다운로드 중..." : "PDF 다운로드"}
            </button>
            <button type="button" className="compact-button" onClick={() => void handleSave()} disabled={isSaving || isLocked}>
              {isSaving ? "저장 중..." : "레이아웃 저장"}
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
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              className="hidden-input"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void addImageBlock(file);
                event.target.value = "";
              }}
            />
          </div>
        </div>
        <label className="editor-title-input">
          제목
          <input
            value={draft.title}
            onChange={(event) => {
              const title = event.target.value;
              mutateDraft((current) => ({ ...current, title }), "title");
            }}
            onBlur={endCoalescing}
            disabled={isLocked}
          />
        </label>
        {isLocked && <div className="editor-lock-notice">{lockMessage}</div>}
        {editorError && <div className="editor-error">{editorError}</div>}
        {isDownloading && (
          <div className="download-progress">
            <div className="download-progress-head">
              <strong>PDF 다운로드 중</strong>
              <span>{downloadProgress == null ? "준비 중..." : `${downloadProgress}%`}</span>
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

      <div className="editor-command-bar">
        {!isLocked && (
          <div className="editor-edit-bar" role="toolbar" aria-label="편집 도구">
            <button type="button" className="secondary-button compact-button" onClick={undo} disabled={historySize.past === 0} title="실행 취소 (Ctrl+Z)">
              실행 취소
            </button>
            <button type="button" className="secondary-button compact-button" onClick={redo} disabled={historySize.future === 0} title="다시 실행 (Ctrl+Y)">
              다시 실행
            </button>
            <span className="editor-edit-divider" />
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => addTextBlock()}
              title="텍스트 상자 추가 (페이지를 더블클릭해도 됩니다)"
            >
              + 텍스트
            </button>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => imageInputRef.current?.click()}
              disabled={isUploadingImage}
            >
              {isUploadingImage ? "업로드 중..." : "+ 이미지"}
            </button>
            <button type="button" className="secondary-button compact-button" onClick={duplicateSelected} disabled={selectedIsProtected} title="복제 (Ctrl+D)">
              복제
            </button>
            <button type="button" className="secondary-button compact-button" onClick={deleteSelected} disabled={selectedIsProtected} title="삭제 (Del)">
              삭제
            </button>
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => void applyNoteFormat()}
              title="기관 노트 포맷대로 페이지 이미지와 본문 섹션을 배치합니다 (입력한 내용은 유지)"
            >
              포맷 적용
            </button>
            <span className="editor-edit-divider" />
            <button type="button" className="compact-button editor-ai-button" onClick={() => setShowAiPanel(true)}>
              AI 초안
            </button>
            <details className="editor-shortcuts-menu">
              <summary>단축키</summary>
              <dl className="editor-shortcuts">
                {SHORTCUTS.map(([keys, label]) => (
                  <div key={keys}>
                    <dt>{keys}</dt>
                    <dd>{label}</dd>
                  </div>
                ))}
              </dl>
            </details>
            <span className={`editor-save-state${isDirty ? " dirty" : ""}`}>{isDirty ? "저장하지 않은 변경사항" : "모든 변경사항 저장됨"}</span>
          </div>
        )}
        <div className="editor-inspector">
          {selectedBlock ? (
            <>
              <div className="editor-inspector-section">
                <span className="editor-inspector-label">선택됨</span>
                <h4>
                  {selectedBlock.type === "text" ? "텍스트 블록" : "이미지 블록"}
                  {FIXED_BLOCK_IDS.has(selectedBlock.id) && <span className="editor-inspector-tag">템플릿</span>}
                </h4>
                {selectedBlock.locked && (
                  <p className="editor-inspector-hint">노트 정보(제목, 작성자, 검토자, 날짜)에서 자동으로 채워집니다.</p>
                )}
              </div>

              {selectedBlock.locked ? (
                onEditNoteDetails &&
                !isLocked && (
                  <div className="editor-inspector-section">
                    <span className="editor-inspector-label">템플릿 항목</span>
                    <div className="editor-segmented">
                      <button type="button" className="compact-button" onClick={onEditNoteDetails}>
                        노트 정보 편집
                      </button>
                    </div>
                  </div>
                )
              ) : (
              <div className="editor-inspector-section">
                <span className="editor-inspector-label">위치·크기</span>
                <div className="editor-field-grid">
                  {(["x", "y", "w", "h"] as const).map((field) => (
                    <label key={field} className="editor-field">
                      <span>{field.toUpperCase()}</span>
                      <input
                        type="number"
                        value={selectedBlock[field]}
                        disabled={isLocked || Boolean(selectedBlock.locked)}
                        onChange={(event) => updateGeometry(selectedBlock.id, field, Number(event.target.value))}
                        onBlur={endCoalescing}
                      />
                    </label>
                  ))}
                </div>
              </div>
              )}

              {selectedBlock.type === "text" && !selectedBlock.locked && (
                <div className="editor-inspector-section">
                  <span className="editor-inspector-label">텍스트</span>
                  <div className="editor-field-grid editor-field-grid-text">
                    <label className="editor-field">
                      <span>크기</span>
                      <input
                        type="number"
                        min={6}
                        max={72}
                        value={selectedBlock.style?.fontSize ?? 16}
                        disabled={isLocked}
                        onChange={(event) => {
                          const size = Number(event.target.value);
                          if (Number.isFinite(size) && size > 0) {
                            updateTextStyle(selectedBlock.id, { fontSize: clamp(Math.round(size), 6, 72) }, `font:${selectedBlock.id}`);
                          }
                        }}
                        onBlur={endCoalescing}
                      />
                    </label>
                    <label className="editor-field">
                      <span>색상</span>
                      <input
                        type="color"
                        className="editor-color-input"
                        value={selectedBlock.style?.color ?? "#000000"}
                        disabled={isLocked}
                        onChange={(event) => updateTextStyle(selectedBlock.id, { color: event.target.value }, `color:${selectedBlock.id}`)}
                        onBlur={endCoalescing}
                      />
                    </label>
                  </div>
                  <div className="editor-segmented">
                    <button
                      type="button"
                      className={`secondary-button compact-button${selectedBlock.style?.fontWeight === "bold" ? " active" : ""}`}
                      onClick={() =>
                        updateTextStyle(selectedBlock.id, {
                          fontWeight: selectedBlock.style?.fontWeight === "bold" ? "normal" : "bold",
                        })
                      }
                      disabled={isLocked}
                      aria-pressed={selectedBlock.style?.fontWeight === "bold"}
                    >
                      <strong>B</strong>
                    </button>
                    {(["left", "center", "right"] as const).map((align) => (
                      <button
                        key={align}
                        type="button"
                        className={`secondary-button compact-button${(selectedBlock.style?.textAlign ?? "left") === align ? " active" : ""}`}
                        onClick={() => updateTextStyle(selectedBlock.id, { textAlign: align })}
                        disabled={isLocked}
                        aria-pressed={(selectedBlock.style?.textAlign ?? "left") === align}
                      >
                        {align === "left" ? "왼쪽" : align === "center" ? "가운데" : "오른쪽"}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {!isLocked && !selectedBlock.locked && (
                <div className="editor-inspector-section">
                  <span className="editor-inspector-label">정렬</span>
                  <div className="editor-segmented">
                    <button type="button" className="secondary-button compact-button" onClick={() => moveLayer("front")}>
                      맨 앞으로
                    </button>
                    <button type="button" className="secondary-button compact-button" onClick={() => moveLayer("back")}>
                      맨 뒤로
                    </button>
                  </div>
                  <div className="editor-segmented">
                    <button type="button" className="secondary-button compact-button" onClick={duplicateSelected} disabled={selectedIsProtected}>
                      복제
                    </button>
                    <button type="button" className="secondary-button compact-button editor-danger-button" onClick={deleteSelected} disabled={selectedIsProtected}>
                      삭제
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="editor-inspector-section">
              <span className="editor-inspector-label">속성</span>
              <p className="editor-inspector-hint">
                {isLocked
                  ? "이 노트는 잠겨 있습니다."
                  : "페이지 아무 곳이나 더블클릭하면 바로 입력할 수 있습니다. 블록을 클릭하면 이동, 크기 조절, 서식 변경이 가능합니다."}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="editor-layout">
        <aside className="card editor-side-panel">
          <div className="section-head">
            <h4>파일 페이지</h4>
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
                <strong>페이지 없음</strong>
                <span>PDF나 이미지 파일을 먼저 올리면 여기서 페이지를 관리할 수 있습니다.</span>
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
                    <img src={previewUrl} alt={`${page.page_no}페이지`} />
                    <strong>{page.page_type === "image" ? "이미지" : `${page.page_no}페이지`}</strong>
                    <span>캔버스 배경으로 사용</span>
                  </button>
                  <button
                    type="button"
                    className="secondary-button compact-button editor-reference-replace"
                    onClick={() => chooseReplacementForPage(page.id)}
                    disabled={isLocked || !onReplaceReferencePage}
                  >
                    이미지 교체
                  </button>
                </div>
              );
            })}
          </div>
        </aside>

        <div className="editor-canvas-wrap">
          <div ref={canvasScrollRef} className="editor-canvas-scroll" onClick={() => setSelectedBlockId(null)}>
            <div
              className="editor-canvas-sizer"
              style={{ width: `${draft.page.width * pageScale}px`, height: `${draft.page.height * pageScale}px` }}
            >
            <div
              ref={canvasRef}
              className="editor-canvas-page"
              style={{
                width: `${draft.page.width}px`,
                height: `${draft.page.height}px`,
                transform: pageScale === 1 ? undefined : `scale(${pageScale})`,
                transformOrigin: "top left",
                backgroundColor: draft.page.background,
                backgroundImage: draft.page.backgroundImage ? `url("${draft.page.backgroundImage}")` : undefined,
              }}
              onMouseDown={(event) => {
                pointerDownOnPageRef.current = event.target === event.currentTarget;
              }}
              onClick={(event) => {
                event.stopPropagation();
                // Only deselect when the whole click happened on empty page space.
                if (event.target === event.currentTarget && pointerDownOnPageRef.current) {
                  setSelectedBlockId(null);
                  focusShell();
                }
              }}
              onDoubleClick={(event) => {
                // Double-click on empty space or an image starts a text box right there.
                if (isLocked || isEditableTarget(event.target)) return;
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return;
                const scale = pageScaleRef.current;
                addTextBlock({ x: (event.clientX - rect.left) / scale - 12, y: (event.clientY - rect.top) / scale - 14 });
              }}
            >
              {draft.blocks.map((block) => {
                const editableText = block.type === "text" && !block.locked && !isLocked;
                return (
                  <div
                    key={block.id}
                    data-block-id={block.id}
                    className={`editor-block editor-block--${block.type}${selectedBlockId === block.id ? " selected" : ""}${block.locked ? " locked" : ""}`}
                    style={{ left: block.x, top: block.y, width: block.w, height: block.h }}
                    onClick={(event) => {
                      event.stopPropagation();
                      setSelectedBlockId(block.id);
                      if (!isEditableTarget(event.target)) focusShell();
                    }}
                    onDoubleClick={(event) => {
                      if (block.type === "image" && !block.locked) return; // bubbles up: adds text at that point
                      event.stopPropagation();
                      if (block.locked && block.type === "text" && !isLocked) onEditNoteDetails?.();
                    }}
                    title={block.locked && block.type === "text" && !isLocked ? "더블클릭하면 노트 정보를 편집합니다" : undefined}
                  >
                    {editableText ? (
                      <div className="editor-block-handle" onMouseDown={(event) => startMove(event, block.id)} title="끌어서 이동">
                        ⠿ {sectionInfo(block.id)?.label ?? (block.id.startsWith("ai-text") ? "AI 텍스트" : "텍스트")}
                      </div>
                    ) : block.type === "image" && !isLocked && !block.locked ? (
                      <button
                        type="button"
                        className="editor-image-drag-handle"
                        onMouseDown={(event) => startMove(event, block.id)}
                        aria-label="이미지 블록 이동"
                      />
                    ) : null}
                    {block.type === "text" ? (
                      editableText ? (
                        <textarea
                          value={block.content}
                          placeholder={sectionInfo(block.id)?.placeholder ?? "여기에 입력"}
                          onFocus={() => setSelectedBlockId(block.id)}
                          onBlur={endCoalescing}
                          onChange={(event) => updateBlock(block.id, { content: event.target.value }, `text:${block.id}`)}
                          style={textStyleToCss(block.style)}
                        />
                      ) : (
                        <div className="editor-block-text editor-block-text-locked" style={textStyleToCss(block.style)}>
                          {block.content}
                        </div>
                      )
                    ) : (
                      <img src={block.src} alt="" />
                    )}
                    {!isLocked && !block.locked && (
                      <button type="button" className="editor-resize-handle" onMouseDown={(event) => startResize(event, block.id)} />
                    )}
                  </div>
                );
              })}
            </div>
            </div>
          </div>
        </div>

      </div>

      {showAiPanel && (
        <AiDraftPanel
          noteId={noteId}
          status={aiStatus}
          referencePages={referencePages}
          defaultPageId={draft.meta.sourcePageId ?? null}
          existingText={existingFreeText}
          canReplace={isFreeTextBlock(selectedBlock)}
          hasContentImage={hasContentImage}
          hasFormatSections={noteFormat.sections.length > 0 && noteFormat.layout.mode !== "image_only"}
          onInsert={(text, mode) => void insertGeneratedText(text, mode)}
          onClose={() => {
            setShowAiPanel(false);
            focusShell();
          }}
        />
      )}
    </section>
  );
}
