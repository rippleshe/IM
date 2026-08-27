"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  LogOut,
  MessageSquareText,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Settings,
  Sparkles,
  Trophy,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";

type PathStatus = "not_started" | "learning" | "completed";
type PathRelation = "prerequisite" | "branch" | "application" | "review";
type AvatarKey = AuthenticatedUser["avatarKey"];

export type PathNode = {
  id: string;
  knowledgePointId: string;
  title: string;
  description: string;
  userStatus: PathStatus;
  mastered: boolean;
  sortOrder: number;
};

export type PathEdge = {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: PathRelation;
};

export type PathGraph = { nodes: PathNode[]; edges: PathEdge[] };

type ProfileMetric = {
  summary: string;
  assetsCount: number;
  todayAssetsCount: number;
  studyMinutes: number;
  accuracy: number | null;
  keywords: string[];
  radar: Array<{ name: string; score: number; reason?: string }>;
};

type Activity = { agentId: string; name: string; action: string };
type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  metadata: { activities?: Activity[]; pathChanged?: boolean };
  createdAt: number;
};

type LearningPathWorkbenchProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  onNavigate?: (view: "path" | "study" | "resources") => void;
};

const avatarStyles: Record<AvatarKey, string> = {
  graphite: "bg-zinc-900 text-white",
  ocean: "bg-sky-600 text-white",
  violet: "bg-violet-600 text-white",
  forest: "bg-emerald-600 text-white",
  amber: "bg-amber-500 text-white",
  rose: "bg-rose-600 text-white",
};

const relationLabels: Record<PathRelation, string> = {
  prerequisite: "前置",
  branch: "分支",
  application: "应用",
  review: "复习",
};

function statusDot(node: PathNode) {
  if (node.mastered) return "bg-emerald-600";
  if (node.userStatus === "completed") return "bg-blue-600";
  if (node.userStatus === "learning") return "bg-amber-500";
  return "bg-zinc-300";
}

function nodeClassName(node: PathNode, selected: boolean) {
  const ring = selected ? "ring-2 ring-foreground/15" : "";
  if (node.mastered) return `border-emerald-300 bg-emerald-50 hover:border-emerald-500 ${ring}`;
  if (node.userStatus === "completed") return `border-blue-300 bg-blue-50/60 hover:border-blue-500 ${ring}`;
  if (node.userStatus === "learning") return `border-amber-300 bg-amber-50/70 hover:border-amber-500 ${ring}`;
  return `border-border bg-card hover:border-foreground/40 ${ring}`;
}

function ProfileRadar({ items }: { items: ProfileMetric["radar"] }) {
  const points = items.slice(0, 5);
  if (points.length < 3) return <div className="rounded-xl border border-dashed px-3 py-7 text-center text-xs text-muted-foreground">积累更多学习证据后生成能力雷达</div>;
  const center = 50;
  const radius = 30;
  const angle = (index: number) => -Math.PI / 2 + (index * Math.PI * 2) / points.length;
  const point = (index: number, scale: number) => `${center + Math.cos(angle(index)) * radius * scale},${center + Math.sin(angle(index)) * radius * scale}`;
  return <div className="flex items-center gap-3">
    <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0" aria-label="学习画像雷达图">
      <polygon points={points.map((_, index) => point(index, 1)).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.7" className="text-border" />
      <polygon points={points.map((_, index) => point(index, 0.5)).join(" ")} fill="none" stroke="currentColor" strokeWidth="0.55" className="text-border" />
      <polygon points={points.map((item, index) => point(index, Math.max(0.08, Math.min(1, item.score)))).join(" ")} fill="currentColor" fillOpacity="0.15" stroke="currentColor" strokeWidth="1.2" className="text-foreground" />
      {points.map((item, index) => <text key={item.name} x={center + Math.cos(angle(index)) * 43} y={center + Math.sin(angle(index)) * 43} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-[4.7px]">{item.name.slice(0, 5)}</text>)}
    </svg>
    <div className="min-w-0 flex-1 space-y-1.5">{points.map((item) => <div className="flex items-center justify-between gap-2 text-[11px]" key={item.name}><span className="truncate text-muted-foreground">{item.name}</span><span className="font-medium">{Math.round(item.score * 100)}%</span></div>)}</div>
  </div>;
}

type TreeLayout = {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
};

function getTreeLayout(graph: PathGraph): TreeLayout {
  const levelById = new Map(graph.nodes.map((node) => [node.id, 0]));
  const validEdges = graph.edges.filter((edge) => levelById.has(edge.fromNodeId) && levelById.has(edge.toNodeId));
  for (let pass = 0; pass < graph.nodes.length; pass += 1) {
    let changed = false;
    for (const edge of validEdges) {
      const next = Math.min((levelById.get(edge.fromNodeId) ?? 0) + 1, 6);
      if (next > (levelById.get(edge.toNodeId) ?? 0)) {
        levelById.set(edge.toNodeId, next);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const columns = new Map<number, PathNode[]>();
  [...graph.nodes].sort((a, b) => a.sortOrder - b.sortOrder).forEach((node) => {
    const level = levelById.get(node.id) ?? 0;
    columns.set(level, [...(columns.get(level) ?? []), node]);
  });
  const nodeWidth = 148;
  const nodeHeight = 56;
  const columnGap = 52;
  const rowGap = 20;
  const maxRows = Math.max(1, ...[...columns.values()].map((items) => items.length));
  const height = Math.max(290, maxRows * (nodeHeight + rowGap) + 34);
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  [...columns.entries()].sort(([a], [b]) => a - b).forEach(([level, items]) => {
    const columnHeight = items.length * nodeHeight + Math.max(0, items.length - 1) * rowGap;
    const startY = Math.max(17, (height - columnHeight) / 2);
    items.forEach((node, index) => positions.set(node.id, { x: 20 + level * (nodeWidth + columnGap), y: startY + index * (nodeHeight + rowGap), width: nodeWidth, height: nodeHeight }));
  });
  return { width: Math.max(650, (Math.max(0, ...columns.keys()) + 1) * (nodeWidth + columnGap) + 20), height, positions };
}

export function TreeCanvas({ graph, selectedNodeId, onSelect }: { graph: PathGraph; selectedNodeId: string | null; onSelect: (node: PathNode) => void }) {
  const layout = useMemo(() => getTreeLayout(graph), [graph]);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [zoom, setZoom] = useState(1);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateFitZoom = () => {
      const availableWidth = Math.max(320, viewport.clientWidth - 16);
      setFitZoom(Math.max(0.5, Math.min(1, Number((availableWidth / layout.width).toFixed(2)))));
    };
    updateFitZoom();
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout.width]);
  useEffect(() => setZoom(fitZoom), [fitZoom]);
  return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
    <div className="flex shrink-0 items-center justify-end gap-1 border-b bg-background px-2 py-1.5">
      <button type="button" onClick={() => setZoom((value) => Math.max(0.5, Number((value - 0.1).toFixed(2))))} aria-label="缩小知识树" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ZoomOut className="h-3.5 w-3.5" /></button>
      <span className="min-w-11 text-center text-[10px] text-muted-foreground">{Math.round(zoom * 100)}%</span>
      <button type="button" onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.1).toFixed(2))))} aria-label="放大知识树" className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ZoomIn className="h-3.5 w-3.5" /></button>
      <button type="button" onClick={() => setZoom(fitZoom)} className="rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-muted hover:text-foreground">适应</button>
    </div>
    <div ref={viewportRef} className="min-h-0 flex-1 overflow-auto">
      <div className="relative shrink-0" style={{ width: layout.width * zoom, height: layout.height * zoom }}>
        <div className="absolute left-0 top-0 origin-top-left" style={{ width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height} aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.fromNodeId);
              const to = layout.positions.get(edge.toNodeId);
              if (!from || !to) return null;
              return <path key={edge.id} d={`M ${from.x + from.width} ${from.y + from.height / 2} C ${from.x + from.width + 30} ${from.y + from.height / 2}, ${to.x - 30} ${to.y + to.height / 2}, ${to.x} ${to.y + to.height / 2}`} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border" />;
            })}
          </svg>
          {[...graph.nodes].sort((a, b) => a.sortOrder - b.sortOrder).map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
            return <button key={node.id} type="button" onClick={() => onSelect(node)} className={`absolute rounded-lg border p-2.5 text-left transition-all ${nodeClassName(node, node.id === selectedNodeId)}`} style={{ left: position.x, top: position.y, width: position.width, height: position.height }}>
              <div className="flex items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(node)}`} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{node.title}</span><ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></div>
            </button>;
          })}
        </div>
      </div>
    </div>
  </div>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-muted/60 p-2.5"><div className="text-muted-foreground">{label}</div><div className="mt-1 text-base font-semibold">{value}</div></div>;
}

type ThinkingDepth = "low" | "medium" | "high" | "max";
type PathAgentRoute = { modelId: string; thinkingDepth: "inherit" | ThinkingDepth };
type PathRuntimeSettings = {
  activeModel: string;
  defaultThinkingDepth: ThinkingDepth;
  providers: Array<{ id: string; displayName: string; baseURL: string; apiKeyConfigured: boolean; models: Array<{ id: string; displayName: string }> }>;
  models: Array<{ id: string; displayName: string; provider: string; providerDisplayName: string }>;
  agentRouting: Record<string, PathAgentRoute>;
  autoAssetTypes: Array<"lecture" | "tiered_quiz" | "concept_map">;
};

const pathAgentLabels = [
  ["learning_planning", "学情与路径"],
  ["evidence_retrieval", "知识检索"],
  ["domain_expert", "领域诊断"],
  ["resource_generation", "资源生成"],
  ["cross_validation", "交叉验证"],
  ["privacy_compliance", "合规审计"],
] as const;

function PathSettingsDialog({ apiBase, onClose }: { apiBase: string; onClose: () => void }) {
  const [tab, setTab] = useState<"models" | "agents" | "assets" | "privacy">("models");
  const [settings, setSettings] = useState<PathRuntimeSettings | null>(null);
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [providerForm, setProviderForm] = useState({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
  const [saving, setSaving] = useState(false);

  const loadSettings = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/settings`);
      const data = await response.json() as PathRuntimeSettings & { success?: boolean };
      if (!response.ok || !data.success) throw new Error("设置读取失败");
      setSettings(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "设置读取失败");
    }
  }, [apiBase]);

  useEffect(() => { void loadSettings(); }, [loadSettings]);

  const saveDefault = async (patch: Partial<Pick<PathRuntimeSettings, "activeModel" | "defaultThinkingDepth">>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/default-execution`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ modelId: next.activeModel, thinkingDepth: next.defaultThinkingDepth }) });
      const data = await response.json() as PathRuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "默认设置保存失败");
      setSettings(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "默认设置保存失败");
      await loadSettings();
    } finally { setSaving(false); }
  };

  const saveProvider = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/providers`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(providerForm) });
      const data = await response.json() as PathRuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "模型服务保存失败");
      setSettings(data);
      setProviderOpen(false);
      setProviderForm({ id: "", displayName: "", baseURL: "", apiKey: "", modelId: "", modelDisplayName: "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "模型服务保存失败"); }
    finally { setSaving(false); }
  };

  const saveAgentRoute = async (agentId: string, patch: Partial<PathAgentRoute>) => {
    if (!settings) return;
    const agentRouting = { ...settings.agentRouting, [agentId]: { modelId: settings.agentRouting[agentId]?.modelId ?? "", thinkingDepth: settings.agentRouting[agentId]?.thinkingDepth ?? "inherit", ...patch } };
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/settings/agent-routing`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agentRouting }) });
      const data = await response.json() as PathRuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "协同设置保存失败");
      setSettings(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "协同设置保存失败"); await loadSettings(); }
    finally { setSaving(false); }
  };

  const toggleAsset = async (type: "lecture" | "tiered_quiz" | "concept_map") => {
    if (!settings) return;
    const next = settings.autoAssetTypes.includes(type) ? settings.autoAssetTypes.filter((item) => item !== type) : [...settings.autoAssetTypes, type];
    if (next.length === 0) return;
    setSaving(true);
    try {
      const response = await fetch(`${apiBase}/api/settings/asset-policy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoAssetTypes: next }) });
      const data = await response.json() as PathRuntimeSettings & { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "资产设置保存失败");
      setSettings(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "资产设置保存失败"); }
    finally { setSaving(false); }
  };

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4" role="dialog" aria-modal="true" aria-label="设置">
    <section className="max-h-[calc(100vh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl">
      <div className="flex items-center justify-between"><h2 className="text-sm font-semibold">设置</h2><button type="button" onClick={onClose} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">关闭</button></div>
      <div className="mt-4 grid grid-cols-4 rounded-lg bg-muted/70 p-1 text-xs">{([["models", "模型服务"], ["agents", "协同编排"], ["assets", "学习资产"], ["privacy", "数据隐私"]] as const).map(([key, label]) => <button key={key} type="button" onClick={() => { setTab(key); setError(""); }} className={`rounded-md px-2 py-2 ${tab === key ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
      {error && <div className="mt-3 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{error}</div>}
      <div className="mt-4 min-h-[300px]">
        {tab === "models" && <div className="space-y-3"><div className="rounded-xl border p-3"><div className="flex items-center justify-between gap-3"><span className="text-xs font-medium">默认执行</span><span className="text-[10px] text-muted-foreground">路径与资源生成共用</span></div><div className="mt-3 grid grid-cols-[minmax(0,1fr)_100px] gap-2"><select value={settings?.activeModel ?? ""} disabled={saving || !settings?.models.length} onChange={(event) => void saveDefault({ activeModel: event.target.value })} className="h-9 min-w-0 rounded-lg border bg-background px-2 text-xs"><option value="">请选择模型</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select><select value={settings?.defaultThinkingDepth ?? "medium"} disabled={saving || !settings} onChange={(event) => void saveDefault({ defaultThinkingDepth: event.target.value as ThinkingDepth })} className="h-9 rounded-lg border bg-background px-2 text-xs"><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select></div></div><div className="rounded-xl border p-3"><div className="flex items-center justify-between"><span className="text-xs font-medium">已配置服务</span><button type="button" onClick={() => setProviderOpen((value) => !value)} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">添加服务</button></div><div className="mt-3 space-y-2">{settings?.providers.map((provider) => <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 px-3 py-2.5"><div className="min-w-0"><div className="truncate text-xs font-medium">{provider.displayName}</div><div className="mt-1 truncate text-[10px] text-muted-foreground">{provider.models.map((model) => model.displayName).join("、") || "未添加模型"}</div></div><span className={`shrink-0 text-[10px] ${provider.apiKeyConfigured ? "text-emerald-600" : "text-muted-foreground"}`}>{provider.apiKeyConfigured ? "已连接" : "未配置"}</span></div>)}</div>{providerOpen && <div className="mt-3 grid grid-cols-2 gap-2 border-t pt-3"><input value={providerForm.displayName} onChange={(event) => setProviderForm((form) => ({ ...form, displayName: event.target.value }))} placeholder="服务名称" className="h-8 rounded-md border bg-background px-2 text-xs" /><input value={providerForm.id} onChange={(event) => setProviderForm((form) => ({ ...form, id: event.target.value }))} placeholder="服务 ID" className="h-8 rounded-md border bg-background px-2 text-xs" /><input value={providerForm.baseURL} onChange={(event) => setProviderForm((form) => ({ ...form, baseURL: event.target.value }))} placeholder="接口地址 https://…" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" /><input type="password" value={providerForm.apiKey} onChange={(event) => setProviderForm((form) => ({ ...form, apiKey: event.target.value }))} placeholder="API Key" className="col-span-2 h-8 rounded-md border bg-background px-2 text-xs" /><input value={providerForm.modelId} onChange={(event) => setProviderForm((form) => ({ ...form, modelId: event.target.value }))} placeholder="模型 ID" className="h-8 rounded-md border bg-background px-2 text-xs" /><input value={providerForm.modelDisplayName} onChange={(event) => setProviderForm((form) => ({ ...form, modelDisplayName: event.target.value }))} placeholder="模型显示名" className="h-8 rounded-md border bg-background px-2 text-xs" /><button type="button" disabled={saving} onClick={() => void saveProvider()} className="col-span-2 h-8 rounded-md bg-foreground text-xs text-background disabled:opacity-50">{saving ? "保存中…" : "保存服务"}</button></div>}</div></div>}
        {tab === "agents" && <div className="divide-y rounded-xl border">{pathAgentLabels.map(([id, label]) => { const route = settings?.agentRouting[id] ?? { modelId: "", thinkingDepth: "inherit" as const }; return <div key={id} className="grid grid-cols-[minmax(0,1fr)_150px_95px] items-center gap-3 px-3 py-3"><span className="text-xs font-medium">{label}</span><select value={route.modelId} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { modelId: event.target.value })} className="h-8 min-w-0 rounded-md border bg-background px-2 text-xs"><option value="">继承默认模型</option>{settings?.models.map((model) => <option key={model.id} value={model.id}>{model.displayName}</option>)}</select><select value={route.thinkingDepth} disabled={saving || !settings} onChange={(event) => void saveAgentRoute(id, { thinkingDepth: event.target.value as PathAgentRoute["thinkingDepth"] })} className="h-8 rounded-md border bg-background px-2 text-xs"><option value="inherit">继承默认</option><option value="low">low</option><option value="medium">medium</option><option value="high">high</option><option value="max">max</option></select></div>; })}</div>}
        {tab === "assets" && <div className="grid grid-cols-3 gap-2">{([["lecture", "讲义"], ["tiered_quiz", "分层习题"], ["concept_map", "知识图谱"]] as const).map(([type, label]) => { const enabled = settings?.autoAssetTypes.includes(type) ?? false; return <button key={type} type="button" disabled={saving || !settings} onClick={() => void toggleAsset(type)} className={`rounded-xl border p-4 text-left ${enabled ? "border-foreground bg-muted/60" : "hover:bg-muted/40"}`}><div className="text-xs font-medium">{label}</div><div className="mt-2 text-[11px] text-muted-foreground">{enabled ? "自动生成" : "关闭"}</div></button>; })}</div>}
        {tab === "privacy" && <div className="divide-y rounded-xl border text-xs"><div className="flex items-center justify-between px-3 py-3"><span>学习记录</span><span className="text-muted-foreground">本地 SQLite</span></div><div className="flex items-center justify-between px-3 py-3"><span>上传资料原文</span><span className="text-muted-foreground">任务结束后不保存</span></div><div className="flex items-center justify-between px-3 py-3"><span>公共知识库写入</span><span className="text-muted-foreground">仅审核后的固定资料</span></div></div>}
      </div>
    </section>
  </div>;
}

export function LearningPathWorkbench({ apiBase, user, onLogout, onNavigate }: LearningPathWorkbenchProps) {
  const [path, setPath] = useState<PathGraph>({ nodes: [], edges: [] });
  const [profile, setProfile] = useState<ProfileMetric | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [activeAvatar, setActiveAvatar] = useState<AvatarKey>(user.avatarKey);
  const [regeneratingProfile, setRegeneratingProfile] = useState(false);
  const [openActivityId, setOpenActivityId] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [serviceReady, setServiceReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const loadWorkbench = useCallback(async () => {
    const [pathResponse, profileResponse, chatResponse] = await Promise.all([
      fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/profile`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/chat`, { credentials: "include" }),
    ]);
    if (!pathResponse.ok || !profileResponse.ok || !chatResponse.ok) throw new Error("学习路径读取失败，请重新登录后再试");
    const pathData = await pathResponse.json() as { path?: PathGraph };
    const profileData = await profileResponse.json() as { profile?: ProfileMetric };
    const chatData = await chatResponse.json() as { messages?: ChatMessage[] };
    const nextPath = pathData.path ?? { nodes: [], edges: [] };
    setPath(nextPath);
    setProfile(profileData.profile ?? null);
    setMessages(chatData.messages ?? []);
    setSelectedNodeId((current) => current && nextPath.nodes.some((node) => node.id === current) ? current : nextPath.nodes[0]?.id ?? null);
  }, [apiBase]);

  useEffect(() => {
    let alive = true;
    void loadWorkbench().catch((error) => { if (alive) setNotice(error instanceof Error ? error.message : "学习路径读取失败"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [loadWorkbench]);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);

  useEffect(() => {
    fetch(`${apiBase}/api/settings`).then((response) => setServiceReady(response.ok)).catch(() => setServiceReady(false));
  }, [apiBase]);

  const selectedNode = path.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const completedNodes = path.nodes.filter((node) => node.userStatus === "completed").length;
  const masteredNodes = path.nodes.filter((node) => node.mastered).length;

  const carryIntoChat = (node: PathNode) => {
    const mention = `@${node.title}`;
    setSelectedNodeId(node.id);
    setDraft((current) => current.includes(mention) ? current : `${mention}${current.trim() ? " " : ""}${current}`);
  };

  const requestNodeAddition = (kind: string) => {
    if (!selectedNode) return;
    setDraft(`@${selectedNode.title} 请添加一个${kind}节点：`);
  };

  const updateNode = async (node: PathNode, patch: Partial<Pick<PathNode, "userStatus" | "mastered">>) => {
    setSavingNodeId(node.id);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/path-graph/nodes/${node.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json() as { success?: boolean; error?: string; node?: PathNode };
      if (!response.ok || !data.success || !data.node) throw new Error(data.error || "节点状态保存失败");
      setPath((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? data.node as PathNode : item) }));
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "节点状态保存失败");
    } finally {
      setSavingNodeId(null);
    }
  };

  const sendMessage = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    setNotice("");
    const temporaryUser: ChatMessage = { id: `local-${Date.now()}`, role: "user", content, metadata: {}, createdAt: Date.now() };
    setMessages((current) => [...current, temporaryUser]);
    try {
      const response = await fetch(`${apiBase}/api/learning/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content }) });
      const data = await response.json() as { success?: boolean; error?: string; userMessage?: ChatMessage; assistantMessage?: ChatMessage; path?: PathGraph; profile?: ProfileMetric | null };
      if (!response.ok || !data.success || !data.userMessage || !data.assistantMessage) throw new Error(data.error || "路径协同失败");
      setMessages((current) => [...current.filter((item) => item.id !== temporaryUser.id), data.userMessage as ChatMessage, data.assistantMessage as ChatMessage]);
      if (data.path) setPath(data.path);
      if (data.profile) setProfile(data.profile);
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== temporaryUser.id));
      setDraft(content);
      setNotice(error instanceof Error ? error.message : "路径协同失败");
    } finally {
      setSending(false);
    }
  };

  const saveAvatar = async (avatarKey: AvatarKey) => {
    setActiveAvatar(avatarKey);
    try {
      const response = await fetch(`${apiBase}/api/auth/avatar`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ avatarKey }) });
      if (!response.ok) throw new Error("头像保存失败");
    } catch (error) {
      setActiveAvatar(user.avatarKey);
      setNotice(error instanceof Error ? error.message : "头像保存失败");
    }
  };

  const regenerateProfile = async () => {
    setRegeneratingProfile(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/profile/regenerate`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await response.json() as { success?: boolean; error?: string; profile?: ProfileMetric };
      if (!response.ok || !data.success || !data.profile) throw new Error(data.error || "画像生成失败");
      setProfile(data.profile);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "画像生成失败");
    } finally {
      setRegeneratingProfile(false);
    }
  };

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };
  const selectNode = (node: PathNode) => setSelectedNodeId(node.id);

  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <button type="button" onClick={() => setProfileOpen(true)} className="flex min-w-0 items-center gap-2.5 text-left" aria-label="打开学习画像"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarStyles[activeAvatar]}`}>{user.displayName.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName} · 学习画像</span></span></button>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">路径</button><button type="button" onClick={() => onNavigate?.("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" onClick={() => onNavigate?.("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="grid min-h-0 flex-1 grid-cols-[minmax(360px,40%)_minmax(0,1fr)] overflow-hidden">
      <section className="flex min-w-0 flex-col bg-card" aria-label="路径调整对话与多智能体协同过程">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5 sm:px-6"><div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /><h1 className="text-sm font-semibold">路径调整</h1></div></div>
        <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="mx-auto max-w-2xl space-y-5">
            {loading ? <div className="flex min-h-[250px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在加载路径对话</div> : messages.length === 0 ? null : messages.map((chat) => <article key={chat.id} className={chat.role === "user" ? "ml-auto max-w-[84%]" : "max-w-[94%]"}><div className={chat.role === "user" ? "rounded-2xl rounded-tr-md bg-foreground px-4 py-3 text-sm leading-6 text-background" : "rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm leading-6"}>{chat.role === "assistant" && <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Bot className="h-3.5 w-3.5" />路径协同</div>}<p className="whitespace-pre-wrap">{chat.content}</p></div>{chat.role === "assistant" && (chat.metadata.activities?.length || chat.metadata.pathChanged) ? <div className="mt-2"><button type="button" onClick={() => setOpenActivityId((current) => current === chat.id ? null : chat.id)} className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"><ChevronDown className={`h-3.5 w-3.5 transition-transform ${openActivityId === chat.id ? "rotate-180" : ""}`} />协同过程{chat.metadata.pathChanged ? " · 路径已更新" : ""}</button>{openActivityId === chat.id && <div className="mt-2 rounded-xl border bg-muted/25 p-3 text-xs text-muted-foreground">{chat.metadata.activities?.map((activity) => <div className="flex gap-2 py-1.5" key={`${chat.id}-${activity.agentId}`}><span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" /><span><b className="font-medium text-foreground">{activity.name}</b>：{activity.action}</span></div>)}</div>}</div> : null}<div className={`mt-1 text-[10px] text-muted-foreground ${chat.role === "user" ? "text-right" : ""}`}>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(chat.createdAt)}</div></article>)}
            {sending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />智能体正在协同处理</div>}
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-4 sm:px-6">{notice && <div className="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</div>}<div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={2} placeholder="输入想如何调整路径" className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" /><button type="button" disabled={!draft.trim() || sending} onClick={() => void sendMessage()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35"><Send className="h-4 w-4" /></button></div></div>
        <div className="flex shrink-0 items-center justify-between border-t bg-background px-4 py-2.5 text-xs">
          <button type="button" onClick={() => setSettingsOpen(true)} className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"><Settings className="h-3.5 w-3.5" />设置</button>
          <span className={`inline-flex items-center gap-1.5 ${serviceReady ? "text-emerald-600" : "text-amber-600"}`}><Radio className="h-2.5 w-2.5" />{serviceReady ? "服务正常" : "服务未连接"}</span>
        </div>
      </section>

      <aside className="flex min-w-0 flex-col overflow-hidden border-l bg-muted/15" aria-label="知识树学习路径">
        <div className="flex shrink-0 items-center justify-between border-b bg-background px-5 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">我的学习路径</h2></div><span className="text-xs text-muted-foreground">{completedNodes}/{path.nodes.length}</span></div>
        <div className="flex min-h-0 basis-[62%] flex-col p-4 pb-2"><div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-zinc-300" />未开始</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />学完</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-600" />掌握</span></div><span className="text-xs text-muted-foreground">知识树</span></div>{loading ? <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : path.nodes.length === 0 ? <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">尚未建立学习路径</div> : <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={selectNode} />}</div>
        <div className="min-h-0 basis-[38%] overflow-y-auto border-t bg-background p-4">
          {selectedNode ? <div className="mx-auto max-w-2xl"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[10px] text-muted-foreground">当前节点</div><h3 className="mt-1 text-base font-semibold">{selectedNode.title}</h3></div><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(selectedNode)}`} /></div><p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedNode.description}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => carryIntoChat(selectedNode)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted">带入对话</button><button type="button" onClick={() => requestNodeAddition("前置")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />前置</button><button type="button" onClick={() => requestNodeAddition("分支")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />分支</button><button type="button" onClick={() => requestNodeAddition("应用")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />应用</button></div><div className="mt-3 flex gap-2"><button type="button" disabled={savingNodeId === selectedNode.id} onClick={() => void updateNode(selectedNode, { userStatus: selectedNode.userStatus === "completed" ? "learning" : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50"><Check className="h-3.5 w-3.5" />{selectedNode.userStatus === "completed" ? "继续学习" : "标记学完"}</button><button type="button" disabled={savingNodeId === selectedNode.id} onClick={() => void updateNode(selectedNode, { mastered: !selectedNode.mastered, userStatus: selectedNode.mastered ? selectedNode.userStatus : "completed" })} className={`inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50 ${selectedNode.mastered ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}`}><Trophy className="h-3.5 w-3.5" />{selectedNode.mastered ? "取消掌握" : "标记掌握"}</button></div></div> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个节点查看详情</div>}
        </div>
      </aside>
    </div>

    {profileOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4" role="dialog" aria-modal="true" aria-label="学习画像"><section className="max-h-[calc(100vh-2rem)] w-full max-w-lg overflow-y-auto rounded-2xl border bg-card p-5 shadow-xl"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4" />学习画像</div><button type="button" onClick={() => setProfileOpen(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">关闭</button></div><div className="mt-5 flex items-center gap-3"><span className={`flex h-12 w-12 items-center justify-center rounded-full text-sm font-semibold ${avatarStyles[activeAvatar]}`}>{user.displayName.slice(0, 1).toUpperCase()}</span><div><div className="text-sm font-semibold">{user.displayName}</div><div className="text-xs text-muted-foreground">@{user.loginName}</div></div></div><div className="mt-4 flex items-center gap-2"><span className="text-xs text-muted-foreground">头像</span>{(Object.keys(avatarStyles) as AvatarKey[]).map((avatar) => <button key={avatar} type="button" onClick={() => void saveAvatar(avatar)} aria-label={`设置${avatar}头像`} className={`h-6 w-6 rounded-full ${avatarStyles[avatar]} ${activeAvatar === avatar ? "ring-2 ring-offset-2 ring-foreground" : ""}`} />)}</div><p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm leading-6">{profile?.summary || "首次路径已建立；你的后续学习记录会持续完善画像。"}</p><div className="mt-4 flex flex-wrap gap-1.5">{profile?.keywords?.map((keyword) => <span key={keyword} className="rounded-full border px-2.5 py-1 text-[11px]">{keyword}</span>)}</div><div className="mt-5"><ProfileRadar items={profile?.radar ?? []} /></div><div className="mt-5 grid grid-cols-3 gap-2 text-xs"><Metric label="学习时间" value={`${profile?.studyMinutes ?? 0} 分`} /><Metric label="学习资产" value={profile?.assetsCount ?? 0} /><Metric label="今日新增" value={profile?.todayAssetsCount ?? 0} /><Metric label="正确率" value={profile?.accuracy === null || profile?.accuracy === undefined ? "—" : `${Math.round(profile.accuracy * 100)}%`} /><Metric label="已学完节点" value={completedNodes} /><Metric label="已掌握节点" value={masteredNodes} /></div><button type="button" onClick={() => void regenerateProfile()} disabled={regeneratingProfile} className="mt-5 inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-60">{regeneratingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}重新生成画像</button></section></div>}
    {settingsOpen && <PathSettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
