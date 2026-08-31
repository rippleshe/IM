"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Download,
  FilePlus2,
  ListTree,
  LogOut,
  MessageSquarePlus,
  Network,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { AvatarBubble, ProfileDialog } from "@/components/profile-dialog";
import { PathNodeDetails, RecommendationBadge, type PathGraph, type PathNode, TreeCanvas } from "@/components/learning-path-workbench";
import { RichText, DescriptionList } from "@/components/rich-text";

type ResourceType = "lecture" | "tiered_quiz" | "presentation" | "concept_map";
type AgentId = "learning_planning" | "evidence_retrieval" | "domain_expert" | "resource_generation" | "cross_validation" | "privacy_compliance" | "orchestrator";
type StudyAsset = { id: string; title: string; type: ResourceType; auditStatus: string; persisted: boolean };
type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  metadata: { surface?: "study"; pathNodeId?: string | null; resourceType?: ResourceType; asset?: StudyAsset; evidence?: { count: number; score: number; crossValidation: string }; kind?: string; runId?: string; agentId?: string; agentName?: string };
};

const resourceOptions: Array<{ value: ResourceType; label: string }> = [
  { value: "lecture", label: "讲义" },
  { value: "tiered_quiz", label: "分层习题" },
  { value: "presentation", label: "PPT" },
  { value: "concept_map", label: "知识脉络" },
];

const nodeLabels: Record<string, { name: string; agentId: AgentId }> = {
  "assess.learner": { name: "分析画像", agentId: "learning_planning" },
  "retrieve.structured": { name: "查找数据依据", agentId: "evidence_retrieval" },
  "retrieve.document": { name: "查找资料依据", agentId: "evidence_retrieval" },
  "analyze.domain": { name: "分析专业内容", agentId: "domain_expert" },
  "generate.resource": { name: "制作学习材料", agentId: "resource_generation" },
  "audit.claims": { name: "逐条检查内容", agentId: "cross_validation" },
  "debate.challenge": { name: "复核疑点", agentId: "cross_validation" },
  "adjudicate.verdict": { name: "判断证据是否足够", agentId: "cross_validation" },
  "privacy.compliance": { name: "隐私检查", agentId: "privacy_compliance" },
  "finalize.publish": { name: "整理并保存结果", agentId: "orchestrator" },
};

type RunNodeState = "running" | "succeeded" | "failed" | "revising";

function agentTone(id: string | undefined) {
  if (id === "orchestrator") return "bg-slate-100 text-slate-700";
  if (id === "evidence_retrieval") return "bg-sky-100 text-sky-700";
  if (id === "domain_expert") return "bg-violet-100 text-violet-700";
  if (id === "resource_generation") return "bg-amber-100 text-amber-700";
  if (id === "cross_validation") return "bg-emerald-100 text-emerald-700";
  if (id === "privacy_compliance") return "bg-rose-100 text-rose-700";
  return "bg-slate-100 text-slate-700";
}

function resourceLabel(type: ResourceType) {
  return resourceOptions.find((item) => item.value === type)?.label ?? "学习资源";
}

function readableProcessText(text: string): string {
  return text
    .replace(/学情与路径智能体/g, "学习规划助手")
    .replace(/知识检索智能体/g, "资料检索助手")
    .replace(/领域诊断智能体/g, "专业分析助手")
    .replace(/资源生成智能体/g, "学习材料助手")
    .replace(/交叉验证与审核智能体|交叉验证智能体/g, "内容检查助手")
    .replace(/合规与隐私智能体/g, "隐私保护助手")
    .replace(/结构化证据检索/g, "查找数据依据")
    .replace(/文档证据检索/g, "查找资料依据")
    .replace(/学情建模/g, "分析画像")
    .replace(/领域分析/g, "分析专业内容")
    .replace(/资源生成/g, "制作学习材料")
    .replace(/隐私合规/g, "隐私检查")
    .replace(/发布收尾/g, "整理并保存结果")
    .replace(/反方质询/g, "复核疑点")
    .replace(/证据裁决/g, "判断证据是否足够")
    .replace(/修订预算/g, "修改次数")
    .replace(/修订/g, "修改")
    .replace(/门禁/g, "检查")
    .replace(/协同/g, "任务处理")
    .replace(/运行已受理/g, "任务已开始")
    .replace(/不可跳过门禁/g, "必做检查")
    .replace(/风险等级/g, "检查等级")
    .replace(/检查等级\s+low\b/gi, "检查等级：低")
    .replace(/检查等级\s+medium\b/gi, "检查等级：中等")
    .replace(/检查等级\s+high\b/gi, "检查等级：高")
    .replace(/manual_review_required/g, "需要人工复核")
    .replace(/revision budget/gi, "修改次数")
    .replace(/revised|revision/gi, "需要修改")
    .replace(/rejected/gi, "未通过")
    .replace(/released/gi, "已通过")
    .replace(/unsupported/gi, "缺少依据")
    .replace(/partial/gi, "部分支持")
    .replace(/conflict/gi, "相互矛盾")
    .replace(/review/gi, "待复核")
    .replace(/strict/gi, "从严检查")
    .replace(/standard/gi, "标准检查")
    .replace(/DAG/g, "处理流程")
    .replace(/Claim/g, "内容")
    .replace(/Agent/g, "智能体")
    .replace(/N\/A（空分母）/g, "暂无数据");
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
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("lecture");
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [clearingConversation, setClearingConversation] = useState(false);
  const [studyRunning, setStudyRunning] = useState(false);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [finishedRunId, setFinishedRunId] = useState<string | null>(null);
  const [nodeStates, setNodeStates] = useState<Array<{ key: string; state: RunNodeState }>>([]);
  const [liveEvents, setLiveEvents] = useState<Array<{ id: string; type: string; nodeKey: string | null; summary: string }>>([]);
  const [liveSummary, setLiveSummary] = useState("");
  const [notice, setNotice] = useState("");
  const [savingNodeId, setSavingNodeId] = useState<string | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(286);
  const [rightWidth, setRightWidth] = useState(362);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const progressStorageKey = `im-training-agent:study-progress:${user.id}`;

  const load = useCallback(async () => {
    const [pathResponse, messageResponse] = await Promise.all([
      fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/chat?surface=study`, { credentials: "include" }),
    ]);
    if (!pathResponse.ok || !messageResponse.ok) throw new Error("学习空间读取失败，请重新登录后再试");
    const pathData = await pathResponse.json() as { path?: PathGraph };
    const messageData = await messageResponse.json() as { messages?: StudyMessage[]; studyRunning?: boolean };
    const nextPath = pathData.path ?? { nodes: [], edges: [] };
    setPath(nextPath);
    const studyMessages = messageData.messages ?? [];
    const serverRunRunning = Boolean(messageData.studyRunning);
    setMessages(studyMessages);
    setStudyRunning(serverRunRunning);
    setSelectedNodeId((current) => current && nextPath.nodes.some((item) => item.id === current) ? current : nextPath.nodes[0]?.id ?? null);
    consumeStudyPrefill(nextPath);
    if (!serverRunRunning) {
      const latestRunId = [...studyMessages].reverse().find((message) => typeof message.metadata.runId === "string")?.metadata.runId;
      if (latestRunId) {
        try {
          const traceResponse = await fetch(`${apiBase}/api/learning/runs/${encodeURIComponent(latestRunId)}/trace`, { credentials: "include" });
          if (traceResponse.ok) {
            const trace = await traceResponse.json() as { run?: { status?: string }; nodes?: Array<{ nodeKey?: string; status?: string; resultSummary?: string | null }> };
            const states = (trace.nodes ?? []).filter((node) => typeof node.nodeKey === "string").map((node) => ({ key: node.nodeKey as string, state: node.status === "failed" ? "failed" as const : node.status === "running" ? "running" as const : "succeeded" as const }));
            const events = (trace.nodes ?? []).filter((node) => typeof node.nodeKey === "string" && node.resultSummary).map((node, index) => ({ id: `restored-${latestRunId}-${index}`, type: node.status === "failed" ? "node.failed" : "node.succeeded", nodeKey: node.nodeKey as string, summary: node.resultSummary as string }));
            setFinishedRunId(latestRunId);
            setNodeStates(states);
            setLiveEvents(events.slice(-16));
            setLiveSummary(trace.run?.status === "succeeded" ? "本次任务已完成，处理记录已保留，可继续查看。" : "本次任务已结束，可查看处理记录。");
          }
        } catch { /* 历史过程读取失败时仍保留消息记录 */ }
      }
    }
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
      if (parsed.resourceType === "tiered_quiz" || parsed.resourceType === "lecture" || parsed.resourceType === "presentation" || parsed.resourceType === "concept_map") {
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

  const refreshLearningContext = useCallback(async () => {
    try {
      const pathResponse = await fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" });
      if (!pathResponse.ok) return;
      const pathData = await pathResponse.json() as { path?: PathGraph };
      if (pathData.path) {
        setPath(pathData.path);
        setSelectedNodeId((current) => current && pathData.path!.nodes.some((item) => item.id === current) ? current : pathData.path!.nodes[0]?.id ?? null);
      }
    } catch { /* 证据刷新失败时保留当前页面，下一次聚焦再试 */ }
  }, [apiBase]);

  // SSE 事件流：驱动节点状态条与运行终态；断线由 Last-Event-ID 续传（总规 §4.4）
  const openRunStream = useCallback((runId: string) => {
    setStudyRunning(true);
    setActiveRunId(runId);
    setNodeStates([]);
    setLiveEvents([]);
    setLiveSummary("已受理，等待节点调度…");
    const source = new EventSource(`${apiBase}/api/learning/runs/${encodeURIComponent(runId)}/events`, { withCredentials: true });
    source.onmessage = () => { /* 具名事件为主；默认消息忽略 */ };
    const handle = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as { nodeKey?: string | null; summary?: string; createdAt?: string };
        const summary = typeof data.summary === "string" ? data.summary : "";
        setLiveSummary(summary);
        const key = data.nodeKey ?? null;
        setLiveEvents((current) => [...current, { id: `${event.type}-${data.createdAt ?? Date.now()}-${current.length}`, type: event.type, nodeKey: key, summary }].slice(-16));
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
    for (const type of ["node.started", "node.progress", "node.succeeded", "node.failed", "node.retrying", "plan.amended", "run.revision", "run.cancelled", "run.succeeded", "run.failed"]) {
      source.addEventListener(type, handle as EventListener);
    }
    const finish = () => {
      source.close();
      setFinishedRunId(runId);
      void Promise.all([refreshMessages(), refreshLearningContext()]).finally(() => {
        setStudyRunning(false);
        setActiveRunId(null);
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
  }, [apiBase, refreshLearningContext, refreshMessages]);

  useEffect(() => {
    let active = true;
    void load().catch((error) => {
      if (active) setNotice(error instanceof Error ? error.message : "学习空间读取失败");
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [load]);

  // 页面切换或刷新后恢复最近一次协同的公开过程，避免运行记录只在当前挂载周期内可见。
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(progressStorageKey);
      if (!raw) return;
      const snapshot = JSON.parse(raw) as { runId?: unknown; summary?: unknown; states?: unknown; events?: unknown; completed?: unknown };
      if (typeof snapshot.runId !== "string" || snapshot.completed !== true) return;
      const states = Array.isArray(snapshot.states) ? snapshot.states.filter((item): item is { key: string; state: RunNodeState } => Boolean(item) && typeof item === "object" && typeof (item as { key?: unknown }).key === "string" && ["running", "succeeded", "failed", "revising"].includes(String((item as { state?: unknown }).state))) : [];
      const events = Array.isArray(snapshot.events) ? snapshot.events.filter((item): item is { id: string; type: string; nodeKey: string | null; summary: string } => Boolean(item) && typeof item === "object" && typeof (item as { id?: unknown }).id === "string" && typeof (item as { summary?: unknown }).summary === "string") : [];
      setFinishedRunId(snapshot.runId);
      setNodeStates(states);
      setLiveEvents(events);
      setLiveSummary(typeof snapshot.summary === "string" ? snapshot.summary : "");
    } catch { /* 本地快照损坏时不影响学习记录读取 */ }
  }, [progressStorageKey]);

  useEffect(() => {
    const runId = activeRunId ?? finishedRunId;
    if (!runId) return;
    try {
      window.localStorage.setItem(progressStorageKey, JSON.stringify({ runId, summary: liveSummary, states: nodeStates, events: liveEvents, completed: !studyRunning }));
    } catch { /* 本地存储不可用时仍保留当前页面展示 */ }
  }, [activeRunId, finishedRunId, liveEvents, liveSummary, nodeStates, progressStorageKey, studyRunning]);

  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending, studyRunning, nodeStates]);
  useEffect(() => {
    const refresh = () => void refreshLearningContext();
    window.addEventListener("im-training-agent:learning-evidence-updated", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("im-training-agent:learning-evidence-updated", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshLearningContext]);
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
    if (!supported) { setNotice("当前临时参考仅支持 Markdown、文本、表格或数据文件"); return; }
    const content = (await file.text()).slice(0, 120_000);
    setAttachedFile({ name: file.name, content });
    setNotice("");
  };

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true); setNotice(""); setDraft("");
    try {
      const response = await fetch(`${apiBase}/api/learning/runs`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: content, pathNodeId: selectedNodeId, resourceType, temporaryReference: attachedFile }),
      });
      const data = await response.json() as { success?: boolean; error?: string; runId?: string };
      if (!response.ok || !data.success || !data.runId) throw new Error(data.error || "学习任务启动失败");
      setAttachedFile(null);
      await refreshMessages();
      openRunStream(data.runId);
    } catch (error) {
      setDraft(content);
      setNotice(error instanceof Error ? error.message : "学习任务启动失败");
    } finally { setSending(false); }
  };

  const clearConversation = async () => {
    if (studyRunning || clearingConversation) return;
    if (!window.confirm("清除当前任务对话的全部历史和后续模型对话上下文？不会删除学习路径、已生成资源或验证记录。")) return;
    setClearingConversation(true);
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/chat?surface=study`, { method: "DELETE", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "清除对话失败");
      setMessages([]);
      setFinishedRunId(null);
      setNodeStates([]);
      setLiveEvents([]);
      setLiveSummary("");
      window.localStorage.removeItem(progressStorageKey);
    } catch (error) { setNotice(error instanceof Error ? error.message : "清除对话失败"); }
    finally { setClearingConversation(false); }
  };

  const updateNode = async (node: PathNode, patch: { userStatus?: PathNode["userStatus"]; mastered?: boolean }) => {
    setSavingNodeId(node.id);
    try {
      const response = await fetch(`${apiBase}/api/learning/path-graph/nodes/${node.id}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      const data = await response.json() as { success?: boolean; error?: string; node?: PathNode };
      if (!response.ok || !data.success || !data.node) throw new Error(data.error || "节点状态保存失败");
      setPath((current) => ({ ...current, nodes: current.nodes.map((item) => item.id === node.id ? data.node as PathNode : item) }));
    } catch (error) { setNotice(error instanceof Error ? error.message : "节点状态保存失败"); }
    finally { setSavingNodeId(null); }
  };

  const exportAsset = (asset: StudyAsset, format: "md" | "txt" | "json" | "ppt") => window.open(`${apiBase}/api/learning/assets/${encodeURIComponent(asset.id)}/export?format=${format}`, "_blank", "noopener,noreferrer");
  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };

  return <main className={`app-shell flex h-screen min-h-0 flex-col overflow-hidden bg-background ${resizing ? "select-none" : ""}`}>
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">智辩无幻</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => setProfileOpen(true)} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">画像</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">学习</button><button type="button" onClick={() => onNavigate("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button><button type="button" onClick={() => onNavigate("validation")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">验证</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="study-layout flex min-h-0 min-w-[1000px] flex-1 overflow-hidden">
      <aside style={{ width: leftWidth }} className="flex shrink-0 flex-col border-r bg-card" aria-label="任务上下文">
        <div className="workspace-pane-titlebar flex shrink-0 items-center justify-between border-b px-4 py-3.5"><div className="flex items-center gap-2"><ListTree className="h-4 w-4" /><h1 className="text-sm font-semibold">任务进度</h1></div><span className="text-xs text-muted-foreground">{studyRunning ? "进行中" : finishedRunId ? "已完成" : "待发起"}</span></div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
      <section aria-label="当前节点"><div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">当前节点</div>{selectedNode ? <div className="mt-2 rounded-xl border p-3"><div className="text-xs font-semibold leading-5">{selectedNode.title}</div><div className="mt-1"><DescriptionList text={selectedNode.description} compact /></div>{selectedNode.recommendation ? <div className="mt-2.5"><RecommendationBadge recommendation={selectedNode.recommendation} /></div> : null}<button type="button" onClick={() => addMention(selectedNode)} className="mt-3 inline-flex h-7 items-center gap-1 rounded-lg border px-2.5 text-[11px] hover:bg-muted"><MessageSquarePlus className="h-3 w-3" />引用到问题</button></div> : <div className="mt-2 rounded-xl border border-dashed p-3 text-[11px] leading-4 text-muted-foreground">在右侧路径中选择一个节点</div>}</section>
          <section aria-label="任务处理状态">{studyRunning || finishedRunId || nodeStates.length > 0 ? <RunProgressStrip states={nodeStates} summary={liveSummary} events={liveEvents} completed={!studyRunning} /> : <div className="mt-2 rounded-xl border border-dashed p-4 text-[11px] leading-4 text-muted-foreground">开始任务后，这里会显示处理进度和检查结果。</div>}</section>
        </div>
      </aside>
      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("left")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />

      <section className="flex min-w-[390px] flex-1 flex-col bg-card" aria-label="学习任务对话">
        <div className="workspace-pane-titlebar flex shrink-0 items-center justify-between border-b px-5 py-3.5">
          <div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><h2 className="text-sm font-semibold">学习助手</h2></div>
          <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{selectedNode ? `关联：${selectedNode.title}` : "选择路径节点后开始任务"}</span><button type="button" disabled={studyRunning || clearingConversation || messages.length === 0} onClick={() => void clearConversation()} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40" title={studyRunning ? "任务结束后才能清除上下文" : "清除对话上下文"}><Trash2 className="h-3 w-3" />{clearingConversation ? "清除中" : "清除上下文"}</button></div>
        </div>
        <div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mx-auto max-w-3xl space-y-4">
            {loading ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">正在加载学习记录</div> : messages.length === 0 && !studyRunning && nodeStates.length === 0 ? <div className="flex min-h-[200px] flex-col items-center justify-center text-center"><Bot className="mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">输入一个学习任务，开始生成内容</p><p className="mt-1 text-xs text-muted-foreground">@ 引用路径节点，选择资源类型后发送即可。</p></div> : messages.map((message) => <MessageCard key={message.id} message={message} onExport={exportAsset} />)}
            {studyRunning && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />正在按步骤处理，结果会逐条显示…</div>}
            {!studyRunning && finishedRunId && (
              <div className="flex items-center justify-between rounded-xl border bg-muted/20 px-3.5 py-2.5 text-xs">
                <span className="text-muted-foreground">本次任务已结束</span>
                <button type="button" onClick={() => {
                  try { window.localStorage.setItem("im-training-agent:validation-prefill", JSON.stringify({ runId: finishedRunId })); } catch { /* 忽略 */ }
                  onNavigate("validation");
                }} className="rounded-lg border px-2.5 py-1.5 text-[11px] font-medium hover:bg-muted">查看验证记录</button>
              </div>
            )}
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
              </div>
              <button type="button" disabled={!draft.trim() || sending || studyRunning} onClick={() => void send()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35" aria-label="开始任务"><Send className="h-4 w-4" /></button>
            </div>
          </div>
        </div>
      </section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("right")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: rightWidth }} className="flex shrink-0 flex-col bg-muted/15" aria-label="当前学习路径"><div className="workspace-pane-titlebar flex shrink-0 items-center justify-between border-b bg-background px-4 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">学习路径</h2></div><span className="text-xs text-muted-foreground">{path.nodes.length} 个节点</span></div><div className="min-h-0 basis-[59%] p-3">{path.nodes.length ? <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={(node) => setSelectedNodeId(node.id)} /> : <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">尚未建立学习路径</div>}</div><div className="min-h-0 basis-[41%] overflow-y-auto border-t bg-background p-4">{selectedNode ? <PathNodeDetails apiBase={apiBase} node={selectedNode} primaryLabel="引用到问题" onPrimary={() => addMention(selectedNode)} onUpdateNode={updateNode} saving={savingNodeId === selectedNode.id} compact /> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">选择一个节点</div>}</div></aside>
    </div>

    {profileOpen && <ProfileDialog apiBase={apiBase} user={user} onUserChange={onUserChange} onClose={() => setProfileOpen(false)} />}
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main>;
}

/** 实时展示各处理步骤的公开进度；校验细节统一放到“验证”页。 */
function RunProgressStrip({ states, summary, events, completed }: { states: Array<{ key: string; state: RunNodeState }>; summary: string; events: Array<{ id: string; type: string; nodeKey: string | null; summary: string }>; completed: boolean }) {
  return <section aria-label="任务处理进度" className="rounded-xl border bg-muted/20 px-3.5 py-3">
    <div className="flex items-center justify-between text-[10px] font-medium tracking-wide text-muted-foreground"><span>{completed ? "处理完成" : "处理中"}</span><span>完成 {states.filter((item) => item.state === "succeeded").length} 项</span></div>
    <div className="mt-2 flex flex-wrap gap-1.5">
      {states.map((item) => <span key={item.key} className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] ${item.state === "succeeded" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : item.state === "failed" ? "border-destructive/30 bg-destructive/10 text-destructive" : item.state === "revising" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-border bg-background text-foreground"}`}><span className={`h-1.5 w-1.5 rounded-full ${item.state === "succeeded" ? "bg-emerald-600" : item.state === "failed" ? "bg-destructive" : item.state === "revising" ? "bg-amber-500" : "animate-pulse bg-foreground"}`} />{nodeLabels[item.key]?.name ?? item.key}</span>)}
    </div>
    {summary && <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">{readableProcessText(summary)}</p>}
    {events.length > 0 && <div className="mt-3 border-t pt-2 text-xs"><p className="mb-1.5 font-medium text-foreground">处理记录</p><div className="space-y-1.5">{events.map((event) => <div key={event.id} className="flex gap-2 leading-5 text-muted-foreground"><span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${event.type === "node.failed" ? "bg-rose-500" : event.type === "node.succeeded" ? "bg-emerald-500" : "bg-sky-500"}`} /><span>{readableProcessText(event.summary)}</span></div>)}</div></div>}
  </section>;
}

function MessageCard({ message, onExport }: { message: StudyMessage; onExport: (asset: StudyAsset, format: "md" | "txt" | "json" | "ppt") => void }) {
  const isUser = message.role === "user";
  const kind = message.metadata.kind;
  const asset = message.metadata.asset;
  if (isUser) {
    return <article className="ml-auto max-w-[84%] border-r border-blue-200 pr-3 text-right text-[13px] leading-6 text-blue-950"><MessageRichText text={message.content} /><div className="mt-1 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div></article>;
  }
  if (kind === "asset" && asset) {
    return <article className="max-w-[94%]"><div className="rounded-2xl rounded-tl-md border bg-muted/20 px-4 py-3"><div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Download className="h-3.5 w-3.5" />已生成资源</div><AssetCard asset={asset} onExport={onExport} /></div><div className="mt-1 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div></article>;
  }
  const agentId = message.metadata.agentId;
  const agentName = readableProcessText(message.metadata.agentName ?? "任务协调员");
  return <article className="max-w-[94%]">
    <div className="flex items-start gap-2.5">
      <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${agentTone(agentId)}`}>{agentName.slice(0, 1)}</span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium text-muted-foreground">{agentName}</div>
        <div className="mt-1 text-[13px] leading-7 text-slate-700"><MessageRichText text={readableProcessText(message.content)} /></div>
      </div>
    </div>
    <div className="mt-1 pl-[42px] text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div>
  </article>;
}

function MessageRichText({ text, invert = false }: { text: string; invert?: boolean }) {
  return <RichText text={text} invert={invert} />;
}

function AssetCard({ asset, onExport }: { asset: StudyAsset; onExport: (asset: StudyAsset, format: "md" | "txt" | "json" | "ppt") => void }) {
  return <div className="rounded-xl border bg-muted/25 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] text-muted-foreground">{resourceLabel(asset.type)}</div><div className="mt-1 text-xs font-semibold">{asset.title}</div></div><span className={`rounded-full px-2 py-1 text-[10px] ${asset.persisted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{asset.persisted ? "已保存" : "等待检查"}</span></div>{asset.persisted && <div className="mt-3 flex gap-2"><button type="button" onClick={() => onExport(asset, "md")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载 Markdown</button>{asset.type === "presentation" && <button type="button" onClick={() => onExport(asset, "ppt")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载 PPT</button>}<button type="button" onClick={() => onExport(asset, "txt")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载文本</button><button type="button" onClick={() => onExport(asset, "json")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载数据</button></div>}</div>;
}
