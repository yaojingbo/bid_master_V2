import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedRoutes = ['/extract', '/simulate', '/statistics', '/database', '/settings'];

export function middleware(request: NextRequest) {
  const refreshToken = request.cookies.get('refresh_token');
  const pathname = request.nextUrl.pathname;

  // 认证页面：已登录用户访问 → 重定向到首页
  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/register');
  if (isAuthRoute && refreshToken) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  // 受保护页面：未登录用户访问 → 重定向到登录页
  const isProtectedRoute = protectedRoutes.some(r => pathname.startsWith(r));
  if (isProtectedRoute && !refreshToken) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'],
};
