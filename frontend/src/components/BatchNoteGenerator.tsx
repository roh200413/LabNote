import { useEffect, useRef, useState } from "react";
import { cancelBatch, createBatch, getLlmConnection, listBatches, retryBatch,
  type BatchEntry, type BatchJob } from "../api/llm";
import { listNoteFiles, listNotePages, type NotePage } from "../api/file";
import { getBackendAssetUrl } from "../api/client";
import type { ResearchNote } from "../api/researchNote";
import { BATCH_CSV_TEMPLATE, parseBatchCsv } from "../lib/batchCsv";

type Entry = BatchEntry & { key: string };
const blankEntry = (): Entry => {
  const now = new Date();
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return { key: crypto.randomUUID(), title: "", written_date: date, memo: "", page_ids: [] };
};
const active = (job: BatchJob) => ["queued", "running"].includes(job.status);
const labels: Record<string, string> = { queued: "대기", running: "생성 중", succeeded: "완료", completed: "완료",
  failed: "실패", partial: "일부 완료", cancelled: "취소", interrupted: "서버 재시작으로 중단" };

export function BatchNoteGenerator({ projectId, companyId, userId, notes, onClose, onRefresh, onOpenNote }: {
  projectId: string; companyId: number; userId: number; notes: ResearchNote[];
  onClose: () => void; onRefresh: () => void; onOpenNote: (id: string) => void;
}) {
  const [entries, setEntries] = useState<Entry[]>([blankEntry()]);
  const [context, setContext] = useState("");
  const [language, setLanguage] = useState("ko");
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("");
  const [jobs, setJobs] = useState<BatchJob[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [pages, setPages] = useState<Record<string, NotePage[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [notice, setNotice] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const requestRef = useRef({ signature: "", id: "" });
  const previousProgress = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    getLlmConnection(companyId).then((c) => { if (live) { setEnabled(c.enabled); setModel(c.model); } })
      .catch((e) => { if (live) setError(e.message); });
    const poll = async () => {
      try {
        const values = await listBatches(projectId);
        if (!live) return;
        setJobs(values); setPollError("");
        const progress = values.map((j) => `${j.id}:${j.succeeded}`).join(",");
        if (previousProgress.current !== null && progress !== previousProgress.current) refreshRef.current();
        previousProgress.current = progress;
      } catch (e) { if (live) setPollError(e instanceof Error ? e.message : "진행 상태 조회 실패"); }
      if (live) timer = setTimeout(() => void poll(), 3000);
    };
    void poll();
    return () => { live = false; clearTimeout(timer); };
  }, [projectId, companyId]);

  const update = (key: string, patch: Partial<Entry>) => setEntries((old) => old.map((e) => e.key === key ? { ...e, ...patch } : e));
  const chooseSource = async (key: string, noteId: string) => {
    update(key, { source_note_id: noteId || undefined, page_ids: [] });
    if (!noteId || pages[noteId]) return;
    try {
      const files = await listNoteFiles(noteId);
      const loaded = (await Promise.all(files.map((f) => listNotePages(f.id)))).flat();
      setPages((old) => ({ ...old, [noteId]: loaded }));
    } catch (e) { setError(e instanceof Error ? e.message : "참고 페이지 조회 실패"); }
  };
  const importCsv = async (file?: File) => {
    if (!file) return;
    setError("");
    try {
      if (file.size > 2 * 1024 * 1024) throw new Error("CSV는 2MB 이하로 업로드하세요");
      const parsed = parseBatchCsv(await file.text());
      setEntries(parsed.map((e) => ({ ...e, key: crypto.randomUUID() })));
      setNotice(`${parsed.length}개 입력을 불러왔습니다. 내용을 검토한 뒤 생성을 시작하세요.`);
    } catch (e) { setError(e instanceof Error ? e.message : "CSV 읽기 실패"); }
  };
  const downloadTemplate = () => {
    const url = URL.createObjectURL(new Blob([BATCH_CSV_TEMPLATE], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "labnote-input-template.csv"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const start = async () => {
    setBusy(true); setError(""); setNotice("");
    const payload = { project_id: projectId, context, language,
      entries: entries.map(({ key: _key, ...entry }) => entry) };
    const signature = JSON.stringify(payload);
    if (requestRef.current.signature !== signature) requestRef.current = { signature, id: crypto.randomUUID() };
    try {
      const job = await createBatch({ ...payload, request_id: requestRef.current.id });
      setJobs((old) => [job, ...old.filter((j) => j.id !== job.id)]); setSelectedId(job.id);
      requestRef.current = { signature: "", id: "" };
      setEntries([blankEntry()]);
      setNotice("작업을 시작했습니다. 이 창을 닫아도 서버에서 계속 생성합니다.");
    } catch (e) { setError(e instanceof Error ? e.message : "생성 요청 실패"); }
    finally { setBusy(false); }
  };
  const control = async (job: BatchJob, action: "cancel" | "retry") => {
    setBusy(true); setError("");
    try {
      const updated = await (action === "cancel" ? cancelBatch(job.id) : retryBatch(job.id));
      setJobs((old) => old.map((j) => j.id === updated.id ? updated : j));
    } catch (e) { setError(e instanceof Error ? e.message : "작업 변경 실패"); }
    finally { setBusy(false); }
  };
  const selected = jobs.find((j) => j.id === selectedId) ?? jobs[0];
  const valid = entries.every((e) => e.title.trim() && e.written_date && (e.memo.trim() || e.source_note_id));

  return <div className="modal-backdrop"><section className="card batch-modal" role="dialog" aria-modal="true" aria-label="AI 연구노트 대량 생성">
    <div className="section-head"><div><p className="eyebrow">입력 자료 기반 작성</p><h3>AI 연구노트 대량 생성</h3></div>
      <button type="button" className="secondary-button" onClick={onClose}>닫기</button></div>
    <p className="context-copy">노트별 제목, 작성일과 작업 메모 또는 참고 노트를 입력하세요. 한 번에 최대 100개를 초안으로 저장합니다.</p>
    <p className="ai-hint">{enabled ? `연결 모델 · ${model}` : "기관 관리자가 플랫폼 연동에서 LLM 연결을 먼저 설정해야 합니다."}</p>
    <fieldset className="llm-fields" disabled={busy}>
      <div className="llm-actions">
        <button type="button" className="secondary-button" onClick={downloadTemplate}>CSV 양식 다운로드</button>
        <button type="button" className="secondary-button" onClick={() => fileRef.current?.click()}>CSV로 입력 교체</button>
        <input className="hidden-input" ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => { void importCsv(e.target.files?.[0]); e.target.value = ""; }} />
        <label>작성 언어<select value={language} onChange={(e) => setLanguage(e.target.value)}><option value="ko">한국어</option><option value="en">영어</option></select></label>
      </div>
      <label>공통 연구 배경 (선택)<textarea rows={2} maxLength={20000} value={context} onChange={(e) => setContext(e.target.value)} placeholder="연구 목표, 사용 장비, 용어 등 모든 노트가 참고할 배경" /></label>
      <div className="batch-entries">{entries.map((entry, index) => <article className="batch-entry" key={entry.key}>
        <div className="section-head"><strong>입력 {index + 1}</strong><button type="button" className="secondary-button compact-button" disabled={entries.length === 1} onClick={() => setEntries((old) => old.filter((e) => e.key !== entry.key))}>삭제</button></div>
        <div className="batch-entry-meta"><label>제목<input value={entry.title} maxLength={255} onChange={(e) => update(entry.key, { title: e.target.value })} /></label>
          <label>작성일<input type="date" value={entry.written_date} onChange={(e) => update(entry.key, { written_date: e.target.value })} /></label></div>
        <label>작업 메모<textarea rows={3} maxLength={20000} value={entry.memo} onChange={(e) => update(entry.key, { memo: e.target.value })} placeholder="실제 수행한 절차, 조건, 측정값, 관찰 내용 등을 입력하세요." /></label>
        <label>기존 참고 노트 (선택)<select value={entry.source_note_id ?? ""} onChange={(e) => void chooseSource(entry.key, e.target.value)}>
          <option value="">선택 안 함</option>{notes.map((note) => <option key={note.id} value={note.id}>{note.title}</option>)}</select></label>
        {entry.source_note_id && (pages[entry.source_note_id]?.length ?? 0) > 0 && <div>
          <p className="ai-hint">참고 이미지 선택 · 최대 4페이지 · 이미지 입력을 지원하는 모델이 필요합니다.</p>
          <div className="ai-page-grid">{pages[entry.source_note_id].map((page) => <label className="ai-page-option" key={page.id}>
            <input type="checkbox" checked={entry.page_ids?.includes(page.id) ?? false}
              disabled={!entry.page_ids?.includes(page.id) && (entry.page_ids?.length ?? 0) >= 4}
              onChange={(e) => update(entry.key, { page_ids: e.target.checked ? [...(entry.page_ids ?? []), page.id] : entry.page_ids?.filter((id) => id !== page.id) })} />
            <img src={getBackendAssetUrl(`/storage/${page.thumbnail_storage_key ?? page.image_storage_key}`)} alt={`참고 ${page.page_no}페이지`} /><span>{page.page_no}페이지</span>
          </label>)}</div></div>}
      </article>)}</div>
      <div className="llm-actions"><button className="secondary-button" type="button" disabled={entries.length >= 100} onClick={() => setEntries((old) => [...old, blankEntry()])}>입력 추가</button>
        <button type="button" disabled={!enabled || !valid} onClick={() => void start()}>{busy ? "요청 중..." : `${entries.length}개 연구노트 생성`}</button></div>
    </fieldset>
    <p className="ai-hint">입력에 없는 수치나 결과는 [확인 필요]로 표시합니다. 생성된 초안을 검토한 뒤 기존 승인 절차로 제출하세요.</p>
    {error && <p className="error" role="alert">{error}</p>}{notice && <p className="llm-notice" role="status">{notice}</p>}
    <hr />
    <div className="section-head"><h4>생성 작업 내역</h4>{jobs.length > 0 && <select aria-label="생성 작업 선택" value={selected?.id ?? ""} onChange={(e) => setSelectedId(e.target.value)}>
      {jobs.map((job) => <option value={job.id} key={job.id}>{new Date(job.created_at).toLocaleString()} · {job.total}개 · {labels[job.status]}</option>)}</select>}</div>
    {pollError && <p className="error" role="alert">{pollError} · 상태 조회를 다시 시도 중입니다.</p>}
    {!selected ? <p className="ai-hint">아직 생성 작업이 없습니다.</p> : <div aria-live="polite">
      <p>{labels[selected.status]} · 완료 {selected.succeeded}/{selected.total} · 실패 {selected.failed}
        {selected.cancel_requested && active(selected) ? " · 취소 요청됨 (진행 중인 응답을 기다리는 중)" : ""}</p>
      <progress className="batch-progress" max={selected.total} value={selected.items.filter((i) => !["queued", "running"].includes(i.status)).length} />
      {selected.created_by === userId && <div className="llm-actions">
        {active(selected) ? <button className="secondary-button" type="button" disabled={busy || selected.cancel_requested} onClick={() => void control(selected, "cancel")}>남은 작업 취소</button>
          : selected.items.some((i) => ["failed", "cancelled"].includes(i.status)) && <button className="secondary-button" type="button" disabled={busy} onClick={() => void control(selected, "retry")}>실패·취소 항목만 재시도</button>}
      </div>}
      <div className="batch-results">{selected.items.map((item) => <div className="batch-result" key={item.id}>
        <div><strong>{item.title}</strong><span className="ai-hint">{labels[item.status]}{item.model ? ` · ${item.model}` : ""}{item.attempts > 0 ? ` · ${item.attempts}회 시도` : ""}</span>
          {item.error && <span className="error">{item.error}</span>}</div>
        {item.note_id && <button type="button" className="secondary-button compact-button" onClick={() => onOpenNote(item.note_id!)}>초안 열기</button>}
      </div>)}</div>
    </div>}
  </section></div>;
}
