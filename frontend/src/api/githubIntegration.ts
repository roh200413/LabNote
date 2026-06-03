import { apiFetch } from "./client";

export type GitHubRepositoryIntegration = {
  id: number;
  created_at: string;
  updated_at: string;
  company_id: number;
  created_by: number | null;
  repo_owner: string;
  repo_name: string;
  repository_url: string | null;
  default_branch: string | null;
  webhook_configured: boolean;
  webhook_url: string | null;
  status: string;
  notes: string | null;
};

export type GitHubRepositoryIntegrationPayload = {
  company_id: number;
  repo_owner: string;
  repo_name: string;
  repository_url?: string | null;
  default_branch?: string | null;
  status?: string;
  notes?: string | null;
};

export type GitHubWebhookSecret = {
  integration_id: number;
  webhook_secret: string;
  webhook_url: string;
};

export type GitHubProjectMapping = {
  id: number;
  created_at: string;
  updated_at: string;
  integration_id: number;
  project_id: string;
  branch_pattern: string | null;
  path_pattern: string | null;
  note_creation_mode: string;
  default_author_member_id: number | null;
  default_reviewer_member_id: number | null;
  is_active: boolean;
};

export type GitHubProjectMappingPayload = {
  project_id: string;
  branch_pattern?: string | null;
  path_pattern?: string | null;
  note_creation_mode?: string;
  default_author_member_id?: number | null;
  default_reviewer_member_id?: number | null;
  is_active?: boolean;
};

export type GitHubEvent = {
  id: number;
  created_at: string;
  processed_at: string | null;
  integration_id: number;
  project_mapping_id: number | null;
  project_id: string | null;
  delivery_id: string;
  github_event_id: string | null;
  event_type: string;
  action: string | null;
  source_url: string | null;
  status: string;
  error_message: string | null;
  generated_note_id: string | null;
};

async function parseGitHubError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") return payload.detail;
  } catch {
    return fallback;
  }
  return fallback;
}

export async function listGitHubIntegrations(companyId?: number | null): Promise<GitHubRepositoryIntegration[]> {
  const query = companyId ? `?company_id=${companyId}` : "";
  const response = await apiFetch(`/github-integrations${query}`);
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to load GitHub integrations"));
  return response.json();
}

export async function createGitHubIntegration(
  payload: GitHubRepositoryIntegrationPayload
): Promise<GitHubRepositoryIntegration> {
  const response = await apiFetch("/github-integrations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to create GitHub integration"));
  return response.json();
}

export async function updateGitHubIntegration(
  integrationId: number,
  payload: Partial<Omit<GitHubRepositoryIntegrationPayload, "company_id">>
): Promise<GitHubRepositoryIntegration> {
  const response = await apiFetch(`/github-integrations/${integrationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to update GitHub integration"));
  return response.json();
}

export async function deleteGitHubIntegration(integrationId: number): Promise<void> {
  const response = await apiFetch(`/github-integrations/${integrationId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to delete GitHub integration"));
}

export async function rotateGitHubWebhookSecret(integrationId: number): Promise<GitHubWebhookSecret> {
  const response = await apiFetch(`/github-integrations/${integrationId}/webhook-secret`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to rotate webhook secret"));
  return response.json();
}

export async function listGitHubProjectMappings(integrationId: number): Promise<GitHubProjectMapping[]> {
  const response = await apiFetch(`/github-integrations/${integrationId}/mappings`);
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to load project mappings"));
  return response.json();
}

export async function createGitHubProjectMapping(
  integrationId: number,
  payload: GitHubProjectMappingPayload
): Promise<GitHubProjectMapping> {
  const response = await apiFetch(`/github-integrations/${integrationId}/mappings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to create project mapping"));
  return response.json();
}

export async function updateGitHubProjectMapping(
  mappingId: number,
  payload: Partial<GitHubProjectMappingPayload>
): Promise<GitHubProjectMapping> {
  const response = await apiFetch(`/github-integrations/mappings/${mappingId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to update project mapping"));
  return response.json();
}

export async function deleteGitHubProjectMapping(mappingId: number): Promise<void> {
  const response = await apiFetch(`/github-integrations/mappings/${mappingId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to delete project mapping"));
}

export async function listGitHubEvents(filters: {
  integrationId?: number | null;
  projectId?: string | null;
  status?: string | null;
} = {}): Promise<GitHubEvent[]> {
  const params = new URLSearchParams();
  if (filters.integrationId) params.set("integration_id", String(filters.integrationId));
  if (filters.projectId) params.set("project_id", filters.projectId);
  if (filters.status) params.set("status", filters.status);
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await apiFetch(`/github-integrations/events${query}`);
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to load GitHub events"));
  return response.json();
}

export async function generateResearchNoteFromGitHubEvent(eventId: number): Promise<GitHubEvent> {
  const response = await apiFetch(`/github-integrations/events/${eventId}/generate-note`, {
    method: "POST",
  });
  if (!response.ok) throw new Error(await parseGitHubError(response, "Failed to generate research note"));
  return response.json();
}
