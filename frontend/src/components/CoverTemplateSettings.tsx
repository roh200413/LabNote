import { useMemo, useState } from "react";

import coverLayoutData from "../../../shared/cover_layout.json";

/** Same shape as HomePage's CoverTemplate (kept structural so both stay in sync). */
export type CoverTemplateData = {
  organization: string;
  projectTitle: string;
  coverTitle: string;
  projectCode: string;
  principalInvestigator: string;
  projectPeriod: string;
  footerNote: string;
  overrideOrganization: boolean;
  overrideProjectTitle: boolean;
  overridePrincipalInvestigator: boolean;
  overrideProjectCode: boolean;
  overrideProjectPeriod: boolean;
  showOrganization: boolean;
  showProjectTitle: boolean;
  showCoverTitle: boolean;
  showCode: boolean;
  showPrincipalInvestigator: boolean;
  showProjectPeriod: boolean;
  showTopLabel: boolean;
  showFooter: boolean;
};

type ValueKey = "coverTitle" | "projectTitle" | "projectCode" | "principalInvestigator" | "organization" | "projectPeriod" | "footerNote";
type ShowKey = "showTopLabel" | "showProjectTitle" | "showCode" | "showPrincipalInvestigator" | "showOrganization" | "showProjectPeriod" | "showFooter";
type OverrideKey =
  | "overrideProjectTitle"
  | "overrideProjectCode"
  | "overridePrincipalInvestigator"
  | "overrideOrganization"
  | "overrideProjectPeriod";

type Field = {
  id: string;
  label: string;
  hint: string;
  value: ValueKey;
  show: ShowKey;
  /** Fields with a project value can use it or a typed value; the others are always typed. */
  override?: OverrideKey;
  rect: { x: number; y: number; w: number; h: number };
};

const L = coverLayoutData as {
  page_width: number;
  page_height: number;
  top_label: { top: number; height: number };
  title: { x: number; y: number; width: number; height: number };
  table: { x: number; y: number; label_width: number; value_width: number; row_height: number };
  footer: { x: number; y: number; width: number; height: number };
};

const tableRow = (index: number) => ({
  x: L.table.x,
  y: L.table.y + L.table.row_height * index,
  w: L.table.label_width + L.table.value_width,
  h: L.table.row_height,
});

// Order matches the canvas drawing in HomePage.generateCoverImageDataUrl.
const FIELDS: Field[] = [
  { id: "top", label: "상단 문구", hint: "제목 위의 작은 글자", value: "coverTitle", show: "showTopLabel", rect: { x: 180, y: L.top_label.top - 6, w: L.page_width - 360, h: L.top_label.height + 12 } },
  { id: "title", label: "큰 제목 (과제명)", hint: "표지 가운데 큰 글자", value: "projectTitle", show: "showProjectTitle", override: "overrideProjectTitle", rect: { x: L.title.x, y: L.title.y, w: L.title.width, h: L.title.height } },
  { id: "code", label: "과제번호", hint: "표 1행", value: "projectCode", show: "showCode", override: "overrideProjectCode", rect: tableRow(0) },
  { id: "pi", label: "연구책임자", hint: "표 2행", value: "principalInvestigator", show: "showPrincipalInvestigator", override: "overridePrincipalInvestigator", rect: tableRow(1) },
  { id: "org", label: "연구기관", hint: "표 3행", value: "organization", show: "showOrganization", override: "overrideOrganization", rect: tableRow(2) },
  { id: "period", label: "연구 기간", hint: "표 4행", value: "projectPeriod", show: "showProjectPeriod", override: "overrideProjectPeriod", rect: tableRow(3) },
  { id: "footer", label: "하단 문구", hint: "표지 맨 아래 작은 글자", value: "footerNote", show: "showFooter", rect: { x: L.footer.x, y: L.footer.y, w: L.footer.width, h: L.footer.height } },
];

const SCALE = 0.62;

type Props = {
  template: CoverTemplateData;
  saved: CoverTemplateData;
  /** Values taken from the project (name, code, owner, period, company). */
  defaults: CoverTemplateData;
  previewUrl: string | null;
  tocPreviewUrl: string | null;
  onChange: (next: CoverTemplateData) => void;
  onSave: () => Promise<void>;
};

export function CoverTemplateSettings({ template, saved, defaults, previewUrl, tocPreviewUrl, onChange, onSave }: Props) {
  const [tab, setTab] = useState<"cover" | "toc">("cover");
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const dirty = useMemo(() => JSON.stringify(template) !== JSON.stringify(saved), [template, saved]);
  const patch = (next: Partial<CoverTemplateData>) => {
    setMessage(null);
    onChange({ ...template, ...next });
  };

  const save = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await onSave();
      setMessage({ kind: "ok", text: "저장했습니다. 노트 묶음 PDF에 이 표지가 쓰입니다." });
    } catch (error) {
      setMessage({ kind: "error", text: error instanceof Error ? error.message : "저장에 실패했습니다" });
    } finally {
      setSaving(false);
    }
  };

  const resetToProject = () =>
    onChange({
      ...defaults,
      // Keep typed texts so switching a field back to "직접 입력" restores them.
      organization: template.organization,
      projectTitle: template.projectTitle,
      principalInvestigator: template.principalInvestigator,
      projectCode: template.projectCode,
      projectPeriod: template.projectPeriod,
    });

  const status = message ?? (dirty ? { kind: "dirty", text: "저장하지 않은 변경사항" } : { kind: "idle", text: "저장된 표지를 사용 중입니다" });

  const selectField = (id: string) => {
    setSelected(id);
    setTab("cover");
    window.setTimeout(() => document.getElementById(`cover-field-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }), 0);
  };

  return (
    <div className="fmt cover-fmt">
      <section className="card fmt-top">
        <div>
          <h3>표지 템플릿</h3>
          <p className="fmt-muted">노트 묶음 PDF 맨 앞에 들어가는 표지입니다. 표지의 원하는 부분을 클릭해 고치세요.</p>
        </div>
      </section>

      <div className="fmt-workspace">
        <section className="card fmt-stage">
          <div className="cover-stage" style={{ width: L.page_width * SCALE, height: L.page_height * SCALE }}>
            {previewUrl ? (
              <img src={previewUrl} alt="표지 미리보기" className="cover-stage-image" />
            ) : (
              <div className="cover-sheet-placeholder">표지 미리보기 준비 중...</div>
            )}
            {FIELDS.map((field) => (
              <button
                key={field.id}
                type="button"
                className={`cover-zone${selected === field.id ? " selected" : ""}${template[field.show] ? "" : " hidden-field"}`}
                style={{
                  left: field.rect.x * SCALE,
                  top: field.rect.y * SCALE,
                  width: field.rect.w * SCALE,
                  height: field.rect.h * SCALE,
                }}
                onClick={() => selectField(field.id)}
                title={`${field.label} 편집`}
              >
                <span className="cover-zone-label">
                  {field.label}
                  {template[field.show] ? "" : " (숨김)"}
                </span>
              </button>
            ))}
          </div>
          <p className="fmt-muted fmt-stage-tip">팁: 표지의 글자나 표 칸을 클릭하면 오른쪽에서 바로 고칠 수 있습니다.</p>
        </section>

        <section className="card fmt-panel">
          <div className="fmt-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={tab === "cover"} className={`fmt-tab${tab === "cover" ? " active" : ""}`} onClick={() => setTab("cover")}>
              표지 항목
            </button>
            <button type="button" role="tab" aria-selected={tab === "toc"} className={`fmt-tab${tab === "toc" ? " active" : ""}`} onClick={() => setTab("toc")}>
              목차 미리보기
            </button>
          </div>

          <div className="fmt-tab-body" role="tabpanel">
            {tab === "cover" ? (
              <div className="fmt-tab-content">
                <p className="fmt-muted">
                  항목마다 프로젝트 정보를 그대로 쓰거나 직접 입력할 수 있습니다. 눈 표시를 끄면 표지에서 숨깁니다.
                </p>
                <div className="cover-field-list">
                  {FIELDS.map((field) => {
                    const custom = field.override ? template[field.override] : true;
                    const shown = template[field.show];
                    return (
                      <div
                        key={field.id}
                        id={`cover-field-${field.id}`}
                        className={`cover-field-card${selected === field.id ? " selected" : ""}${shown ? "" : " muted"}`}
                        onClick={() => setSelected(field.id)}
                      >
                        <div className="cover-field-head">
                          <div>
                            <strong>{field.label}</strong>
                            <span>{field.hint}</span>
                          </div>
                          <label className="cover-show-toggle" title={shown ? "표지에서 숨기기" : "표지에 보이기"}>
                            <input type="checkbox" checked={shown} onChange={(event) => patch({ [field.show]: event.target.checked } as Partial<CoverTemplateData>)} />
                            {shown ? "표시" : "숨김"}
                          </label>
                        </div>
                        {field.override && (
                          <div className="segmented-control cover-source" role="radiogroup" aria-label={`${field.label} 값`}>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={!custom}
                              className={!custom ? "active" : ""}
                              onClick={() => patch({ [field.override!]: false } as Partial<CoverTemplateData>)}
                            >
                              프로젝트 값
                            </button>
                            <button
                              type="button"
                              role="radio"
                              aria-checked={custom}
                              className={custom ? "active" : ""}
                              onClick={() =>
                                patch({
                                  [field.override!]: true,
                                  // Start typing from the project value instead of an empty box.
                                  [field.value]: template[field.value] || defaults[field.value],
                                } as Partial<CoverTemplateData>)
                              }
                            >
                              직접 입력
                            </button>
                          </div>
                        )}
                        {custom ? (
                          <input
                            value={template[field.value]}
                            onChange={(event) => patch({ [field.value]: event.target.value } as Partial<CoverTemplateData>)}
                            onFocus={() => setSelected(field.id)}
                            maxLength={field.id === "footer" ? 120 : 80}
                            placeholder={defaults[field.value] || field.label}
                            disabled={!shown}
                          />
                        ) : (
                          <div className="cover-project-value">{defaults[field.value] || <em>프로젝트에 값이 없습니다</em>}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="fmt-tab-content">
                <p className="fmt-muted">목차는 묶음에 들어가는 노트 목록으로 자동으로 만들어집니다. 아래는 지금 노트로 만든 예시입니다.</p>
                <div className="cover-toc-preview">
                  {tocPreviewUrl ? <img src={tocPreviewUrl} alt="목차 미리보기" /> : <div className="cover-sheet-placeholder">목차 미리보기 준비 중...</div>}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <div className="fmt-savebar">
        <span className={`fmt-status ${status.kind}`}>{status.text}</span>
        <div className="fmt-savebar-actions">
          <button type="button" className="secondary-button compact-button" onClick={resetToProject} title="모든 항목을 프로젝트 값과 기본 표시로 되돌립니다. 저장해야 반영됩니다.">
            기본값 사용
          </button>
          <button type="button" className="secondary-button compact-button" onClick={() => onChange(saved)} disabled={!dirty}>
            되돌리기
          </button>
          <button type="button" className="compact-button" onClick={() => void save()} disabled={!dirty || saving}>
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
    </div>
  );
}
