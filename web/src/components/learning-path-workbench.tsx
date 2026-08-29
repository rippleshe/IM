"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Lightbulb,
  Loader2,
  LogOut,
  MessageSquareText,
  Network,
  Plus,
  Radio,
  RefreshCw,
  Send,
  Sparkles,
  Trophy,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { AvatarBubble, ProfileDialog } from "@/components/profile-dialog";
import { GuidanceDialog } from "@/components/guidance-dialog";

type PathStatus = "not_started" | "learning" | "completed";
type PathRelation = "prerequisite" | "branch" | "application" | "review";

export type NodeRecommendation = {
  level: "no_evidence" | "reinforce" | "maintain" | "advance";
  reason: string;
  attemptCount: number;
  correctCount: number;
  mastery: number;
};

export type PathNode = {
  id: string;
  knowledgePointId: string;
  title: string;
  description: string;
  userStatus: PathStatus;
  mastered: boolean;
  sortOrder: number;
  recommendation?: NodeRecommendation;
};

export function recommendationView(level: NodeRecommendation["level"]): { label: string; chipClass: string; dotClass: string | null } {
  switch (level) {
    case "reinforce":
      return { label: "建议补强", chipClass: "border-amber-300 bg-amber-50 text-amber-700", dotClass: "bg-amber-500" };
    case "advance":
      return { label: "可进阶", chipClass: "border-emerald-300 bg-emerald-50 text-emerald-700", dotClass: "bg-emerald-500" };
    case "maintain":
      return { label: "保持节奏", chipClass: "border-sky-300 bg-sky-50 text-sky-700", dotClass: null };
    default:
      return { label: "暂无记录", chipClass: "border-border bg-muted/40 text-muted-foreground", dotClass: null };
  }
}

export function RecommendationBadge({ recommendation }: { recommendation: NodeRecommendation }) {
  const view = recommendationView(recommendation.level);
  return <div className="flex items-start gap-2">
    <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-4 ${view.chipClass}`}>{view.label}</span>
    <span className="text-[11px] leading-4 text-muted-foreground">{recommendation.reason}</span>
  </div>;
}

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
  onNavigate?: (view: "path" | "study" | "resources" | "validation") => void;
  onUserChange?: (user: AuthenticatedUser) => void;
};

type LearningDecisionSummary = {
  id: string;
  knowledgePointId: string;
  triggerType: string;
  decision: string;
  recommendedResourceType: string | null;
  recommendationLevel: string;
  rationale: { observations?: string[]; reasons?: string[]; bktBefore?: { pMastery: number; confidence: number }; bktAfter?: { pMastery: number; confidence: number } };
  createdAt: number;
};

const DECISION_LABELS: Record<string, string> = {
  remediate: "建议补强",
  continue: "保持节奏",
  advance: "可进阶",
  collect_more_evidence: "先追问澄清",
};

const TRIGGER_LABELS: Record<string, string> = {
  quiz_attempt: "习题作答",
  asset_feedback: "资源掌握反馈",
  guidance_session: "启发式追问",
};

/** 里程碑 G（路径页小改）：节点建议的“依据”——最近一次持久化学习决策与 BKT 前后值 */
function NodeDecisionBasis({ apiBase, knowledgePointId }: { apiBase: string; knowledgePointId: string }) {
  const [decision, setDecision] = useState<LearningDecisionSummary | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setDecision(null);
    void fetch(`${apiBase}/api/learning/decisions?limit=30`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { decisions?: LearningDecisionSummary[] };
        if (!active) return;
        const match = (data.decisions ?? []).find((item) => item.knowledgePointId === knowledgePointId);
        setDecision(match ?? null);
        setLoaded(true);
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [apiBase, knowledgePointId]);

  if (!loaded || !decision) return null;
  const before = decision.rationale.bktBefore;
  const after = decision.rationale.bktAfter;
  const resourceLabel = decision.recommendedResourceType === "lecture" ? "讲义"
    : decision.recommendedResourceType === "tiered_quiz" ? "分层习题"
    : decision.recommendedResourceType === "review_cards" ? "复习卡片"
    : decision.recommendedResourceType === "challenge_task" ? "挑战任务" : "资源";
  return <div className="mt-3 rounded-xl border bg-muted/20 p-3 text-[11px] leading-4">
    <div className="flex items-center justify-between">
      <span className="font-medium">依据：最近一次{TRIGGER_LABELS[decision.triggerType] ?? "学习反馈"}</span>
      <span className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(decision.createdAt)}</span>
    </div>
    {before && after ? <p className="mt-1.5 text-muted-foreground">掌握概率 {before.pMastery.toFixed(2)} → {after.pMastery.toFixed(2)}，置信度 {before.confidence.toFixed(2)} → {after.confidence.toFixed(2)}</p> : null}
    {decision.rationale.reasons?.length ? <p className="mt-1 text-muted-foreground">{decision.rationale.reasons.join("；")}</p> : null}
    <p className="mt-1">系统决策：<b className="font-semibold">{DECISION_LABELS[decision.decision] ?? decision.decision}</b>{decision.recommendedResourceType ? ` · 建议下一份${resourceLabel}` : ""}</p>
  </div>;
}

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
              <div className="flex items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(node)}`} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{node.title}</span>{node.recommendation && recommendationView(node.recommendation.level).dotClass ? <span aria-label={recommendationView(node.recommendation.level).label} title={recommendationView(node.recommendation.level).label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${recommendationView(node.recommendation.level).dotClass}`} /> : null}<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></div>
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

export function LearningPathWorkbench({ apiBase, user, onLogout, onNavigate, onUserChange }: LearningPathWorkbenchProps) {
  const [path, setPath] = useState<PathGraph>({ nodes: [], edges: [] });
  const [profile, setProfile] = useState<ProfileMetric | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [guidanceOpen, setGuidanceOpen] = useState(false);
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
    fetch(`${apiBase}/api/settings`, { credentials: "include" }).then((response) => setServiceReady(response.ok)).catch(() => setServiceReady(false));
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

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };
  const selectNode = (node: PathNode) => setSelectedNodeId(node.id);

  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => setProfileOpen(true)} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">画像</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">路径</button><button type="button" onClick={() => onNavigate?.("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" onClick={() => onNavigate?.("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button><button type="button" onClick={() => onNavigate?.("validation")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">验证</button></nav>
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
        <div className="flex shrink-0 items-center justify-end border-t bg-background px-4 py-2.5 text-xs">
          <span className={`inline-flex items-center gap-1.5 ${serviceReady ? "text-emerald-600" : "text-amber-600"}`}><Radio className="h-2.5 w-2.5" />{serviceReady ? "服务正常" : "服务未连接"}</span>
        </div>
      </section>

      <aside className="flex min-w-0 flex-col overflow-hidden border-l bg-muted/15" aria-label="知识树学习路径">
        <div className="flex shrink-0 items-center justify-between border-b bg-background px-5 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">我的学习路径</h2></div><span className="text-xs text-muted-foreground">{completedNodes}/{path.nodes.length}</span></div>
        <div className="flex min-h-0 basis-[62%] flex-col p-4 pb-2"><div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex items-center gap-3 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-zinc-300" />未开始</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />学完</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-600" />掌握</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-500" />建议补强</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />可进阶</span></div><span className="text-xs text-muted-foreground">知识树</span></div>{loading ? <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : path.nodes.length === 0 ? <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">尚未建立学习路径</div> : <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={selectNode} />}</div>
        <div className="min-h-0 basis-[38%] overflow-y-auto border-t bg-background p-4">
          {selectedNode ? <div className="mx-auto max-w-2xl"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="text-[10px] text-muted-foreground">当前节点</div><h3 className="mt-1 text-base font-semibold">{selectedNode.title}</h3></div><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${statusDot(selectedNode)}`} /></div>{selectedNode.recommendation ? <div className="mt-3"><RecommendationBadge recommendation={selectedNode.recommendation} /></div> : null}<NodeDecisionBasis apiBase={apiBase} knowledgePointId={selectedNode.knowledgePointId} /><p className="mt-3 text-sm leading-6 text-muted-foreground">{selectedNode.description}</p><div className="mt-4 flex flex-wrap gap-2"><button type="button" onClick={() => carryIntoChat(selectedNode)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted">带入对话</button><button type="button" onClick={() => setGuidanceOpen(true)} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted"><Lightbulb className="h-3.5 w-3.5" />启发式追问</button><button type="button" onClick={() => requestNodeAddition("前置")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />前置</button><button type="button" onClick={() => requestNodeAddition("分支")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />分支</button><button type="button" onClick={() => requestNodeAddition("应用")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs hover:bg-muted"><Plus className="h-3.5 w-3.5" />应用</button></div><div className="mt-3 flex gap-2"><button type="button" disabled={savingNodeId === selectedNode.id} onClick={() => void updateNode(selectedNode, { userStatus: selectedNode.userStatus === "completed" ? "learning" : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50"><Check className="h-3.5 w-3.5" />{selectedNode.userStatus === "completed" ? "继续学习" : "标记学完"}</button><button type="button" disabled={savingNodeId === selectedNode.id} onClick={() => void updateNode(selectedNode, { mastered: !selectedNode.mastered, userStatus: selectedNode.mastered ? selectedNode.userStatus : "completed" })} className={`inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50 ${selectedNode.mastered ? "border-emerald-300 bg-emerald-50 text-emerald-700" : ""}`}><Trophy className="h-3.5 w-3.5" />{selectedNode.mastered ? "取消掌握" : "标记掌握"}</button></div></div> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个节点查看详情</div>}
        </div>
      </aside>
    </div>

    {guidanceOpen && <GuidanceDialog apiBase={apiBase} pathNodeId={selectedNodeId} user={user} onClose={() => setGuidanceOpen(false)} onGenerateResource={(knowledgePointId, resourceType) => {
      try {
        window.localStorage.setItem("im-training-agent:study-prefill", JSON.stringify({
          draft: `围绕知识点「${knowledgePointId}」${resourceType === "challenge_task" ? "生成一份进阶挑战任务" : "生成一份补强讲义"}，针对我刚追问暴露的薄弱处展开。`,
          knowledgePointId, resourceType, createdAt: Date.now(),
        }));
      } catch { /* 存储不可用时仅跳转 */ }
      onNavigate?.("study");
      setGuidanceOpen(false);
    }} />}
    {profileOpen && <ProfileDialog apiBase={apiBase} user={user} onUserChange={onUserChange} extraMetrics={[{ label: '今日新增', value: profile?.todayAssetsCount ?? 0 }, { label: '已学完节点', value: completedNodes }, { label: '已掌握节点', value: masteredNodes }]} onClose={() => setProfileOpen(false)} />}
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
