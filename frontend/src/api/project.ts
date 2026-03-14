const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

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
};

export type ProjectMember = {
  id: number;
  project_id: string;
  company_member_id: number;
  role: string;
  created_at: string;
  updated_at: string;
};

export type CreateProjectPayload = {
  company_id: number;
  name: string;
  code: string;
  description?: string;
  status?: string;
};

export async function listProjects(companyId?: number): Promise<Project[]> {
  const query = companyId ? `?company_id=${companyId}` : "";
  const response = await fetch(`${API_BASE_URL}/projects${query}`);
  if (!response.ok) throw new Error("Failed to fetch projects");
  return response.json();
}

export async function createProject(payload: CreateProjectPayload): Promise<Project> {
  const response = await fetch(`${API_BASE_URL}/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to create project");
  return response.json();
}

export async function getProjectMembers(projectId: string): Promise<ProjectMember[]> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}/members`);
  if (!response.ok) throw new Error("Failed to fetch project members");
  return response.json();
}

export async function assignProjectMember(
  projectId: string,
  companyMemberId: number,
  role: string
): Promise<ProjectMember> {
  const response = await fetch(`${API_BASE_URL}/projects/${projectId}/members`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ company_member_id: companyMemberId, role }),
  });
  if (!response.ok) throw new Error("Failed to assign member");
  return response.json();
}
