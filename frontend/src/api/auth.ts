import { apiFetch, setAccessToken } from "./client";

export type AuthUser = {
  id: number;
  email: string;
  name: string;
  username: string;
  is_active: boolean;
  is_admin: boolean;
  is_org_owner: boolean;
  approval_status: string;
  organization_id: number | null;
  signature_data_url: string | null;
};

export type AuthResponse = {
  access_token: string | null;
  token_type: string | null;
  user: AuthUser;
  message: string | null;
};

export type CompanyAccessRequestInfo = {
  company_id: number;
  company_name: string;
  company_code: string;
  status: string;
};

export type CompanyAccessRequestResponse = {
  user: AuthUser;
  request: CompanyAccessRequestInfo | null;
  message: string;
};

export type UserSignature = {
  id: number;
  user_id: number;
  image_storage_key: string;
  checksum: string | null;
  status: string;
  created_at: string;
  revoked_at: string | null;
};

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.detail === "string") {
      return data.detail;
    }
    if (Array.isArray(data?.detail) && data.detail.length > 0) {
      return data.detail
        .map((item: { loc?: Array<string | number>; msg?: string }) => {
          const field = item.loc && item.loc.length > 0 ? item.loc[item.loc.length - 1] : undefined;
          return field ? `${String(field)}: ${item.msg ?? fallback}` : (item.msg ?? fallback);
        })
        .join(", ");
    }
  } catch {
    return fallback;
  }
  return fallback;
}

export async function signUp(payload: {
  email: string;
  password: string;
  name: string;
  account_type: "owner" | "user";
  organization_name?: string;
  organization_code?: string;
}): Promise<AuthResponse> {
  const response = await apiFetch("/auth/signup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "회원가입에 실패했습니다"));
  const data = (await response.json()) as AuthResponse;
  setAccessToken(data.access_token);
  return data;
}

export async function login(payload: { email: string; password: string }): Promise<AuthResponse> {
  const response = await apiFetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "로그인에 실패했습니다"));
  const data = (await response.json()) as AuthResponse;
  setAccessToken(data.access_token);
  return data;
}

export async function getMe(): Promise<AuthUser> {
  const response = await apiFetch("/auth/me");
  if (response.status === 401) throw new Error("UNAUTHORIZED");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "사용자 정보를 불러오지 못했습니다"));
  return response.json();
}

export async function updateMySignature(signature_data_url: string | null): Promise<AuthUser> {
  const response = await apiFetch("/auth/me/signature", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ signature_data_url }),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "서명 수정에 실패했습니다"));
  return response.json();
}

export async function listMySignatures(): Promise<UserSignature[]> {
  const response = await apiFetch("/auth/me/signatures");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "서명을 불러오지 못했습니다"));
  return response.json();
}

export async function createMySignature(file: File): Promise<UserSignature> {
  const form = new FormData();
  form.append("upload", file);
  const response = await apiFetch("/auth/me/signatures", {
    method: "POST",
    body: form,
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "서명 업로드에 실패했습니다"));
  return response.json();
}

export async function revokeMySignature(signatureId: number): Promise<void> {
  const response = await apiFetch(`/auth/me/signatures/${signatureId}`, {
    method: "DELETE",
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "서명 삭제에 실패했습니다"));
}

export async function getMyCompanyAccessRequest(): Promise<CompanyAccessRequestResponse> {
  const response = await apiFetch("/auth/me/company-access-request");
  if (!response.ok) throw new Error(await parseErrorMessage(response, "기관 가입 요청을 불러오지 못했습니다"));
  return response.json();
}

export async function requestMyCompanyAccess(payload: {
  organization_name: string;
  organization_code: string;
}): Promise<CompanyAccessRequestResponse> {
  const response = await apiFetch("/auth/me/company-access-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "기관 가입 요청에 실패했습니다"));
  return response.json();
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await apiFetch("/auth/me/password", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
  if (!response.ok) throw new Error(await parseErrorMessage(response, "비밀번호 변경에 실패했습니다"));
}
