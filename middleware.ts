import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedRoutes = ['/extract', '/simulate', '/statistics', '/database', '/settings'];
const authDisabled = process.env.NEXT_PUBLIC_AUTH_DISABLED === 'true';

export function middleware(request: NextRequest) {
  if (authDisabled) {
    return NextResponse.next();
  }
  // 仅依赖客户端设置的 auth_status cookie（非 httpOnly）判断登录态。
  // 不使用 refresh_token（httpOnly），因为它可能过期/失效而 middleware 无法验证，
  // 导致已失效的 cookie 将用户困在 /login ↔ / 重定向循环中。
  const authStatus = request.cookies.get('auth_status');
  const isAuthenticated = authStatus?.value === '1';
  const pathname = request.nextUrl.pathname;

  // 认证页面：已登录用户访问 → 重定向到首页
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  if (isAuthRoute && isAuthenticated) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // 受保护页面：未登录用户访问 → 重定向到登录页（带回调 URL）
  const isProtectedRoute = protectedRoutes.some(r => pathname.startsWith(r));
  if (isProtectedRoute && !isAuthenticated) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
