"use client";

import { useState } from "react";
import { Activity, ArrowRight, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface AuthenticatedUser {
  id: string;
  loginName: string;
  displayName: string;
  avatarKey: "graphite" | "ocean" | "violet" | "forest" | "amber" | "rose";
  /** 用户自传头像（缩图 data URL）；null = 用 avatarKey 色块首字母 */
  avatarImage: string | null;
  onboardingCompleted: boolean;
  /** 是否已完成 12 题初始诊断（服务端按诊断会话计算） */
  diagnosticCompleted?: boolean;
}

type AuthEntryProps = {
  apiBase: string;
  user: AuthenticatedUser | null;
  onAuthenticated: (user: AuthenticatedUser) => void;
};

export function AuthEntry({ apiBase, user, onAuthenticated }: AuthEntryProps) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loginName, setLoginName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("在校学习者");
  const [programmingFoundation, setProgrammingFoundation] = useState("刚开始学习");
  const [goal, setGoal] = useState("学习 Python 数据分析，并完成一个设备数据诊断工具");
  const [weeklyHours, setWeeklyHours] = useState("6");
  const [selfDescription, setSelfDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submitCredentials = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginName, displayName, password }),
      });
      const data = await response.json() as { success?: boolean; error?: string; user?: AuthenticatedUser };
      if (!response.ok || !data.success || !data.user) throw new Error(data.error || "暂时无法继续");
      onAuthenticated(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "暂时无法继续");
    } finally {
      setSaving(false);
    }
  };

  const submitOnboarding = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/auth/onboarding`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          role,
          programmingFoundation,
          goal,
          weeklyHours: weeklyHours.trim() ? Number(weeklyHours) : null,
          selfDescription,
        }),
      });
      const data = await response.json() as { success?: boolean; error?: string; user?: AuthenticatedUser };
      if (!response.ok || !data.success || !data.user) throw new Error(data.error || "首次路径生成失败");
      onAuthenticated(data.user);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "首次路径生成失败");
    } finally {
      setSaving(false);
    }
  };

  const onboarding = Boolean(user && !user.onboardingCompleted);
  return (
    <main className="app-entry min-h-screen bg-background px-5 py-10 text-foreground">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-5xl items-center justify-center">
        <div className="auth-frame grid w-full max-w-5xl overflow-hidden rounded-2xl border bg-card shadow-sm md:grid-cols-[0.92fr_1.08fr]">
          <section className="auth-hero flex flex-col border-b bg-muted/35 p-7 md:border-b-0 md:border-r md:p-10">
            <div className="auth-brand flex items-center gap-2.5"><span className="auth-brand-mark" aria-hidden="true"><Activity className="h-4 w-4" /></span><span><strong className="block text-sm font-semibold">智辩无幻</strong><span className="block text-[10px] text-muted-foreground">设备数据诊断训练</span></span></div>
            <div className="auth-hero-copy my-auto max-w-sm">
              <h1 className="text-3xl font-semibold leading-tight tracking-[-0.03em]">从数据理解，走到诊断工具。</h1>
              <p className="mt-4 text-sm leading-7 text-muted-foreground">把真实设备数据拆成一条适合你的学习路径，边学边做，最后完成一次能复查的诊断判断。</p>
              <div className="auth-proof-list mt-8 space-y-3" aria-label="学习空间特点">
                <div><CheckCircle2 className="h-4 w-4" /><span>路径跟着你的基础与作答记录调整</span></div>
                <div><Activity className="h-4 w-4" /><span>讲义、习题、PPT 和知识脉络一次串起来</span></div>
                <div><ShieldCheck className="h-4 w-4" /><span>内容经过依据核对，结论保留可复查边界</span></div>
              </div>
            </div>
            <div className="auth-signal" aria-hidden="true"><span /><span /><span /><span /><span /><span /><span /></div>
          </section>

          <section className="auth-form p-7 md:p-10">
            {onboarding ? (
              <form onSubmit={submitOnboarding} className="space-y-5">
                <div><p className="text-sm font-semibold">先告诉我们你的学习起点</p></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="space-y-1.5 text-xs font-medium">当前身份
                    <select value={role} onChange={(event) => setRole(event.target.value)} className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option>在校学习者</option><option>转岗学习者</option><option>一线运维人员</option><option>培训者</option></select>
                  </label>
                  <label className="space-y-1.5 text-xs font-medium">编程基础
                    <select value={programmingFoundation} onChange={(event) => setProgrammingFoundation(event.target.value)} className="h-9 w-full rounded-lg border bg-background px-2.5 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring/50"><option>刚开始学习</option><option>会基础 Python</option><option>会数据分析</option><option>有项目经验</option></select>
                  </label>
                </div>
                <label className="block space-y-1.5 text-xs font-medium">想完成什么
                  <Input required value={goal} onChange={(event) => setGoal(event.target.value)} className="h-9" />
                </label>
                <label className="block space-y-1.5 text-xs font-medium">每周可投入时间（小时，可不填）
                  <Input inputMode="decimal" value={weeklyHours} onChange={(event) => setWeeklyHours(event.target.value)} className="h-9" />
                </label>
                <label className="block space-y-1.5 text-xs font-medium">还有什么想让系统了解的
                  <Textarea value={selfDescription} onChange={(event) => setSelfDescription(event.target.value)} placeholder="例如：我对代码不太自信，希望先从图表和小数据开始。" className="min-h-24 text-sm" />
                </label>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={saving}>{saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />正在生成第一棵路径</> : <>进入工作台 <ArrowRight className="ml-2 h-4 w-4" /></>}</Button>
              </form>
            ) : (
              <form onSubmit={submitCredentials} className="space-y-5">
                <div className="flex gap-1 rounded-lg bg-muted p-1"><button type="button" onClick={() => { setMode("login"); setError(""); }} className={`flex-1 rounded-md py-2 text-xs ${mode === "login" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>登录</button><button type="button" onClick={() => { setMode("register"); setError(""); }} className={`flex-1 rounded-md py-2 text-xs ${mode === "register" ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}>注册</button></div>
                <div><p className="text-sm font-semibold">{mode === "login" ? "继续你的学习路径" : "创建学习账号"}</p></div>
                <label className="block space-y-1.5 text-xs font-medium">账号
                  <Input required autoComplete="username" value={loginName} onChange={(event) => setLoginName(event.target.value)} placeholder="字母、数字、点或下划线" className="h-9" />
                </label>
                {mode === "register" && <label className="block space-y-1.5 text-xs font-medium">昵称
                  <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="在工作台中显示的名字" className="h-9" />
                </label>}
                <label className="block space-y-1.5 text-xs font-medium">密码
                  <Input required type="password" minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" className="h-9" />
                </label>
                {error && <p className="text-xs text-destructive">{error}</p>}
                <Button type="submit" className="w-full" disabled={saving}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === "login" ? "登录" : "注册并开始"}</Button>
              </form>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
