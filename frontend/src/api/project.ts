import { apiFetch } from "./client";

export type Project = {
  id: string;
  created_at: string;
  updated_at: string;
  company_id: number;
  name: string;
  code: string;
  description: string | null;
  status: string;
  owner_member_id: number | null;
  start_date: string | null;
  end_date: string | null;
  monthly_note_target: number | null;
};

export type ProjectMember = {
  id: number;
  project_id: string;
  company_member_id: number;
  company_id: number;
  user_id: number;
  name: string;
  email: string;
  company_role: string;
  role: string;
  is_active: boolean;
  is_approved: boolean;
  created_at: string;
  updated_at: string;
};

export type ProjectNoteCover = {
  id: number;
  project_id: string;
  cover_image_data_url: string | null;
  template_payload: string | null;
  show_business_name: boolean;
  show_title: boolean;
  show_code: boolean;
  show_org: boolean;
  show_manager: boolean;
  show_period: boolean;
  created_at: string;
  updated_at: string;
};

export type CreateProjectPayload = {
  company_id: number;
  name: string;
  code: string;
  description?: string;
  status?: string;
  owner_member_id?: number;
  start_date?: string;
  end_date?: string;
  monthly_note_target?: number;
};

export type UpdateProjectPayload = {
  name?: string;
  code?: string;
  description?: string;
  status?: string;
  owner_member_id?: number;
  start_date?: string;
  end_date?: string;
  monthly_note_target?: number;
};

export type UpsertProjectCoverPayload = {
  cover_image_data_url?: string | null;
  template_payload?: string | null;
  show_business_name: boolean;
  show_title: boolean;
  show_code: boolean;
  show_org: boolean;
  show_manager: boolean;
  show_period: boolean;
};

async function parseProjectError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = await response.json();
    if (typeof payload?.detail === "string") {
      return payload.detail;
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export async function listProjects(companyId?: number): Promise<Project[]> {
  const query = companyId ? `?company_id=${companyId}` : "";
  const response = await apiFetch(`/projects${query}`);
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to fetch projects"));
  return response.json();
}

export async function createProject(payload: CreateProjectPayload): Promise<Project> {
  const response = await apiFetch("/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to create project"));
  return response.json();
}

export async function updateProject(projectId: string, payload: UpdateProjectPayload): Promise<Project> {
  const response = await apiFetch(`/projects/${projectId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to update project"));
  return response.json();
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const response = await apiFetch(`/projects/${projectId}/members`);
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to fetch project members"));
  return response.json();
}

export async function assignProjectMember(
  projectId: string,
  companyMemberId: number,
  role: string
): Promise<ProjectMember> {
  const response = await apiFetch(`/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_member_id: companyMemberId, role }),
  });
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to assign member"));
  return response.json();
}

export async function removeProjectMember(projectId: string, companyMemberId: number): Promise<void> {
  const response = await apiFetch(`/projects/${projectId}/members/${companyMemberId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to remove member"));
}

export async function getProjectCover(projectId: string): Promise<ProjectNoteCover | null> {
  const response = await apiFetch(`/projects/${projectId}/cover`);
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to fetch project cover"));
  return response.json();
}

export async function upsertProjectCover(
  projectId: string,
  payload: UpsertProjectCoverPayload
): Promise<ProjectNoteCover> {
  const response = await apiFetch(`/projects/${projectId}/cover`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseProjectError(response, "Failed to save project cover"));
  return response.json();
}
