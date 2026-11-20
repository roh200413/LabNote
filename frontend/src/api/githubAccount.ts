import { apiFetch } from "./client";

export type GitHubAccountInfo = {
  connected: boolean;
  /** "app": the LabNote GitHub App is installed. "token": a personal access token. */
  auth_type?: "app" | "token";
  account_type?: string | null;
  manage_url?: string | null;
  login?: string;
  display_name?: string | null;
  avatar_url?: string | null;
  profile_url?: string | null;
  scopes?: string | null;
  connected_at?: string | null;
};

export type GitHubUserLink = {
  linked: boolean;
  login?: string;
  avatar_url?: string | null;
  profile_url?: string | null;
  linked_at?: string | null;
};

export type GitHubAccountOverview = GitHubAccountInfo & {
  can_manage: boolean;
  app_available: boolean;
  app_slug: string | null;
  user_login_available: boolean;
  me: GitHubUserLink;
  linked_repositories: Array<{
    mapping_id: number;
    project_id: string;
    project_name: string;
    repo_full_name: string;
    repository_url: string | null;
    is_active: boolean;
  }>;
};

export type GitHubRepoOption = {
  full_name: string;
  owner: string;
  name: string;
  private: boolean;
  default_branch: string;
  html_url: string;
  description: string | null;
  updated_at: string | null;
  can_admin: boolean;
  linked: boolean;
};

export type ProjectGitHubLink = {
  mapping_id: number;
  integration_id: number;
  repo_owner: string;
  repo_name: string;
  repo_full_name: string;
  repository_url: string | null;
  default_branch: string | null;
  branch_pattern: string | null;
  note_creation_mode: string;
  default_author_member_id: number | null;
  default_reviewer_member_id: number | null;
  is_active: boolean;
  /** Notes made from this repository go into this note bundle (null: no bundle). */
  bundle_id?: string | null;
  webhook_url: string;
  webhook_mode?: "app" | "repository";
  event_count: number;
};

export type ProjectGitHubState = {
  project_id: string;
  can_manage: boolean;
  account: GitHubAccountInfo;
  links: ProjectGitHubLink[];
};

export type ProjectGitHubEvent = {
  id: number;
  created_at: string | null;
  event_type: string;
  action: string | null;
  source_url: string | null;
  status: string;
  error_message: string | null;
  project_mapping_id: number | null;
  generated_note_id: string | null;
};

export type LinkRepositoryPayload = {
  repo_owner: string;
  repo_name: string;
  repository_url?: string | null;
  default_branch?: string | null;
  branch_pattern?: string | null;
  note_creation_mode: string;
  default_author_member_id?: number | null;
  default_reviewer_member_id?: number | null;
  bundle_id?: string | null;
  install_webhook?: boolean;
};

async function fail(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") message = body.detail;
  } catch {
    // keep fallback
  }
  throw new Error(message);
}

async function json<T>(path: string, fallback: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) return fail(response, fallback);
  return response.status === 204 ? (undefined as T) : response.json();
}

const jsonBody = (body: unknown): RequestInit => ({
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getGitHubAccount = () => json<GitHubAccountOverview>("/github/account", "GitHub 계정 정보를 불러오지 못했습니다");

export const connectGitHubAccount = (token: string) =>
  json<GitHubAccountOverview>("/github/account", "GitHub 계정 연결에 실패했습니다", { method: "PUT", ...jsonBody({ token }) });

export const disconnectGitHubAccount = () =>
  json<void>("/github/account", "GitHub 계정 연결 해제에 실패했습니다", { method: "DELETE" });

// ─── GitHub App and each user's GitHub login ────────────────────────────

export const getGitHubAppInstallUrl = () =>
  json<{ url: string }>("/github/app/install-url", "GitHub App 설치 주소를 만들지 못했습니다");

export const completeGitHubAppInstallation = (installationId: number, state: string) =>
  json<GitHubAccountOverview>("/github/app/installations", "GitHub App 설치를 확인하지 못했습니다", {
    method: "POST",
    timeoutMs: 30000,
    ...jsonBody({ installation_id: installationId, state }),
  } as RequestInit);

export const getGitHubUserLinkUrl = () =>
  json<{ url: string }>("/github/me/link-url", "GitHub 로그인 주소를 만들지 못했습니다");

export const completeGitHubUserLink = (code: string, state: string) =>
  json<GitHubUserLink>("/github/me/link", "GitHub 계정 연결을 확인하지 못했습니다", {
    method: "POST",
    timeoutMs: 30000,
    ...jsonBody({ code, state }),
  } as RequestInit);

export const unlinkGitHubUser = () => json<void>("/github/me/link", "GitHub 계정 연결 해제에 실패했습니다", { method: "DELETE" });

export const getProjectGitHub = (projectId: string) =>
  json<ProjectGitHubState>(`/projects/${projectId}/github`, "프로젝트 GitHub 정보를 불러오지 못했습니다");

export const listProjectGitHubRepositories = (projectId: string, q = "") =>
  json<GitHubRepoOption[]>(
    `/projects/${projectId}/github/repositories?q=${encodeURIComponent(q)}`,
    "저장소 목록을 불러오지 못했습니다",
    { timeoutMs: 30000 } as RequestInit
  );

export const linkProjectRepository = (projectId: string, payload: LinkRepositoryPayload) =>
  json<{ mapping_id: number; integration_id: number; webhook: { installed: boolean; error: string | null; mode?: "app" | "repository" } }>(
    `/projects/${projectId}/github/links`,
    "저장소 연결에 실패했습니다",
    { method: "POST", ...jsonBody(payload) }
  );

export const updateProjectRepositoryLink = (
  projectId: string,
  mappingId: number,
  payload: Partial<Pick<ProjectGitHubLink, "branch_pattern" | "note_creation_mode" | "default_author_member_id" | "default_reviewer_member_id" | "is_active" | "bundle_id">>
) =>
  json<{ mapping_id: number }>(`/projects/${projectId}/github/links/${mappingId}`, "연결 설정 저장에 실패했습니다", {
    method: "PUT",
    ...jsonBody(payload),
  });

export const unlinkProjectRepository = (projectId: string, mappingId: number) =>
  json<void>(`/projects/${projectId}/github/links/${mappingId}`, "저장소 연결 해제에 실패했습니다", { method: "DELETE" });

export const installProjectWebhook = (projectId: string, mappingId: number) =>
  json<{ installed: boolean }>(`/projects/${projectId}/github/links/${mappingId}/webhook`, "웹훅 설치에 실패했습니다", {
    method: "POST",
  });

export const revealProjectWebhookSecret = (projectId: string, mappingId: number) =>
  json<{ webhook_secret: string }>(
    `/projects/${projectId}/github/links/${mappingId}/webhook-secret`,
    "웹훅 비밀값을 불러오지 못했습니다",
    { method: "POST" }
  );

export const listProjectGitHubEvents = (projectId: string) =>
  json<ProjectGitHubEvent[]>(`/projects/${projectId}/github/events`, "GitHub 이벤트를 불러오지 못했습니다");

export const NOTE_CREATION_MODE_LABELS: Record<string, string> = {
  pr_merge: "PR 병합 시 자동 생성",
  every_push: "푸시마다 자동 생성",
  manual: "이벤트에서 직접 생성",
};

export type GitHubCommitOption = {
  sha: string;
  short_sha: string;
  message: string;
  author: string;
  date: string | null;
  html_url: string | null;
  note_id: string | null;
  event_status: string | null;
};

export type GitHubRecentCommits = { branch: string; ai_enabled: boolean; commits: GitHubCommitOption[] };

export const listRecentCommits = (projectId: string, mappingId: number) =>
  json<GitHubRecentCommits>(
    `/projects/${projectId}/github/links/${mappingId}/commits`,
    "최근 커밋을 불러오지 못했습니다",
    { timeoutMs: 30000 } as RequestInit
  );

/** Creates (or reuses) the research note that explains one commit; waits for the LLM. */
export const createNoteFromCommit = (projectId: string, mappingId: number, sha: string) =>
  json<{ event_id: number; note_id: string; created: boolean }>(
    `/projects/${projectId}/github/links/${mappingId}/commits/${encodeURIComponent(sha)}/note`,
    "커밋으로 연구노트를 만들지 못했습니다",
    { method: "POST", timeoutMs: 180000 } as RequestInit
  );
