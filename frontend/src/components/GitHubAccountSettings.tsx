import { FormEvent, useEffect, useState } from "react";

import {
  completeGitHubAppInstallation,
  completeGitHubUserLink,
  connectGitHubAccount,
  disconnectGitHubAccount,
  getGitHubAccount,
  getGitHubAppInstallUrl,
  getGitHubUserLinkUrl,
  unlinkGitHubUser,
  type GitHubAccountOverview,
} from "../api/githubAccount";

type Props = {
  /** Opens a project's GitHub tab from the linked-repository list. */
  onOpenProjectGitHub: (projectId: string) => void;
};

type GitHubCallback =
  | { kind: "install"; installationId: number; state: string }
  | { kind: "install-requested" }
  | { kind: "user"; code: string; state: string }
  | { kind: "invalid"; message: string };

function parseGitHubCallback(search: string): GitHubCallback | null {
  const params = new URLSearchParams(search);
  const installationId = params.get("installation_id");
  const setupAction = params.get("setup_action");
  const state = params.get("state");
  const code = params.get("code");
  if (setupAction === "request") return { kind: "install-requested" };
  if (installationId) {
    if (!state) {
      return { kind: "invalid", message: "LabNote에서 'GitHub App 설치' 버튼으로 시작해야 기관에 연결됩니다. 다시 눌러 주세요." };
    }
    return { kind: "install", installationId: Number(installationId), state };
  }
  if (code && state) return { kind: "user", code, state };
  if (params.get("error") && state) return { kind: "invalid", message: "GitHub 로그인이 취소되었습니다." };
  return null;
}

/** Whether GitHub just sent the browser back here (App install or user sign-in), so the page should open. */
export function hasGitHubCallback() {
  return typeof window !== "undefined" && parseGitHubCallback(window.location.search) !== null;
}

// GitHub's sign-in code works only once: take it from the URL a single time (StrictMode mounts twice).
let pendingCallback: GitHubCallback | null | undefined;
function takeGitHubCallback(): GitHubCallback | null {
  if (pendingCallback !== undefined) return null;
  pendingCallback = parseGitHubCallback(window.location.search);
  if (pendingCallback) {
    const url = new URL(window.location.href);
    ["installation_id", "setup_action", "state", "code", "error", "error_description", "error_uri"].forEach((key) =>
      url.searchParams.delete(key)
    );
    window.history.replaceState(null, "", url.pathname + (url.search ? url.search : "") + url.hash);
  }
  return pendingCallback;
}

/** Main-page GitHub settings: the organization's connection, the user's own GitHub login, and project links. */
export function GitHubAccountSettings({ onOpenProjectGitHub }: Props) {
  const [account, setAccount] = useState<GitHubAccountOverview | null>(null);
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState(false);
  const [tokenOpen, setTokenOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [userError, setUserError] = useState<string | null>(null);
  const [userNotice, setUserNotice] = useState<string | null>(null);

  const load = async () => {
    try {
      setAccount(await getGitHubAccount());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  useEffect(() => {
    const callback = takeGitHubCallback();
    void (async () => {
      if (callback?.kind === "install") {
        setBusy("callback");
        setNotice("GitHub App 설치를 확인하는 중입니다...");
        try {
          const result = await completeGitHubAppInstallation(callback.installationId, callback.state);
          setAccount(result);
          setNotice(`GitHub App을 @${result.login}에 설치하고 기관에 연결했습니다.`);
        } catch (err) {
          setNotice(null);
          setError((err as Error).message);
        } finally {
          setBusy(null);
        }
      } else if (callback?.kind === "install-requested") {
        setNotice("GitHub 조직 관리자에게 App 설치 승인을 요청했습니다. 승인되면 이 화면에서 'GitHub App 설치'를 다시 눌러 연결을 마치세요.");
      } else if (callback?.kind === "user") {
        setBusy("callback");
        setUserNotice("GitHub 계정을 확인하는 중입니다...");
        try {
          const me = await completeGitHubUserLink(callback.code, callback.state);
          setUserNotice(`내 GitHub 계정 @${me.login}을(를) 연결했습니다.`);
        } catch (err) {
          setUserNotice(null);
          setUserError((err as Error).message);
        } finally {
          setBusy(null);
        }
      } else if (callback?.kind === "invalid") {
        setError(callback.message);
      }
      await load();
    })();
  }, []);

  const goTo = async (key: string, getUrl: () => Promise<{ url: string }>, onError: (message: string) => void) => {
    setBusy(key);
    try {
      const { url } = await getUrl();
      window.location.assign(url);
    } catch (err) {
      onError((err as Error).message);
      setBusy(null);
    }
  };

  const onInstallApp = () => {
    setError(null);
    void goTo("install", getGitHubAppInstallUrl, setError);
  };

  const onLinkMe = () => {
    setUserError(null);
    void goTo("link-me", getGitHubUserLinkUrl, setUserError);
  };

  const onUnlinkMe = async () => {
    if (!window.confirm("내 GitHub 계정 연결을 해제할까요? 이후 내 커밋으로 만든 노트는 프로젝트 기본 작성자 이름으로 만들어집니다.")) return;
    setBusy("unlink-me");
    try {
      await unlinkGitHubUser();
      setUserNotice("내 GitHub 계정 연결을 해제했습니다.");
      await load();
    } catch (err) {
      setUserError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onConnect = async (event: FormEvent) => {
    event.preventDefault();
    setBusy("token");
    setError(null);
    setNotice(null);
    try {
      const result = await connectGitHubAccount(token);
      setAccount(result);
      setToken("");
      setEditing(false);
      setTokenOpen(false);
      setNotice(`GitHub 계정 ${result.login}을(를) 토큰으로 연결했습니다.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onDisconnect = async () => {
    const viaApp = account?.auth_type === "app";
    const message = viaApp
      ? "기관의 GitHub App 연결을 해제할까요? LabNote에서만 해제되며, GitHub에서 App을 완전히 지우려면 GitHub의 설치 설정에서 Uninstall 하세요."
      : "GitHub 계정 연결을 해제할까요? 이미 연결된 저장소의 웹훅은 계속 동작하지만, 새 저장소는 연결할 수 없습니다.";
    if (!window.confirm(message)) return;
    setBusy("disconnect");
    try {
      await disconnectGitHubAccount();
      setNotice("GitHub 연결을 해제했습니다.");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const canManage = Boolean(account?.can_manage);
  const viaApp = account?.auth_type === "app";
  const appAvailable = Boolean(account?.app_available);
  const showTokenForm = canManage && ((!account?.connected && (tokenOpen || !appAvailable)) || editing);
  const byProject = new Map<string, { name: string; repos: GitHubAccountOverview["linked_repositories"] }>();
  for (const item of account?.linked_repositories ?? []) {
    const entry = byProject.get(item.project_id) ?? { name: item.project_name, repos: [] };
    entry.repos.push(item);
    byProject.set(item.project_id, entry);
  }

  const tokenForm = (
    <form className="github-token-form" onSubmit={onConnect}>
      <p className="context-copy">
        기관 공용 GitHub 계정의 <b>Personal access token</b>으로 연결합니다. 토큰은 암호화해서 저장하고 다시 보여주지 않습니다.
      </p>
      <ol className="github-token-steps">
        <li>
          GitHub → Settings → Developer settings →{" "}
          <a href="https://github.com/settings/tokens?type=beta" target="_blank" rel="noreferrer">
            Fine-grained tokens
          </a>{" "}
          에서 <b>연결할 저장소만 골라</b> 새 토큰을 만듭니다.
        </li>
        <li>
          저장소 권한: <code>Metadata</code>·<code>Contents</code>·<code>Pull requests</code> 읽기, <code>Webhooks</code> 읽기·쓰기
        </li>
        <li>만든 토큰을 아래에 붙여 넣습니다.</li>
      </ol>
      <div className="github-token-row">
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          placeholder="github_pat_… 또는 ghp_…"
          autoComplete="off"
          required
          disabled={busy !== null}
        />
        <button type="submit" className="compact-button" disabled={busy !== null || !token.trim()}>
          {busy === "token" ? "확인 중..." : "토큰으로 연결"}
        </button>
        {(editing || (tokenOpen && appAvailable)) && (
          <button
            type="button"
            className="secondary-button compact-button"
            onClick={() => {
              setEditing(false);
              setTokenOpen(false);
            }}
            disabled={busy !== null}
          >
            취소
          </button>
        )}
      </div>
    </form>
  );

  return (
    <div className="user-stack github-account-page">
      <section className="card github-account-card">
        <div className="section-head">
          <h3>기관 GitHub 연결</h3>
          {account?.connected && (
            <span className="github-status-pill connected">{viaApp ? "GitHub App 연결됨" : "토큰으로 연결됨"}</span>
          )}
          {account && !account.connected && <span className="github-status-pill">연결 안 됨</span>}
        </div>

        {account?.connected && (
          <div className="github-account-summary">
            {account.avatar_url ? (
              <img src={account.avatar_url} alt="" className="github-avatar" />
            ) : (
              <div className="github-avatar github-avatar-fallback">{account.login?.slice(0, 1).toUpperCase()}</div>
            )}
            <div>
              <strong>{account.display_name || account.login}</strong>
              <span>
                @{account.login}
                {viaApp
                  ? ` · ${account.account_type === "Organization" ? "GitHub 조직" : "개인 계정"} · ${account.scopes ?? "저장소 접근"}`
                  : account.scopes
                    ? ` · 권한: ${account.scopes}`
                    : ""}
                {account.connected_at ? ` · ${account.connected_at.slice(0, 10)} 연결` : ""}
              </span>
              {viaApp ? (
                <span className="field-hint">
                  LabNote GitHub App이 읽기 전용으로 설치되어 있습니다. 커밋·PR 소식은 App 웹훅으로 자동으로 들어옵니다.
                </span>
              ) : (
                account.profile_url && (
                  <a href={account.profile_url} target="_blank" rel="noreferrer">
                    GitHub 프로필 열기
                  </a>
                )
              )}
            </div>
            {canManage && !editing && (
              <div className="github-account-actions">
                {viaApp && account.manage_url && (
                  <a className="secondary-button compact-button" href={account.manage_url} target="_blank" rel="noreferrer">
                    저장소 선택 바꾸기
                  </a>
                )}
                {!viaApp && (
                  <button type="button" className="secondary-button compact-button" onClick={() => setEditing(true)} disabled={busy !== null}>
                    토큰 바꾸기
                  </button>
                )}
                <button type="button" className="secondary-button compact-button danger-text" onClick={() => void onDisconnect()} disabled={busy !== null}>
                  연결 해제
                </button>
              </div>
            )}
          </div>
        )}

        {canManage && account?.connected && !viaApp && appAvailable && !editing && (
          <div className="github-app-upgrade">
            <div>
              <strong>GitHub App으로 바꾸는 것을 권장합니다</strong>
              <span>토큰은 등록한 사람의 계정에 묶여 있어 퇴사·만료 시 연동이 끊깁니다. App은 기관에 설치되고 읽기 권한만 받습니다.</span>
            </div>
            <button type="button" className="compact-button" onClick={onInstallApp} disabled={busy !== null}>
              {busy === "install" ? "이동 중..." : "GitHub App 설치"}
            </button>
          </div>
        )}

        {account && !account.connected && !canManage && (
          <p className="context-copy">아직 기관 GitHub가 연결되지 않았습니다. 기관 관리자에게 연결을 요청하세요.</p>
        )}

        {canManage && account && !account.connected && appAvailable && (
          <div className="github-app-install">
            <div className="github-app-install-copy">
              <strong>
                GitHub App 설치 <span className="github-recommended">권장</span>
              </strong>
              <ul>
                <li>기관의 GitHub 조직(또는 계정)에 LabNote App을 설치하고, 연결할 저장소를 GitHub 화면에서 고릅니다.</li>
                <li>코드 읽기 전용 권한만 받고, 1시간짜리 토큰을 그때그때 발급해 씁니다. 특정 개인 계정에 묶이지 않습니다.</li>
                <li>저장소마다 웹훅을 설정할 필요 없이 커밋·PR 소식이 자동으로 들어옵니다.</li>
              </ul>
            </div>
            <button type="button" className="compact-button" onClick={onInstallApp} disabled={busy !== null}>
              {busy === "install" ? "GitHub로 이동 중..." : "GitHub App 설치"}
            </button>
          </div>
        )}

        {canManage && account && !account.connected && appAvailable && !tokenOpen && (
          <button type="button" className="link-button github-token-toggle" onClick={() => setTokenOpen(true)}>
            App을 설치할 수 없나요? 개인 토큰으로 연결하기
          </button>
        )}

        {canManage && account && !account.connected && !appAvailable && (
          <p className="field-hint">
            서버에 GitHub App이 등록되면 토큰 대신 App 설치로 연결할 수 있습니다. 그전까지는 토큰으로 연결하세요.
          </p>
        )}

        {canManage && account && (!appAvailable || !account.user_login_available) && <GitHubAppSetupGuide />}

        {showTokenForm && tokenForm}

        {error && <p className="error">오류: {error}</p>}
        {notice && <p className="success-copy">{notice}</p>}
      </section>

      <section className="card github-me-card">
        <div className="section-head">
          <h3>내 GitHub 계정</h3>
          {account?.me.linked ? (
            <span className="github-status-pill connected">연결됨</span>
          ) : (
            account && <span className="github-status-pill">연결 안 됨</span>
          )}
        </div>
        <p className="context-copy">
          내 GitHub 계정을 연결하면 내가 올린 커밋·PR로 만든 연구노트가 <b>내 이름으로</b> 작성되고, AI가 쓴 내용을 내가 검토해 제출합니다.
          연결하지 않으면 프로젝트의 기본 작성자 이름으로 만들어집니다.
        </p>
        {account?.me.linked ? (
          <div className="github-account-summary">
            {account.me.avatar_url ? (
              <img src={account.me.avatar_url} alt="" className="github-avatar" />
            ) : (
              <div className="github-avatar github-avatar-fallback">{account.me.login?.slice(0, 1).toUpperCase()}</div>
            )}
            <div>
              <strong>@{account.me.login}</strong>
              <span>{account.me.linked_at ? `${account.me.linked_at.slice(0, 10)} 연결` : ""}</span>
              {account.me.profile_url && (
                <a href={account.me.profile_url} target="_blank" rel="noreferrer">
                  GitHub 프로필 열기
                </a>
              )}
            </div>
            <div className="github-account-actions">
              <button type="button" className="secondary-button compact-button danger-text" onClick={() => void onUnlinkMe()} disabled={busy !== null}>
                연결 해제
              </button>
            </div>
          </div>
        ) : (
          account && (
            <div className="github-me-actions">
              <button type="button" className="compact-button" onClick={onLinkMe} disabled={busy !== null || !account.user_login_available}>
                {busy === "link-me" ? "GitHub로 이동 중..." : "GitHub로 로그인해 연결"}
              </button>
              {!account.user_login_available && (
                <span className="field-hint">
                  {canManage
                    ? "서버에 GitHub App이 등록되면 사용할 수 있습니다. 위 ‘GitHub App 등록 방법’을 참고하세요."
                    : "서버에 GitHub App이 아직 등록되지 않았습니다. 기관 관리자에게 등록을 요청하세요."}
                </span>
              )}
            </div>
          )
        )}
        {userError && <p className="error">오류: {userError}</p>}
        {userNotice && <p className="success-copy">{userNotice}</p>}
      </section>

      <section className="card">
        <div className="section-head">
          <h3>프로젝트별 연결 저장소</h3>
          <span>{account?.linked_repositories.length ?? 0}개</span>
        </div>
        <p className="context-copy">
          저장소는 각 프로젝트의 <b>GitHub</b> 탭에서 연결합니다. 연결된 저장소의 커밋·PR이 그 프로젝트의 연구노트로 만들어집니다.
        </p>
        {byProject.size === 0 ? (
          <div className="github-empty">아직 저장소를 연결한 프로젝트가 없습니다.</div>
        ) : (
          <ul className="github-project-overview">
            {[...byProject.entries()].map(([projectId, entry]) => (
              <li key={projectId}>
                <div>
                  <strong>{entry.name}</strong>
                  <span>
                    {entry.repos.map((repo) => (
                      <span key={repo.mapping_id} className={`github-repo-chip${repo.is_active ? "" : " inactive"}`}>
                        {repo.repo_full_name}
                      </span>
                    ))}
                  </span>
                </div>
                <button type="button" className="secondary-button compact-button" onClick={() => onOpenProjectGitHub(projectId)}>
                  프로젝트에서 관리
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function GitHubAppSetupGuide() {
  const front = `${window.location.origin}/`;
  return (
    <details className="github-setup-guide">
      <summary>GitHub App 등록 방법 (서버 관리자용)</summary>
      <ol>
        <li>
          GitHub 조직의 Settings → Developer settings → GitHub Apps → <b>New GitHub App</b> 을 엽니다. 개인 계정이면{" "}
          <a href="https://github.com/settings/apps/new" target="_blank" rel="noreferrer">
            github.com/settings/apps/new
          </a>
          .
        </li>
        <li>
          <b>Callback URL</b> 과 <b>Setup URL</b> 에 <code>{front}</code> 를 넣고, Setup URL 의 <b>Redirect on update</b> 를 체크합니다.
          “Request user authorization (OAuth) during installation” 은 체크하지 않습니다.
        </li>
        <li>
          <b>Webhook</b>: 외부에서 접속되는 주소가 있으면 <code>https://공개주소/github/app/webhook</code> 과 임의의 Secret 을 넣고, 없으면 Active 를 끕니다.
        </li>
        <li>
          Repository permissions: <code>Contents</code>·<code>Metadata</code>·<code>Pull requests</code> <b>Read-only</b>. 이벤트: <code>Push</code>·
          <code>Pull request</code>.
        </li>
        <li>
          만든 뒤 App ID, Client ID 를 복사하고 <b>Generate a new client secret</b>, <b>Generate a private key</b>(.pem 다운로드)를 누릅니다.
          Slug 는 공개 페이지 주소 <code>github.com/apps/&lt;slug&gt;</code> 의 끝부분입니다.
        </li>
        <li>
          서버의 <code>backend/.env</code> 에 아래 값을 넣고 백엔드를 다시 시작합니다.
          <pre>{`GITHUB_APP_ID=
GITHUB_APP_SLUG=
GITHUB_APP_PRIVATE_KEY_PATH=   # .pem 파일 경로 (저장소 밖)
GITHUB_APP_CLIENT_ID=
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_WEBHOOK_SECRET=     # 웹훅을 켰을 때`}</pre>
        </li>
      </ol>
    </details>
  );
}
