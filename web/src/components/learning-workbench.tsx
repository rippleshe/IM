"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  Download,
  FilePlus2,
  ListTree,
  LogOut,
  MessageSquarePlus,
  Network,
  Paperclip,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { AvatarBubble, ProfileDialog } from "@/components/profile-dialog";
import { RecommendationBadge, type PathGraph, type PathNode, TreeCanvas } from "@/components/learning-path-workbench";

type ResourceType = "lecture" | "tiered_quiz" | "practice_guide" | "concept_map" | "review_cards" | "challenge_task";
type AgentId = "learning_planning" | "evidence_retrieval" | "domain_expert" | "resource_generation" | "cross_validation" | "privacy_compliance" | "orchestrator";
type StudyAsset = { id: string; title: string; type: ResourceType; auditStatus: string; persisted: boolean };
type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  metadata: { surface?: "study"; pathNodeId?: string | null; resourceType?: ResourceType; asset?: StudyAsset; evidence?: { count: number; score: number; crossValidation: string }; kind?: string; runId?: string; agentId?: string; agentName?: string };
};
type Profile = { summary: string; keywords: string[]; studyMinutes: number; assetsCount: number; accuracy: number | null };

const resourceOptions: Array<{ value: ResourceType; label: string }> = [
  { value: "lecture", label: "讲义" },
  { value: "tiered_quiz", label: "分层习题" },
  { value: "practice_guide", label: "实操指南" },
  { value: "concept_map", label: "知识图谱" },
  { value: "review_cards", label: "复习卡片" },
  { value: "challenge_task", label: "挑战任务" },
];

const selectableAgents: Array<{ id: AgentId; label: string }> = [
  { id: "learning_planning", label: "学情与路径" },
  { id: "evidence_retrieval", label: "知识检索" },
  { id: "domain_expert", label: "领域诊断" },
  { id: "resource_generation", label: "资源生成" },
];

const nodeLabels: Record<string, { name: string; agentId: AgentId }> = {
  "assess.learner": { name: "学情建模", agentId: "learning_planning" },
  "retrieve.structured": { name: "结构化证据检索", agentId: "evidence_retrieval" },
  "retrieve.document": { name: "文档证据检索", agentId: "evidence_retrieval" },
  "analyze.domain": { name: "领域分析", agentId: "domain_expert" },
  "generate.resource": { name: "资源生成", agentId: "resource_generation" },
  "audit.claims": { name: "Claim 逐条审核", agentId: "cross_validation" },
  "debate.challenge": { name: "反方质询", agentId: "cross_validation" },
  "adjudicate.verdict": { name: "证据裁决", agentId: "cross_validation" },
  "privacy.compliance": { name: "隐私合规", agentId: "privacy_compliance" },
  "finalize.publish": { name: "发布收尾", agentId: "orchestrator" },
};

type RunNodeState = "running" | "succeeded" | "failed" | "revising";

function agentTone(id: string | undefined) {
  if (id === "orchestrator") return "bg-zinc-900 text-white";
  if (id === "evidence_retrieval") return "bg-sky-600 text-white";
  if (id === "domain_expert") return "bg-violet-600 text-white";
  if (id === "resource_generation") return "bg-amber-500 text-white";
  if (id === "cross_validation") return "bg-emerald-600 text-white";
  if (id === "privacy_compliance") return "bg-rose-600 text-white";
  return "bg-slate-600 text-white";
}

function resourceLabel(type: ResourceType) {
  return resourceOptions.find((item) => item.value === type)?.label ?? "学习资源";
}

type LearningWorkbenchProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  onNavigate: (view: "path" | "study" | "resources" | "validation") => void;
  onUserChange?: (user: AuthenticatedUser) => void;
};

export function LearningWorkbench({ apiBase, user, onLogout, onNavigate, onUserChange }: LearningWorkbenchProps) {
  const [path, setPath] = useState<PathGraph>({ nodes: [], edges: [] });
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("lecture");
  const [preference, setPreference] = useState<"auto" | "custom">("auto");
  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>(["learning_planning", "evidence_retrieval", "domain_expert", "resource_generation"]);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [studyRunning, setStudyRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [finishedRunId, setFinishedRunId] = useState<string | null>(null);
  const [nodeStates, setNodeStates] = useState<Array<{ key: string; state: RunNodeState }>>([]);
  const [liveSummary, setLiveSummary] = useState("");
  const [notice, setNotice] = useState("");
  const [mentionOpen, setMentionOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(286);
  const [rightWidth, setRightWidth] = useState(362);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    const [pathResponse, messageResponse, profileResponse] = await Promise.all([
      fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/chat?surface=study`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/profile`, { credentials: "include" }),
    ]);
    if (!pathResponse.ok || !messageResponse.ok || !profileResponse.ok) throw new Error("学习空间读取失败，请重新登录后再试");
    const pathData = await pathResponse.json() as { path?: PathGraph };
    const messageData = await messageResponse.json() as { messages?: StudyMessage[]; studyRunning?: boolean };
    const profileData = await profileResponse.json() as { profile?: Profile };
    const nextPath = pathData.path ?? { nodes: [], edges: [] };
    setPath(nextPath);
    setMessages(messageData.messages ?? []);
    setStudyRunning(Boolean(messageData.studyRunning));
    setProfile(profileData.profile ?? null);
    setSelectedNodeId((current) => current && nextPath.nodes.some((item) => item.id === current) ? current : nextPath.nodes[0]?.id ?? null);
    consumeStudyPrefill(nextPath);
  }, [apiBase]);

  // 消费资源页“针对薄弱点生成练习”带来的预填任务：自动填草稿、切资源类型并关联路径节点。
  const consumeStudyPrefill = (graph: PathGraph) => {
    try {
      const raw = window.localStorage.getItem("im-training-agent:study-prefill");
      if (!raw) return;
      window.localStorage.removeItem("im-training-agent:study-prefill");
      const parsed = JSON.parse(raw) as { draft?: unknown; knowledgePointId?: unknown; resourceType?: unknown; createdAt?: unknown };
      if (typeof parsed.draft !== "string" || !parsed.draft.trim()) return;
      if (typeof parsed.createdAt === "number" && Date.now() - parsed.createdAt > 120_000) return;
      setDraft(parsed.draft);
      if (parsed.resourceType === "tiered_quiz" || parsed.resourceType === "lecture" || parsed.resourceType === "practice_guide" || parsed.resourceType === "concept_map" || parsed.resourceType === "review_cards" || parsed.resourceType === "challenge_task") {
        setResourceType(parsed.resourceType);
      }
      if (typeof parsed.knowledgePointId === "string" && parsed.knowledgePointId) {
        const node = graph.nodes.find((item) => item.knowledgePointId === parsed.knowledgePointId);
        if (node) setSelectedNodeId(node.id);
      }
    } catch { /* 预填数据损坏时直接忽略 */ }
  };

  const refreshMessages = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/api/learning/chat?surface=study`, { credentials: "include" });
      const data = await response.json() as { messages?: StudyMessage[] };
      if (!response.ok) return;
      setMessages(data.messages ?? []);
    } catch { /* 刷新失败等下一次 */ }
  }, [apiBase]);

  // SSE 事件流：驱动节点状态条与运行终态；断线由 Last-Event-ID 续传（总规 §4.4）
  const openRunStream = useCallback((runId: string) => {
    setStudyRunning(true);
    setActiveRunId(runId);
    setNodeStates([]);
    setLiveSummary("已受理，等待节点调度…");
    const source = new EventSource(`${apiBase}/api/learning/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
    source.onmessage = () => { /* 具名事件为主；默认消息忽略 */ };
    const handle = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { nodeKey?: string | null; summary?: string };
        const summary = typeof data.summary === "string" ? data.summary : "";
        setLiveSummary(summary);
        const key = data.nodeKey ?? null;
        if (event.type === "node.started" && key) {
          setNodeStates((current) => [...current.filter((item) => item.key !== key), { key, state: "running" }]);
        } else if (event.type === "node.succeeded" && key) {
          setNodeStates((current) => [...current.filter((item) => item.key !== key), { key, state: "succeeded" }]);
        } else if (event.type === "node.failed" && key) {
          setNodeStates((current) => [...current.filter((item) => item.key !== key), { key, state: "failed" }]);
        } else if (event.type === "run.revision") {
          setNodeStates((current) => current.map((item) => item.state === "succeeded" && ["generate.resource", "audit.claims", "debate.challenge", "adjudicate.verdict"].includes(item.key) ? { ...item, state: "revising" as const } : item));
        }
      } catch { /* 单条事件异常忽略 */ }
    };
    for (const type of ["node.started", "node.succeeded", "node.failed", "run.revision", "run.cancelled", "run.succeeded", "run.failed"]) {
      source.addEventListener(type, handle as EventListener);
    }
    const finish = () => {
      source.close();
      setFinishedRunId(runId);
      void refreshMessages().finally(() => {
        setStudyRunning(false);
        setActiveRunId(null);
        setNodeStates([]);
        setLiveSummary("");
      });
    };
    source.addEventListener("run.succeeded", finish);
    source.addEventListener("run.failed", finish);
    source.addEventListener("run.cancelled", finish);
    source.onerror = () => {
      // 连接被永久关闭时兜底：拉一次快照判定终态；否则交给 EventSource 自动重连
      if (source.readyState !== EventSource.CLOSED) return;
      void (async () => {
        try {
          const response = await fetch(`${apiBase}/api/learning/runs/${encodeURIComponent(runId)}`, { credentials: "include" });
          const data = await response.json() as { run?: { status?: string } };
          const status = data.run?.status;
          if (status === "succeeded" || status === "failed" || status === "cancelled") finish();
        } catch { /* 下次交互重试 */ }
      })();
    };
  }, [apiBase, refreshMessages]);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending, studyRunning, nodeStates]);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: MouseEvent) => {
      const viewport = Math.max(1000, window.innerWidth);
      if (resizing === "left") setLeftWidth(Math.max(238, Math.min(420, event.clientX)));
      else setRightWidth(Math.max(300, Math.min(460, viewport - event.clientX)));
    };
    const release = () => setResizing(null);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", release);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", release); };
  }, [resizing]);

  const selectedNode = path.nodes.find((node) => node.id === selectedNodeId) ?? null;

  const addMention = (node: PathNode) => {
    const mention = `@${node.title}`;
    setSelectedNodeId(node.id);
    setDraft((current) => current.includes(mention) ? current : `${current.trim()}${current.trim() ? " " : ""}${mention} `);
    setMentionOpen(false);
  };

  const readAttachment = async (file: File) => {
    const supported = file.type.startsWith("text/") || /\.(md|txt|csv|json)$/i.test(file.name);
    if (!supported) { setNotice("当前临时参考仅支持 MD、TXT、CSV 或 JSON 文件"); return; }
    const content = (await file.text()).slice(0, 120_000);
    setAttachedFile({ name: file.name, content });
    setNotice("");
  };

  const toggleAgent = (agentId: AgentId) => setSelectedAgents((current) => {
    const next = current.includes(agentId) ? current.filter((item) => item !== agentId) : [...current, agentId];
    return next.length >= 3 ? next : current; // 一次运行至少 3 个业务角色（总规 §5.2）
  });

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    if (preference === "custom" && (!selectedAgents.includes("resource_generation") || selectedAgents.length < 3)) {
      setNotice("指定角色模式下至少选择 3 个业务角色，且必须包含资源生成（门禁不可取消）");
      return;
    }
    setSending(true); setNotice(""); setDraft("");
    try {
      const response = await fetch(`${apiBase}/api/learning/runs`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: content, pathNodeId: selectedNodeId, resourceType, collaborationMode: preference, selectedAgentIds: selectedAgents, temporaryReference: attachedFile }),
      });
      const data = await response.json() as { success?: boolean; error?: string; runId?: string };
      if (!response.ok || !data.success || !data.runId) throw new Error(data.error || "学习协同失败");
      setAttachedFile(null);
      await refreshMessages();
      openRunStream(data.runId);
    } catch (error) {
      setDraft(content);
      setNotice(error instanceof Error ? error.message : "学习协同失败");
    } finally { setSending(false); }
  };

  const updateNode = async (node: PathNode, patch: { userStatus?: PathNode["userStatus"]; mastered?: boolean }) => {
    try {
      const response = await fetch(`${apiBase}/api/learning/path-graph/nodes/${node.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json() as { success?: boolean; error?: string; node?: PathNode };
      if (!response.ok || !data.success || !data.node) throw new Error(data.error || "节点状态保存失败");
      setPath((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? data.node as PathNode : item) }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "节点状态保存失败"); }
  };

  const exportAsset = (asset: StudyAsset, format: "md" | "txt" | "json") => window.open(`${apiBase}/api/learning/assets/${encodeURIComponent(asset.id)}/export?format=${format}`, "_blank", "noopener,noreferrer");
  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };

  return <main className={`flex h-screen min-h-0 flex-col overflow-hidden bg-background ${resizing ? "select-none" : ""}`}>
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => setProfileOpen(true)} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">画像</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">学习</button><button type="button" onClick={() => onNavigate("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button><button type="button" onClick={() => onNavigate("validation")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">验证</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="flex min-h-0 min-w-[1000px] flex-1 overflow-hidden">
      <aside style={{ width: leftWidth }} className="flex shrink-0 flex-col border-r bg-card" aria-label="任务上下文">
        <div className="flex shrink-0 items-center justify-between border-b px-4 py-3.5"><div className="flex items-center gap-2"><ListTree className="h-4 w-4" /><h1 className="text-sm font-semibold">任务上下文</h1></div></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          <section aria-label="当前节点"><div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">当前节点</div>{selectedNode ? <div className="mt-2 rounded-xl border p-3"><div className="text-xs font-semibold leading-5">{selectedNode.title}</div><p className="mt-1.5 text-[11px] leading-4 text-muted-foreground">{selectedNode.description}</p>{selectedNode.recommendation ? <div className="mt-2.5"><RecommendationBadge recommendation={selectedNode.recommendation} /></div> : null}<button type="button" onClick={() => addMention(selectedNode)} className="mt-3 inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] hover:bg-muted"><MessageSquarePlus className="h-3 w-3" />@ 引用到输入</button></div> : <div className="mt-2 rounded-xl border border-dashed p-3 text-[11px] leading-4 text-muted-foreground">在右侧路径里选择一个节点，协同将围绕它展开。</div>}</section>
          <section aria-label="学情快照"><div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">学情快照</div><div className="mt-2 grid grid-cols-3 gap-1.5 text-center"><Metric label="正确率" value={profile?.accuracy === null || profile?.accuracy === undefined ? "—" : `${Math.round(profile.accuracy * 100)}%`} /><Metric label="学习分钟" value={profile?.studyMinutes ?? 0} /><Metric label="资产数" value={profile?.assetsCount ?? 0} /></div><p className="mt-2 text-[10px] leading-4 text-muted-foreground">学情与路径智能体会读取这些数据来决定资源粒度。</p></section>
          <section aria-label="本次任务"><div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">本次任务</div><div className="mt-2 space-y-1.5 rounded-xl border p-3 text-[11px] leading-4"><div className="flex justify-between gap-2"><span className="text-muted-foreground">资源类型</span><span className="font-medium">{resourceLabel(resourceType)}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">协同方式</span><span className="text-right font-medium">{preference === "auto" ? "自动编排" : selectedAgents.map((id) => selectableAgents.find((item) => item.id === id)?.label ?? id).join("、") || "未选角色"}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">临时参考</span><span className="max-w-[55%] truncate text-right font-medium">{attachedFile ? attachedFile.name : "无"}</span></div><div className="flex justify-between gap-2"><span className="text-muted-foreground">固定关卡</span><span className="text-right font-medium">交叉验证 · 隐私合规</span></div></div></section>
        </div>
      </aside>
      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("left")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />

      <section className="flex min-w-[390px] flex-1 flex-col bg-card" aria-label="多智能体协同群聊">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><h2 className="text-sm font-semibold">协同群聊</h2></div>
          <span className="text-xs text-muted-foreground">{selectedNode ? `关联：${selectedNode.title}` : "选择路径节点后发起协同"}</span>
        </div>
        <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-3xl space-y-4">
            {loading ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">正在加载协同记录</div> : messages.length === 0 ? <div className="flex min-h-[240px] flex-col items-center justify-center text-center"><Bot className="mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">从一条任务开始群聊协同</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">@ 引用路径节点并说明你要的资料。总控会编排学情、双路检索、领域核对、生成与审核，每个智能体的发言都会逐条冒泡。</p></div> : messages.map((message) => <MessageCard key={message.id} message={message} onExport={exportAsset} />)}
            {(studyRunning || nodeStates.length > 0) && <RunProgressStrip states={nodeStates} summary={liveSummary} />}
            {!studyRunning && finishedRunId && (
              <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-2.5 text-xs">
                <span className="text-muted-foreground">本次协同已结束，产物链与声明图已固化。</span>
                <button type="button" onClick={() => {
                  try { window.localStorage.setItem("im-training-agent:validation-prefill", JSON.stringify({ runId: finishedRunId })); } catch { /* 忽略 */ }
                  onNavigate("validation");
                }} className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted">查看验证记录</button>
              </div>
            )}
            {studyRunning && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />多智能体正在协同处理，发言会逐条出现…</div>}
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-4">
          {notice && <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</div>}
          {attachedFile && <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs"><span className="truncate">临时参考：{attachedFile.name}</span><button type="button" onClick={() => setAttachedFile(null)} aria-label="移除临时参考"><X className="h-3.5 w-3.5" /></button></div>}
          <div className="mx-auto max-w-3xl rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10">
            <textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="输入任务，或 @ 引用路径节点" className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" />
            <div className="flex items-center justify-between gap-2 border-t px-1 pt-2">
              <div className="flex min-w-0 items-center gap-2">
                <input ref={fileInputRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readAttachment(file); event.currentTarget.value = ""; }} />
                <button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border hover:bg-muted" aria-label="添加临时参考文件"><Paperclip className="h-3.5 w-3.5" /></button>
                <div className="relative">
                  <button type="button" onClick={() => setMentionOpen((value) => !value)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm hover:bg-muted" aria-label="引用路径节点">@</button>
                  {mentionOpen && <div className="absolute bottom-10 left-0 z-20 max-h-56 w-56 overflow-y-auto rounded-xl border bg-card p-1 shadow-lg">{path.nodes.map((node) => <button key={node.id} type="button" onClick={() => addMention(node)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-muted">{node.title}</button>)}</div>}
                </div>
                <select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType)} className="h-8 min-w-0 rounded-lg border bg-background px-2 text-xs">{resourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
                <select value={preference} onChange={(event) => setPreference(event.target.value as "auto" | "custom")} className="h-8 min-w-0 rounded-lg border bg-background px-2 text-xs"><option value="auto">自动编排</option><option value="custom">指定角色</option></select>
              </div>
              <button type="button" disabled={!draft.trim() || sending || studyRunning} onClick={() => void send()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35" aria-label="发起协同"><Send className="h-4 w-4" /></button>
            </div>
            {preference === "custom" && <div className="flex flex-wrap gap-1.5 px-1 pt-2">{selectableAgents.map((agent) => <button key={agent.id} type="button" onClick={() => toggleAgent(agent.id)} className={`rounded-full border px-2.5 py-1 text-[11px] ${selectedAgents.includes(agent.id) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{agent.label}</button>)}<span className="self-center text-[10px] text-muted-foreground">检索双实例与审核、隐私为固定角色</span></div>}
          </div>
        </div>
      </section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("right")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: rightWidth }} className="flex shrink-0 flex-col bg-muted/15" aria-label="当前学习路径"><div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">学习路径</h2></div><span className="text-xs text-muted-foreground">{path.nodes.length} 个节点</span></div><div className="min-h-0 basis-[59%] p-3">{path.nodes.length ? <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={(node) => setSelectedNodeId(node.id)} /> : <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">尚未建立学习路径</div>}</div><div className="min-h-0 basis-[41%] overflow-y-auto border-t bg-background p-4">{selectedNode ? <div><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] text-muted-foreground">当前节点</div><h3 className="mt-1 text-sm font-semibold leading-5">{selectedNode.title}</h3></div><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${selectedNode.mastered ? "bg-emerald-600" : selectedNode.userStatus === "completed" ? "bg-blue-600" : selectedNode.userStatus === "learning" ? "bg-amber-500" : "bg-zinc-300"}`} /></div>{selectedNode.recommendation ? <div className="mt-3"><RecommendationBadge recommendation={selectedNode.recommendation} /></div> : null}<p className="mt-3 text-xs leading-5 text-muted-foreground">{selectedNode.description}</p><button type="button" onClick={() => addMention(selectedNode)} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted">@ 引用到输入</button><div className="mt-2 flex gap-2"><button type="button" onClick={() => void updateNode(selectedNode, { userStatus: selectedNode.userStatus === "completed" ? "learning" : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs hover:bg-muted"><Check className="h-3.5 w-3.5" />{selectedNode.userStatus === "completed" ? "继续学习" : "学完"}</button><button type="button" onClick={() => void updateNode(selectedNode, { mastered: !selectedNode.mastered, userStatus: selectedNode.mastered ? selectedNode.userStatus : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs hover:bg-muted">{selectedNode.mastered ? "取消掌握" : "掌握"}</button></div></div> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">选择一个节点</div>}</div></aside>
    </div>

    {profileOpen && <ProfileDialog apiBase={apiBase} user={user} onUserChange={onUserChange} onClose={() => setProfileOpen(false)} />}
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-muted/60 p-2.5"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>;
}

/** SSE 驱动的节点状态条：实时展示 DAG 各节点的执行/门禁状态（总规 §4.4） */
function RunProgressStrip({ states, summary }: { states: Array<{ key: string; state: RunNodeState }>; summary: string }) {
  return <section aria-label="协同运行状态" className="rounded-xl border bg-muted/20 px-3.5 py-3">
    <div className="flex items-center justify-between text-[10px] font-medium uppercase tracking-wide text-muted-foreground"><span>协同运行 · 实时节点状态</span><span>{states.filter((item) => item.state === "succeeded").length} 完成</span></div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {states.map((item) => <span key={item.key} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${item.state === "succeeded" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : item.state === "failed" ? "border-destructive/30 bg-destructive/10 text-destructive" : item.state === "revising" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border bg-background text-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${item.state === "succeeded" ? "bg-emerald-600" : item.state === "failed" ? "bg-destructive" : item.state === "revising" ? "bg-amber-500" : "animate-pulse bg-foreground"}`} />{nodeLabels[item.key]?.name ?? item.key}</span>)}
    </div>
    {summary && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{summary}</p>}
  </section>;
}

function MessageCard({ message, onExport }: { message: StudyMessage; onExport: (asset: StudyAsset, format: "md" | "txt" | "json") => void }) {
  const isUser = message.role === "user";
  const kind = message.metadata.kind;
  const asset = message.metadata.asset;
  if (isUser) {
    return <article className="ml-auto max-w-[84%]"><div className="rounded-2xl rounded-tr-md bg-foreground px-4 py-3 text-sm leading-6 text-background"><p className="whitespace-pre-wrap">{message.content}</p></div><div className="mt-1 text-right text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div></article>;
  }
  if (kind === "asset" && asset) {
    return <article className="max-w-[94%]"><div className="rounded-2xl rounded-tl-md border bg-muted/20 px-4 py-3"><div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Download className="h-3.5 w-3.5" />资源产出</div><AssetCard asset={asset} onExport={onExport} /></div><div className="mt-1 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div></article>;
  }
  const agentId = message.metadata.agentId;
  const agentName = message.metadata.agentName ?? "协同总控 Agent";
  return <article className="max-w-[94%]">
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${agentTone(agentId)}`}>{agentName.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-muted-foreground">{agentName}</div>
        <div className="mt-1 rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm leading-6"><p className="whitespace-pre-wrap">{message.content}</p></div>
      </div>
    </div>
    <div className="mt-1 pl-[42px] text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div>
  </article>;
}

function AssetCard({ asset, onExport }: { asset: StudyAsset; onExport: (asset: StudyAsset, format: "md" | "txt" | "json") => void }) {
  return <div className="rounded-xl border bg-muted/25 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] text-muted-foreground">{resourceLabel(asset.type)}</div><div className="mt-1 text-xs font-semibold">{asset.title}</div></div><span className={`rounded-full px-2 py-1 text-[10px] ${asset.persisted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{asset.persisted ? "已入库" : "待复核"}</span></div>{asset.persisted && <div className="mt-3 flex gap-2"><button type="button" onClick={() => onExport(asset, "md")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载 MD</button><button type="button" onClick={() => onExport(asset, "txt")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">TXT</button><button type="button" onClick={() => onExport(asset, "json")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">JSON</button></div>}</div>;
}
