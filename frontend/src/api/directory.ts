import { apiFetch } from "./client";

export type CompanyMemberDirectoryItem = {
  company_member_id: number;
  company_id: number;
  user_id: number;
  name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_approved: boolean;
  signature_data_url: string | null;
};

export type ResearcherManagementData = {
  company: {
    id: number;
    name: string;
    code: string;
    is_active: boolean;
  };
  members: CompanyMemberDirectoryItem[];
  pending_requests?: MembershipRequestItem[];
};

async function parseDirectoryError(response: Response, fallback: string): Promise<string> {
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

export async function listCompanyMembers(): Promise<CompanyMemberDirectoryItem[]> {
  const response = await apiFetch("/directory/company-members");
  if (!response.ok) throw new Error(await parseDirectoryError(response, "기관 구성원을 불러오지 못했습니다"));
  return response.json();
}

export async function getResearcherManagement(): Promise<ResearcherManagementData> {
  const response = await apiFetch("/directory/researcher-management");
  if (!response.ok) throw new Error(await parseDirectoryError(response, "연구원 관리 정보를 불러오지 못했습니다"));
  return response.json();
}

export async function createResearcherInvitation(email: string): Promise<{ id: number; email: string; status: string; created_at: string | null }> {
  const response = await apiFetch("/directory/researcher-management/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "초대 생성에 실패했습니다"));
  return response.json();
}

export async function removeResearcherMember(companyMemberId: number): Promise<void> {
  const response = await apiFetch(`/directory/researcher-management/members/${companyMemberId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "연구원 삭제에 실패했습니다"));
}

export type MembershipRequestItem = {
  request_id: number;
  user_id: number;
  name: string;
  email: string;
  requested_at: string | null;
};

export type RegisteredResearcher = {
  company_member_id: number;
  user_id: number;
  name: string;
  email: string;
  temporary_password: string | null;
};

export async function registerResearcher(payload: {
  name: string;
  email: string;
  password?: string;
}): Promise<RegisteredResearcher> {
  const response = await apiFetch("/directory/researcher-management/researchers", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "연구원 등록에 실패했습니다"));
  return response.json();
}

export async function approveMembershipRequest(requestId: number): Promise<void> {
  const response = await apiFetch(`/directory/researcher-management/requests/${requestId}/approve`, { method: "POST" });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "가입 요청 승인에 실패했습니다"));
}

export async function rejectMembershipRequest(requestId: number): Promise<void> {
  const response = await apiFetch(`/directory/researcher-management/requests/${requestId}/reject`, { method: "POST" });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "가입 요청 거절에 실패했습니다"));
}
