import { useEffect, useState } from "react";
import { getLlmConnection, getLlmModels, saveLlmConnection, testLlmConnection,
  type ConnectionInput, type LlmConnection } from "../api/llm";

export function LlmConnectionSettings({ companyId, onSaved }: { companyId?: number; onSaved?: () => void }) {
  const [info, setInfo] = useState<LlmConnection | null>(null);
  const [form, setForm] = useState<ConnectionInput>({ provider: "cliproxy", base_url: "http://127.0.0.1:8317/v1",
    model: "", enabled: true, json_mode: false, timeout_seconds: 120 });
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let alive = true;
    getLlmConnection(companyId).then((value) => {
      if (!alive) return;
      setInfo(value);
      if (value.source === "database" || value.enabled) setForm(value);
    }).catch((e) => { if (alive) setError(e.message); });
    return () => { alive = false; };
  }, [companyId]);

  const update = (patch: Partial<ConnectionInput>) => { setForm((old) => ({ ...old, ...patch })); setNotice(""); };
  const run = async (action: "models" | "test" | "save") => {
    setBusy(action); setError(""); setNotice("");
    // Explicit field selection prevents secrets or metadata from being echoed back as form data.
    const input: ConnectionInput = { provider: form.provider, base_url: form.base_url, model: form.model,
      enabled: form.enabled, json_mode: form.json_mode, timeout_seconds: form.timeout_seconds,
      api_key: apiKey || undefined, clear_api_key: form.clear_api_key ?? false };
    try {
      if (action === "models") {
        const result = await getLlmModels(input, companyId);
        setModels(result.models);
        setNotice(`${result.models.length}개 모델을 불러왔습니다. 사용할 모델을 선택하세요.`);
      } else if (action === "test") {
        const result = await testLlmConnection(input, companyId);
        setNotice(`생성 테스트 성공 · ${result.model}\n${result.text}`);
      } else {
        const saved = await saveLlmConnection(input, companyId);
        setInfo(saved); setForm(saved); setApiKey("");
        setNotice("연결 설정을 저장했습니다. 단일 초안과 대량 생성에 적용됩니다.");
        onSaved?.();
      }
    } catch (e) { setError(e instanceof Error ? e.message : "연결 요청에 실패했습니다"); }
    finally { setBusy(""); }
  };

  return <section className="card llm-settings">
    <div className="section-head"><div><p className="eyebrow">플랫폼 연동</p><h3>LLM API 연결</h3></div>
      <span className="ai-hint">{info?.enabled ? `사용 설정됨 · ${info.model}` : "연결 설정 필요"}</span></div>
    <p className="context-copy">CliProxy 또는 OpenAI 호환 API를 기관 연구노트 작성에 사용합니다. API 주소는 LabNote 서버에서 접근할 수 있어야 합니다.</p>
    {info && !info.can_manage && <p className="ai-hint">기관 관리자만 연결을 변경할 수 있습니다.</p>}
    <fieldset className="llm-fields" disabled={!info?.can_manage || !!busy}>
      <label>연결 종류<select value={form.provider} onChange={(e) => {
        const provider = e.target.value as ConnectionInput["provider"];
        update({ provider, base_url: provider === "cliproxy" ? "http://127.0.0.1:8317/v1" : provider === "openai" ? "https://api.openai.com/v1" : form.base_url,
          json_mode: provider === "openai", model: "" });
        setApiKey(""); setModels([]);
      }}><option value="cliproxy">CliProxy</option><option value="openai">OpenAI</option><option value="compatible">OpenAI 호환 API</option></select></label>
      <label>API Base URL<input value={form.base_url} onChange={(e) => { update({ base_url: e.target.value }); setModels([]); }} placeholder="http://127.0.0.1:8317/v1" /></label>
      <label>API 키<input type="password" autoComplete="new-password" value={apiKey} onChange={(e) => { setApiKey(e.target.value); update({ clear_api_key: false }); }}
        placeholder={info?.has_api_key ? "키 저장됨 · 비워 두면 같은 주소의 키 유지" : "CliProxy에 설정한 클라이언트 API 키"} /></label>
      <label className="ai-checkbox"><input type="checkbox" checked={form.clear_api_key ?? false} onChange={(e) => { update({ clear_api_key: e.target.checked }); setApiKey(""); }} />저장된 API 키 제거</label>
      <label>모델 ID<input list="llm-models" value={form.model} onChange={(e) => update({ model: e.target.value })} placeholder="모델 목록에서 선택하거나 ID 직접 입력" />
        <datalist id="llm-models">{models.map((model) => <option key={model} value={model} />)}</datalist></label>
      <label>요청 제한 시간 (초)<input type="number" min={10} max={180} value={form.timeout_seconds} onChange={(e) => update({ timeout_seconds: Number(e.target.value) })} /></label>
      <label className="ai-checkbox"><input type="checkbox" checked={form.json_mode} onChange={(e) => update({ json_mode: e.target.checked })} />API JSON 모드 사용 (지원하는 모델만)</label>
      <label className="ai-checkbox"><input type="checkbox" checked={form.enabled} onChange={(e) => update({ enabled: e.target.checked })} />AI 생성 사용</label>
      <div className="llm-actions">
        <button className="secondary-button" type="button" onClick={() => void run("models")}>모델 목록 불러오기</button>
        <button className="secondary-button" type="button" disabled={!form.model} onClick={() => void run("test")}>생성 연결 테스트</button>
        <button type="button" disabled={form.enabled && !form.model.trim()} onClick={() => void run("save")}>연결 저장</button>
      </div>
    </fieldset>
    <p className="ai-hint">주소가 바뀌면 API 키를 다시 입력하세요. 연결 테스트는 짧은 생성 요청 1회를 사용합니다.</p>
    {busy && <p role="status">{busy === "models" ? "모델 목록을 확인하는 중..." : busy === "test" ? "모델 생성 응답을 확인하는 중..." : "저장 중..."}</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="llm-notice" role="status">{notice}</p>}
  </section>;
}
