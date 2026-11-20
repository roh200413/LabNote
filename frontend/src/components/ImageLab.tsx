import { useEffect, useRef, useState } from "react";

/**
 * Image processing (DP) workspace — layout only for now.
 * The tool list below is the planned feature set; each tool is wired in later
 * (operations run on the canvas and the result can be attached to a note).
 */

type Tool = { id: string; label: string; description: string; group: string };

const TOOLS: Tool[] = [
  { id: "crop", group: "기본 편집", label: "자르기·회전", description: "필요한 영역만 남기고 방향을 맞춥니다" },
  { id: "levels", group: "기본 편집", label: "밝기·대비", description: "어두운 겔·현미경 사진을 보기 좋게 조정합니다" },
  { id: "channels", group: "기본 편집", label: "색상 채널", description: "형광 이미지의 R/G/B 채널을 나눠 봅니다" },
  { id: "scale", group: "측정", label: "스케일바", description: "픽셀-길이 비율을 정하고 스케일바를 넣습니다" },
  { id: "measure", group: "측정", label: "길이·면적 측정", description: "선과 영역을 그려 실제 크기를 잽니다" },
  { id: "profile", group: "측정", label: "밴드·강도 분석", description: "겔 밴드나 선을 따라 강도를 그래프로 봅니다" },
  { id: "annotate", group: "기록", label: "주석", description: "화살표, 글자, 번호를 붙입니다" },
  { id: "compare", group: "기록", label: "나란히 비교", description: "조건별 이미지를 한 장에 배치합니다" },
  { id: "attach", group: "기록", label: "노트에 첨부", description: "처리한 이미지를 원본과 함께 연구노트에 넣습니다" },
];

export function ImageLab() {
  const [image, setImage] = useState<{ url: string; name: string; width: number; height: number } | null>(null);
  const [tool, setTool] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url);
  }, [image]);

  const open = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    const url = URL.createObjectURL(file);
    const probe = new Image();
    probe.onload = () => setImage({ url, name: file.name, width: probe.naturalWidth, height: probe.naturalHeight });
    probe.src = url;
  };

  const groups = [...new Set(TOOLS.map((item) => item.group))];
  const active = TOOLS.find((item) => item.id === tool);

  return (
    <div className="image-lab">
      <div className="image-lab-notice">
        <strong>이미지 처리(DP) — 준비 중</strong>
        <span>화면 구성만 먼저 만들었습니다. 이미지를 열어 볼 수는 있고, 오른쪽 도구는 차례로 추가됩니다.</span>
      </div>

      <div className="image-lab-body">
        <section className="image-lab-stage">
          <div className="image-lab-stage-head">
            <span>{image ? `${image.name} · ${image.width}×${image.height}px` : "이미지를 열어 주세요"}</span>
            <div>
              <button type="button" className="secondary-button compact-button" onClick={() => inputRef.current?.click()}>
                내 컴퓨터에서 열기
              </button>
              <button type="button" className="secondary-button compact-button" disabled title="준비 중">
                노트·데이터 보관함에서 열기
              </button>
            </div>
            <input ref={inputRef} type="file" accept="image/*" className="hidden-input" onChange={(event) => { open(event.target.files?.[0]); event.target.value = ""; }} />
          </div>
          <div
            className="image-lab-canvas"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              open(event.dataTransfer.files?.[0]);
            }}
          >
            {image ? <img src={image.url} alt={image.name} /> : <p>이미지를 끌어다 놓거나 '내 컴퓨터에서 열기'를 누르세요.</p>}
          </div>
        </section>

        <aside className="image-lab-tools" aria-label="이미지 처리 도구">
          {groups.map((group) => (
            <div key={group} className="image-lab-tool-group">
              <p>{group}</p>
              {TOOLS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`image-lab-tool${tool === item.id ? " active" : ""}`}
                  onClick={() => setTool(item.id)}
                >
                  <strong>{item.label}</strong>
                  <em>준비 중</em>
                </button>
              ))}
            </div>
          ))}
          {active && (
            <div className="image-lab-tool-detail">
              <strong>{active.label}</strong>
              <p>{active.description}</p>
              <p className="field-hint">이 도구는 아직 만들어지지 않았습니다.</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
