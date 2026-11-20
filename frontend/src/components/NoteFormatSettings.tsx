import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";

import type { NoteFormatInfo } from "../api/noteFormat";
import {
  LAYOUT_MODE_LABELS,
  MAX_SECTIONS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  buildPageTemplateSvg,
  buildSectionBlocks,
  RATIO_MIN,
  contentArea,
  effectiveImageRatio,
  maxImageRatio,
  formatImageRect,
  formatTextRect,
  parseSectionBlockId,
  type NoteFormat,
  type NoteFormatSection,
  type NoteLayoutMode,
} from "../lib/noteFormat";

type Props = {
  info: NoteFormatInfo | null;
  loadError: string | null;
  onSave: (format: NoteFormat) => Promise<void>;
  /** Deletes the saved company format (back to the built-in default). */
  onDelete?: () => Promise<void>;
};

type Tab = "sections" | "layout" | "frame" | "text";
/** Part of the page that is highlighted in the preview. */
type Zone = { kind: "header" | "footer" | "image" } | { kind: "section"; id: string } | null;

const TABS: { id: Tab; label: string }[] = [
  { id: "sections", label: "섹션" },
  { id: "layout", label: "레이아웃" },
  { id: "frame", label: "머리글·서명란" },
  { id: "text", label: "글자 스타일" },
];

const LAYOUT_DESCRIPTIONS: Record<NoteLayoutMode, string> = {
  image_top: "첨부 페이지가 위, 작성 섹션이 아래",
  text_top: "작성 섹션이 위, 첨부 페이지가 아래",
  text_only: "작성 섹션만, 첨부 페이지 없음",
  image_only: "첨부 페이지만, 작성 섹션 없음",
};

const SECTION_PRESETS: { title: string; guide: string }[] = [
  { title: "배경", guide: "이번 작업의 배경과 선행 연구" },
  { title: "재료", guide: "시료, 시약, 장비, 버전" },
  { title: "관찰 내용", guide: "작업 중 관찰한 내용" },
  { title: "데이터", guide: "측정값, 표, 파일 참조" },
  { title: "문제점", guide: "문제, 계획과 달라진 점, 실패한 시도" },
  { title: "향후 계획", guide: "다음에 할 일과 담당자" },
  { title: "참고 자료", guide: "논문, 프로토콜, 링크" },
];

const PREVIEW_SCALE = 0.6;

function newSectionId(sections: NoteFormatSection[]) {
  let id = "";
  do {
    id = `s${Math.random().toString(36).slice(2, 8)}`;
  } while (sections.some((section) => section.id === id));
  return id;
}

export function NoteFormatSettings({ info, loadError, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<NoteFormat | null>(info?.format ?? null);
  const [tab, setTab] = useState<Tab>("sections");
  const [zone, setZone] = useState<Zone>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    setDraft(info?.format ?? null);
  }, [info]);

  const isDirty = useMemo(
    () => Boolean(draft && info && JSON.stringify(draft) !== JSON.stringify(info.format)),
    [draft, info]
  );

  if (!info || !draft) {
    return (
      <section className="card fmt-loading">
        <p>{loadError ?? "노트 포맷을 불러오는 중..."}</p>
      </section>
    );
  }

  const canEdit = info.can_manage;
  const update = (patch: (current: NoteFormat) => NoteFormat) => {
    if (!canEdit) return;
    setMessage(null);
    setDraft((current) => (current ? patch(current) : current));
  };

  const selectZone = (next: Zone) => {
    setZone(next);
    if (!next) return;
    setTab(next.kind === "section" ? "sections" : next.kind === "image" ? "layout" : "frame");
  };

  const removeSection = (id: string) => {
    update((current) => ({ ...current, sections: current.sections.filter((item) => item.id !== id) }));
    setZone((current) => (current?.kind === "section" && current.id === id ? null : current));
  };

  const deleteFormat = async () => {
    if (!onDelete) return;
    if (!window.confirm("저장된 기관 포맷을 삭제하고 기본 포맷으로 돌아갈까요? 이후 새 노트와 \"포맷 적용\"은 기본 포맷을 씁니다. 되돌릴 수 없습니다.")) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await onDelete();
      setZone(null);
      setMessage({ kind: "ok", text: "기관 포맷을 삭제했습니다. 이제 기본 포맷을 씁니다." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "삭제에 실패했습니다" });
    } finally {
      setIsSaving(false);
    }
  };

  const selectedSection = zone?.kind === "section" ? draft.sections.find((section) => section.id === zone.id) : undefined;

  const validationError = (() => {
    if (draft.sections.some((section) => !section.title.trim())) return "모든 섹션에 제목을 입력하세요.";
    if (draft.sections.length === 0 && draft.layout.mode !== "image_only")
      return "섹션을 하나 이상 추가하거나 레이아웃을 \"이미지만\"으로 바꾸세요.";
    return null;
  })();

  const save = async () => {
    if (validationError) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await onSave({
        ...draft,
        sections: draft.sections.map((section) => ({ ...section, title: section.title.trim(), guide: section.guide.trim() })),
      });
      setMessage({ kind: "ok", text: "저장했습니다. 이제 새 노트와 편집기의 \"포맷 적용\"에 이 포맷이 쓰입니다." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "저장에 실패했습니다" });
    } finally {
      setIsSaving(false);
    }
  };

  const status = validationError
    ? { kind: "error", text: validationError }
    : message
      ? message
      : isDirty
        ? { kind: "dirty", text: "저장하지 않은 변경사항" }
        : { kind: "idle", text: info.is_custom ? "기관 포맷을 사용 중입니다" : "기본 포맷을 사용 중입니다" };

  return (
    <div className="fmt">
      <section className="card fmt-top">
        <div>
          <h3>연구노트 포맷</h3>
          <p className="fmt-muted">
            기관의 모든 연구노트 구성을 정합니다. 페이지의 원하는 부분을 클릭해 편집하세요.
          </p>
        </div>
        <span className={`fmt-badge${info.is_custom ? " custom" : ""}`}>{info.is_custom ? "사용자 지정" : "기본"}</span>
      </section>

      {!canEdit && (
        <div className="editor-lock-notice">포맷을 볼 수만 있습니다. 변경은 기관 관리자만 할 수 있습니다.</div>
      )}

      <div className="fmt-workspace">
        <section className="card fmt-stage">
          <InteractivePage
            format={draft}
            zone={zone}
            onSelect={selectZone}
            onRatioChange={
              canEdit ? (ratio) => update((current) => ({ ...current, layout: { ...current.layout, imageRatio: ratio } })) : null
            }
          />
          {canEdit && selectedSection ? (
            <div className="fmt-selected-bar">
              <span>
                선택한 섹션: <b>{selectedSection.title || "(제목 없음)"}</b>
              </span>
              <button type="button" className="fmt-delete-button" onClick={() => removeSection(selectedSection.id)}>
                이 섹션 삭제
              </button>
            </div>
          ) : (
            <p className="fmt-muted fmt-stage-tip">
              팁: 페이지의 섹션을 클릭하면 바로 고치거나 삭제할 수 있습니다. 이미지와 글 사이의 파란 손잡이를 끌어 크기를 조절하세요.
            </p>
          )}
        </section>

        <section className="card fmt-panel">
          <div className="fmt-tabs" role="tablist">
            {TABS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={tab === item.id}
                className={`fmt-tab${tab === item.id ? " active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="fmt-tab-body" role="tabpanel">
            {tab === "sections" && (
              <SectionsTab
                format={draft}
                canEdit={canEdit}
                onRemove={removeSection}
                selectedId={zone?.kind === "section" ? zone.id : null}
                onSelect={(id) => setZone({ kind: "section", id })}
                update={update}
              />
            )}
            {tab === "layout" && <LayoutTab format={draft} canEdit={canEdit} update={update} />}
            {tab === "frame" && <FrameTab format={draft} canEdit={canEdit} update={update} highlight={zone?.kind ?? null} />}
            {tab === "text" && <TextTab format={draft} canEdit={canEdit} update={update} />}
          </div>
        </section>
      </div>

      {canEdit && (
        <div className="fmt-savebar">
          <span className={`fmt-status ${status.kind}`}>{status.text}</span>
          <div className="fmt-savebar-actions">
            {info.is_custom && onDelete && (
              <button
                type="button"
                className="secondary-button compact-button danger-text"
                onClick={() => void deleteFormat()}
                disabled={isSaving}
                title="저장된 기관 포맷을 지우고 기본 포맷으로 돌아갑니다"
              >
                기관 포맷 삭제
              </button>
            )}
            <button
              type="button"
              className="secondary-button compact-button"
              onClick={() => update(() => structuredClone(info.default_format))}
              title="기본 포맷을 불러옵니다. 저장을 누르기 전에는 반영되지 않습니다."
            >
              기본값 사용
            </button>
            <button type="button" className="secondary-button compact-button" onClick={() => setDraft(info.format)} disabled={!isDirty}>
              되돌리기
            </button>
            <button type="button" className="compact-button" onClick={() => void save()} disabled={!isDirty || isSaving || Boolean(validationError)}>
              {isSaving ? "저장 중..." : "저장"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Interactive page preview ──────────────────────────────────────────────
function InteractivePage({
  format,
  zone,
  onSelect,
  onRatioChange,
}: {
  format: NoteFormat;
  zone: Zone;
  onSelect: (zone: Zone) => void;
  onRatioChange: ((ratio: number) => void) | null;
}) {
  const pageRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const background = useMemo(() => buildPageTemplateSvg(format), [format]);
  const imageRect = formatImageRect(format);
  const textRect = formatTextRect(format);
  const blocks = buildSectionBlocks(format);
  const area = contentArea(format);

  // Section zone = heading + body of one section.
  const sectionZones = format.sections.map((section) => {
    const parts = blocks.filter((block) => parseSectionBlockId(block.id)?.sectionId === section.id);
    const top = Math.min(...parts.map((block) => block.y));
    const bottom = Math.max(...parts.map((block) => block.y + block.h));
    const heading = parts.find((block) => parseSectionBlockId(block.id)?.part === "heading");
    return { section, x: area.x, y: top, w: area.w, h: bottom - top, headingH: heading?.h ?? 30 };
  });

  // Divider sits in the gap between the image area and the text area.
  const dividerY =
    imageRect && textRect
      ? format.layout.mode === "image_top"
        ? imageRect.y + imageRect.h + 6
        : textRect.y + textRect.h + 6
      : null;

  useEffect(() => {
    if (!dragging || !onRatioChange) return;
    const onMove = (event: MouseEvent) => {
      const rect = pageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const y = (event.clientY - rect.top) / PREVIEW_SCALE;
      const raw = format.layout.mode === "image_top" ? (y - area.y) / area.h : (area.y + area.h - y) / area.h;
      const ratio = Math.min(maxImageRatio(format), Math.max(RATIO_MIN, Math.round(raw * 50) / 50));
      if (ratio !== format.layout.imageRatio) onRatioChange(ratio);
    };
    const onUp = () => setDragging(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, onRatioChange, format, area.y, area.h]);

  const isActive = (kind: string, id?: string) =>
    zone?.kind === kind && (kind !== "section" || (zone.kind === "section" && zone.id === id));

  const startDrag = (event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setDragging(true);
  };

  return (
    <div className="fmt-page-frame" style={{ width: PAGE_WIDTH * PREVIEW_SCALE, height: PAGE_HEIGHT * PREVIEW_SCALE }}>
      <div
        ref={pageRef}
        className={`fmt-page${dragging ? " dragging" : ""}`}
        style={{ width: PAGE_WIDTH, height: PAGE_HEIGHT, transform: `scale(${PREVIEW_SCALE})`, backgroundImage: `url("${background}")` }}
        onClick={() => onSelect(null)}
      >
        {format.header.show ? (
          <ZoneBox rect={{ x: 20, y: 25, w: 754, h: 30 }} active={isActive("header")} label="머리글" onClick={() => onSelect({ kind: "header" })}>
            <span className="fmt-sample" style={{ left: 70, top: 6, fontSize: 13 }}>
              샘플 연구노트
            </span>
          </ZoneBox>
        ) : (
          <GhostZone rect={{ x: 20, y: 25, w: 754, h: 30 }} label="+ 머리글 숨김" onClick={() => onSelect({ kind: "header" })} />
        )}

        {imageRect && (
          <ZoneBox rect={imageRect} active={isActive("image")} label="레이아웃" className="fmt-zone-image" onClick={() => onSelect({ kind: "image" })}>
            <span className="fmt-image-label">첨부 페이지 이미지</span>
          </ZoneBox>
        )}

        {sectionZones.map(({ section, x, y, w, h, headingH }, index) => (
          <ZoneBox
            key={section.id}
            rect={{ x, y, w, h }}
            active={isActive("section", section.id)}
            label={`섹션 ${index + 1}`}
            className="fmt-zone-section"
            onClick={() => onSelect({ kind: "section", id: section.id })}
          >
            <span
              className="fmt-section-title"
              style={{
                height: headingH,
                fontSize: format.typography.headingFontSize,
                fontWeight: format.typography.headingBold ? 700 : 400,
              }}
            >
              {section.title || "제목 없는 섹션"}
            </span>
            <span className="fmt-section-guide" style={{ fontSize: format.typography.bodyFontSize }}>
              {section.guide || "본문"}
            </span>
          </ZoneBox>
        ))}

        {format.footer.show ? (
          <ZoneBox rect={{ x: 20, y: 955, w: 754, h: 143 }} active={isActive("footer")} label="서명란" onClick={() => onSelect({ kind: "footer" })}>
            <span className="fmt-sample" style={{ left: 14, top: 36, width: 200, textAlign: "center", fontSize: 16 }}>
              작성자
            </span>
            <span className="fmt-sample" style={{ left: 508, top: 36, width: 140, textAlign: "center", fontSize: 16 }}>
              2026-01-01
            </span>
          </ZoneBox>
        ) : (
          <GhostZone rect={{ x: 20, y: 1050, w: 754, h: 40 }} label="+ 서명란 숨김" onClick={() => onSelect({ kind: "footer" })} />
        )}

        {dividerY != null && onRatioChange && (
          <div
            className="fmt-divider"
            style={{ top: dividerY - 12, left: area.x, width: area.w }}
            onMouseDown={startDrag}
            onClick={(event) => event.stopPropagation()}
            title="끌어서 이미지 영역 크기 조절"
          >
            <span>이미지 {Math.round(effectiveImageRatio(format) * 100)}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

function ZoneBox({
  rect,
  active,
  label,
  className = "",
  onClick,
  children,
}: {
  rect: { x: number; y: number; w: number; h: number };
  active: boolean;
  label: string;
  className?: string;
  onClick: () => void;
  children?: ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      className={`fmt-zone ${className}${active ? " active" : ""}`}
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <span className="fmt-zone-tag">{label}</span>
      {children}
    </div>
  );
}

function GhostZone({ rect, label, onClick }: { rect: { x: number; y: number; w: number; h: number }; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="fmt-ghost"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {label}
    </button>
  );
}

// ─── Tabs ───────────────────────────────────────────────────────────────────
type TabProps = { format: NoteFormat; canEdit: boolean; update: (patch: (current: NoteFormat) => NoteFormat) => void };

function SectionsTab({
  format,
  canEdit,
  selectedId,
  onSelect,
  onRemove,
  update,
}: TabProps & { selectedId: string | null; onSelect: (id: string) => void; onRemove: (id: string) => void }) {
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const dragIndex = useRef<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedId) cardRefs.current.get(selectedId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  useEffect(() => {
    if (!focusId) return;
    cardRefs.current.get(focusId)?.querySelector("input")?.focus();
    setFocusId(null);
  }, [focusId, format.sections]);

  const patchSection = (id: string, patch: Partial<NoteFormatSection>) =>
    update((current) => ({
      ...current,
      sections: current.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
    }));

  const addSection = (title = "", guide = "") => {
    const id = newSectionId(format.sections);
    update((current) => ({ ...current, sections: [...current.sections, { id, title, guide }] }));
    onSelect(id);
    if (!title) setFocusId(id);
  };

  const move = (from: number, to: number) =>
    update((current) => {
      if (from === to || to < 0 || to >= current.sections.length) return current;
      const sections = [...current.sections];
      const [item] = sections.splice(from, 1);
      sections.splice(to, 0, item);
      return { ...current, sections };
    });

  const usedTitles = new Set(format.sections.map((section) => section.title.trim().toLowerCase()));
  const presets = SECTION_PRESETS.filter((preset) => !usedTitles.has(preset.title.toLowerCase()));
  const full = format.sections.length >= MAX_SECTIONS;

  return (
    <div className="fmt-tab-content">
      <p className="fmt-muted">
        섹션은 작성자가 채우는 칸이 됩니다. 안내 문구는 빈 칸 안에 보이고 AI 초안 작성에도 쓰입니다.
      </p>

      {format.layout.mode === "image_only" && (
        <div className="fmt-note">&quot;이미지만&quot; 레이아웃에서는 섹션이 보이지 않습니다. 섹션을 쓰려면 레이아웃을 바꾸세요.</div>
      )}

      <div className="fmt-section-cards">
        {format.sections.length === 0 && <div className="fmt-empty">아직 섹션이 없습니다. 아래에서 추가하세요.</div>}
        {format.sections.map((section, index) => (
          <div
            key={section.id}
            ref={(element) => {
              if (element) cardRefs.current.set(section.id, element);
              else cardRefs.current.delete(section.id);
            }}
            className={`fmt-section-card${selectedId === section.id ? " selected" : ""}${dropIndex === index ? " drop-target" : ""}`}
            onClick={() => onSelect(section.id)}
            draggable={canEdit}
            onDragStart={(event) => {
              dragIndex.current = index;
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              if (dragIndex.current == null) return;
              event.preventDefault();
              setDropIndex(index);
            }}
            onDragLeave={() => setDropIndex((current) => (current === index ? null : current))}
            onDrop={(event) => {
              event.preventDefault();
              if (dragIndex.current != null) move(dragIndex.current, index);
              dragIndex.current = null;
              setDropIndex(null);
            }}
            onDragEnd={() => {
              dragIndex.current = null;
              setDropIndex(null);
            }}
          >
            <span className="fmt-grip" title="끌어서 순서 변경" aria-hidden="true">
              ⋮⋮
            </span>
            <span className="fmt-section-number">{index + 1}</span>
            <div className="fmt-section-fields">
              <input
                className="fmt-section-title-input"
                value={section.title}
                maxLength={60}
                placeholder="섹션 제목"
                disabled={!canEdit}
                onFocus={() => onSelect(section.id)}
                onChange={(event) => patchSection(section.id, { title: event.target.value })}
              />
              <input
                className="fmt-section-guide-input"
                value={section.guide}
                maxLength={300}
                placeholder="빈 상자에 보여줄 안내 문구 (선택)"
                disabled={!canEdit}
                onFocus={() => onSelect(section.id)}
                onChange={(event) => patchSection(section.id, { guide: event.target.value })}
              />
            </div>
            {canEdit && (
              <div className="fmt-card-actions">
                <button type="button" className="fmt-icon-button" onClick={() => move(index, index - 1)} disabled={index === 0} title="위로" aria-label="위로">
                  ↑
                </button>
                <button
                  type="button"
                  className="fmt-icon-button"
                  onClick={() => move(index, index + 1)}
                  disabled={index === format.sections.length - 1}
                  title="아래로"
                  aria-label="아래로"
                >
                  ↓
                </button>
                <button
                  type="button"
                  className="fmt-delete-button"
                  onClick={(event) => {
                    event.stopPropagation();
                    onRemove(section.id);
                  }}
                  title="섹션 삭제 (저장해야 반영)"
                  aria-label="섹션 삭제"
                >
                  삭제
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {canEdit && (
        <>
          <button type="button" className="fmt-add-button" onClick={() => addSection()} disabled={full}>
            + 섹션 추가
          </button>
          {presets.length > 0 && !full && (
            <div className="fmt-presets">
              <span className="fmt-muted">빠른 추가:</span>
              {presets.map((preset) => (
                <button key={preset.title} type="button" className="fmt-chip" onClick={() => addSection(preset.title, preset.guide)}>
                  + {preset.title}
                </button>
              ))}
            </div>
          )}
          {full && <p className="fmt-muted">섹션은 최대 {MAX_SECTIONS}개까지 만들 수 있습니다.</p>}
        </>
      )}
    </div>
  );
}

function LayoutTab({ format, canEdit, update }: TabProps) {
  const showRatio = format.layout.mode === "image_top" || format.layout.mode === "text_top";
  const maxRatio = maxImageRatio(format);
  const effective = effectiveImageRatio(format);
  return (
    <div className="fmt-tab-content">
      <p className="fmt-muted">첨부 페이지(PDF 페이지나 이미지)와 작성 섹션을 어디에 둘지 정합니다.</p>
      <div className="fmt-layout-grid">
        {(Object.keys(LAYOUT_MODE_LABELS) as NoteLayoutMode[]).map((mode) => (
          <button
            key={mode}
            type="button"
            className={`fmt-layout-card${format.layout.mode === mode ? " active" : ""}`}
            disabled={!canEdit}
            aria-pressed={format.layout.mode === mode}
            onClick={() => update((current) => ({ ...current, layout: { ...current.layout, mode } }))}
          >
            <span className={`fmt-thumb fmt-thumb-${mode}`} aria-hidden="true">
              <i className="img" />
              <i className="txt" />
            </span>
            <strong>{LAYOUT_MODE_LABELS[mode]}</strong>
            <span className="fmt-muted">{LAYOUT_DESCRIPTIONS[mode]}</span>
          </button>
        ))}
      </div>
      {showRatio && (
        <div className="fmt-control">
          <div className="fmt-control-head">
            <strong>이미지 크기</strong>
            <span>본문 영역의 {Math.round(effective * 100)}%</span>
          </div>
          <input
            type="range"
            className="fmt-range"
            min={RATIO_MIN * 100}
            max={Math.round(maxRatio * 100)}
            step={2}
            disabled={!canEdit}
            value={Math.round(effective * 100)}
            onChange={(event) =>
              update((current) => ({ ...current, layout: { ...current.layout, imageRatio: Number(event.target.value) / 100 } }))
            }
          />
          <p className="fmt-muted">
            페이지 미리보기의 손잡이를 끌어도 됩니다.
            {maxRatio < 0.8 && ` 섹션 ${format.sections.length}개가 모두 들어가도록 최대 ${Math.round(maxRatio * 100)}%까지 가능합니다.`}
          </p>
        </div>
      )}
    </div>
  );
}

function Switch({ checked, disabled, onChange, label, description }: { checked: boolean; disabled: boolean; onChange: (value: boolean) => void; label: string; description: string }) {
  return (
    <label className={`fmt-switch-row${disabled ? " disabled" : ""}`}>
      <span>
        <strong>{label}</strong>
        <span className="fmt-muted">{description}</span>
      </span>
      <span className="fmt-switch">
        <input type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />
        <span aria-hidden="true" />
      </span>
    </label>
  );
}

function FrameTab({ format, canEdit, update, highlight }: TabProps & { highlight: string | null }) {
  const footerFields = [
    ["recordedLabel", "작성자"],
    ["witnessedLabel", "검토자"],
    ["signatureLabel", "서명"],
    ["dateLabel", "날짜"],
  ] as const;
  return (
    <div className="fmt-tab-content">
      <div className={`fmt-group${highlight === "header" ? " highlight" : ""}`}>
        <Switch
          label="머리글"
          description="모든 페이지 상단의 노트 제목 줄"
          checked={format.header.show}
          disabled={!canEdit}
          onChange={(show) => update((current) => ({ ...current, header: { ...current.header, show } }))}
        />
        {format.header.show && (
          <label className="fmt-field">
            <span>제목 라벨</span>
            <input
              value={format.header.titleLabel}
              maxLength={30}
              disabled={!canEdit}
              placeholder="예: 제목 :"
              onChange={(event) => update((current) => ({ ...current, header: { ...current.header, titleLabel: event.target.value } }))}
            />
          </label>
        )}
      </div>

      <div className={`fmt-group${highlight === "footer" ? " highlight" : ""}`}>
        <Switch
          label="서명란"
          description="하단의 작성자·검토자 이름, 서명, 날짜"
          checked={format.footer.show}
          disabled={!canEdit}
          onChange={(show) => update((current) => ({ ...current, footer: { ...current.footer, show } }))}
        />
        {format.footer.show && (
          <div className="fmt-field-grid">
            {footerFields.map(([key, label]) => (
              <label key={key} className="fmt-field">
                <span>{label} 라벨</span>
                <input
                  value={format.footer[key]}
                  maxLength={30}
                  disabled={!canEdit}
                  onChange={(event) => update((current) => ({ ...current, footer: { ...current.footer, [key]: event.target.value } }))}
                />
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Stepper({ value, min, max, disabled, onChange }: { value: number; min: number; max: number; disabled: boolean; onChange: (value: number) => void }) {
  return (
    <div className="fmt-stepper">
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={disabled || value <= min} aria-label="작게">
        −
      </button>
      <span>{value} pt</span>
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={disabled || value >= max} aria-label="크게">
        +
      </button>
    </div>
  );
}

function TextTab({ format, canEdit, update }: TabProps) {
  const { bodyFontSize, headingFontSize, headingBold } = format.typography;
  const setTypography = (patch: Partial<NoteFormat["typography"]>) =>
    update((current) => ({ ...current, typography: { ...current.typography, ...patch } }));
  return (
    <div className="fmt-tab-content">
      <p className="fmt-muted">새 노트의 기본 글자 크기입니다. 작성자는 상자별로 따로 바꿀 수 있습니다.</p>
      <div className="fmt-group">
        <div className="fmt-stepper-row">
          <strong>섹션 제목</strong>
          <Stepper value={headingFontSize} min={8} max={28} disabled={!canEdit} onChange={(value) => setTypography({ headingFontSize: value })} />
        </div>
        <div className="fmt-stepper-row">
          <strong>본문</strong>
          <Stepper value={bodyFontSize} min={8} max={24} disabled={!canEdit} onChange={(value) => setTypography({ bodyFontSize: value })} />
        </div>
        <Switch
          label="섹션 제목 굵게"
          description="섹션 제목을 본문보다 눈에 띄게 합니다"
          checked={headingBold}
          disabled={!canEdit}
          onChange={(value) => setTypography({ headingBold: value })}
        />
      </div>
      <div className="fmt-type-sample" aria-label="글자 스타일 예시">
        <span style={{ fontSize: headingFontSize, fontWeight: headingBold ? 700 : 400 }}>결과</span>
        <span style={{ fontSize: bodyFontSize }}>- 58°C에서 55°C 대비 밴드 강도가 증가함.</span>
      </div>
    </div>
  );
}
