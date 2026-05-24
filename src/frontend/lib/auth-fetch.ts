/**
 * Auth-aware fetch wrapper.
 * 自动注入 Authorization header，401 时自动 refresh + 重试。
 * 使用单例 refresh 锁防止并发请求同时触发多次 refresh。
 */
import { useAuthStore } from "@/stores/auth-store";
import { useLogStore } from "@/stores/log-store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";
const SSE_BASE = process.env.NEXT_PUBLIC_SSE_URL || "";

let refreshPromise: Promise<string | null> | null = null;

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const fullUrl = url.startsWith("/") ? `${API_BASE}${url}` : url;
  const method = options?.method || "GET";
  const shortUrl = url.startsWith("/") ? url : new URL(url).pathname;

  let response: Response;
  try {
    response = await fetch(fullUrl, { ...options, headers, credentials: "include" });
  } catch (err) {
    useLogStore.getState().addLog({
      level: "error",
      category: "api_call",
      message: `${method} ${shortUrl} 网络错误`,
      detail: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  if (response.status >= 400 && response.status !== 401) {
    const body = await response.clone().text().catch(() => "");
    useLogStore.getState().addLog({
      level: "error",
      category: "api_call",
      message: `${method} ${shortUrl} ${response.status}`,
      detail: body.slice(0, 500),
    });
  }

  if (response.status === 401) {
    if (!refreshPromise) {
      refreshPromise = useAuthStore.getState().refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }

    const newToken = await refreshPromise;
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      return fetch(fullUrl, { ...options, headers, credentials: "include" });
    }

    useAuthStore.getState().logout();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return response;
  }

  return response;
}

/**
 * SSE 流式请求。默认走 Next.js rewrite 代理（与 authFetch 一致），
 * 如需直连后端可设置 NEXT_PUBLIC_SSE_URL 环境变量。
 */
export async function authFetchSSE(url: string, options?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const fullUrl = url.startsWith("/") ? `${SSE_BASE}${url}` : url;

  const response = await fetch(fullUrl, { ...options, headers, credentials: "include" });

  if (response.status === 401) {
    if (!refreshPromise) {
      refreshPromise = useAuthStore.getState().refreshAccessToken().finally(() => {
        refreshPromise = null;
      });
    }
    const newToken = await refreshPromise;
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      return fetch(fullUrl, { ...options, headers, credentials: "include" });
    }

    useAuthStore.getState().logout();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return response;
  }

  return response;
}
