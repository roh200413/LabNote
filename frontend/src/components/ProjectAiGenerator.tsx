import { FormEvent, useEffect, useRef, useState } from "react";

import {
  confirmAiPlan,
  createAiPlan,
  listAiPlans,
  replyToAiPlan,
  saveAiPlanItems,
  type AiPlan,
  type PlanItem,
} from "../api/aiPlans";
import { getBatch, getLlmConnection, type BatchJob } from "../api/llm";
import type { ResearchNote } from "../api/researchNote";

type Props = {
  projectId: string;
  companyId: number;
  notes: ResearchNote[];
  onOpenNote: (noteId: string) => void;
  onNotesChanged: () => void;
  /** Opens the older manual bulk generator (one row per note typed by hand). */
  onOpenManualBulk: () => void;
  /** Documents sent from 데이터 보관함; a new token switches to "새 문서로 만들기" with these files. */
  initialDocuments?: { files: File[]; token: number } | null;
};

const ACCEPT = ".pdf,.docx,.txt,.md";
const JOB_LABELS: Record<string, string> = {
  queued: "대기",
  running: "생성 중",
  succeeded: "완료",
  completed: "완료",
  failed: "실패",
  partial: "일부 완료",
  cancelled: "취소",
  interrupted: "중단됨",
};

export function ProjectAiGenerator({
  projectId,
  companyId,
  notes,
  onOpenNote,
  onNotesChanged,
  onOpenManualBulk,
  initialDocuments,
}: Props) {
  const [llm, setLlm] = useState<{ enabled: boolean; model: string } | null>(null);
  const [mode, setMode] = useState<"expand" | "document">("expand");
  const [noteIds, setNoteIds] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [requestedCount, setRequestedCount] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [instructions, setInstructions] = useState("");
  const [language, setLanguage] = useState("ko");

  const [plan, setPlan] = useState<AiPlan | null>(null);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [dirty, setDirty] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState<null | "plan" | "reply" | "save" | "confirm">(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<AiPlan[]>([]);
  const [job, setJob] = useState<BatchJob | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const notesChangedRef = useRef(onNotesChanged);
  notesChangedRef.current = onNotesChanged;

  useEffect(() => {
    getLlmConnection(companyId)
      .then((connection) => setLlm({ enabled: connection.enabled, model: connection.model }))
      .catch(() => setLlm({ enabled: false, model: "" }));
  }, [companyId]);

  const loadHistory = () =>
    listAiPlans(projectId)
      .then(setHistory)
      .catch(() => undefined);

  useEffect(() => {
    setPlan(null);
    setJob(null);
    setNoteIds([]);
    void loadHistory();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const openPlan = (next: AiPlan) => {
    setPlan(next);
    setItems(next.proposal.items ?? []);
    setDirty(false);
    setError(null);
    setJob(null);
  };

  useEffect(() => {
    if (!initialDocuments?.files.length) return;
    setPlan(null);
    setMode("document");
    setFiles(initialDocuments.files.slice(0, 10));
  }, [initialDocuments?.token]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [plan?.messages.length]);

  // Follow the generation job once the plan is confirmed.
  useEffect(() => {
    if (!plan?.job_id) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let lastSucceeded = -1;
    const poll = async () => {
      try {
        const next = await getBatch(plan.job_id!);
        if (!live) return;
        setJob(next);
        if (next.succeeded !== lastSucceeded) {
          if (lastSucceeded >= 0) notesChangedRef.current();
          lastSucceeded = next.succeeded;
        }
        if (["queued", "running"].includes(next.status)) timer = setTimeout(() => void poll(), 3000);
      } catch (err) {
        if (live) setError((err as Error).message);
      }
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [plan?.job_id]);

  const run = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    setBusy(kind);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onStart = (event: FormEvent) => {
    event.preventDefault();
    void run("plan", async () => {
      const created = await createAiPlan(projectId, {
        mode,
        noteIds,
        files,
        requestedCount,
        dateFrom,
        dateTo,
        instructions,
        language,
      });
      openPlan(created);
      void loadHistory();
    });
  };

  const persistItems = async () => {
    if (!plan || !dirty) return plan;
    const saved = await saveAiPlanItems(plan.id, items);
    setPlan(saved);
    setDirty(false);
    return saved;
  };

  const sendReply = (message: string) =>
    plan &&
    message.trim() &&
    run("reply", async () => {
      await persistItems();
      const next = await replyToAiPlan(plan.id, message.trim());
      openPlan(next);
      setReply("");
    });

  const onConfirm = () =>
    plan &&
    run("confirm", async () => {
      await persistItems();
      const result = await confirmAiPlan(plan.id);
      setPlan(result.plan);
      setJob(result.job);
      void loadHistory();
    });

  const updateItem = (index: number, patch: Partial<PlanItem>) => {
    setItems((current) => current.map((item, i) => (i === index ? { ...item, ...patch } : item)));
    setDirty(true);
  };

  const removeItem = (index: number) => {
    setItems((current) => current.filter((_, i) => i !== index));
    setDirty(true);
  };

  const addItem = () => {
    setItems((current) => [...current, { title: "", written_date: null, focus: "", source_hint: "" }]);
    setDirty(true);
  };

  const canStart =
    llm?.enabled && (mode === "expand" ? noteIds.length > 0 : files.length > 0) && busy === null;
  const notesWithTitle = notes;
  const latest = plan?.proposal;
  const drafting = plan?.status === "drafting";
  const validItems = items.length > 0 && items.every((item) => item.title.trim());

  if (!plan) {
    return (
      <div className="ai-gen">
        {llm && !llm.enabled && (
          <p className="ai-gen-warning">기관 관리자가 메인 화면의 플랫폼 연동에서 LLM 연결을 먼저 설정해야 합니다.</p>
        )}
        <form className="ai-gen-setup" onSubmit={onStart}>
          <div className="ai-gen-modes" role="radiogroup" aria-label="생성 방식">
            <button
              type="button"
              role="radio"
              aria-checked={mode === "expand"}
              className={mode === "expand" ? "active" : ""}
              onClick={() => setMode("expand")}
            >
              <strong>기존 노트 늘리기</strong>
              <span>이 프로젝트의 노트를 근거로, 실험·단계별로 더 잘게 나누고 자세히 쓴 노트를 여러 장 만듭니다.</span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === "document"}
              className={mode === "document" ? "active" : ""}
              onClick={() => setMode("document")}
            >
              <strong>새 문서로 만들기</strong>
              <span>보고서·프로토콜·논문 초안 같은 다른 문서를 올리면, 그 내용으로 새 연구노트를 만듭니다.</span>
            </button>
          </div>

          {mode === "expand" ? (
            <div className="ai-gen-block">
              <div className="ai-gen-block-head">
                <strong>근거로 쓸 노트</strong>
                <span>
                  {noteIds.length}개 선택
                  {notesWithTitle.length > 0 && (
                    <button
                      type="button"
                      className="link-button"
                      onClick={() =>
                        setNoteIds(noteIds.length === notesWithTitle.length ? [] : notesWithTitle.map((note) => note.id))
                      }
                    >
                      {noteIds.length === notesWithTitle.length ? "모두 해제" : "모두 선택"}
                    </button>
                  )}
                </span>
              </div>
              {notesWithTitle.length === 0 ? (
                <p className="field-hint">이 프로젝트에 노트가 없습니다. '새 문서로 만들기'를 쓰거나 노트를 먼저 만드세요.</p>
              ) : (
                <ul className="ai-gen-note-list">
                  {notesWithTitle.map((note) => (
                    <li key={note.id}>
                      <label>
                        <input
                          type="checkbox"
                          checked={noteIds.includes(note.id)}
                          onChange={(event) =>
                            setNoteIds((current) =>
                              event.target.checked ? [...current, note.id] : current.filter((id) => id !== note.id)
                            )
                          }
                        />
                        <span>{note.title}</span>
                        <em>{note.written_date ?? ""}</em>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <div className="ai-gen-block">
              <div className="ai-gen-block-head">
                <strong>근거 문서</strong>
                <span>PDF, Word(.docx), 텍스트(.txt/.md) · 파일당 20MB · 최대 10개</span>
              </div>
              <div
                className="ai-gen-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  setFiles((current) => [...current, ...Array.from(event.dataTransfer.files)].slice(0, 10));
                }}
                onClick={() => fileRef.current?.click()}
                role="button"
                tabIndex={0}
              >
                파일을 끌어다 놓거나 클릭해서 고르세요
              </div>
              <input
                ref={fileRef}
                className="hidden-input"
                type="file"
                multiple
                accept={ACCEPT}
                onChange={(event) => {
                  setFiles((current) => [...current, ...Array.from(event.target.files ?? [])].slice(0, 10));
                  event.target.value = "";
                }}
              />
              {files.length > 0 && (
                <ul className="ai-gen-files">
                  {files.map((file, index) => (
                    <li key={`${file.name}-${index}`}>
                      <span>{file.name}</span>
                      <em>{(file.size / 1024).toFixed(0)}KB</em>
                      <button type="button" className="link-button" onClick={() => setFiles((current) => current.filter((_, i) => i !== index))}>
                        빼기
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <p className="field-hint">한글(.hwp) 파일과 스캔한 PDF는 글자를 읽을 수 없습니다. PDF나 Word로 저장해서 올려 주세요.</p>
            </div>
          )}

          <div className="ai-gen-options">
            <label>
              희망 장수
              <input
                type="number"
                min={1}
                max={100}
                value={requestedCount}
                onChange={(event) => setRequestedCount(event.target.value)}
                placeholder="비우면 AI가 추천"
              />
            </label>
            <label>
              연구 기간 시작
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              연구 기간 끝
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <label>
              작성 언어
              <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                <option value="ko">한국어</option>
                <option value="en">영어</option>
              </select>
            </label>
          </div>
          <label className="ai-gen-instructions">
            추가 지시 (선택)
            <textarea
              rows={2}
              maxLength={2000}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
              placeholder="예: 실험 날짜별로 나눠 주세요 / 장비 설정을 자세히 적어 주세요"
            />
          </label>

          <div className="ai-gen-actions">
            <button type="submit" disabled={!canStart}>
              {busy === "plan" ? "AI가 자료를 읽고 장수를 정하는 중..." : "AI와 장수 정하기"}
            </button>
            <button type="button" className="secondary-button" onClick={onOpenManualBulk}>
              직접 입력해서 대량 생성
            </button>
          </div>
          <p className="field-hint">
            AI는 먼저 몇 장을 만들지와 각 장의 제목·범위를 제안합니다. 대화로 장수를 조정하고 목록을 고친 뒤 확정하면 생성이 시작됩니다.
            근거 자료에 없는 실험이나 수치는 만들지 않고 [확인 필요]로 표시합니다.
          </p>
          {error && <p className="error">오류: {error}</p>}
        </form>

        {history.length > 0 && (
          <section className="ai-gen-history">
            <h4>최근 AI 생성</h4>
            <ul>
              {history.map((item) => (
                <li key={item.id}>
                  <button type="button" onClick={() => openPlan(item)}>
                    <strong>{item.mode === "expand" ? "노트 늘리기" : "문서로 만들기"}</strong>
                    <span>
                      {item.source_label} · {item.proposal.items?.length ?? 0}장 ·{" "}
                      {item.status === "confirmed" ? "생성 시작됨" : "협의 중"} · {item.created_at?.slice(0, 16).replace("T", " ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="ai-gen">
      <div className="ai-gen-plan-head">
        <div>
          <strong>{plan.mode === "expand" ? "기존 노트 늘리기" : "새 문서로 만들기"}</strong>
          <span>
            근거: {plan.source_label}
            {plan.source_truncated ? " · 자료가 길어 앞부분 위주로 계획했습니다" : ""}
          </span>
        </div>
        <button type="button" className="secondary-button compact-button" onClick={() => { setPlan(null); void loadHistory(); }}>
          처음으로
        </button>
      </div>

      <div className="ai-gen-plan">
        <section className="ai-gen-chat" aria-label="장수 협의">
          <h4>장수 협의</h4>
          <div className="ai-gen-messages">
            {plan.messages.map((message, index) => (
              <div key={index} className={`ai-gen-bubble ${message.role}`}>
                {message.content || (message.role === "assistant" ? "목록을 제안했습니다." : "")}
              </div>
            ))}
            {busy === "reply" && <div className="ai-gen-bubble assistant pending">생각하는 중...</div>}
            <div ref={chatEndRef} />
          </div>
          {latest?.rationale && (
            <p className="ai-gen-rationale">
              <b>AI 추천 {latest.recommended_count}장</b> · {latest.rationale}
            </p>
          )}
          {drafting && (
            <>
              <div className="ai-gen-quick">
                {latest?.recommended_count && latest.recommended_count !== items.length && (
                  <button type="button" onClick={() => void sendReply(`추천대로 ${latest.recommended_count}장으로 해 주세요.`)} disabled={busy !== null}>
                    추천대로 {latest.recommended_count}장
                  </button>
                )}
                <button type="button" onClick={() => void sendReply(`${items.length + 5}장으로 늘려 주세요.`)} disabled={busy !== null}>
                  +5장
                </button>
                {items.length > 2 && (
                  <button
                    type="button"
                    onClick={() => void sendReply(`${Math.max(1, Math.ceil(items.length / 2))}장으로 줄여 주세요.`)}
                    disabled={busy !== null}
                  >
                    절반으로
                  </button>
                )}
              </div>
              <form
                className="ai-gen-reply"
                onSubmit={(event) => {
                  event.preventDefault();
                  void sendReply(reply);
                }}
              >
                <input
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="예: 12장으로 해줘 / 3번과 4번을 합쳐줘 / 날짜별로 나눠줘"
                  maxLength={2000}
                  disabled={busy !== null}
                />
                <button type="submit" disabled={busy !== null || !reply.trim()}>
                  보내기
                </button>
              </form>
            </>
          )}
        </section>

        <section className="ai-gen-items" aria-label="생성할 노트 목록">
          <div className="ai-gen-block-head">
            <strong>생성할 노트 {items.length}장</strong>
            {drafting && (
              <span>
                {dirty && <em className="ai-gen-dirty">수정됨</em>}
                <button type="button" className="link-button" onClick={addItem}>
                  + 직접 추가
                </button>
              </span>
            )}
          </div>
          <ol className="ai-gen-item-list">
            {items.map((item, index) => (
              <li key={index}>
                <div className="ai-gen-item-row">
                  <span className="ai-gen-item-no">{index + 1}</span>
                  <input
                    value={item.title}
                    onChange={(event) => updateItem(index, { title: event.target.value })}
                    placeholder="노트 제목"
                    disabled={!drafting}
                  />
                  <input
                    type="date"
                    value={item.written_date ?? ""}
                    onChange={(event) => updateItem(index, { written_date: event.target.value || null })}
                    disabled={!drafting}
                    title="비우면 연구 기간에 맞춰 자동으로 나눕니다"
                  />
                  {drafting && (
                    <button type="button" className="link-button danger-text" onClick={() => removeItem(index)} aria-label={`${index + 1}번 빼기`}>
                      빼기
                    </button>
                  )}
                </div>
                <textarea
                  rows={2}
                  value={item.focus}
                  onChange={(event) => updateItem(index, { focus: event.target.value })}
                  placeholder="이 노트가 다룰 범위"
                  disabled={!drafting}
                />
                {item.source_hint && <span className="ai-gen-hint">근거: {item.source_hint}</span>}
              </li>
            ))}
          </ol>
          {drafting ? (
            <div className="ai-gen-actions">
              <button type="button" onClick={() => void onConfirm()} disabled={busy !== null || !validItems}>
                {busy === "confirm" ? "시작하는 중..." : `${items.length}장 생성 확정`}
              </button>
              {dirty && (
                <button type="button" className="secondary-button" onClick={() => void run("save", async () => { await persistItems(); })} disabled={busy !== null}>
                  수정 저장
                </button>
              )}
            </div>
          ) : (
            <div className="ai-gen-job">
              {job ? (
                <>
                  <p>
                    {JOB_LABELS[job.status] ?? job.status} · 완료 {job.succeeded}/{job.total}
                    {job.failed ? ` · 실패 ${job.failed}` : ""}
                  </p>
                  <progress max={job.total} value={job.items.filter((item) => !["queued", "running"].includes(item.status)).length} />
                  <ul>
                    {job.items.map((item) => (
                      <li key={item.id}>
                        <span>
                          {item.title} · {JOB_LABELS[item.status] ?? item.status}
                          {item.error ? ` · ${item.error}` : ""}
                        </span>
                        {item.note_id && (
                          <button type="button" className="secondary-button compact-button" onClick={() => onOpenNote(item.note_id!)}>
                            초안 열기
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="field-hint">실패한 항목은 '직접 입력해서 대량 생성' 창의 작업 내역에서 재시도할 수 있습니다.</p>
                </>
              ) : (
                <p className="field-hint">생성 진행 상황을 불러오는 중...</p>
              )}
            </div>
          )}
          {error && <p className="error">오류: {error}</p>}
        </section>
      </div>
    </div>
  );
}
