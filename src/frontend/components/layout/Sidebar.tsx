"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  FileSearch, BarChart3, Database, Settings, FileText, LayoutDashboard, Sparkles, LogOut, LogIn, UserPlus, User,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth-store";

const navItems = [
  { href: "/", label: "首页", icon: LayoutDashboard },
  { href: "/extract", label: "要素提取", icon: FileSearch },
  { href: "/simulate", label: "模拟编制", icon: FileText },
  { href: "/statistics", label: "开标分析", icon: BarChart3 },
  { href: "/database", label: "数据管理", icon: Database },
  { href: "/settings", label: "AI 设置", icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();

  return (
    <aside className="w-56 min-h-screen bg-white border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 h-16 px-5 border-b border-border">
        <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
          <Sparkles className="h-4 w-4 text-primary" />
        </div>
        <span className="text-foreground font-bold text-base">Bid Master</span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-1">
        {navItems.map((item) => {
          const active = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 h-10 px-3 rounded-lg text-sm font-medium transition-colors",
                active
                  ? "bg-primary/8 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              <item.icon className="h-[18px] w-[18px] shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-border">
        {isLoading ? (
          <p className="text-xs text-muted-foreground">加载中...</p>
        ) : isAuthenticated && user ? (
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-sm font-bold text-primary">{user.username[0]}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user.username}</p>
              <p className="text-xs text-muted-foreground">{user.role === "admin" ? "管理员" : "用户"}</p>
            </div>
            <button
              onClick={logout}
              title="退出登录"
              className="p-1 hover:bg-muted rounded"
            >
              <LogOut className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <User className="h-4 w-4" />
              <span>游客</span>
            </div>
            <div className="flex items-center gap-2">
              <Link href="/login" className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded border border-border hover:bg-muted transition-colors">
                <LogIn className="h-3 w-3" />
                登录
              </Link>
              <Link href="/register" className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                <UserPlus className="h-3 w-3" />
                注册
              </Link>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
