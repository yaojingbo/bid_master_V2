/**
 * 通用后端 API 代理路由。
 * 认证、提取、模拟编制和开标分析使用各自专用代理；其余后端接口在这里转发。
 */
import { NextRequest } from "next/server";

export const maxDuration = 300;

const BACKEND = (process.env.BACKEND_URL || (process.env.NODE_ENV === "production"
  ? "https://bidmasterv2-production.up.railway.app"
  : "http://localhost:8000")).replace(/\/$/, "");

const DEDICATED_PROXY_PREFIXES = new Set(["auth", "extract", "simulate", "statistics"]);

async function proxyRequest(request: NextRequest, segments: string[]) {
  const prefix = segments[0];
  if (DEDICATED_PROXY_PREFIXES.has(prefix)) {
    return new Response(JSON.stringify({ detail: "接口由专用代理处理" }), {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
  }

  const path = segments.join("/");
  const url = new URL(`${BACKEND}/api/${path}`);
  request.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.append(key, value);
  });

  const headers: Record<string, string> = {};
  const auth = request.headers.get("Authorization");
  if (auth) headers.Authorization = auth;

  const contentType = request.headers.get("Content-Type");
  if (contentType) headers["Content-Type"] = contentType;

  let body: BodyInit | undefined;
  if (request.method !== "GET" && request.method !== "HEAD") {
    body = await request.arrayBuffer();
  }

  try {
    const backendRes = await fetch(url, {
      method: request.method,
      headers,
      body,
    });

    const responseHeaders = new Headers();
    const backendContentType = backendRes.headers.get("Content-Type");
    if (backendContentType) responseHeaders.set("Content-Type", backendContentType);

    const disposition = backendRes.headers.get("Content-Disposition");
    if (disposition) responseHeaders.set("Content-Disposition", disposition);

    return new Response(backendRes.body, {
      status: backendRes.status,
      headers: responseHeaders,
    });
  } catch {
    return new Response(JSON.stringify({ detail: "后端服务不可用" }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  const { path } = await ctx.params;
  return proxyRequest(req, path);
}
