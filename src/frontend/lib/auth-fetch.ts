/**
 * Auth-aware fetch wrapper.
 * 自动注入 Authorization header，401 时自动 refresh + 重试。
 * 使用单例 refresh 锁防止并发请求同时触发多次 refresh。
 * 若 accessToken 为空且 authReady 为 false，等待 initAuth 完成后再发请求，
 * 避免页面刷新时因 token 尚未就绪导致不必要的 401。
 */
import { useAuthStore } from "@/stores/auth-store";
import { useLogStore } from "@/stores/log-store";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

let refreshPromise: Promise<string | null> | null = null;

/** 等待 authReady 变为 true（即 initAuth 完成） */
function waitForAuthReady(): Promise<void> {
  const { authReady } = useAuthStore.getState();
  if (authReady) return Promise.resolve();
  return new Promise((resolve) => {
    const unsub = useAuthStore.subscribe((state) => {
      if (state.authReady) {
        unsub();
        resolve();
      }
    });
  });
}

export async function authFetch(url: string, options?: RequestInit): Promise<Response> {
  // 若 token 尚未就绪，等待 initAuth 完成
  const { accessToken: initialToken } = useAuthStore.getState();
  if (!initialToken) {
    await waitForAuthReady();
  }

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

    const { authReady } = useAuthStore.getState();
    if (authReady) {
      useAuthStore.getState().logout();
      // 等待 logout 请求完成（清除 httpOnly cookie）后再跳转，
      // 避免 middleware 因残留 refresh_token cookie 导致重定向循环
      if (typeof window !== "undefined") {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
        window.location.href = "/login";
      }
    }
    return response;
  }

  return response;
}

/**
 * SSE 流式请求，使用与 authFetch 相同的代理路径和认证逻辑。
 */
export async function authFetchSSE(url: string, options?: RequestInit): Promise<Response> {
  // 若 token 尚未就绪，等待 initAuth 完成
  const { accessToken: initialToken } = useAuthStore.getState();
  if (!initialToken) {
    await waitForAuthReady();
  }

  const { accessToken } = useAuthStore.getState();
  const headers = new Headers(options?.headers);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const fullUrl = url.startsWith("/") ? `${API_BASE}${url}` : url;

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

    const { authReady } = useAuthStore.getState();
    if (authReady) {
      useAuthStore.getState().logout();
      if (typeof window !== "undefined") {
        await fetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => {});
        window.location.href = "/login";
      }
    }
    return response;
  }

  return response;
}
