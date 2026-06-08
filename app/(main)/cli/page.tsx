import { CheckCircle2, Copy, Folder, ShieldCheck, Terminal, Zap } from 'lucide-react';

const benefits = [
  {
    title: '更快',
    desc: '本地快速解析招标文件，直接输出结构化 Markdown 与关键要素。',
    icon: Zap,
  },
  {
    title: '更批量',
    desc: '一行命令处理整个文件夹，批量完成提取、模拟编制和开标分析。',
    icon: Folder,
  },
  {
    title: '更 Agent',
    desc: '天然适配 Claude Code、Codex 等 AI Agent，一行命令即可调用。',
    icon: ShieldCheck,
  },
];

export default function CliPage() {
  return (
    <div className="mx-auto max-w-6xl pb-8">
      <section className="flex min-h-[390px] flex-col items-center justify-center text-center">
        <div className="inline-flex items-center rounded-full border border-primary/25 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary">
          命令行工具
        </div>

        <h1 className="mt-8 text-[64px] font-extrabold leading-none tracking-tight text-foreground">
          <span className="text-primary">Bid</span> Master <span className="text-muted-foreground">CLI</span>
        </h1>

        <p className="mt-8 text-[26px] font-semibold leading-tight tracking-tight text-foreground">
          更快 · 更批量 · 更 Agent
        </p>
        <p className="mt-5 text-lg text-muted-foreground">一行命令处理一个文件夹，本地高性能运行</p>
      </section>

      <section className="grid grid-cols-1 gap-5 md:grid-cols-3">
        {benefits.map(benefit => (
          <div key={benefit.title} className="rounded-2xl border border-border bg-card p-7 shadow-sm">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <benefit.icon className="h-6 w-6" />
            </div>
            <h2 className="text-lg font-bold tracking-tight text-foreground">{benefit.title}</h2>
            <p className="mt-3 text-[15px] leading-7 text-muted-foreground">{benefit.desc}</p>
          </div>
        ))}
      </section>

      <section className="mt-16 flex flex-col items-center text-center">
        <h2 className="text-3xl font-bold tracking-tight text-foreground">立即安装</h2>
        <p className="mt-4 text-base text-muted-foreground">macOS 与 Windows 一行命令</p>

        <div className="mt-3 inline-flex rounded-full bg-muted p-1 text-sm font-medium text-muted-foreground">
          <span className="rounded-full bg-background px-5 py-2 text-foreground shadow-sm">macOS</span>
          <span className="px-5 py-2">Windows</span>
        </div>

        <div className="mt-6 flex w-full max-w-2xl items-center justify-between rounded-2xl border border-primary/20 bg-card px-6 py-5 text-left shadow-[0_18px_70px_rgba(0,128,96,0.12)]">
          <div className="flex min-w-0 items-center gap-4 font-mono text-base text-foreground">
            <span className="text-primary">$</span>
            <span className="truncate">curl -fsSL https://bid-master.local/cli | bash</span>
          </div>
          <button
            type="button"
            className="ml-4 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="复制安装命令"
          >
            <Copy className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-8 grid grid-cols-1 gap-3 text-sm text-muted-foreground sm:grid-cols-3">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            本地处理文件
          </div>
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            批量任务执行
          </div>
          <div className="flex items-center justify-center gap-2">
            <Terminal className="h-4 w-4 text-primary" />
            Agent 友好调用
          </div>
        </div>
      </section>
    </div>
  );
}
