"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2 } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { register, isLoading } = useAuthStore();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await register(email, password, username || undefined);
      router.push("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
    }
  };

  return (
    <div className="space-y-8">
      {/* Logo */}
      <div className="flex items-center justify-center gap-3">
        <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
          <Sparkles className="h-5 w-5 text-primary" />
        </div>
        <span className="text-foreground font-bold text-xl">Bid Master</span>
      </div>

      {/* 标题 */}
      <div className="text-center">
        <h1 className="text-2xl font-bold tracking-tight">注册</h1>
        <p className="text-muted-foreground mt-1">创建新用户账号</p>
      </div>

      {/* 表单 */}
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="p-3 rounded-lg bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
        <div>
          <label className="text-sm font-medium mb-1 block">邮箱</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="输入邮箱地址"
            autoComplete="email"
            required
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">密码</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="至少 6 个字符"
            required
            minLength={6}
          />
        </div>
        <div>
          <label className="text-sm font-medium mb-1 block">用户名（可选）</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full px-3 py-2 border border-border rounded-lg bg-background focus:outline-none focus:ring-2 focus:ring-primary/20"
            placeholder="留空则自动生成"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          注册
        </button>
      </form>

      {/* 登录链接 */}
      <p className="text-center text-sm text-muted-foreground">
        已有账号？{" "}
        <a href="/login" className="text-primary hover:underline">
          登录
        </a>
      </p>
    </div>
  );
}
