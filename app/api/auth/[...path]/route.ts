/**
 * Auth API 代理路由。
 * Vercel rewrite 会剥离后端的 Set-Cookie 头，
 * 所以用 Next.js API Route 代替——在服务器端读取后端 Set-Cookie，
 * 再由 Next.js 自己设置 cookie 给浏览器。
 */
import { NextRequest, NextResponse } from "next/server";

const BACKEND = process.env.NODE_ENV === "production"
  ? "https://bidmasterv2-production.up.railway.app"
  : "http://localhost:8000";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const REFRESH_COOKIE_MAX_AGE = 7 * 86400; // 7 天（与后端 jwt_refresh_token_expire_days 一致）

async function proxyAuthRequest(
  request: NextRequest,
  segments: string[],
) {
  const action = segments.join("/");
  const url = `${BACKEND}/api/auth/${action}`;

  // 构建转发 headers
  const fwdHeaders: Record<string, string> = {};

  const auth = request.headers.get("Authorization");
  if (auth) fwdHeaders["Authorization"] = auth;

  // refresh 请求：转发浏览器发来的 refresh_token cookie
  if (action === "refresh") {
    const token = request.cookies.get("refresh_token")?.value;
    if (token) fwdHeaders["Cookie"] = `refresh_token=${token}`;
  }

  const method = request.method;
  let body: string | undefined;

  if (method !== "GET" && method !== "HEAD") {
    const ct = request.headers.get("content-type") || "";
    if (ct.includes("application/json")) {
      body = await request.text();
      fwdHeaders["Content-Type"] = "application/json";
    }
  }

  const backendRes = await fetch(url, { method, headers: fwdHeaders, body });
  const data = await backendRes.json();
  const res = NextResponse.json(data, { status: backendRes.status });

  // 登录/注册：从后端 Set-Cookie 提取 refresh_token，在 Next.js 响应中重新设置
  if (action === "login" || action === "register") {
    const setCookies = backendRes.headers.getSetCookie();
    for (const c of setCookies) {
      const m = c.match(/refresh_token=([^;]+)/);
      if (m) {
        res.cookies.set("refresh_token", m[1], {
          httpOnly: true,
          secure: IS_PRODUCTION,
          sameSite: "lax",
          path: "/",
          maxAge: REFRESH_COOKIE_MAX_AGE,
        });
      }
    }
  }

  // logout：清除 refresh_token cookie（maxAge=0）
  if (action === "logout") {
    res.cookies.set("refresh_token", "", {
      httpOnly: true,
      secure: IS_PRODUCTION,
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
  }

  return res;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyAuthRequest(req, path);
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyAuthRequest(req, path);
}