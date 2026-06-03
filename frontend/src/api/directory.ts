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
  if (!response.ok) throw new Error(await parseDirectoryError(response, "Failed to fetch company members"));
  return response.json();
}

export async function getResearcherManagement(): Promise<ResearcherManagementData> {
  const response = await apiFetch("/directory/researcher-management");
  if (!response.ok) throw new Error(await parseDirectoryError(response, "Failed to fetch researcher management data"));
  return response.json();
}

export async function createResearcherInvitation(email: string): Promise<{ id: number; email: string; status: string; created_at: string | null }> {
  const response = await apiFetch("/directory/researcher-management/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "Failed to create invitation"));
  return response.json();
}

export async function removeResearcherMember(companyMemberId: number): Promise<void> {
  const response = await apiFetch(`/directory/researcher-management/members/${companyMemberId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseDirectoryError(response, "Failed to remove researcher"));
}
