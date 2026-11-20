import { useEffect, useMemo, useRef, useState } from "react";

import {
  NOTE_CREATION_MODE_LABELS,
  createNoteFromCommit,
  getProjectGitHub,
  installProjectWebhook,
  linkProjectRepository,
  listProjectGitHubEvents,
  listProjectGitHubRepositories,
  listRecentCommits,
  revealProjectWebhookSecret,
  unlinkProjectRepository,
  updateProjectRepositoryLink,
  type GitHubRecentCommits,
  type GitHubRepoOption,
  type ProjectGitHubEvent,
  type ProjectGitHubLink,
  type ProjectGitHubState,
} from "../api/githubAccount";
import { generateResearchNoteFromGitHubEvent } from "../api/githubIntegration";
import { createNoteBundle, listNoteBundles, type NoteBundle } from "../api/noteBundle";

type MemberOption = { id: number; name: string };

type Props = {
  projectId: string;
  members: MemberOption[];
  defaultAuthorId?: number | null;
  defaultReviewerId?: number | null;
  /** Goes to the main GitHub page (account connection). */
  onOpenAccountSettings: () => void;
  onOpenNote: (noteId: string) => void;
  /** Called after a note was generated so the note list can refresh. */
  onNotesChanged: () => void;
};

const EVENT_LABELS: Record<string, string> = { push: "푸시", pull_request: "풀 리퀘스트", ping: "연결 확인" };
const EVENT_STATUS_LABELS: Record<string, string> = {
  received: "수신됨",
  pending: "대기",
  processing: "AI 작성 중",
  processed: "처리됨",
  ignored: "무시됨",
  failed: "실패",
  unmapped: "매핑 없음",
};

type Draft = {
  repo: GitHubRepoOption;
  branchPattern: string;
  mode: string;
  authorId: number | "";
  reviewerId: number | "";
  /** "" (no bundle), a bundle id, or NEW_GITHUB_BUNDLE. */
  bundle: string;
};

const NEW_GITHUB_BUNDLE = "__new_github";
const GITHUB_BUNDLE_NAME = "GitHub";

export function ProjectGitHubPanel({
  projectId,
  members,
  defaultAuthorId,
  defaultReviewerId,
  onOpenAccountSettings,
  onOpenNote,
  onNotesChanged,
}: Props) {
  const [state, setState] = useState<ProjectGitHubState | null>(null);
  const [events, setEvents] = useState<ProjectGitHubEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [repoQuery, setRepoQuery] = useState("");
  const [repos, setRepos] = useState<GitHubRepoOption[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [secrets, setSecrets] = useState<Record<number, string>>({});
  const [manualOpen, setManualOpen] = useState<Record<number, boolean>>({});
  const [commitsOpen, setCommitsOpen] = useState<number | null>(null);
  const [commits, setCommits] = useState<GitHubRecentCommits | null>(null);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [bundles, setBundles] = useState<NoteBundle[]>([]);
  const repoSeq = useRef(0);

  const load = async () => {
    try {
      const [nextState, nextEvents, nextBundles] = await Promise.all([
        getProjectGitHub(projectId),
        listProjectGitHubEvents(projectId),
        listNoteBundles(projectId).catch(() => [] as NoteBundle[]),
      ]);
      setState(nextState);
      setEvents(nextEvents);
      setBundles(nextBundles);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    setState(null);
    setEvents([]);
    setPickerOpen(false);
    setDraft(null);
    setCommitsOpen(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  // A webhook note is written by the AI in the background; refresh until it is done.
  const hasProcessing = events.some((event) => event.status === "processing");
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => {
      void load().then(onNotesChanged);
    }, 5000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasProcessing, projectId]);

  useEffect(() => {
    if (!pickerOpen) return;
    const seq = ++repoSeq.current;
    setReposLoading(true);
    const timer = window.setTimeout(() => {
      listProjectGitHubRepositories(projectId, repoQuery)
        .then((items) => {
          if (seq === repoSeq.current) setRepos(items);
        })
        .catch((err: Error) => {
          if (seq === repoSeq.current) setError(err.message);
        })
        .finally(() => {
          if (seq === repoSeq.current) setReposLoading(false);
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [pickerOpen, repoQuery, projectId]);

  const memberName = useMemo(() => new Map(members.map((member) => [member.id, member.name])), [members]);
  const linkById = useMemo(() => new Map((state?.links ?? []).map((link) => [link.mapping_id, link])), [state]);
  const canManage = Boolean(state?.can_manage);
  const accountConnected = Boolean(state?.account.connected);

  const run = async (key: string, action: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const githubBundle = bundles.find((bundle) => bundle.name.toLowerCase() === GITHUB_BUNDLE_NAME.toLowerCase());
  const bundleName = useMemo(() => new Map(bundles.map((bundle) => [bundle.id, bundle.name])), [bundles]);

  /** The bundle id to store for a choice, creating the shared "GitHub" bundle on first use. */
  const resolveBundle = async (choice: string): Promise<string | null> => {
    if (choice !== NEW_GITHUB_BUNDLE) return choice || null;
    if (githubBundle) return githubBundle.id;
    const created = await createNoteBundle(projectId, GITHUB_BUNDLE_NAME, "GitHub 커밋·PR로 만든 연구노트");
    onNotesChanged();
    return created.id;
  };

  const chooseRepo = (repo: GitHubRepoOption) =>
    setDraft({
      repo,
      branchPattern: repo.default_branch || "main",
      mode: "pr_merge",
      authorId: defaultAuthorId ?? "",
      reviewerId: defaultReviewerId ?? "",
      bundle: githubBundle?.id ?? NEW_GITHUB_BUNDLE,
    });

  const bundleOptions = (current: string) => (
    <>
      <option value="">묶지 않음 (일반 노트)</option>
      {!githubBundle && <option value={NEW_GITHUB_BUNDLE}>새 &apos;{GITHUB_BUNDLE_NAME}&apos; 묶음 만들기</option>}
      {bundles.map((bundle) => (
        <option key={bundle.id} value={bundle.id}>
          {bundle.name}
        </option>
      ))}
      {current && current !== NEW_GITHUB_BUNDLE && !bundleName.has(current) && <option value={current}>(삭제된 묶음)</option>}
    </>
  );

  const onLink = () =>
    draft &&
    run("link", async () => {
      const result = await linkProjectRepository(projectId, {
        repo_owner: draft.repo.owner,
        repo_name: draft.repo.name,
        repository_url: draft.repo.html_url,
        default_branch: draft.repo.default_branch,
        branch_pattern: draft.branchPattern,
        note_creation_mode: draft.mode,
        default_author_member_id: draft.authorId === "" ? null : draft.authorId,
        default_reviewer_member_id: draft.reviewerId === "" ? null : draft.reviewerId,
        bundle_id: await resolveBundle(draft.bundle),
        install_webhook: true,
      });
      setDraft(null);
      setPickerOpen(false);
      setRepoQuery("");
      await load();
      if (result.webhook.mode === "app") {
        setNotice(`${draft.repo.full_name} 저장소를 연결했습니다. 커밋·PR 소식은 GitHub App이 자동으로 보내 줍니다.`);
      } else if (result.webhook.installed) {
        setNotice(`${draft.repo.full_name} 저장소를 연결하고 웹훅을 설치했습니다.`);
      } else {
        setManualOpen((current) => ({ ...current, [result.mapping_id]: true }));
        setNotice(
          `${draft.repo.full_name} 저장소를 연결했습니다. 웹훅은 자동 설치하지 못했습니다(${result.webhook.error ?? "권한 부족"}). 아래 수동 설정을 따라 주세요.`
        );
      }
    });

  const onUpdate = (link: ProjectGitHubLink, patch: Parameters<typeof updateProjectRepositoryLink>[2]) =>
    run(`update-${link.mapping_id}`, async () => {
      await updateProjectRepositoryLink(projectId, link.mapping_id, patch);
      await load();
    });

  const onUnlink = (link: ProjectGitHubLink) => {
    if (!window.confirm(`${link.repo_full_name} 연결을 해제할까요? 이미 만든 연구노트는 그대로 남습니다.`)) return;
    void run(`unlink-${link.mapping_id}`, async () => {
      await unlinkProjectRepository(projectId, link.mapping_id);
      setNotice(`${link.repo_full_name} 연결을 해제했습니다. GitHub 저장소의 웹훅은 GitHub에서 직접 지워 주세요.`);
      await load();
    });
  };

  const onInstallWebhook = (link: ProjectGitHubLink) =>
    run(`hook-${link.mapping_id}`, async () => {
      await installProjectWebhook(projectId, link.mapping_id);
      setNotice(`${link.repo_full_name}에 웹훅을 설치했습니다.`);
    });

  const onRevealSecret = (link: ProjectGitHubLink) =>
    run(`secret-${link.mapping_id}`, async () => {
      const result = await revealProjectWebhookSecret(projectId, link.mapping_id);
      setSecrets((current) => ({ ...current, [link.mapping_id]: result.webhook_secret }));
    });

  const loadCommits = async (mappingId: number) => {
    setCommitsLoading(true);
    try {
      setCommits(await listRecentCommits(projectId, mappingId));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCommitsLoading(false);
    }
  };

  const toggleCommits = (link: ProjectGitHubLink) => {
    if (commitsOpen === link.mapping_id) {
      setCommitsOpen(null);
      return;
    }
    setCommitsOpen(link.mapping_id);
    setCommits(null);
    setError(null);
    void loadCommits(link.mapping_id);
  };

  const onCommitNote = (link: ProjectGitHubLink, sha: string) =>
    run(`commit-${sha}`, async () => {
      const result = await createNoteFromCommit(projectId, link.mapping_id, sha);
      await Promise.all([load(), loadCommits(link.mapping_id)]);
      onNotesChanged();
      setNotice(result.created ? "커밋 변경 내용을 설명한 연구노트를 만들었습니다." : "이미 만든 노트가 있습니다.");
    });

  const onGenerate = (event: ProjectGitHubEvent) =>
    run(`event-${event.id}`, async () => {
      await generateResearchNoteFromGitHubEvent(event.id);
      await load();
      onNotesChanged();
      setNotice("이벤트로 연구노트를 만들었습니다.");
    });

  if (!state) {
    return (
      <div className="project-github">
        {error ? <p className="error">오류: {error}</p> : <p className="context-copy">불러오는 중...</p>}
      </div>
    );
  }

  return (
    <div className="project-github">
      <div className="project-github-account">
        {accountConnected ? (
          <span>
            <span className="github-status-pill connected">연결됨</span> 기관 GitHub 계정 <b>@{state.account.login}</b>
          </span>
        ) : (
          <span>
            <span className="github-status-pill">연결 안 됨</span> 기관 GitHub 계정이 없어 저장소를 고를 수 없습니다.
          </span>
        )}
        <button type="button" className="secondary-button compact-button" onClick={onOpenAccountSettings}>
          {accountConnected ? "계정 설정" : "메인에서 계정 연결하기"}
        </button>
      </div>

      {error && <p className="error">오류: {error}</p>}
      {notice && <p className="success-copy">{notice}</p>}

      <section className="project-github-section">
        <div className="section-head">
          <h3>연결된 저장소</h3>
          {canManage && accountConnected && !pickerOpen && (
            <button type="button" className="compact-button" onClick={() => setPickerOpen(true)}>
              + 저장소 연결
            </button>
          )}
        </div>

        {pickerOpen && (
          <div className="github-picker">
            {!draft ? (
              <>
                <div className="github-picker-head">
                  <input
                    type="search"
                    autoFocus
                    value={repoQuery}
                    onChange={(event) => setRepoQuery(event.target.value)}
                    placeholder="저장소 이름으로 찾기"
                  />
                  <button type="button" className="secondary-button compact-button" onClick={() => setPickerOpen(false)}>
                    닫기
                  </button>
                </div>
                {reposLoading && !repos && <p className="context-copy">GitHub에서 저장소를 불러오는 중...</p>}
                {repos && repos.length === 0 && <p className="context-copy">찾는 저장소가 없습니다.</p>}
                <ul className="github-repo-options">
                  {(repos ?? []).map((repo) => (
                    <li key={repo.full_name}>
                      <button type="button" disabled={repo.linked} onClick={() => chooseRepo(repo)}>
                        <span className="github-repo-name">
                          <strong>{repo.full_name}</strong>
                          {repo.private && <em>비공개</em>}
                          {repo.linked && <em className="linked">연결됨</em>}
                          {!repo.can_admin && !repo.linked && <em title="웹훅을 자동 설치하려면 저장소 관리자 권한이 필요합니다">관리 권한 없음</em>}
                        </span>
                        {repo.description && <span className="github-repo-desc">{repo.description}</span>}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <div className="github-link-form">
                <p>
                  <strong>{draft.repo.full_name}</strong> 저장소를 이 프로젝트에 연결합니다.
                </p>
                <div className="github-link-grid">
                  <label>
                    대상 브랜치
                    <input
                      value={draft.branchPattern}
                      onChange={(event) => setDraft({ ...draft, branchPattern: event.target.value })}
                      placeholder="main, release/*, * (전체)"
                    />
                  </label>
                  <label>
                    노트 생성 방식
                    <select value={draft.mode} onChange={(event) => setDraft({ ...draft, mode: event.target.value })}>
                      {Object.entries(NOTE_CREATION_MODE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    기본 작성자
                    <select
                      value={draft.authorId}
                      onChange={(event) => setDraft({ ...draft, authorId: event.target.value ? Number(event.target.value) : "" })}
                    >
                      <option value="">지정 안 함</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    기본 검토자
                    <select
                      value={draft.reviewerId}
                      onChange={(event) => setDraft({ ...draft, reviewerId: event.target.value ? Number(event.target.value) : "" })}
                    >
                      <option value="">지정 안 함</option>
                      {members.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    노트 묶음 <span className="field-optional">선택</span>
                    <select value={draft.bundle} onChange={(event) => setDraft({ ...draft, bundle: event.target.value })}>
                      {bundleOptions(draft.bundle)}
                    </select>
                  </label>
                </div>
                <p className="field-hint">
                  묶음을 고르면 이 저장소로 만든 연구노트가 연구노트 목록의 그 묶음에 모입니다. 묶지 않으면 일반 노트와 함께 쌓입니다.
                </p>
                <div className="github-link-actions">
                  <button type="button" className="compact-button" onClick={() => void onLink()} disabled={busy === "link"}>
                    {busy === "link" ? "연결 중..." : "연결하고 웹훅 설치"}
                  </button>
                  <button type="button" className="secondary-button compact-button" onClick={() => setDraft(null)}>
                    다른 저장소 고르기
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {state.links.length === 0 ? (
          <div className="github-empty">
            {accountConnected
              ? canManage
                ? "아직 연결한 저장소가 없습니다. '+ 저장소 연결'로 GitHub 저장소를 고르세요."
                : "아직 연결한 저장소가 없습니다. 프로젝트 책임자가 연결할 수 있습니다."
              : "메인 화면의 GitHub 연동에서 기관 계정을 먼저 연결하세요."}
          </div>
        ) : (
          <ul className="github-link-list">
            {state.links.map((link) => (
              <li key={link.mapping_id} className={link.is_active ? "" : "inactive"}>
                <div className="github-link-top">
                  <div>
                    <a href={link.repository_url ?? "#"} target="_blank" rel="noreferrer" className="github-link-name">
                      {link.repo_full_name}
                    </a>
                    <span className="github-link-meta">
                      브랜치 <code>{link.branch_pattern || "*"}</code> · {NOTE_CREATION_MODE_LABELS[link.note_creation_mode] ?? link.note_creation_mode}
                      {" · "}작성자 {link.default_author_member_id ? memberName.get(link.default_author_member_id) ?? "-" : "자동"}
                      {link.bundle_id ? ` · 묶음 '${bundleName.get(link.bundle_id) ?? "?"}'` : ""}
                      {" · "}이벤트 {link.event_count}건{link.is_active ? "" : " · 일시 중지됨"}
                    </span>
                  </div>
                  <div className="github-link-buttons">
                    {accountConnected && (
                      <button
                        type="button"
                        className={commitsOpen === link.mapping_id ? "compact-button" : "secondary-button compact-button"}
                        onClick={() => toggleCommits(link)}
                      >
                        커밋으로 노트 만들기
                      </button>
                    )}
                  {canManage && (
                    <>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onUpdate(link, { is_active: !link.is_active })}
                        disabled={busy !== null}
                      >
                        {link.is_active ? "일시 중지" : "다시 켜기"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => setManualOpen((current) => ({ ...current, [link.mapping_id]: !current[link.mapping_id] }))}
                      >
                        설정
                      </button>
                      <button
                        type="button"
                        className="secondary-button compact-button danger-text"
                        onClick={() => onUnlink(link)}
                        disabled={busy !== null}
                      >
                        연결 해제
                      </button>
                    </>
                  )}
                  </div>
                </div>

                {commitsOpen === link.mapping_id && (
                  <div className="github-commit-picker">
                    <div className="github-commit-picker-head">
                      <strong>
                        최근 커밋{commits ? <> · <code>{commits.branch}</code></> : null}
                      </strong>
                      {commits && (
                        <span className={commits.ai_enabled ? "github-ai-badge on" : "github-ai-badge"}>
                          {commits.ai_enabled ? "AI가 코드 변경을 분석해 작성" : "AI 연결 없음 · 커밋 정보만 기록"}
                        </span>
                      )}
                    </div>
                    {commitsLoading && !commits && <p className="context-copy">GitHub에서 커밋을 불러오는 중...</p>}
                    {commits && commits.commits.length === 0 && <p className="context-copy">이 브랜치에 커밋이 없습니다.</p>}
                    {commits && commits.commits.length > 0 && (
                      <ul className="github-commit-list">
                        {commits.commits.map((commit) => (
                          <li key={commit.sha}>
                            <div className="github-commit-copy">
                              <strong>{commit.message || "(메시지 없음)"}</strong>
                              <span>
                                {commit.html_url ? (
                                  <a href={commit.html_url} target="_blank" rel="noreferrer">
                                    <code>{commit.short_sha}</code>
                                  </a>
                                ) : (
                                  <code>{commit.short_sha}</code>
                                )}
                                {commit.author ? ` · ${commit.author}` : ""}
                                {commit.date ? ` · ${commit.date.slice(0, 10)}` : ""}
                              </span>
                            </div>
                            {commit.note_id ? (
                              <button type="button" className="secondary-button compact-button" onClick={() => onOpenNote(commit.note_id!)}>
                                노트 열기
                              </button>
                            ) : (
                              <button
                                type="button"
                                className="compact-button"
                                disabled={busy !== null}
                                onClick={() => void onCommitNote(link, commit.sha)}
                              >
                                {busy === `commit-${commit.sha}` ? (commits.ai_enabled ? "AI 분석 중..." : "만드는 중...") : "노트 만들기"}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {busy?.startsWith("commit-") && commits?.ai_enabled && (
                      <p className="field-hint">변경된 코드를 읽고 설명을 쓰는 중입니다. 변경이 크면 1~2분 걸릴 수 있습니다.</p>
                    )}
                  </div>
                )}

                {canManage && manualOpen[link.mapping_id] && (
                  <div className="github-link-settings">
                    <div className="github-link-grid">
                      <label>
                        대상 브랜치
                        <input
                          defaultValue={link.branch_pattern ?? ""}
                          onBlur={(event) => {
                            if (event.target.value !== (link.branch_pattern ?? "")) void onUpdate(link, { branch_pattern: event.target.value });
                          }}
                        />
                      </label>
                      <label>
                        노트 생성 방식
                        <select value={link.note_creation_mode} onChange={(event) => void onUpdate(link, { note_creation_mode: event.target.value })}>
                          {Object.entries(NOTE_CREATION_MODE_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        기본 작성자
                        <select
                          value={link.default_author_member_id ?? ""}
                          onChange={(event) =>
                            void onUpdate(link, { default_author_member_id: event.target.value ? Number(event.target.value) : null })
                          }
                        >
                          <option value="">지정 안 함</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        기본 검토자
                        <select
                          value={link.default_reviewer_member_id ?? ""}
                          onChange={(event) =>
                            void onUpdate(link, { default_reviewer_member_id: event.target.value ? Number(event.target.value) : null })
                          }
                        >
                          <option value="">지정 안 함</option>
                          {members.map((member) => (
                            <option key={member.id} value={member.id}>
                              {member.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        노트 묶음 <span className="field-optional">선택</span>
                        <select
                          value={link.bundle_id ?? ""}
                          onChange={(event) => {
                            const choice = event.target.value;
                            void run(`update-${link.mapping_id}`, async () => {
                              await updateProjectRepositoryLink(projectId, link.mapping_id, { bundle_id: await resolveBundle(choice) });
                              await load();
                            });
                          }}
                        >
                          {bundleOptions(link.bundle_id ?? "")}
                        </select>
                      </label>
                    </div>
                    <p className="field-hint">이후에 만드는 노트부터 적용됩니다. 이미 만든 노트는 연구노트 목록에서 묶음을 바꿀 수 있습니다.</p>

                    {link.webhook_mode === "app" ? (
                    <div className="github-webhook-box github-webhook-app">
                      <strong>웹훅</strong>
                      <p>
                        기관에 설치된 <b>GitHub App</b>이 이 저장소의 커밋·PR 소식을 자동으로 보냅니다. 저장소별로 웹훅을 설정할 필요가 없습니다.
                      </p>
                      {/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(link.webhook_url) && (
                        <p className="field-hint">
                          지금 서버 주소는 이 컴퓨터 안에서만 열립니다. GitHub App 설정의 Webhook URL에 서버의 공개 주소(PUBLIC_API_BASE_URL)+
                          <code>/github/app/webhook</code> 를 넣어야 소식이 들어옵니다. 그전에는 "커밋으로 노트 만들기"를 쓰세요.
                        </p>
                      )}
                    </div>
                    ) : (
                    <div className="github-webhook-box">
                      <strong>웹훅</strong>
                      <p>
                        GitHub가 커밋·PR 소식을 보내는 주소입니다. 자동 설치가 안 되면 저장소 Settings → Webhooks → Add webhook 에 아래 값을
                        넣으세요. (Content type: <code>application/json</code>, 이벤트: Push, Pull requests)
                      </p>
                      <dl>
                        <div>
                          <dt>Payload URL</dt>
                          <dd>
                            <code>{link.webhook_url}</code>
                          </dd>
                        </div>
                        <div>
                          <dt>Secret</dt>
                          <dd>
                            {secrets[link.mapping_id] ? (
                              <code>{secrets[link.mapping_id]}</code>
                            ) : (
                              <button type="button" className="secondary-button compact-button" onClick={() => void onRevealSecret(link)}>
                                비밀값 보기
                              </button>
                            )}
                          </dd>
                        </div>
                      </dl>
                      {accountConnected && (
                        <button
                          type="button"
                          className="secondary-button compact-button"
                          onClick={() => void onInstallWebhook(link)}
                          disabled={busy !== null}
                        >
                          {busy === `hook-${link.mapping_id}` ? "설치 중..." : "웹훅 자동 설치 다시 시도"}
                        </button>
                      )}
                      {/^https?:\/\/(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(link.webhook_url) && (
                        <p className="field-hint">
                          지금 주소는 이 컴퓨터 안에서만 열립니다. GitHub가 보내려면 서버의 공개 주소(.env 의 PUBLIC_API_BASE_URL)가 필요합니다.
                        </p>
                      )}
                    </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="project-github-section">
        <div className="section-head">
          <h3>최근 GitHub 이벤트</h3>
          <button type="button" className="secondary-button compact-button" onClick={() => void load()}>
            새로고침
          </button>
        </div>
        {events.length === 0 ? (
          <div className="github-empty">아직 받은 이벤트가 없습니다. 연결된 저장소에 푸시하거나 PR을 병합하면 여기에 나타납니다.</div>
        ) : (
          <ul className="github-event-list">
            {events.map((event) => {
              const link = event.project_mapping_id ? linkById.get(event.project_mapping_id) : undefined;
              return (
                <li key={event.id}>
                  <div>
                    <strong>
                      {EVENT_LABELS[event.event_type] ?? event.event_type}
                      {event.action === "commit" ? " · 커밋 선택" : event.action ? ` · ${event.action}` : ""}
                    </strong>
                    <span>
                      {link?.repo_full_name ?? "연결 해제된 저장소"} · {event.created_at?.slice(0, 16).replace("T", " ")} ·{" "}
                      {EVENT_STATUS_LABELS[event.status] ?? event.status}
                      {event.error_message ? ` · ${event.error_message}` : ""}
                    </span>
                  </div>
                  <div className="github-event-actions">
                    {event.source_url && (
                      <a href={event.source_url} target="_blank" rel="noreferrer" className="secondary-button compact-button">
                        GitHub
                      </a>
                    )}
                    {event.generated_note_id ? (
                      <button type="button" className="compact-button" onClick={() => onOpenNote(event.generated_note_id!)}>
                        노트 열기
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary-button compact-button"
                        onClick={() => void onGenerate(event)}
                        disabled={busy !== null || !event.project_mapping_id}
                      >
                        노트 만들기
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
