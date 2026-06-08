"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuthStore } from "@/stores/auth-store";

const protectedRoutes = ["/extract", "/simulate", "/statistics", "/database", "/settings"];
const authDisabled = process.env.NEXT_PUBLIC_AUTH_DISABLED === "true";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { initAuth, authReady, isAuthenticated } = useAuthStore();
  const pathname = usePathname();
  const router = useRouter();
  const initialized = useRef(false);

  useEffect(() => {
    if (authDisabled) return;
    if (initialized.current) return;
    initialized.current = true;
    // authReady 已为 true 说明刚完成 login/register，无需再 initAuth
    // 否则 initAuth 若偶发失败会覆盖 isAuthenticated=false 并清除 cookie，导致导航被重定向
    if (!useAuthStore.getState().authReady) {
      initAuth();
    }
  }, [initAuth]);

  // initAuth 完成后，若用户未认证且在受保护路由，客户端侧回退重定向
  useEffect(() => {
    if (authDisabled) return;
    if (!authReady) return;
    const isProtected = protectedRoutes.some(r => pathname.startsWith(r));
    if (!isAuthenticated && isProtected) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [authReady, isAuthenticated, pathname, router]);

  // authReady 为 false 时不渲染子页面，避免 accessToken 为 null 导致请求 401
  if (!authDisabled && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Sidebar />
      <main>
        <div className="mx-auto px-8 py-16">
          {children}
        </div>
      </main>
    </div>
  );
}
