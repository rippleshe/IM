"use client";

import { useEffect, useState } from "react";
import { AuthEntry, type AuthenticatedUser } from "@/components/auth-entry";
import { DiagnosticFlow } from "@/components/diagnostic-flow";
import { LearningPathWorkbench } from "@/components/learning-path-workbench";
import { LearningWorkbench } from "@/components/learning-workbench";
import { ResourceWorkbench } from "@/components/resource-workbench";
import { ValidationWorkbench } from "@/components/validation-workbench";

const configuredApiBase = process.env.NEXT_PUBLIC_API_BASE;

function resolveApiBase() {
  if (configuredApiBase) return configuredApiBase;
  if (typeof window !== "undefined") return `${window.location.protocol}//${window.location.hostname}:3001`;
  return "http://localhost:3001";
}

type LearningView = "path" | "study" | "resources" | "validation";

export default function LearningApp() {
  const [apiBase] = useState(resolveApiBase);
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LearningView>("path");

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/auth/me`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; user?: AuthenticatedUser | null };
        if (active && response.ok && data.success) setUser(data.user ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, [apiBase]);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在准备学习工作台…</main>;
  }

  if (!user || !user.onboardingCompleted) {
    return <AuthEntry apiBase={apiBase} user={user} onAuthenticated={setUser} />;
  }

  // 建档后强制进入 12 题初始诊断（总规 §4 产品闭环）；演示种子账号已预置诊断结果
  if (!user.diagnosticCompleted) {
    return <DiagnosticFlow apiBase={apiBase} user={user} onFinished={setUser} />;
  }

  const sharedProps = {
    apiBase,
    user,
    onLogout: () => setUser(null),
    onNavigate: setView,
    onUserChange: setUser,
  };

  if (view === "study") return <LearningWorkbench {...sharedProps} />;
  if (view === "resources") return <ResourceWorkbench {...sharedProps} />;
  if (view === "validation") return <ValidationWorkbench {...sharedProps} />;
  return <LearningPathWorkbench {...sharedProps} />;
}
