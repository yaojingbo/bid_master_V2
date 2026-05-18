/**
 * Auth-aware fetch wrapper.
 * 自动注入 Authorization header，401 时自动 refresh + 重试。
 */
import { useAuthStore } from "@/stores/auth-store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const fullUrl = url.startsWith("/") ? `${API_BASE}${url}` : url;
  const response = await fetch(fullUrl, { ...options, headers });

  if (response.status === 401) {
    // 尝试刷新 token
    const newToken = await useAuthStore.getState().refreshAccessToken();
    if (newToken) {
      headers.set("Authorization", `Bearer ${newToken}`);
      return fetch(fullUrl, { ...options, headers });
    }
    // refresh 失败，退出登录
    useAuthStore.getState().logout();
    window.location.href = "/login";
    return response;
  }

  return response;
}