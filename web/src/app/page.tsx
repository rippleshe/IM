"use client";

import { useEffect, useState } from "react";
import { AuthEntry, type AuthenticatedUser } from "@/components/auth-entry";
import { LearningPathWorkbench } from "@/components/learning-path-workbench";
import { LearningWorkbench } from "@/components/learning-workbench";
import { ResourceWorkbench } from "@/components/resource-workbench";

const API_BASE = "http://localhost:3001";

type LearningView = "path" | "study" | "resources";

export default function LearningApp() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LearningView>("path");

  useEffect(() => {
    let active = true;
    void fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; user?: AuthenticatedUser | null };
        if (active && response.ok && data.success) setUser(data.user ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  if (loading) {
    return <main className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">正在准备学习工作台…</main>;
  }

  if (!user || !user.onboardingCompleted) {
    return <AuthEntry apiBase={API_BASE} user={user} onAuthenticated={setUser} />;
  }

  const sharedProps = {
    apiBase: API_BASE,
    user,
    onLogout: () => setUser(null),
    onNavigate: setView,
  };

  if (view === "study") return <LearningWorkbench {...sharedProps} />;
  if (view === "resources") return <ResourceWorkbench {...sharedProps} />;
  return <LearningPathWorkbench {...sharedProps} />;
}
