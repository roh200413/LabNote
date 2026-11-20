import { useState } from "react";

import { getBackendAssetUrl } from "../api/client";
import { generateNoteDraft, type NoteGenerationStatus } from "../api/documentEditor";
import type { NotePage } from "../api/file";

export type AiInsertMode = "sections" | "split" | "block" | "replace";

type Props = {
  noteId: string;
  status: NoteGenerationStatus | null;
  referencePages: NotePage[];
  defaultPageId: number | null;
  existingText: string;
  canReplace: boolean;
  hasContentImage: boolean;
  /** The company note format has body sections the draft can be filled into. */
  hasFormatSections: boolean;
  onInsert: (text: string, mode: AiInsertMode) => void;
  onClose: () => void;
};

export function AiDraftPanel({
  noteId,
  status,
  referencePages,
  defaultPageId,
  existingText,
  canReplace,
  hasContentImage,
  hasFormatSections,
  onInsert,
  onClose,
}: Props) {
  const maxPages = status?.max_pages ?? 4;
  const initialPage = referencePages.find((page) => page.id === defaultPageId) ?? referencePages[0];
  const [selectedPageIds, setSelectedPageIds] = useState<number[]>(initialPage ? [initialPage.id] : []);
  const [memo, setMemo] = useState("");
  const [language, setLanguage] = useState<"ko" | "en">("ko");
  const [includeExisting, setIncludeExisting] = useState(existingText.trim().length > 0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState("");
  const [model, setModel] = useState<string | null>(null);
  const [insertMode, setInsertMode] = useState<AiInsertMode>(
    hasFormatSections ? "sections" : hasContentImage ? "split" : "block"
  );

  const enabled = status?.enabled ?? false;
  const canGenerate = enabled && !isGenerating && (selectedPageIds.length > 0 || memo.trim().length > 0);

  const togglePage = (pageId: number) => {
    setSelectedPageIds((current) => {
      if (current.includes(pageId)) return current.filter((id) => id !== pageId);
      if (current.length >= maxPages) return current;
      return [...current, pageId];
    });
  };

  const generate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setError(null);
    try {
      const generated = await generateNoteDraft({
        noteId,
        pageIds: selectedPageIds,
        memo,
        language,
        existingText: includeExisting ? existingText : "",
      });
      setResult(generated.text);
      setModel(generated.model);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "노트 초안 생성에 실패했습니다");
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="card ai-draft-modal"
        role="dialog"
        aria-label="AI 노트 초안"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") onClose();
        }}
      >
        <div className="section-head">
          <div>
            <h3>AI 초안</h3>
            <span className="ai-hint">
              {enabled ? `${status?.provider ?? "LLM"} · ${status?.model ?? ""}` : "연결 안 됨"}
            </span>
          </div>
          <button type="button" className="secondary-button compact-button" onClick={onClose}>
            닫기
          </button>
        </div>

        {!enabled && (
          <div className="editor-error">
            {status == null
              ? "AI 상태를 확인할 수 없습니다."
              : "AI 생성이 설정되지 않았습니다. 기관 관리자에게 플랫폼 연동의 LLM 연결 설정을 요청하세요."}
          </div>
        )}

        <div className="ai-draft-section">
          <div className="ai-draft-label">
            <strong>참고 페이지</strong>
            <span className="ai-hint">
              {selectedPageIds.length} / {maxPages}개 선택
            </span>
          </div>
          {referencePages.length === 0 ? (
            <p className="ai-hint">업로드된 페이지가 없습니다. 메모만으로 초안을 작성합니다.</p>
          ) : (
            <div className="ai-page-grid">
              {referencePages.map((page) => {
                const selected = selectedPageIds.includes(page.id);
                const disabled = !selected && selectedPageIds.length >= maxPages;
                return (
                  <label
                    key={page.id}
                    className={`ai-page-option${selected ? " selected" : ""}${disabled ? " disabled" : ""}`}
                  >
                    <input type="checkbox" checked={selected} disabled={disabled} onChange={() => togglePage(page.id)} />
                    <img src={getBackendAssetUrl(`/storage/${page.image_storage_key}`)} alt={`${page.page_no}페이지`} />
                    <span>{page.page_type === "image" ? "이미지" : `${page.page_no}페이지`}</span>
                  </label>
                );
              })}
            </div>
          )}
        </div>

        <label className="ai-draft-section">
          <span className="ai-draft-label">
            <strong>메모</strong>
            <span className="ai-hint">수행한 작업, 주요 조건, 관찰 내용</span>
          </span>
          <textarea
            className="ai-memo"
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            placeholder="예: PCR 3회 반복, annealing 55°C → 58°C로 변경 후 밴드 선명해짐. 샘플 B는 재실험 필요."
            maxLength={8000}
          />
        </label>

        <div className="ai-draft-options">
          <label className="ai-inline-field">
            언어
            <select value={language} onChange={(event) => setLanguage(event.target.value as "ko" | "en")}>
              <option value="ko">한국어</option>
              <option value="en">영어</option>
            </select>
          </label>
          <label className="ai-checkbox">
            <input
              type="checkbox"
              checked={includeExisting}
              disabled={!existingText.trim()}
              onChange={(event) => setIncludeExisting(event.target.checked)}
            />
            기존 텍스트 블록을 참고 자료로 사용
          </label>
          <button type="button" className="compact-button" onClick={() => void generate()} disabled={!canGenerate}>
            {isGenerating ? "생성 중..." : result ? "다시 생성" : "초안 생성"}
          </button>
        </div>

        {isGenerating && <p className="ai-hint">페이지를 읽고 노트 초안을 쓰는 중입니다. 최대 1분 정도 걸릴 수 있습니다.</p>}
        {error && <div className="editor-error">{error}</div>}

        {result && (
          <div className="ai-draft-section">
            <div className="ai-draft-label">
              <strong>초안</strong>
              <span className="ai-hint">넣기 전에 검토하고 수정하세요{model ? ` · ${model}` : ""}</span>
            </div>
            <textarea className="ai-result" value={result} onChange={(event) => setResult(event.target.value)} />
            <p className="ai-hint">
              AI 초안은 틀릴 수 있습니다. 모든 수치와 사실을 원자료와 대조하세요. [확인 필요] 표시 항목은 직접 확인해서 채워 주세요.
            </p>
            <div className="ai-insert-modes">
              {hasFormatSections && (
                <label className="ai-checkbox">
                  <input
                    type="radio"
                    name="ai-insert-mode"
                    checked={insertMode === "sections"}
                    onChange={() => setInsertMode("sections")}
                  />
                  노트 포맷 섹션에 채우기
                </label>
              )}
              <label className="ai-checkbox">
                <input
                  type="radio"
                  name="ai-insert-mode"
                  checked={insertMode === "split"}
                  disabled={!hasContentImage}
                  onChange={() => setInsertMode("split")}
                />
                페이지 이미지를 위로 줄이고 글은 아래에
              </label>
              <label className="ai-checkbox">
                <input
                  type="radio"
                  name="ai-insert-mode"
                  checked={insertMode === "block"}
                  onChange={() => setInsertMode("block")}
                />
                새 텍스트 블록
              </label>
              <label className="ai-checkbox">
                <input
                  type="radio"
                  name="ai-insert-mode"
                  checked={insertMode === "replace"}
                  disabled={!canReplace}
                  onChange={() => setInsertMode("replace")}
                />
                선택한 텍스트 블록 교체
              </label>
            </div>
            <div className="ai-draft-actions">
              <button
                type="button"
                className="compact-button"
                onClick={() => onInsert(result, insertMode)}
                disabled={!result.trim() || (insertMode === "replace" && !canReplace)}
              >
                노트에 넣기
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
