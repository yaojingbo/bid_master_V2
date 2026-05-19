/**
 * Auth-aware fetch wrapper.
 * 自动注入 Authorization header，401 时自动 refresh + 重试。
 * 使用单例 refresh 锁防止并发请求同时触发多次 refresh。
 */
import { useAuthStore } from "@/stores/auth-store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

let refreshPromise: Promise<string | null> | null = null;

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const fullUrl = url.startsWith("/") ? `${API_BASE}${url}` : url;
  const response = await fetch(fullUrl, { ...options, headers, credentials: "include" });

  if (response.status === 401) {
    // 使用单例锁：多个并发 401 只触发一次 refresh
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

    // refresh 失败，退出登录并重定向（仅在浏览器环境）
    useAuthStore.getState().logout();
    if (typeof window !== "undefined") {
      window.location.href = "/login";
    }
    return response;
  }

  return response;
}
