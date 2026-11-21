const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const BACKEND_ORIGIN = import.meta.env.VITE_BACKEND_ORIGIN ?? "http://127.0.0.1:8110";
const AUTH_TOKEN_KEY = "labnote.access_token";
// Ordinary requests fail fast; uploads (PDF rendering, large images) get much longer so a slow
// but successful upload is not reported as a failure (and then retried into a duplicate).
const API_TIMEOUT_MS = 15000;
const UPLOAD_TIMEOUT_MS = 180000;
/** Fired when the server rejects the saved login (expired or revoked); the app returns to the login screen. */
export const UNAUTHORIZED_EVENT = "labnote:unauthorized";
const PUBLIC_AUTH_PATHS = ["/auth/login", "/auth/signup"];

export function getAccessToken(): string | null {
  return window.localStorage.getItem(AUTH_TOKEN_KEY);
}

export function setAccessToken(token: string | null): void {
  if (token) {
    window.localStorage.setItem(AUTH_TOKEN_KEY, token);
    return;
  }
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

export async function apiFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = init.body instanceof FormData ? UPLOAD_TIMEOUT_MS : API_TIMEOUT_MS, ...requestInit } = init;
  const headers = new Headers(requestInit.headers);
  const token = getAccessToken();
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { ...requestInit, headers, signal: controller.signal });
    if (response.status === 401 && token && !PUBLIC_AUTH_PATHS.some((prefix) => path.startsWith(prefix))) {
      setAccessToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return response;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("서버 응답 시간이 초과되었습니다. API 서버가 실행 중인지 확인하세요.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

export function getBackendAssetUrl(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  if (normalizedPath.startsWith("http://") || normalizedPath.startsWith("https://")) {
    return normalizedPath;
  }
  return `${BACKEND_ORIGIN}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}

export function getBackendApiUrl(path: string): string {
  const normalizedPath = path.replace(/\\/g, "/");
  return `${BACKEND_ORIGIN}${normalizedPath.startsWith("/") ? normalizedPath : `/${normalizedPath}`}`;
}
