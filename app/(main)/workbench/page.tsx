'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Crown,
  Database,
  FileSearch,
  FileText,
  Home,
  LogIn,
  ScrollText,
  Settings,
  Sparkles,
  Terminal,
  Upload,
} from 'lucide-react';
import { getStats, type DataStats } from '@/lib/data-api';
import { useSettingsStore } from '@/stores/settings-store';

const workspaceNav = [
  {
    title: '招标文件处理',
    items: [
      { href: '/extract', label: '要素提取', icon: FileSearch },
      { href: '/simulate', label: '模拟编制', icon: FileText },
    ],
  },
  {
    title: '开标数据分析',
    items: [{ href: '/statistics', label: '开标分析', icon: BarChart3 }],
  },
  {
    title: '系统工具',
    items: [
      { href: '/database', label: '数据管理', icon: Database },
      { href: '/settings', label: 'AI 设置', icon: Settings },
      { href: '/logs', label: '系统日志', icon: ScrollText },
    ],
  },
];

const actionCards = [
  {
    href: '/extract',
    title: '要素提取',
    desc: '上传 PDF、Word、Excel，提取资质、评分、合同条款',
    icon: Upload,
  },
  {
    href: '/simulate',
    title: '模拟编制',
    desc: '按项目特征生成招标文件，辅助编制与复核',
    icon: FileText,
  },
  {
    href: '/statistics',
    title: '开标分析',
    desc: '解析开标一览表，输出排名与偏差分析报告',
    icon: BookOpen,
  },
];

const emptyStats: DataStats = {
  files: 0,
  simulate_tasks: 0,
  opening_results: 0,
  extract_results: 0,
};

export default function WorkbenchPage() {
  const [stats, setStats] = useState<DataStats>(emptyStats);
  const { activeModel } = useSettingsStore();

  useEffect(() => {
    getStats()
      .then(setStats)
      .catch(() => setStats(emptyStats));
  }, []);

  const generatedReports = stats.simulate_tasks + stats.opening_results + stats.extract_results;

  const recentCards = useMemo(
    () => [
      {
        href: '/database?tab=extracts',
        title: '招标文件要素提取',
        desc: `最近上传 ${stats.extract_results} 份`,
        icon: FileSearch,
      },
      {
        href: '/database?tab=simulates',
        title: '模拟招标文件编制',
        desc: `最近生成 ${stats.simulate_tasks} 份`,
        icon: FileText,
      },
      {
        href: '/database?tab=openings',
        title: '开标报价分析',
        desc: `最近分析 ${stats.opening_results} 次`,
        icon: BarChart3,
      },
    ],
    [stats.extract_results, stats.opening_results, stats.simulate_tasks]
  );

  return (
    <div className="mx-auto flex max-w-none gap-8 px-0">
      <aside className="flex min-h-[calc(100vh-10rem)] w-56 shrink-0 flex-col border-r border-border pr-4">
        <div className="mb-8 px-2">
          <p className="text-xl font-bold tracking-tight text-primary">Bid Master</p>
        </div>

        <nav className="flex-1 space-y-6">
          <Link
            href="/"
            className="flex h-10 items-center gap-2 rounded-2xl bg-primary/10 px-3 text-sm font-semibold text-primary"
          >
            <Home className="h-4 w-4" />
            首页
          </Link>

          {workspaceNav.map(group => (
            <div key={group.title}>
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">{group.title}</p>
              <div className="space-y-1">
                {group.items.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="flex h-10 items-center gap-2 rounded-2xl px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="space-y-4 px-3 pt-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                游
              </div>
              <span className="text-sm font-medium text-foreground">游客</span>
            </div>
            <Settings className="h-4 w-4 text-muted-foreground" />
          </div>
          <Link href="/register" className="flex items-center gap-2 text-sm font-medium text-primary">
            <Crown className="h-4 w-4" />
            注册账号
          </Link>
          <Link href="/login" className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
            <LogIn className="h-4 w-4" />
            退出登录
          </Link>
        </div>
      </aside>

      <main className="min-w-0 flex-1 space-y-6">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">工作台</h1>

        <div className="flex items-center justify-between rounded-2xl border border-primary/20 bg-primary/5 px-5 py-3 text-[13px] text-foreground">
          <div className="flex items-center gap-3">
            <Terminal className="h-4 w-4 text-primary" />
            <span>Bid Master AI 服务已就绪，建议先配置模型后处理正式文件</span>
          </div>
          <Link
            href="/settings"
            className="rounded-full bg-primary px-4 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            立即配置
          </Link>
        </div>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {actionCards.map(card => (
            <Link
              key={card.href}
              href={card.href}
              className="group rounded-2xl border border-border bg-card px-6 py-7 transition-all hover:border-primary/25 hover:shadow-sm"
            >
              <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/10 text-primary transition-colors group-hover:bg-primary/15">
                <card.icon className="h-5 w-5" />
              </div>
              <h2 className="text-base font-semibold text-foreground transition-colors group-hover:text-primary">
                {card.title}
              </h2>
              <p className="mt-1.5 text-[13px] leading-5 text-muted-foreground">{card.desc}</p>
            </Link>
          ))}
        </section>

        <section className="rounded-2xl border border-border bg-card px-6 py-5">
          <div className="mb-6 flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold text-foreground">你的工作概览</h2>
          </div>
          <div className="grid grid-cols-1 divide-y divide-border md:grid-cols-3 md:divide-x md:divide-y-0">
            <Link href="/database?tab=files" className="group py-3 md:py-0 md:pr-8">
              <p className="text-sm text-muted-foreground">已处理文件</p>
              <p className="mt-1 text-[28px] font-bold tracking-tight text-foreground group-hover:text-primary">
                {stats.files}
              </p>
            </Link>
            <Link href="/database?tab=extracts" className="group py-3 md:px-8 md:py-0">
              <p className="text-sm text-muted-foreground">已生成报告</p>
              <p className="mt-1 text-[28px] font-bold tracking-tight text-foreground group-hover:text-primary">
                {generatedReports}
              </p>
            </Link>
            <Link href="/settings" className="group py-3 md:py-0 md:pl-8">
              <p className="text-sm text-muted-foreground">常用模型</p>
              <p className="mt-1 truncate text-[28px] font-bold tracking-tight text-foreground group-hover:text-primary">
                {activeModel || '未配置'}
              </p>
            </Link>
          </div>
        </section>

        <section className="rounded-2xl border border-border bg-card px-6 py-5">
          <div className="mb-5 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-foreground">
              你近期的招投标工作主要聚集在：
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {recentCards.map(card => (
              <Link
                key={card.title}
                href={card.href}
                className="group rounded-2xl border border-border px-5 py-5 transition-colors hover:border-primary/25 hover:bg-muted/30"
              >
                <card.icon className="mb-4 h-5 w-5 text-primary" />
                <p className="text-[15px] font-semibold text-foreground group-hover:text-primary">
                  {card.title}
                </p>
                <p className="mt-2 text-[13px] text-muted-foreground">{card.desc}</p>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
