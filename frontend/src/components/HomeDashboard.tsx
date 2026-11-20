import { useEffect, useMemo, useState } from "react";

import { getApprovalStats, type ApprovalStats } from "../api/homeStats";
import type { Project } from "../api/project";
import type { ResearchNote } from "../api/researchNote";

const WEEKS = 12;
type NotesStatus = "loading" | "ready" | "error";
const STATUS_LABELS: Record<string, string> = {
  draft: "초안",
  reopened: "재개됨",
  submitted: "제출됨",
  approved: "승인됨",
  rejected: "반려됨",
};

function noteDate(note: ResearchNote): string {
  return (note.written_date ?? note.created_at).slice(0, 10);
}

function monthKey(offset = 0): string {
  const date = new Date();
  date.setDate(1);
  date.setMonth(date.getMonth() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Monday 00:00 of the week containing `date`. */
function weekStart(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function relativeTime(iso: string): string {
  // The API sends UTC timestamps without a zone (SQLite); without "Z" they would be read as local time.
  const utc = /[zZ]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`;
  const minutes = Math.round((Date.now() - new Date(utc).getTime()) / 60000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}일 전` : iso.slice(0, 10);
}

// ─── Quick actions + "continue writing" ─────────────────────────────────

type QuickProps = {
  notes: ResearchNote[];
  notesStatus: NotesStatus;
  projects: Project[];
  myMemberIds: Set<number>;
  projectName: (projectId: string) => string;
  onOpenNote: (note: ResearchNote) => void;
  onNewNote: (project: Project) => Promise<void>;
  onAiNotes: (project: Project) => Promise<void>;
  onManageProjects: () => void;
};

export function HomeQuickStart({ notes, notesStatus, projects, myMemberIds, projectName, onOpenNote, onNewNote, onAiNotes, onManageProjects }: QuickProps) {
  const activeProjects = projects.filter((project) => project.status !== "completed");
  const choices = activeProjects.length > 0 ? activeProjects : projects;
  const [projectId, setProjectId] = useState("");
  const [opening, setOpening] = useState(false);
  const chosen = choices.find((project) => project.id === projectId) ?? choices[0];

  async function open(action: (project: Project) => Promise<void>) {
    if (!chosen || opening) return;
    setOpening(true);
    try {
      await action(chosen);
    } finally {
      setOpening(false);
    }
  }

  const recent = useMemo(() => {
    const mine = notes.filter((note) => myMemberIds.has(note.owner_member_id));
    return [...(mine.length > 0 ? mine : notes)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, 4);
  }, [notes, myMemberIds]);

  return (
    <section className="home-quick">
      <div className="card home-quick-actions">
        <div className="home-projects-head">
          <h3>바로 시작하기</h3>
          <button type="button" className="link-button" onClick={onManageProjects}>프로젝트 목록</button>
        </div>
        {choices.length === 0 ? (
          <p className="home-todo-empty">참여한 프로젝트가 생기면 여기서 바로 노트를 쓸 수 있습니다.</p>
        ) : (
          <>
            {choices.length > 1 && (
              <label className="home-quick-project">
                프로젝트
                <select value={chosen?.id ?? ""} disabled={opening} onChange={(event) => setProjectId(event.target.value)}>
                  {choices.map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="home-quick-buttons">
              <button type="button" className="home-quick-button primary" disabled={opening} onClick={() => void open(onNewNote)}>
                <span className="home-quick-icon" aria-hidden="true">＋</span>
                <span>
                  <strong>새 연구노트</strong>
                  <small>직접 쓰거나 PDF·이미지로 만들기</small>
                </span>
              </button>
              <button type="button" className="home-quick-button" disabled={opening} onClick={() => void open(onAiNotes)}>
                <span className="home-quick-icon" aria-hidden="true">✦</span>
                <span>
                  <strong>AI로 노트 만들기</strong>
                  <small>자료를 주면 초안을 여러 장 만들어 줍니다</small>
                </span>
              </button>
            </div>
            {choices.length === 1 && <p className="home-quick-hint">{chosen?.name} 프로젝트에 만듭니다.</p>}
          </>
        )}
      </div>

      <div className="card home-recent">
        <h3>이어서 작업하기</h3>
        {notesStatus !== "ready" || recent.length === 0 ? (
          <p className="home-todo-empty">
            {notesStatus === "loading" ? "노트를 불러오는 중입니다." : notesStatus === "error" ? "노트를 불러오지 못했습니다." : "최근 작업한 노트가 없습니다."}
          </p>
        ) : (
          <ul>
            {recent.map((note) => (
              <li key={note.id}>
                <button type="button" onClick={() => onOpenNote(note)}>
                  <span className={`home-recent-status status-${note.status}`}>{STATUS_LABELS[note.status] ?? note.status}</span>
                  <strong>{note.title}</strong>
                  <span className="home-recent-meta">
                    {projectName(note.project_id)} · {relativeTime(note.updated_at)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// ─── Stats: KPI tiles + 12-week activity ────────────────────────────────

type StatsProps = {
  notes: ResearchNote[];
  projects: Project[];
  projectsReady: boolean;
  notesStatus: NotesStatus;
  myMemberIds: Set<number>;
  /** Company owners see the whole organisation; researchers see their own notes. */
  organisationScope: boolean;
  onRetry: () => void;
};

export function HomeStats({ notes, projects, projectsReady, notesStatus, myMemberIds, organisationScope, onRetry }: StatsProps) {
  const [approval, setApproval] = useState<ApprovalStats | null>(null);
  const [approvalError, setApprovalError] = useState(false);
  const scope = organisationScope ? "all" : "mine";

  useEffect(() => {
    if (notesStatus !== "ready") return;
    let cancelled = false;
    setApprovalError(false);
    getApprovalStats(scope)
      .then((data) => !cancelled && setApproval(data))
      .catch(() => {
        if (!cancelled) {
          setApproval(null);
          setApprovalError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [scope, notes, notesStatus]);

  const scoped = organisationScope ? notes : notes.filter((note) => myMemberIds.has(note.owner_member_id));
  const thisMonth = scoped.filter((note) => noteDate(note).startsWith(monthKey())).length;
  const lastMonth = scoped.filter((note) => noteDate(note).startsWith(monthKey(-1))).length;
  const target = organisationScope
    ? projects.filter((project) => project.status !== "completed").reduce((sum, project) => sum + (project.monthly_note_target ?? 0), 0)
    : 0;
  const waiting = scoped.filter((note) => note.status === "submitted").length;
  const myReviews = notes.filter(
    (note) => note.status === "submitted" && note.reviewer_member_id != null && myMemberIds.has(note.reviewer_member_id)
  ).length;
  const approved = scoped.filter((note) => note.status === "approved").length;

  const weeks = useMemo(() => {
    const current = weekStart(new Date());
    const buckets = Array.from({ length: WEEKS }, (_, index) => {
      const start = new Date(current);
      start.setDate(start.getDate() - (WEEKS - 1 - index) * 7);
      return { start, count: 0 };
    });
    for (const note of scoped) {
      const [y, m, d] = noteDate(note).split("-").map(Number);
      const start = weekStart(new Date(y, m - 1, d)).getTime();
      const bucket = buckets.find((item) => item.start.getTime() === start);
      if (bucket) bucket.count += 1;
    }
    return buckets;
  }, [scoped]);
  const peak = Math.max(1, ...weeks.map((week) => week.count));
  const emptyWeeks = weeks.slice(0, -1).filter((week) => week.count === 0).length;

  const delta = thisMonth - lastMonth;
  const tiles = [
    {
      label: "이번 달 작성",
      value: `${thisMonth}`,
      unit: "건",
      sub: target > 0
        ? `목표 ${target}건의 ${Math.round((thisMonth / target) * 100)}%`
        : delta === 0
          ? "지난달과 같음"
          : `지난달보다 ${Math.abs(delta)}건 ${delta > 0 ? "많음" : "적음"}`,
      tone: target > 0 && thisMonth < target ? "warn" : "",
      progress: target > 0 ? Math.min(1, thisMonth / target) : null,
    },
    {
      label: "결재 대기",
      value: `${waiting}`,
      unit: "건",
      sub: myReviews > 0 ? `내가 결재할 노트 ${myReviews}건` : "내가 결재할 노트 없음",
      tone: myReviews > 0 ? "warn" : "",
      progress: null,
    },
    {
      label: "평균 결재 소요",
      value: approval?.average_days != null ? `${approval.average_days}` : "-",
      unit: approval?.average_days != null ? "일" : "",
      sub: approval ? `최근 ${approval.window_days}일 승인 ${approval.approved_count}건 기준` : approvalError ? "결재 통계 조회 실패" : "불러오는 중",
      tone: approval?.average_days != null && approval.average_days > 7 ? "warn" : "",
      progress: null,
    },
    {
      label: "승인된 노트",
      value: `${approved}`,
      unit: "건",
      sub: `전체 ${scoped.length}건 중`,
      tone: "",
      progress: scoped.length > 0 ? approved / scoped.length : null,
    },
  ];

  return (
    <section className="home-stats">
      <div className="home-stats-head">
        <h3>{organisationScope ? "기관 현황" : "내 기록 현황"}</h3>
        <span>{organisationScope ? "기관 전체 연구노트 기준" : "내가 작성한 연구노트 기준"}</span>
        {projectsReady && (
          <span className="home-project-count">진행 중인 프로젝트 {projects.filter((project) => project.status === "active").length}개 / 전체 {projects.length}개</span>
        )}
      </div>
      {notesStatus !== "ready" ? (
        <div className="card home-stats-status" role="status">
          <p>{notesStatus === "loading" ? "연구 현황을 불러오는 중입니다." : "연구 현황을 불러오지 못했습니다."}</p>
          {notesStatus === "error" && <button type="button" className="link-button" onClick={onRetry}>다시 불러오기</button>}
        </div>
      ) : <>
      <div className="home-kpis">
        {tiles.map((tile) => (
          <article key={tile.label} className={`card home-kpi${tile.tone ? ` ${tile.tone}` : ""}`}>
            <span className="home-kpi-label">{tile.label}</span>
            <strong className="home-kpi-value">
              {tile.value}
              {tile.unit && <small>{tile.unit}</small>}
            </strong>
            {tile.progress != null && (
              <span className="home-kpi-bar" aria-hidden="true">
                <span style={{ width: `${Math.round(tile.progress * 100)}%` }} />
              </span>
            )}
            <span className="home-kpi-sub">{tile.sub}</span>
          </article>
        ))}
      </div>

      <article className="card home-trend">
        <div className="home-trend-head">
          <h4>최근 {WEEKS}주 작성 추이</h4>
          <span>{emptyWeeks > 0 ? `기록이 없는 주 ${emptyWeeks}주` : "매주 기록이 있습니다"}</span>
        </div>
        <div className="home-trend-bars" role="img" aria-label={weeks.map((week) => `${week.start.getMonth() + 1}월 ${week.start.getDate()}일 주간 ${week.count}건`).join(", ")}>
          {weeks.map((week, index) => {
            const label = `${week.start.getMonth() + 1}/${week.start.getDate()}`;
            const isCurrent = index === weeks.length - 1;
            return (
              <div key={label} className={`home-trend-col${week.count === 0 ? " empty" : ""}${isCurrent ? " current" : ""}`} title={`${label} 주: ${week.count}건`}>
                <span className="home-trend-count">{week.count > 0 ? week.count : ""}</span>
                <span className="home-trend-bar" style={{ height: `${week.count === 0 ? 3 : Math.max(8, (week.count / peak) * 100)}%` }} />
                <span className="home-trend-label">{index % 2 === 1 || isCurrent ? label : ""}</span>
              </div>
            );
          })}
        </div>
      </article>
      </>}
    </section>
  );
}
