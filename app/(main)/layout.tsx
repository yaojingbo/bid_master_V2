"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { useAuthStore } from "@/stores/auth-store";

const protectedRoutes = ["/extract", "/simulate", "/statistics", "/database", "/settings"];

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
    if (initialized.current) return;
    initialized.current = true;
    initAuth();
  }, [initAuth]);

  // initAuth 完成后，若用户未认证且在受保护路由，客户端侧回退重定向
  useEffect(() => {
    if (!authReady) return;
    const isProtected = protectedRoutes.some(r => pathname.startsWith(r));
    if (!isAuthenticated && isProtected) {
      router.replace(`/login?callbackUrl=${encodeURIComponent(pathname)}`);
    }
  }, [authReady, isAuthenticated, pathname, router]);

  // authReady 为 false 时不渲染子页面，避免 accessToken 为 null 导致请求 401
  if (!authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">加载中...</div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-background">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="mx-auto px-8 py-16">
          {children}
        </div>
      </main>
    </div>
  );
}
