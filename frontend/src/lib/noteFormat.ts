/**
 * Company-wide research note format, shared by the format settings page, the document editor
 * and the default document builder. Mirrors backend/app/domain/note_formats/entities.py.
 */
import type { DocumentBlock, DocumentSchema, ImageBlock, TextBlock } from "../types/document";

export type NoteFormatSection = { id: string; title: string; guide: string };
export type NoteLayoutMode = "image_top" | "text_top" | "text_only" | "image_only";

export type NoteFormat = {
  version: number;
  sections: NoteFormatSection[];
  layout: { mode: NoteLayoutMode; imageRatio: number };
  header: { show: boolean; titleLabel: string };
  footer: {
    show: boolean;
    recordedLabel: string;
    witnessedLabel: string;
    signatureLabel: string;
    dateLabel: string;
  };
  typography: { bodyFontSize: number; headingFontSize: number; headingBold: boolean };
};

export type Rect = { x: number; y: number; w: number; h: number };

export const MAX_SECTIONS = 12;
export const PAGE_WIDTH = 794;
export const PAGE_HEIGHT = 1123;
const CONTENT_X = 34;
const CONTENT_W = 726;
const AREA_GAP = 12;
const SECTION_GAP = 8;

export const DEFAULT_NOTE_FORMAT: NoteFormat = {
  version: 1,
  sections: [
    { id: "purpose", title: "연구 목적", guide: "이번 실험/작업의 목적과 배경" },
    { id: "method", title: "수행 내용", guide: "재료, 조건, 절차 등 수행한 내용" },
    { id: "result", title: "결과", guide: "관찰 결과와 측정값" },
    { id: "discussion", title: "고찰 및 향후 계획", guide: "결과 해석, 문제점, 다음 계획" },
  ],
  layout: { mode: "image_top", imageRatio: 0.48 },
  header: { show: true, titleLabel: "제목 :" },
  footer: {
    show: true,
    recordedLabel: "작성자",
    witnessedLabel: "검토자",
    signatureLabel: "서명",
    dateLabel: "날짜",
  },
  typography: { bodyFontSize: 12, headingFontSize: 13, headingBold: true },
};

export const LAYOUT_MODE_LABELS: Record<NoteLayoutMode, string> = {
  image_top: "이미지 위, 글 아래",
  text_top: "글 위, 이미지 아래",
  text_only: "글만",
  image_only: "이미지만",
};

// ─── Geometry ───────────────────────────────────────────────────────────────
export function contentArea(format: NoteFormat): Rect {
  const top = format.header.show ? 64 : 34;
  const bottom = format.footer.show ? 948 : 1088;
  return { x: CONTENT_X, y: top, w: CONTENT_W, h: bottom - top };
}

function hasTextArea(format: NoteFormat) {
  return format.layout.mode !== "image_only" && format.sections.length > 0;
}

export const RATIO_MIN = 0.2;
export const RATIO_MAX = 0.8;
const MIN_BODY_H = 28;

function headingHeight(format: NoteFormat) {
  return Math.round(format.typography.headingFontSize * 1.5 + 10);
}

/**
 * Largest image share that still leaves every section a title line plus a small writing box.
 * The saved ratio is capped to this when laying out, so sections never spill into the footer.
 */
export function maxImageRatio(format: NoteFormat): number {
  if (!hasTextArea(format)) return RATIO_MAX;
  const area = contentArea(format);
  const count = format.sections.length;
  const minText = count * (headingHeight(format) + MIN_BODY_H) + (count - 1) * SECTION_GAP;
  const ratio = Math.floor(((area.h - AREA_GAP - minText) / area.h) * 50) / 50;
  return Math.min(RATIO_MAX, Math.max(RATIO_MIN, ratio));
}

export function effectiveImageRatio(format: NoteFormat): number {
  return Math.min(format.layout.imageRatio, maxImageRatio(format));
}

/** Area the uploaded page image is fitted into, or null when the layout has no image. */
export function formatImageRect(format: NoteFormat): Rect | null {
  const area = contentArea(format);
  if (format.layout.mode === "text_only") return null;
  if (!hasTextArea(format)) return area;
  const imageH = Math.round(area.h * effectiveImageRatio(format));
  return format.layout.mode === "image_top"
    ? { ...area, h: imageH }
    : { ...area, y: area.y + area.h - imageH, h: imageH };
}

/** Area the section blocks are laid out in, or null when the layout has no text. */
export function formatTextRect(format: NoteFormat): Rect | null {
  if (!hasTextArea(format)) return null;
  const area = contentArea(format);
  const image = formatImageRect(format);
  if (!image) return area;
  if (format.layout.mode === "image_top") {
    const top = image.y + image.h + AREA_GAP;
    return { ...area, y: top, h: area.y + area.h - top };
  }
  return { ...area, h: image.y - AREA_GAP - area.y };
}

export function fitIntoRect(width: number, height: number, rect: Rect, allowUpscale = true): Rect {
  if (width <= 0 || height <= 0) return rect;
  const scale = Math.min(rect.w / width, rect.h / height, allowUpscale ? Number.POSITIVE_INFINITY : 1);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: Math.round(rect.x + (rect.w - w) / 2), y: Math.round(rect.y + (rect.h - h) / 2), w, h };
}

// ─── Section blocks ─────────────────────────────────────────────────────────
const SECTION_PREFIX = "section-";

export function sectionHeadingId(sectionId: string) {
  return `${SECTION_PREFIX}${sectionId}-heading`;
}

export function sectionBodyId(sectionId: string) {
  return `${SECTION_PREFIX}${sectionId}-body`;
}

/** Returns the section and part for a section block id, e.g. section-result-body → result/body. */
export function parseSectionBlockId(blockId: string): { sectionId: string; part: "heading" | "body" } | null {
  const match = /^section-(.+)-(heading|body)$/.exec(blockId);
  return match ? { sectionId: match[1], part: match[2] as "heading" | "body" } : null;
}

/** Section heading + body blocks laid out top to bottom in the text area, keeping existing text. */
export function buildSectionBlocks(format: NoteFormat, existing: DocumentBlock[] = []): TextBlock[] {
  const area = formatTextRect(format);
  if (!area) return [];
  const existingById = new Map(existing.map((block) => [block.id, block]));
  const count = format.sections.length;
  const slot = (area.h - SECTION_GAP * (count - 1)) / count;
  // When space is tight, the title line shrinks before anything spills out of the text area.
  const headingH = Math.max(14, Math.min(headingHeight(format), Math.round(slot * 0.5)));
  const { bodyFontSize, headingFontSize, headingBold } = format.typography;

  return format.sections.flatMap((section, index) => {
    const top = Math.round(area.y + index * (slot + SECTION_GAP));
    const previousHeading = existingById.get(sectionHeadingId(section.id));
    const previousBody = existingById.get(sectionBodyId(section.id));
    const heading: TextBlock = {
      id: sectionHeadingId(section.id),
      type: "text",
      x: area.x,
      y: top,
      w: area.w,
      h: headingH,
      content: section.title,
      style: { fontSize: headingFontSize, fontWeight: headingBold ? "bold" : "normal", textAlign: "left" },
      locked: false,
    };
    const body: TextBlock = {
      id: sectionBodyId(section.id),
      type: "text",
      x: area.x,
      y: top + headingH,
      w: area.w,
      h: Math.max(10, Math.round(slot - headingH)),
      content: previousBody?.type === "text" ? previousBody.content : "",
      style: {
        ...(previousBody?.type === "text" ? previousBody.style : {}),
        fontSize: bodyFontSize,
        fontWeight: "normal",
        textAlign: "left",
      },
      locked: false,
    };
    // A heading the author renamed in this note stays as written.
    if (previousHeading?.type === "text" && previousHeading.content.trim()) heading.content = previousHeading.content;
    return [heading, body];
  });
}

/**
 * Re-lays out a document to the format: page image into the image area, section blocks into the
 * text area. Text already typed into sections is kept; sections no longer in the format are kept
 * only if they contain text.
 */
export function applyFormatToDocument(
  document: DocumentSchema,
  format: NoteFormat,
  imageSize?: { width: number; height: number } | null
): DocumentSchema {
  const sectionBlocks = buildSectionBlocks(format, document.blocks);
  const newIds = new Set(sectionBlocks.map((block) => block.id));
  const imageRect = formatImageRect(format);

  const kept = document.blocks.flatMap<DocumentBlock>((block) => {
    if (newIds.has(block.id)) return [];
    if (parseSectionBlockId(block.id)) {
      return block.type === "text" && block.content.trim() && parseSectionBlockId(block.id)?.part === "body"
        ? [block]
        : [];
    }
    if (block.id === "content-image" && block.type === "image") {
      if (!imageRect) return [];
      const size = imageSize ?? { width: block.w, height: block.h };
      return [{ ...block, ...fitIntoRect(size.width, size.height, imageRect) } as ImageBlock];
    }
    return [block];
  });

  return {
    ...document,
    page: {
      ...document.page,
      backgroundImage: isTemplateSvg(document.page.backgroundImage) ? buildPageTemplateSvg(format) : document.page.backgroundImage,
    },
    blocks: [...kept, ...sectionBlocks],
  };
}

/** Fills section body blocks from AI draft sections, matching headings to the format's section titles. */
export function fillSectionsFromDraft(
  document: DocumentSchema,
  format: NoteFormat,
  drafted: { heading: string; body: string }[]
): { document: DocumentSchema; filled: number } {
  const normalize = (value: string) => value.replace(/[\s■:#*·.-]/g, "").toLowerCase();
  const bodyBySection = new Map<string, string>();
  drafted.forEach((item, index) => {
    const match =
      format.sections.find((section) => normalize(section.title) === normalize(item.heading)) ??
      (drafted.length === format.sections.length ? format.sections[index] : undefined);
    if (match && !bodyBySection.has(match.id)) bodyBySection.set(match.id, item.body.trim());
  });

  let filled = 0;
  const blocks = document.blocks.map((block) => {
    const parsed = parseSectionBlockId(block.id);
    if (!parsed || parsed.part !== "body" || block.type !== "text") return block;
    const body = bodyBySection.get(parsed.sectionId);
    if (body == null) return block;
    filled += 1;
    return { ...block, content: body };
  });
  return { document: { ...document, blocks }, filled };
}

/** Splits draft text in the "■ Heading\nbody" shape the AI panel shows back into sections. */
export function parseDraftText(text: string): { heading: string; body: string }[] {
  const sections: { heading: string; body: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const heading = /^■\s*(.+)$/.exec(line.trim());
    if (heading) {
      sections.push({ heading: heading[1].trim(), body: "" });
    } else if (sections.length > 0) {
      const current = sections[sections.length - 1];
      current.body = current.body ? `${current.body}\n${line}` : line;
    }
  }
  return sections.map((section) => ({ ...section, body: section.body.trim() }));
}

// ─── Page template (canvas background) ──────────────────────────────────────
function escapeXml(value: string) {
  return value.replace(/[<>&'"]/g, (char) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[char]!);
}

export function isTemplateSvg(background: string | null | undefined) {
  return !background || background.startsWith("data:image/svg+xml");
}

export function buildPageTemplateSvg(format: NoteFormat): string {
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#94a3b8" stroke-width="1.2" />`;
  const label = (x: number, y: number, text: string, size: number) =>
    text
      ? `<text x="${x}" y="${y}" font-size="${size}" fill="#334155" font-family="Arial, Malgun Gothic, sans-serif">${escapeXml(text)}</text>`
      : "";
  const parts = [
    `<rect x="20" y="25" width="754" height="1073" fill="#ffffff" stroke="#94a3b8" stroke-width="1.5" />`,
  ];
  if (format.header.show) {
    parts.push(line(20, 55, 774, 55), label(32, 44, format.header.titleLabel, 12));
  }
  if (format.footer.show) {
    const footer = format.footer;
    parts.push(
      line(20, 955, 774, 955),
      line(20, 1026, 774, 1026),
      line(250, 955, 250, 1098),
      line(510, 955, 510, 1098),
      label(32, 971, footer.recordedLabel, 11),
      label(270, 971, footer.signatureLabel, 11),
      label(528, 971, footer.dateLabel, 11),
      label(32, 1042, footer.witnessedLabel, 11),
      label(270, 1042, footer.signatureLabel, 11),
      label(528, 1042, footer.dateLabel, 11)
    );
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123">${parts.join("")}</svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/** Template field block ids the format shows (header title, footer names/dates/signatures). */
export function formatTemplateBlockIds(format: NoteFormat): Set<string> {
  const ids = new Set<string>();
  if (format.header.show) ids.add("note-title");
  if (format.footer.show) {
    ["continued-page", "recorded-by", "recorded-date", "witnessed-by", "witnessed-date", "author-signature", "reviewer-signature"].forEach(
      (id) => ids.add(id)
    );
  }
  return ids;
}
