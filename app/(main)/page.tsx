"use client";

import Link from "next/link";
import { FileSearch, BarChart3, FileText, ArrowRight, Brain, Shield, Zap, LogIn, UserPlus } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

const features = [
  {
    href: "/extract",
    icon: FileSearch,
    title: "要素提取",
    desc: "上传招标文件，AI 自动提取资质要求、评标办法、业绩门槛、定标方法、合同条款等八大关键要素",
  },
  {
    href: "/simulate",
    icon: FileText,
    title: "模拟编制",
    desc: "基于历史项目规律和区域特征，四步引导式生成模拟招标文件，支持多维度对比",
  },
  {
    href: "/statistics",
    icon: BarChart3,
    title: "开标分析",
    desc: "智能解析开标一览表，自动计算报价排名、降价幅度、离散系数，生成分析报告",
  },
];

export default function HomePage() {
  const { isAuthenticated } = useAuthStore();

  return (
    <div className="max-w-5xl mx-auto space-y-16">
      <div className="pt-8">
        <h1 className="text-3xl font-bold text-foreground tracking-tight leading-tight">
          招投标智能分析工具箱
        </h1>
        <p className="text-muted-foreground text-base mt-4 max-w-lg leading-relaxed">
          上传招标文件，AI 自动提取关键要素、模拟编制投标文件、分析开标数据
        </p>
        <div className="flex items-center gap-4 mt-8">
          <Link
            href="/extract"
            className="inline-flex items-center gap-2 h-11 px-6 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            开始使用
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            href="/statistics"
            className="inline-flex items-center text-sm text-primary hover:underline transition-colors"
          >
            了解更多
          </Link>
        </div>

        {!isAuthenticated && (
          <div className="flex items-center gap-3 mt-6">
            <Link
              href="/register"
              className="inline-flex items-center gap-2 h-10 px-5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <UserPlus className="h-4 w-4" />
              注册新账号
            </Link>
            <Link
              href="/login"
              className="inline-flex items-center gap-2 h-10 px-5 border border-border rounded-lg text-sm text-foreground hover:bg-muted transition-colors"
            >
              <LogIn className="h-4 w-4" />
              登录
            </Link>
          </div>
        )}
      </div>

      <div className="grid grid-cols-3 gap-6">
        {[
          { label: "AI 模型", value: "AI大模型+", icon: Brain },
          { label: "文件格式", value: "6 种", icon: Shield },
          { label: "平均响应", value: "~10s", icon: Zap },
        ].map((s) => (
          <div key={s.label} className="flex items-center gap-5 p-6 bg-card rounded-xl border border-border">
            <div className="h-12 w-12 rounded-lg bg-primary/8 flex items-center justify-center shrink-0">
              <s.icon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <p className="text-xl font-bold text-foreground tracking-tight">{s.value}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      <div>
        <h2 className="text-lg font-semibold text-foreground mb-6">核心功能</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {features.map((f) => (
            <Link
              key={f.href}
              href={f.href}
              className="group block p-8 bg-card rounded-xl border border-border hover:border-primary/20 hover:shadow-md transition-all"
            >
              <div className="h-12 w-12 rounded-lg bg-primary/8 flex items-center justify-center mb-5">
                <f.icon className="h-6 w-6 text-primary" />
              </div>
              <h3 className="font-semibold text-foreground mb-3 group-hover:text-primary transition-colors">
                {f.title}
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
