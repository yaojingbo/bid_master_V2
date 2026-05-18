/**
 * 认证 API 客户端。
 * 对应后端 /api/auth/* 路由。
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface LoginResponse {
  access_token: string;
  refresh_token?: string;
  token_type: string;
  user: { id: string; username: string; email?: string; role: string };
}

interface RefreshResponse {
  access_token: string;
  token_type: string;
}

export async function authLogin(email: string, password: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `登录失败: HTTP ${res.status}`);
  }
  return res.json();
}

export async function authRegister(email: string, password: string, username?: string): Promise<LoginResponse> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, username }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || `注册失败: HTTP ${res.status}`);
  }
  return res.json();
}

export async function authRefresh(): Promise<RefreshResponse> {
  // refresh_token 在 httpOnly cookie 中，自动随请求发送
  const res = await fetch(`${API_BASE}/api/auth/refresh`, {
    method: "POST",
    credentials: "include",
  });
  if (!res.ok) {
    throw new Error(`刷新 token 失败: HTTP ${res.status}`);
  }
  return res.json();
}

export async function authMe(token: string): Promise<{ id: string; username: string; role: string; email?: string }> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`获取用户信息失败: HTTP ${res.status}`);
  }
  return res.json();
}