"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  FilePlus2,
  LogOut,
  Network,
  Paperclip,
  Send,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { type PathGraph, type PathNode, TreeCanvas } from "@/components/learning-path-workbench";

type ResourceType = "lecture" | "tiered_quiz" | "practice_guide" | "concept_map" | "review_cards" | "challenge_task";
type AgentId = "learning_planning" | "evidence_retrieval" | "domain_expert" | "resource_generation" | "cross_validation" | "privacy_compliance" | "orchestrator";
type ToolRecord = { name: string; detail: string };
type AgentActivity = { agentId: AgentId; name: string; action: string; status: "completed" | "running" | "failed"; tools?: ToolRecord[] };
type StudyAsset = { id: string; title: string; type: ResourceType; auditStatus: string; persisted: boolean };
type StudyMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  metadata: { surface?: "study"; pathNodeId?: string | null; resourceType?: ResourceType; activities?: AgentActivity[]; asset?: StudyAsset; evidence?: { count: number; score: number; crossValidation: string } };
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

const selectableAgents: Array<{ id: Exclude<AgentId, "orchestrator" | "resource_generation" | "cross_validation" | "privacy_compliance">; label: string }> = [
  { id: "learning_planning", label: "学情与路径" },
  { id: "evidence_retrieval", label: "知识检索" },
  { id: "domain_expert", label: "领域诊断" },
];

const avatarClasses: Record<AuthenticatedUser["avatarKey"], string> = {
  graphite: "bg-zinc-900 text-white", ocean: "bg-sky-600 text-white", violet: "bg-violet-600 text-white",
  forest: "bg-emerald-600 text-white", amber: "bg-amber-500 text-white", rose: "bg-rose-600 text-white",
};

function agentTone(id: AgentId) {
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
  onNavigate: (view: "path" | "study" | "resources") => void;
};

export function LearningWorkbench({ apiBase, user, onLogout, onNavigate }: LearningWorkbenchProps) {
  const [path, setPath] = useState<PathGraph>({ nodes: [], edges: [] });
  const [messages, setMessages] = useState<StudyMessage[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [resourceType, setResourceType] = useState<ResourceType>("lecture");
  const [preference, setPreference] = useState<"auto" | "custom">("auto");
  const [selectedAgents, setSelectedAgents] = useState<AgentId[]>(["learning_planning", "evidence_retrieval", "domain_expert"]);
  const [attachedFile, setAttachedFile] = useState<{ name: string; content: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState("");
  const [expandedAgents, setExpandedAgents] = useState<Set<string>>(new Set(["orchestrator"]));
  const [leftWidth, setLeftWidth] = useState(286);
  const [rightWidth, setRightWidth] = useState(362);
  const [resizing, setResizing] = useState<"left" | "right" | null>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
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
    const messageData = await messageResponse.json() as { messages?: StudyMessage[] };
    const profileData = await profileResponse.json() as { profile?: Profile };
    const nextPath = pathData.path ?? { nodes: [], edges: [] };
    setPath(nextPath);
    setMessages(messageData.messages ?? []);
    setProfile(profileData.profile ?? null);
    setSelectedNodeId((current) => current && nextPath.nodes.some((item) => item.id === current) ? current : nextPath.nodes[0]?.id ?? null);
  }, [apiBase]);

  useEffect(() => { void load().catch((error) => setNotice(error instanceof Error ? error.message : "学习空间读取失败")).finally(() => setLoading(false)); }, [load]);
  useEffect(() => { feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: "smooth" }); }, [messages, sending]);
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
  const latestActivities = useMemo(() => [...messages].reverse().find((message) => message.role === "assistant" && message.metadata.activities)?.metadata.activities ?? [], [messages]);
  const agents = useMemo(() => [{ agentId: "orchestrator" as AgentId, name: "协同总控 Agent", action: latestActivities[0]?.action ?? "等待学习任务", status: sending ? "running" as const : "completed" as const, tools: latestActivities[0]?.tools ?? [{ name: "任务编排", detail: "收到任务后自动创建协同结构" }, { name: "DAG 调度", detail: "按任务依赖调度子 Agent" }, { name: "发布门禁", detail: "资源发布前执行审核与隐私检查" }] }, ...latestActivities.filter((item) => item.agentId !== "orchestrator")], [latestActivities, sending]);

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

  const toggleAgent = (agentId: AgentId) => setSelectedAgents((current) => current.includes(agentId) ? current.filter((item) => item !== agentId) : [...current, agentId]);
  const toggleExpanded = (agentId: string) => setExpandedAgents((current) => { const next = new Set(current); if (next.has(agentId)) next.delete(agentId); else next.add(agentId); return next; });

  const send = async () => {
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true); setNotice(""); setDraft("");
    const temporary: StudyMessage = { id: `local-${Date.now()}`, role: "user", content, createdAt: Date.now(), metadata: { surface: "study", pathNodeId: selectedNodeId, resourceType } };
    setMessages((current) => [...current, temporary]);
    try {
      const response = await fetch(`${apiBase}/api/learning/study/chat`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, pathNodeId: selectedNodeId, resourceType, collaborationPreference: preference, selectedAgentIds: selectedAgents, temporaryReference: attachedFile }),
      });
      const data = await response.json() as { success?: boolean; error?: string; userMessage?: StudyMessage; assistantMessage?: StudyMessage };
      if (!response.ok || !data.success || !data.userMessage || !data.assistantMessage) throw new Error(data.error || "学习协同失败");
      setMessages((current) => [...current.filter((item) => item.id !== temporary.id), data.userMessage as StudyMessage, data.assistantMessage as StudyMessage]);
      setAttachedFile(null);
    } catch (error) {
      setMessages((current) => current.filter((item) => item.id !== temporary.id));
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
      <button type="button" onClick={() => setProfileOpen(true)} className="flex min-w-0 items-center gap-2.5 text-left" aria-label="打开学习画像"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${avatarClasses[user.avatarKey]}`}>{user.displayName.slice(0, 1).toUpperCase()}</span><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName} · 学习画像</span></span></button>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">学习</button><button type="button" onClick={() => onNavigate("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="flex min-h-0 min-w-[1000px] flex-1 overflow-hidden">
      <aside style={{ width: leftWidth }} className="flex shrink-0 flex-col border-r bg-card" aria-label="协同智能体"><div className="flex shrink-0 items-center justify-between border-b px-4 py-3.5"><div className="flex items-center gap-2"><Bot className="h-4 w-4" /><h1 className="text-sm font-semibold">协同智能体</h1></div><span className="text-xs text-muted-foreground">{Math.max(0, agents.length - 1)} 个角色</span></div><div className="min-h-0 flex-1 overflow-y-auto p-3"><div className="space-y-2"><AgentCard agent={agents[0]} expanded={expandedAgents.has("orchestrator")} onToggle={() => toggleExpanded("orchestrator")} root />{agents.slice(1).map((agent) => <AgentCard key={agent.agentId} agent={agent} expanded={expandedAgents.has(agent.agentId)} onToggle={() => toggleExpanded(agent.agentId)} />)}</div></div></aside>
      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("left")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />

      <section className="flex min-w-[390px] flex-1 flex-col bg-card" aria-label="学习对话与资源生成"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div className="flex items-center gap-2"><Sparkles className="h-4 w-4" /><h2 className="text-sm font-semibold">智能问答</h2></div><span className="text-xs text-muted-foreground">{selectedNode ? `关联：${selectedNode.title}` : "选择路径节点后生成资源"}</span></div><div ref={feedRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-5"><div className="mx-auto max-w-3xl space-y-5">{loading ? <div className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">正在加载学习协同记录</div> : messages.length === 0 ? <div className="flex min-h-[240px] flex-col items-center justify-center text-center"><Bot className="mb-3 h-8 w-8 text-muted-foreground/50" /><p className="text-sm font-medium">从一个路径节点开始</p><p className="mt-1 text-xs text-muted-foreground">在右侧引用节点，再说明你需要的资源。</p></div> : messages.map((message) => <MessageCard key={message.id} message={message} onExport={exportAsset} />)}{sending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><span className="h-2 w-2 animate-pulse rounded-full bg-foreground" />总控 Agent 正在编排协同任务</div>}</div></div><div className="shrink-0 border-t bg-background p-4">{notice && <div className="mx-auto mb-2 max-w-3xl rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</div>}{attachedFile && <div className="mx-auto mb-2 flex max-w-3xl items-center justify-between rounded-lg border bg-muted/30 px-3 py-2 text-xs"><span className="truncate">临时参考：{attachedFile.name}</span><button type="button" onClick={() => setAttachedFile(null)} aria-label="移除临时参考"><X className="h-3.5 w-3.5" /></button></div>}<div className="mx-auto max-w-3xl rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }} rows={2} placeholder="输入问题，或 @ 引用路径节点" className="max-h-32 min-h-[44px] w-full resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" /><div className="flex items-center justify-between gap-2 border-t px-1 pt-2"><div className="flex min-w-0 items-center gap-2"><input ref={fileInputRef} type="file" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void readAttachment(file); event.currentTarget.value = ""; }} /><button type="button" onClick={() => fileInputRef.current?.click()} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border hover:bg-muted" aria-label="添加临时参考文件"><Paperclip className="h-3.5 w-3.5" /></button><div className="relative"><button type="button" onClick={() => setMentionOpen((value) => !value)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm hover:bg-muted" aria-label="引用路径节点">@</button>{mentionOpen && <div className="absolute bottom-10 left-0 z-20 max-h-56 w-56 overflow-y-auto rounded-xl border bg-card p-1 shadow-lg">{path.nodes.map((node) => <button key={node.id} type="button" onClick={() => addMention(node)} className="w-full rounded-lg px-2.5 py-2 text-left text-xs hover:bg-muted">{node.title}</button>)}</div>}</div><select value={resourceType} onChange={(event) => setResourceType(event.target.value as ResourceType)} className="h-8 min-w-0 rounded-lg border bg-background px-2 text-xs">{resourceOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><select value={preference} onChange={(event) => setPreference(event.target.value as "auto" | "custom")} className="h-8 min-w-0 rounded-lg border bg-background px-2 text-xs"><option value="auto">自动编排</option><option value="custom">指定角色</option></select></div><button type="button" disabled={!draft.trim() || sending} onClick={() => void send()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35"><Send className="h-4 w-4" /></button></div>{preference === "custom" && <div className="flex flex-wrap gap-1.5 px-1 pt-2">{selectableAgents.map((agent) => <button key={agent.id} type="button" onClick={() => toggleAgent(agent.id)} className={`rounded-full border px-2.5 py-1 text-[11px] ${selectedAgents.includes(agent.id) ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-muted"}`}>{agent.label}</button>)}<span className="self-center text-[10px] text-muted-foreground">审核与隐私为固定关卡</span></div>}</div></div></section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing("right")} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: rightWidth }} className="flex shrink-0 flex-col bg-muted/15" aria-label="当前学习路径"><div className="flex shrink-0 items-center justify-between border-b bg-background px-4 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">学习路径</h2></div><span className="text-xs text-muted-foreground">{path.nodes.length} 个节点</span></div><div className="min-h-0 basis-[59%] p-3">{path.nodes.length ? <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={(node) => setSelectedNodeId(node.id)} /> : <div className="flex h-full items-center justify-center rounded-xl border border-dashed text-xs text-muted-foreground">尚未建立学习路径</div>}</div><div className="min-h-0 basis-[41%] overflow-y-auto border-t bg-background p-4">{selectedNode ? <div><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] text-muted-foreground">当前节点</div><h3 className="mt-1 text-sm font-semibold leading-5">{selectedNode.title}</h3></div><span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${selectedNode.mastered ? "bg-emerald-600" : selectedNode.userStatus === "completed" ? "bg-blue-600" : selectedNode.userStatus === "learning" ? "bg-amber-500" : "bg-zinc-300"}`} /></div><p className="mt-3 text-xs leading-5 text-muted-foreground">{selectedNode.description}</p><button type="button" onClick={() => addMention(selectedNode)} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-1 rounded-lg border text-xs font-medium hover:bg-muted">@ 引用到输入</button><div className="mt-2 flex gap-2"><button type="button" onClick={() => void updateNode(selectedNode, { userStatus: selectedNode.userStatus === "completed" ? "learning" : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs hover:bg-muted"><Check className="h-3.5 w-3.5" />{selectedNode.userStatus === "completed" ? "继续学习" : "学完"}</button><button type="button" onClick={() => void updateNode(selectedNode, { mastered: !selectedNode.mastered, userStatus: selectedNode.mastered ? selectedNode.userStatus : "completed" })} className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg border text-xs hover:bg-muted">{selectedNode.mastered ? "取消掌握" : "掌握"}</button></div></div> : <div className="flex h-full items-center justify-center text-xs text-muted-foreground">选择一个节点</div>}</div></aside>
    </div>

    {profileOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/20 p-4" role="dialog" aria-modal="true" aria-label="学习画像"><section className="w-full max-w-md rounded-2xl border bg-card p-5 shadow-xl"><div className="flex items-center justify-between"><div className="flex items-center gap-2 text-sm font-semibold"><UserRound className="h-4 w-4" />学习画像</div><button type="button" onClick={() => setProfileOpen(false)} className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-muted">关闭</button></div><div className="mt-5 flex items-center gap-3"><span className={`flex h-11 w-11 items-center justify-center rounded-full text-sm font-semibold ${avatarClasses[user.avatarKey]}`}>{user.displayName.slice(0, 1).toUpperCase()}</span><div><div className="text-sm font-semibold">{user.displayName}</div><div className="text-xs text-muted-foreground">@{user.loginName}</div></div></div><p className="mt-4 rounded-xl bg-muted/60 p-3 text-sm leading-6">{profile?.summary ?? "当前还没有足够的学习证据。"}</p><div className="mt-3 flex flex-wrap gap-1.5">{profile?.keywords?.map((keyword) => <span key={keyword} className="rounded-full border px-2.5 py-1 text-[11px]">{keyword}</span>)}</div><div className="mt-4 grid grid-cols-3 gap-2 text-xs"><Metric label="学习时间" value={`${profile?.studyMinutes ?? 0} 分`} /><Metric label="学习资产" value={profile?.assetsCount ?? 0} /><Metric label="正确率" value={profile?.accuracy === null || profile?.accuracy === undefined ? "—" : `${Math.round(profile.accuracy * 100)}%`} /></div></section></div>}
  </main>;
}

function AgentCard({ agent, expanded, onToggle, root = false }: { agent: AgentActivity; expanded: boolean; onToggle: () => void; root?: boolean }) {
  return <article className={`rounded-xl border ${root ? "border-foreground/25 bg-muted/40" : "bg-card"}`}><button type="button" onClick={onToggle} className="flex w-full items-center gap-2.5 p-3 text-left"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${agentTone(agent.agentId)}`}>{root ? "总" : agent.name.slice(0, 1)}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{agent.name}</span><span className="mt-0.5 block truncate text-[10px] text-muted-foreground">{agent.action}</span></span><ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} /></button>{expanded && <div className="border-t px-3 py-2.5"><div className="space-y-2">{agent.tools?.map((tool) => <div key={`${agent.agentId}-${tool.name}`} className="rounded-lg bg-muted/45 p-2"><div className="flex items-center gap-1.5 text-[11px] font-medium"><FilePlus2 className="h-3 w-3" />{tool.name}</div><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{tool.detail}</p></div>)}</div></div>}</article>;
}

function MessageCard({ message, onExport }: { message: StudyMessage; onExport: (asset: StudyAsset, format: "md" | "txt" | "json") => void }) {
  const isUser = message.role === "user";
  const asset = message.metadata.asset;
  return <article className={isUser ? "ml-auto max-w-[84%]" : "max-w-[94%]"}><div className={isUser ? "rounded-2xl rounded-tr-md bg-foreground px-4 py-3 text-sm leading-6 text-background" : "rounded-2xl rounded-tl-md border bg-card px-4 py-3 text-sm leading-6"}>{!isUser && <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground"><Bot className="h-3.5 w-3.5" />协同总控 Agent</div>}<p className="whitespace-pre-wrap">{message.content}</p></div>{asset && <div className="mt-2 rounded-xl border bg-muted/25 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[10px] text-muted-foreground">{resourceLabel(asset.type)}</div><div className="mt-1 text-xs font-semibold">{asset.title}</div></div><span className={`rounded-full px-2 py-1 text-[10px] ${asset.persisted ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}`}>{asset.persisted ? "已入库" : "待复核"}</span></div>{asset.persisted && <div className="mt-3 flex gap-2"><button type="button" onClick={() => onExport(asset, "md")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">下载 MD</button><button type="button" onClick={() => onExport(asset, "txt")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">TXT</button><button type="button" onClick={() => onExport(asset, "json")} className="h-7 rounded-lg border px-2.5 text-[11px] hover:bg-background">JSON</button></div>}</div>}<div className={`mt-1 text-[10px] text-muted-foreground ${isUser ? "text-right" : ""}`}>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</div></article>;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return <div className="rounded-lg bg-muted/60 p-2.5"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-sm font-semibold">{value}</div></div>;
}
