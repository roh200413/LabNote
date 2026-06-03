import { apiFetch } from "./client";

export type AdminDashboard = {
  total_users: number;
  total_organizations: number;
  active_admins: number;
  pending_organizations: number;
  logins_by_day: Array<{ date: string; count: number }>;
  recent_logins: Array<{
    id: number;
    occurred_at: string;
    user_id: number;
    email: string;
    event_type: string;
  }>;
};

export type AdminUser = {
  id: number;
  email: string;
  name: string;
  is_active: boolean;
  is_admin: boolean;
  is_org_owner: boolean;
  approval_status: string;
  organization_id: number | null;
  created_at: string;
};

export type Organization = {
  id: number;
  name: string;
  code: string;
  description: string | null;
  is_active: boolean;
  owner_user_id: number | null;
  approval_status: string;
  created_at: string;
};

export async function getAdminDashboard(): Promise<AdminDashboard> {
  const response = await apiFetch("/admin/dashboard");
  if (!response.ok) throw new Error("Failed to load dashboard");
  return response.json();
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const response = await apiFetch("/admin/users");
  if (!response.ok) throw new Error("Failed to load users");
  return response.json();
}

export async function updateAdminUser(
  userId: number,
  payload: Partial<Pick<AdminUser, "name" | "is_active" | "is_admin" | "organization_id">>
): Promise<AdminUser> {
  const response = await apiFetch(`/admin/users/${userId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to update user");
  return response.json();
}

export async function listOrganizations(): Promise<Organization[]> {
  const response = await apiFetch("/admin/organizations");
  if (!response.ok) throw new Error("Failed to load organizations");
  return response.json();
}

export async function listPendingOrganizations(): Promise<Organization[]> {
  const response = await apiFetch("/admin/organizations/pending");
  if (!response.ok) throw new Error("Failed to load pending organizations");
  return response.json();
}

export async function createOrganization(payload: {
  name: string;
  code: string;
  description?: string;
}): Promise<Organization> {
  const response = await apiFetch("/admin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to create organization");
  return response.json();
}

export async function updateOrganization(
  organizationId: number,
  payload: Partial<Pick<Organization, "name" | "code" | "description" | "is_active">>
): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error("Failed to update organization");
  return response.json();
}

export async function approveOrganization(organizationId: number): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}/approve`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("Failed to approve organization");
  return response.json();
}

export async function rejectOrganization(organizationId: number): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}/reject`, {
    method: "POST",
  });
  if (!response.ok) throw new Error("Failed to reject organization");
  return response.json();
}
