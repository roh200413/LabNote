import { apiFetch } from "./client";

/** Throws with the server's `detail` message when there is one, otherwise the fallback. */
async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  let message = fallback;
  try {
    const body = await response.json();
    if (typeof body?.detail === "string") message = body.detail;
  } catch {
    // keep the fallback message
  }
  throw new Error(message);
}

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
  if (!response.ok) throw new Error("대시보드를 불러오지 못했습니다");
  return response.json();
}

export async function listAdminUsers(): Promise<AdminUser[]> {
  const response = await apiFetch("/admin/users");
  if (!response.ok) throw new Error("사용자 목록을 불러오지 못했습니다");
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
  await ensureOk(response, "사용자 수정에 실패했습니다");
  return response.json();
}

export async function listOrganizations(): Promise<Organization[]> {
  const response = await apiFetch("/admin/organizations");
  if (!response.ok) throw new Error("기관 목록을 불러오지 못했습니다");
  return response.json();
}

export async function listPendingOrganizations(): Promise<Organization[]> {
  const response = await apiFetch("/admin/organizations/pending");
  if (!response.ok) throw new Error("승인 대기 기관을 불러오지 못했습니다");
  return response.json();
}

export async function createOrganization(payload: { name: string; code?: string }): Promise<Organization> {
  const response = await apiFetch("/admin/organizations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(response, "기관 생성에 실패했습니다");
  return response.json();
}

export async function updateOrganization(
  organizationId: number,
  payload: Partial<Pick<Organization, "name" | "code" | "is_active">>
): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  await ensureOk(response, "기관 수정에 실패했습니다");
  return response.json();
}

export async function approveOrganization(organizationId: number): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}/approve`, {
    method: "POST",
  });
  await ensureOk(response, "기관 승인에 실패했습니다");
  return response.json();
}

export async function rejectOrganization(organizationId: number): Promise<Organization> {
  const response = await apiFetch(`/admin/organizations/${organizationId}/reject`, {
    method: "POST",
  });
  await ensureOk(response, "기관 반려에 실패했습니다");
  return response.json();
}

export async function createAdminUser(payload: {
  name: string;
  email: string;
  password?: string;
  organization_id?: number | null;
  role: "member" | "owner";
}): Promise<{ user: AdminUser; temporary_password: string | null }> {
  const response = await apiFetch("/admin/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    let message = "사용자 등록에 실패했습니다";
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return response.json();
}

export async function setAdminUserOrganizationRole(userId: number, role: "member" | "owner"): Promise<AdminUser> {
  const response = await apiFetch(`/admin/users/${userId}/organization-role`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (!response.ok) {
    let message = "기관 역할을 바꾸지 못했습니다";
    try {
      const body = await response.json();
      if (typeof body?.detail === "string") message = body.detail;
    } catch {
      // keep the generic message
    }
    throw new Error(message);
  }
  return response.json();
}
