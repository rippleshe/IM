"use client";

import {
  BookOpen,
  CircleUserRound,
  FileCheck2,
  LibraryBig,
  LogOut,
  Route,
  Settings,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { AvatarBubble } from "@/components/profile-dialog";

export type WorkspaceView = "path" | "study" | "resources" | "validation";

type WorkspaceHeaderProps = {
  user: AuthenticatedUser;
  activeView: WorkspaceView;
  onNavigate: (view: WorkspaceView) => void;
  onSettings: () => void;
  onProfile: () => void;
  onLogout: () => void | Promise<void>;
};

const navItems: Array<{ view: WorkspaceView; label: string; icon: typeof Route }> = [
  { view: "path", label: "路径", icon: Route },
  { view: "study", label: "学习", icon: BookOpen },
  { view: "resources", label: "资源", icon: LibraryBig },
  { view: "validation", label: "验证", icon: FileCheck2 },
];

export function WorkspaceHeader({ user, activeView, onNavigate, onSettings, onProfile, onLogout }: WorkspaceHeaderProps) {
  return (
    <header className="workspace-header flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="workspace-identity flex min-w-0 items-center gap-3">
        <AvatarBubble user={user} size="h-9 w-9 text-xs" />
        <div className="workspace-wordmark min-w-0">
          <div className="flex items-center gap-2">
            <span className="block text-sm font-semibold tracking-tight">智辩无幻</span>
            <span className="workspace-brand-tag">诊断学习空间</span>
          </div>
          <span className="workspace-user block text-[11px] text-muted-foreground">{user.displayName}</span>
        </div>
      </div>

      <nav aria-label="学习空间" className="workspace-nav flex min-w-0 items-center rounded-lg border bg-muted/40 p-1">
        <button type="button" onClick={onSettings} aria-label="设置" className="workspace-nav-button" title="设置">
          <Settings className="h-3.5 w-3.5" /><span className="workspace-nav-label">设置</span>
        </button>
        <button type="button" onClick={onProfile} aria-label="画像" className="workspace-nav-button" title="画像">
          <CircleUserRound className="h-3.5 w-3.5" /><span className="workspace-nav-label">画像</span>
        </button>
        {navItems.map(({ view, label, icon: Icon }) => (
          <button key={view} type="button" onClick={() => onNavigate(view)} aria-label={label} aria-current={activeView === view ? "page" : undefined} className={`workspace-nav-button ${activeView === view ? "is-active" : ""}`} title={label}>
            <Icon className="h-3.5 w-3.5" /><span className="workspace-nav-label">{label}</span>
          </button>
        ))}
      </nav>

      <button type="button" onClick={() => void onLogout()} className="workspace-logout inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground" aria-label="退出" title="退出">
        <LogOut className="h-3.5 w-3.5" /><span className="workspace-logout-label">退出</span>
      </button>
    </header>
  );
}
