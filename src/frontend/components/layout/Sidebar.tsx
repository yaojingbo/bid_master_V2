'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  FileSearch,
  LayoutDashboard,
  LogOut,
  LogIn,
  UserPlus,
  User,
  ScrollText,
  Settings,
  Terminal,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuthStore } from '@/stores/auth-store';

const navItems = [
  { href: '/', label: '首页', icon: LayoutDashboard },
  { href: '/workbench', label: '功能', icon: FileSearch },
  { href: '/cli', label: 'CLI', icon: Terminal },
  { href: '/settings', label: 'AI 设置', icon: Settings },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, isAuthenticated, isLoading, logout } = useAuthStore();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-8">
        <Link href="/" className="flex min-w-44 flex-col leading-none">
          <span className="text-[22px] font-bold tracking-tight text-primary">Bid Master</span>
        </Link>

        <nav className="flex items-center gap-4">
          {navItems.map(item => {
            const active = pathname === item.href;
            const pending = pendingHref === item.href && !active;
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setPendingHref(item.href)}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition-colors',
                  active
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  pending && 'bg-muted/70 text-foreground'
                )}
                aria-busy={pending}
              >
                <item.icon className={cn('h-4 w-4', pending && 'animate-pulse')} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex min-w-44 items-center justify-end gap-3">
          <Link
            href="/logs"
            title="系统日志"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
              pathname === '/logs' && 'bg-muted text-primary'
            )}
          >
            <ScrollText className="h-4 w-4" />
          </Link>
          {isLoading ? (
            <span className="text-xs text-muted-foreground">加载中...</span>
          ) : isAuthenticated && user ? (
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                <span className="text-sm font-bold text-primary">{user.username[0]}</span>
              </div>
              <span className="max-w-20 truncate text-sm font-medium text-foreground">
                {user.username}
              </span>
              <button
                onClick={logout}
                title="退出登录"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1.5 text-sm text-muted-foreground xl:flex">
                <User className="h-4 w-4" />
                <span>游客</span>
              </div>
              <Link
                href="/login"
                className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <LogIn className="h-4 w-4" />
                登录
              </Link>
              <Link
                href="/register"
                className="inline-flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
              >
                <UserPlus className="h-4 w-4" />
                注册
              </Link>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
