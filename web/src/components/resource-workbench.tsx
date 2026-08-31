"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  LogOut,
  Map as MapIcon,
  MessageCircleQuestion,
  Presentation,
  Save,
  Target,
  Trash2,
  XCircle,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { AvatarBubble, ProfileDialog } from "@/components/profile-dialog";
import { ResourceQuestionDialog } from "@/components/resource-question-dialog";
import { RichInlineText, RichText } from "@/components/rich-text";

type ResourceType = "lecture" | "tiered_quiz" | "presentation" | "concept_map";
type ResourceBlock = { id: string; type: string; position: number; content: unknown; evidenceIds: string[] };
type ResourceAsset = {
  id: string;
  type: ResourceType;
  title: string;
  difficulty: number;
  learningObjectives: string[];
  knowledgePointIds: string[];
  blocks: ResourceBlock[];
  evidenceIds: string[];
  auditStatus: string;
  createdAt: number;
};
type PageNote = { pageKey: string; content: string; updatedAt: number };
type Feedback = { completed: boolean; mastered: boolean; masteryLevel: "high" | "medium" | "low" | null; updatedAt: number };
type QuizQuestionType = "choice" | "blank" | "short_answer";
type QuizQuestion = { id: string; type?: QuizQuestionType; level: "L1" | "L2" | "L3"; prompt: string; options?: Array<{ id: string; text: string }>; answerId: string; explanation: string; evidenceIds: string[] };
type QuizAttempt = { id: string; questionId: string; answerId: string; correct: boolean; durationMs: number; createdAt: number };
type ReaderData = { asset: ResourceAsset; pageNotes: PageNote[]; feedback: Feedback | null; quizAttempts: QuizAttempt[] };

const typeItems: Array<{ type: ResourceType; label: string; icon: typeof BookOpen }> = [
  { type: "lecture", label: "讲义", icon: BookOpen },
  { type: "tiered_quiz", label: "习题", icon: ClipboardList },
  { type: "presentation", label: "PPT", icon: Presentation },
  { type: "concept_map", label: "知识脉络", icon: MapIcon },
];

function typeLabel(type: ResourceType) {
  return typeItems.find((item) => item.type === type)?.label ?? "资源";
}

function notifyEvidenceUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("im-training-agent:learning-evidence-updated"));
}

// Mermaid 知识图谱渲染：概念图资源以 flowchart 文本存储，客户端动态加载 mermaid 绘制。
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const renderId = `mermaid-${Math.random().toString(36).slice(2)}`;
    void (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          themeVariables: {
            primaryColor: "#eef2ff",
            primaryBorderColor: "#6366f1",
            primaryTextColor: "#1e293b",
            lineColor: "#94a3b8",
            fontSize: "13px",
            fontFamily: "inherit",
          },
        });
        // 先静默校验语法，再渲染，避免 Mermaid 把错误 SVG 注入页面顶部。
        const parsed = await mermaid.parse(code, { suppressErrors: true });
        if (!parsed) {
          if (active) setFailed(true);
          return;
        }
        const { svg: rendered } = await mermaid.render(renderId, code);
        // mermaid 解析失败时不总是抛错，有时直接返回错误图——按内容识别并降级为源码展示
        if (active) {
          if (rendered.includes("Syntax error") || rendered.includes("mermaid-error")) setFailed(true);
          else setSvg(rendered);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        // mermaid.render 会在 body 中创建临时节点；无论成功或失败都要清理，避免错误 SVG 残留在页面顶部。
        document.getElementById(`d${renderId}`)?.remove();
      }
    })();
    return () => { active = false; };
  }, [code]);
  if (failed) return <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4"><div className="text-xs font-medium text-amber-700">这张知识关系图暂时无法渲染，下面是它的结构定义：</div><pre className="mt-2 overflow-x-auto rounded-lg bg-background px-3 py-2.5 font-mono text-xs leading-5 text-muted-foreground">{code}</pre></div>;
  if (!svg) return <div className="flex h-24 items-center justify-center rounded-xl border bg-muted/20 text-xs text-muted-foreground">正在渲染知识图谱…</div>;
  return <div className="flex justify-center overflow-x-auto rounded-xl border bg-gradient-to-b from-background to-muted/20 p-5 [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function renderBlockContent(block: ResourceBlock, sectionNumber?: number) {
  if (block.type === "heading") return <h3 className="flex items-center gap-3 border-b border-border/70 pb-3 text-xl font-semibold tracking-tight text-foreground">{typeof sectionNumber === "number" ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 text-[13px] font-bold text-white">{sectionNumber}</span> : <span className="h-5 w-1 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500" />}<RichInlineText text={String(block.content)} /></h3>;
  if (block.type === "paragraph" && typeof block.content === "string" && /^(flowchart|graph)\b/.test(block.content.trim())) {
    return <MermaidDiagram code={block.content} />;
  }
  if (typeof block.content === "string") return <div className="space-y-1"><RichText text={block.content} variant="doc" /></div>;
  if (Array.isArray(block.content)) return <ul className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-4 text-sm leading-7 text-muted-foreground">{block.content.map((item, index) => <li key={index} className="flex gap-2"><span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" />{typeof item === "string" ? <RichInlineText text={item} /> : String(item)}</li>)}</ul>;
  if (block.content && typeof block.content === "object") {
    const data = block.content as { label?: string; locator?: string; summary?: string; language?: string; caption?: string; code?: string; columns?: unknown; rows?: unknown; sources?: string[] };
    if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
      return <div className="overflow-hidden rounded-xl border"><div className="border-b bg-muted/30 px-4 py-2.5 text-xs font-medium">{data.caption ?? "数据摘录"}</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-muted/15 text-muted-foreground">{(data.columns as string[]).map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{(data.rows as Array<Array<string | number | null>>).map((row, rowIndex) => <tr key={rowIndex} className="border-b transition-colors last:border-b-0 hover:bg-muted/20">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">{cell === null ? "—" : String(cell)}</td>)}</tr>)}</tbody></table></div>{data.sources?.length ? <div className="border-t bg-muted/15 px-4 py-2 font-mono text-[10px] text-muted-foreground">{data.sources[0]}</div> : null}</div>;
    }
    if (typeof data.code === "string") {
      return <figure className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-sm"><figcaption className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs text-zinc-300"><span className="font-medium">{data.caption ?? "代码示例"}</span><span className="font-mono text-[10px] uppercase tracking-wider text-zinc-500">{data.language ?? "python"}</span></figcaption><pre className="overflow-x-auto px-4 py-4 text-xs leading-6 text-zinc-100"><code>{data.code}</code></pre></figure>;
    }
    if (data.summary || data.locator) return <div className="rounded-xl border border-border/70 bg-gradient-to-br from-muted/40 to-card p-4"><div className="flex items-center gap-1.5 text-xs font-medium"><span className="flex h-4 w-4 items-center justify-center rounded bg-blue-100 text-[9px] font-bold text-blue-700">证</span>{data.label ?? "证据"}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{data.summary}</p>{data.locator ? <div className="mt-3 border-t border-border/50 pt-2 font-mono text-[11px] text-muted-foreground/80">{data.locator}</div> : null}</div>;
  }
  return <p className="text-sm text-muted-foreground">该部分暂时没有可显示内容。</p>;
}

function getQuizQuestions(asset: ResourceAsset): QuizQuestion[] {
  const block = asset.blocks.find((item) => item.type === "question");
  const raw = block?.content as { questions?: unknown } | undefined;
  if (!Array.isArray(raw?.questions)) return [];
  return raw.questions.filter((item): item is QuizQuestion => Boolean(item) && typeof item === "object" && typeof (item as QuizQuestion).id === "string" && typeof (item as QuizQuestion).prompt === "string");
}

type ResourceWorkbenchProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  onNavigate: (view: "path" | "study" | "resources" | "validation") => void;
  onUserChange?: (user: AuthenticatedUser) => void;
};

/** 里程碑 G（资源页小改）：从产物化资源 ID 解析来源运行（study-<runId>-<attempt>） */
function runIdOfAsset(assetId: string): string | null {
  if (!assetId.startsWith("study-study-run-")) return null;
  const rest = assetId.slice("study-".length);
  const lastDash = rest.lastIndexOf("-");
  return lastDash > 0 ? rest.slice(0, lastDash) : null;
}

/** 可信溯源条：由哪次 run 生成、通过何种裁决、难度为何匹配；可跳转验证页 */
function ProvenanceStrip({ asset, onOpenValidation }: { asset: ResourceAsset; onOpenValidation: (runId: string) => void }) {
  const runId = runIdOfAsset(asset.id);
  return <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b bg-blue-50/35 px-5 py-1.5 text-[10px]">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="font-medium text-emerald-700">{asset.auditStatus === "passed" ? "已通过检查" : "等待检查"}</span>
      <span className="text-slate-500">难度 {asset.difficulty.toFixed(2)} · 按掌握度校准</span>
    </div>
    {runId ? <button type="button" onClick={() => onOpenValidation(runId)} className="rounded-md px-2 py-1 font-medium text-blue-700 hover:bg-blue-100/70">查看验证记录</button> : null}
  </div>;
}

export function ResourceWorkbench({ apiBase, user, onLogout, onNavigate, onUserChange }: ResourceWorkbenchProps) {
  const [assets, setAssets] = useState<ResourceAsset[]>([]);
  const [activeType, setActiveType] = useState<ResourceType>("lecture");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [notesWidth, setNotesWidth] = useState(330);
  const [resizing, setResizing] = useState(false);
  const [qaOpen, setQaOpen] = useState(false);

  const activeAssets = useMemo(() => assets.filter((asset) => asset.type === activeType), [assets, activeType]);
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;

  const loadAssets = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/learning/assets`, { credentials: "include" });
    const data = await response.json() as { success?: boolean; error?: string; assets?: ResourceAsset[] };
    if (!response.ok || !data.success) throw new Error(data.error || "学习资产读取失败");
    const nextAssets = data.assets ?? [];
    setAssets(nextAssets);
    setSelectedId((current) => current && nextAssets.some((asset) => asset.id === current) ? current : (nextAssets.find((asset) => asset.type === activeType)?.id ?? null));
  }, [activeType, apiBase]);

  const loadReader = useCallback(async (assetId: string) => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(assetId)}/reader`, { credentials: "include" });
    const data = await response.json() as { success?: boolean; error?: string } & Partial<ReaderData>;
    if (!response.ok || !data.success || !data.asset) throw new Error(data.error || "资源内容读取失败");
    setReader({ asset: data.asset, pageNotes: data.pageNotes ?? [], feedback: data.feedback ?? null, quizAttempts: data.quizAttempts ?? [] });
  }, [apiBase]);

  useEffect(() => { void loadAssets().catch((error) => setNotice(error instanceof Error ? error.message : "学习资产读取失败")).finally(() => setLoading(false)); }, [loadAssets]);
  useEffect(() => { if (selectedId) void loadReader(selectedId).catch((error) => setNotice(error instanceof Error ? error.message : "资源内容读取失败")); else setReader(null); }, [loadReader, selectedId]);
  useEffect(() => {
    if (!resizing) return;
    const move = (event: MouseEvent) => setNotesWidth(Math.max(280, Math.min(480, window.innerWidth - event.clientX)));
    const end = () => setResizing(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", end);
    return () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", end); };
  }, [resizing]);

  const selectType = (type: ResourceType) => {
    setActiveType(type);
    setSelectedId(assets.find((asset) => asset.type === type)?.id ?? null);
    setNotice("");
  };

  const deleteAsset = async (asset: ResourceAsset) => {
    if (!window.confirm(`删除“${asset.title}”？该资源的笔记与作答记录也会一并删除。`)) return;
    setNotice("");
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(asset.id)}`, { method: "DELETE", credentials: "include" });
      const data = await response.json() as { success?: boolean; error?: string };
      if (!response.ok || !data.success) throw new Error(data.error || "资源删除失败");
      setAssets((current) => current.filter((item) => item.id !== asset.id));
      if (selectedId === asset.id) setSelectedId(null);
      setReader(null);
    } catch (error) { setNotice(error instanceof Error ? error.message : "资源删除失败"); }
  };

  const exportAsset = (format: "md" | "txt" | "json" | "ppt") => {
    if (!selectedAsset) return;
    const link = document.createElement("a");
    link.href = `${apiBase}/api/learning/assets/${encodeURIComponent(selectedAsset.id)}/export?format=${format}`;
    link.download = `${selectedAsset.title}.${format}`;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  // 把“当前资源 + 掌握反馈”带到学习页，由多智能体针对薄弱点生成练习。
  const reinforceFromAsset = (asset: ResourceAsset, level: "high" | "medium" | "low" | null) => {
    const wording = level === "low" ? "掌握不好" : level === "medium" ? "掌握一般" : level === "high" ? "已完全掌握" : "尚未反馈掌握情况";
    const draft = `针对《${asset.title}》做针对性练习：我的阅读反馈是“${wording}”，请围绕它覆盖的知识点生成分层习题并附解析，重点考薄弱处。`;
    try { window.localStorage.setItem("im-training-agent:study-prefill", JSON.stringify({ draft, knowledgePointId: asset.knowledgePointIds[0] ?? "", resourceType: "tiered_quiz", createdAt: Date.now() })); } catch { /* 存储不可用时仅跳转 */ }
    onNavigate("study");
  };

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };

  return <main className={`app-shell flex h-screen min-h-0 flex-col overflow-hidden bg-background ${resizing ? "select-none" : ""}`}>
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => setProfileOpen(true)} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习情况</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" onClick={() => onNavigate("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">资源</button><button type="button" onClick={() => onNavigate("validation")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">验证</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="resource-layout flex min-h-0 min-w-[1180px] flex-1 overflow-hidden">
      <aside aria-label="资源目录" className="flex w-[264px] shrink-0 flex-col border-r bg-slate-50/80">
        <nav aria-label="资源类型" className="shrink-0 border-b bg-background px-3 py-3">
          {typeItems.map((item) => { const Icon = item.icon; const active = activeType === item.type; const count = assets.filter((asset) => asset.type === item.type).length; return <button key={item.type} type="button" onClick={() => selectType(item.type)} className={`flex w-full items-center gap-2.5 border-l px-2.5 py-2 text-left text-xs font-medium transition-colors ${active ? "border-foreground bg-muted/70 text-foreground" : "border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}><Icon className="h-4 w-4 shrink-0" /><span className="flex-1">{item.label}</span>{count > 0 ? <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none">{count}</span> : null}</button>; })}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">{loading ? <div className="px-2 py-4 text-xs text-muted-foreground">正在读取资源</div> : activeAssets.length === 0 ? <div className="border border-dashed px-3 py-8 text-center text-xs leading-5 text-muted-foreground">还没有{typeLabel(activeType)}，从学习页生成后会出现在这里。</div> : <div className="space-y-0.5">{activeAssets.map((asset) => <article key={asset.id} className={`group border-l px-2.5 py-2 transition-colors ${selectedId === asset.id ? "border-foreground bg-background" : "border-transparent hover:border-foreground/30 hover:bg-background/70"}`}><button type="button" onClick={() => setSelectedId(asset.id)} className="block w-full text-left"><div className="line-clamp-2 text-xs font-medium leading-5">{asset.title}</div><div className="mt-1 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(asset.createdAt)}</div></button><button type="button" onClick={() => void deleteAsset(asset)} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"><Trash2 className="h-3 w-3" />删除</button></article>)}</div>}</div>
      </aside>

      <section className="flex min-w-[460px] flex-1 flex-col overflow-hidden bg-card" aria-label="资源阅读与作答">
        {notice ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">{notice}</div> : null}
        <div className="flex shrink-0 justify-end border-b bg-background px-5 py-2"><button type="button" onClick={() => setQaOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium hover:bg-muted"><MessageCircleQuestion className="h-3.5 w-3.5" />资源问答</button></div>
        {selectedAsset ? <ProvenanceStrip asset={selectedAsset} onOpenValidation={(runId) => {
          try { window.localStorage.setItem("im-training-agent:validation-prefill", JSON.stringify({ runId })); } catch { /* 忽略 */ }
          onNavigate("validation");
        }} /> : null}
        {reader?.asset.type === "lecture" ? <LectureReader reader={reader} onExport={exportAsset} /> : reader?.asset.type === "tiered_quiz" ? <QuizReader apiBase={apiBase} reader={reader} onReaderChange={setReader} /> : reader?.asset.type === "presentation" ? <PresentationReader reader={reader} onExport={exportAsset} /> : reader ? <GenericReader apiBase={apiBase} reader={reader} onReaderChange={setReader} onExport={exportAsset} /> : loading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取资源</div> : <EmptyReader label={typeLabel(activeType)} />}
      </section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing(true)} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: notesWidth }} className="flex shrink-0 flex-col border-l bg-muted/15" aria-label="资源笔记或解析">
        {reader?.asset.type === "lecture" ? <LectureNotes apiBase={apiBase} reader={reader} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(reader.asset, reader.feedback?.masteryLevel ?? null)} /> : reader?.asset.type === "tiered_quiz" ? <QuizAnswerPanel reader={reader} /> : reader ? <GenericFeedback apiBase={apiBase} reader={reader} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(reader.asset, reader.feedback?.masteryLevel ?? null)} /> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">选择一份资源后，在这里查看笔记、反馈或答案解析。</div>}
      </aside>
    </div>
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
    {profileOpen && <ProfileDialog apiBase={apiBase} user={user} onUserChange={onUserChange} onClose={() => setProfileOpen(false)} />}
    {qaOpen && <ResourceQuestionDialog apiBase={apiBase} selectedAssetId={selectedAsset?.id ?? null} selectedAssetTitle={selectedAsset?.title} onClose={() => setQaOpen(false)} />}
  </main>;
}

function EmptyReader({ label }: { label: string }) {
  return <div className="flex h-full flex-col items-center justify-center text-center"><FileText className="mb-3 h-8 w-8 text-muted-foreground/45" /><p className="text-sm font-medium">选择一份{label}</p></div>;
}

// 讲义为持续下滑的富文本长文：标题即章节锚点（自动编号），顶部细条显示阅读进度，右侧目录滚动定位。
function LectureReader({ reader, onExport }: { reader: ReaderData; onExport: (format: "md" | "txt" | "json" | "ppt") => void }) {
  const blocks = useMemo(() => [...reader.asset.blocks].sort((a, b) => a.position - b.position), [reader.asset]);
  const headings = blocks.filter((block) => block.type === "heading");
  const sectionNumber = useMemo(() => {
    const map = new Map<string, number>();
    headings.forEach((block, index) => map.set(block.id, index + 1));
    return map;
  }, [headings]);
  const [tocOpen, setTocOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 4 ? Math.min(1, el.scrollTop / max) : 0);
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3">
      <div className="min-w-0"><div className="text-[10px] text-muted-foreground">讲义</div><h1 className="truncate text-[13px] font-semibold tracking-tight">{reader.asset.title}</h1></div>
      <div className="flex shrink-0 items-center gap-1.5">
        {headings.length > 0 && <div className="relative">
          <button type="button" onClick={() => setTocOpen((open) => !open)} className="h-8 rounded-lg border px-3 text-xs hover:bg-muted">章节</button>
          {tocOpen && <div className="absolute right-0 top-10 z-20 max-h-64 w-60 overflow-y-auto rounded-xl border bg-card p-1.5 shadow-lg">{headings.map((block, index) => <button key={block.id} type="button" onClick={() => { document.getElementById(`sec-${block.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setTocOpen(false); }} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs hover:bg-muted"><span className="w-4 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{index + 1}</span><span className="line-clamp-2">{String(block.content)}</span></button>)}</div>}
        </div>}
        <button type="button" onClick={() => onExport("md")} className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />Markdown</button>
      </div>
    </div>
    <div ref={scrollRef} onScroll={handleScroll} className="min-h-0 flex-1 overflow-y-auto bg-background/40">
      <div className="sticky top-0 z-10 h-0.5 bg-transparent"><div className="h-full rounded-r-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <article className="mx-auto max-w-3xl px-8 py-8">
        {reader.asset.learningObjectives.length > 0 && <div className="mb-8 border-y border-blue-100 bg-blue-50/45 px-5 py-4"><div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-blue-700"><Target className="h-3.5 w-3.5" />学习目标</div><ul className="mt-3 space-y-2">{reader.asset.learningObjectives.map((objective) => <li key={objective} className="flex gap-2.5 text-[13px] leading-6 text-blue-950"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />{objective}</li>)}</ul></div>}
        <div className="space-y-7">{blocks.map((block) => <section key={block.id} id={block.type === "heading" ? `sec-${block.id}` : undefined} className="scroll-mt-4">{renderBlockContent(block, sectionNumber.get(block.id))}</section>)}</div>
        <div className="h-12" />
      </article>
    </div>
  </div>;
}

function PresentationReader({ reader, onExport }: { reader: ReaderData; onExport: (format: "md" | "txt" | "json" | "ppt") => void }) {
  const blocks = useMemo(() => [...reader.asset.blocks].sort((a, b) => a.position - b.position), [reader.asset]);
  const slides = useMemo(() => {
    const result: ResourceBlock[][] = [];
    let current: ResourceBlock[] = [];
    for (const block of blocks) {
      if (block.type === "heading" && current.length) { result.push(current); current = []; }
      current.push(block);
    }
    if (current.length) result.push(current);
    return result.length ? result : [blocks];
  }, [blocks]);
  const [index, setIndex] = useState(0);
  const slide = slides[index] ?? [];
  const headingBlock = slide.find((block) => block.type === "heading");
  const isCover = !headingBlock;
  const title = String(headingBlock?.content ?? reader.asset.title);
  const bulletBlocks = slide.filter((block) => block.type === "list" && Array.isArray(block.content));
  const noteBlocks = slide.filter((block) => block.type === "paragraph" && typeof block.content === "string");
  return <div className="flex min-h-0 flex-1 flex-col bg-slate-100/80">
    <div className="flex shrink-0 items-center justify-between border-b bg-background px-5 py-3.5"><div><div className="text-[11px] text-muted-foreground">PPT · 演示稿</div><h1 className="mt-0.5 text-sm font-semibold">{reader.asset.title}</h1></div><div className="flex items-center gap-2"><span className="text-xs text-muted-foreground">第 {index + 1} / {slides.length} 页</span><button type="button" onClick={() => onExport("ppt")} className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />下载 PPT</button></div></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div className="mx-auto aspect-video w-full max-w-4xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60">
        <div className="flex h-full flex-col">
          <div className="h-1.5 shrink-0 bg-gradient-to-r from-blue-600 via-indigo-500 to-violet-500" />
          <div className="flex min-h-0 flex-1 flex-col px-10 py-7 sm:px-14 sm:py-9">
            {isCover ? <div className="flex h-full flex-col justify-center">
              <div className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-600">设备数据诊断训练</div>
              <h2 className="mt-4 text-4xl font-bold leading-tight tracking-tight text-slate-900">{reader.asset.title}</h2>
              <div className="mt-5 h-1 w-16 rounded-full bg-blue-600" />
              <div className="mt-6 max-w-2xl space-y-3">{noteBlocks.map((block) => <RichText key={block.id} text={String(block.content)} />)}</div>
              <div className="mt-8 text-xs text-slate-400">{reader.asset.learningObjectives[0] ?? "基于证据的多智能体学习材料"}</div>
            </div> : <>
              <div className="flex items-start justify-between gap-4">
                <h2 className="text-2xl font-bold leading-snug tracking-tight text-slate-900 sm:text-3xl">{title}</h2>
                <span className="mt-1 shrink-0 rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[11px] font-medium text-slate-500">{String(index + 1).padStart(2, "0")}</span>
              </div>
              <div className="mt-2.5 h-1 w-12 rounded-full bg-blue-600" />
              <div className="mt-6 flex-1 space-y-3 overflow-y-auto pr-1">
                {bulletBlocks.map((block) => <ul key={block.id} className="space-y-3">
                  {(block.content as string[]).map((item, itemIndex) => <li key={itemIndex} className="flex items-start gap-3 text-[15px] leading-7 text-slate-700 sm:text-base">
                    <span className="mt-2 h-2 w-2 shrink-0 rounded-sm bg-gradient-to-br from-blue-500 to-indigo-500" />
                    <RichInlineText text={item} />
                  </li>)}
                </ul>)}
              </div>
              {noteBlocks.length > 0 && <div className="mt-4 shrink-0 rounded-xl bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">讲解词</div>
                <div className="mt-1.5 space-y-1 text-[13px] leading-6 text-slate-500">{noteBlocks.map((block) => <RichText key={block.id} text={String(block.content)} />)}</div>
              </div>}
            </>}
          </div>
        </div>
      </div>
    </div>
    <div className="flex shrink-0 items-center justify-center gap-2 border-t bg-background px-5 py-3"><button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} className="h-8 rounded-lg border px-3 text-xs disabled:opacity-35">上一页</button><div className="flex max-w-[60%] gap-1.5 overflow-x-auto">{slides.map((_, itemIndex) => <button key={itemIndex} type="button" onClick={() => setIndex(itemIndex)} aria-label={`第 ${itemIndex + 1} 页`} className={`h-2 w-6 rounded-full transition-colors ${itemIndex === index ? "bg-blue-600" : "bg-slate-300 hover:bg-slate-400"}`} />)}</div><button type="button" disabled={index === slides.length - 1} onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} className="h-8 rounded-lg border px-3 text-xs disabled:opacity-35">下一页</button></div>
  </div>;
}

const NOTE_PAGE_KEY = "main";

function LectureNotes({ apiBase, reader, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const stored = reader.pageNotes.find((note) => note.pageKey === NOTE_PAGE_KEY)?.content ?? "";
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(reader.pageNotes.find((note) => note.pageKey === NOTE_PAGE_KEY)?.content ?? ""); setSaved(false); }, [reader.asset.id, reader.pageNotes]);
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/pages/${encodeURIComponent(NOTE_PAGE_KEY)}/note`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft }) });
      const data = await response.json() as { success?: boolean; note?: PageNote; error?: string };
      if (!response.ok || !data.success || !data.note) throw new Error(data.error || "笔记保存失败");
      onReaderChange({ ...reader, pageNotes: [...reader.pageNotes.filter((note) => note.pageKey !== data.note!.pageKey), data.note] });
      setSaved(true);
    } finally { setSaving(false); }
  };
  const feedback = async (level: "high" | "medium" | "low") => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/feedback`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true, masteryLevel: level }) });
    const data = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !data.success) return;
    onReaderChange({ ...reader, feedback: { completed: true, mastered: level === "high", masteryLevel: level, updatedAt: Date.now() } });
    notifyEvidenceUpdated();
  };
  const level = reader.feedback?.masteryLevel;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">讲义笔记</div></div><div className="min-h-0 flex-1 p-4"><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} placeholder="例如：我理解了……；还不确定……；下一步要验证……" className="h-full min-h-[220px] w-full resize-none rounded-xl border bg-card p-4 text-sm leading-7 outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/10" /><div className="mt-2 text-right text-[11px] text-muted-foreground">{draft.length} 字</div></div><div className="border-t bg-background p-4"><button type="button" disabled={saving} onClick={() => void save()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50">{saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}{saved ? "笔记已保存" : saving ? "正在保存" : "保存笔记"}</button><div className="mt-5 border-t pt-4"><div className="text-sm font-semibold">阅读反馈</div><div className="mt-3 grid gap-2"><button type="button" onClick={() => void feedback("high")} className={`h-9 rounded-lg border text-xs font-medium ${level === "high" ? "border-emerald-600 bg-emerald-600 text-white" : "hover:bg-emerald-50"}`}>完全掌握</button><button type="button" onClick={() => void feedback("medium")} className={`h-9 rounded-lg border text-xs font-medium ${level === "medium" ? "border-amber-500 bg-amber-500 text-white" : "hover:bg-amber-50"}`}>掌握一般</button><button type="button" onClick={() => void feedback("low")} className={`h-9 rounded-lg border text-xs font-medium ${level === "low" ? "border-rose-600 bg-rose-600 text-white" : "hover:bg-rose-50"}`}>掌握不好</button></div><button type="button" onClick={onReinforce} className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-foreground/25 bg-muted/40 text-xs font-medium hover:bg-muted"><Target className="h-3.5 w-3.5" />基于反馈生成针对性练习</button></div></div></div>;
}

const QUESTION_TYPE_LABELS: Record<QuizQuestionType, string> = { choice: "选择", blank: "填空", short_answer: "简答" };

function QuizReader({ apiBase, reader, onReaderChange }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void }) {
  const questions = useMemo(() => getQuizQuestions(reader.asset), [reader.asset]);
  const [index, setIndex] = useState(0);
  const [answerId, setAnswerId] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(Date.now());
  useEffect(() => { setIndex(0); setAnswerId(""); setShowReference(false); startedAt.current = Date.now(); }, [reader.asset.id]);
  const question = questions[index];
  const questionType: QuizQuestionType = question?.type ?? "choice";
  const latest = reader.quizAttempts.filter((attempt) => attempt.questionId === question?.id).at(-1) ?? null;
  const jump = (next: number) => { setIndex(next); setAnswerId(""); setShowReference(false); startedAt.current = Date.now(); };
  const submit = async (selfAssessed?: boolean) => {
    if (!question || submitting) return;
    const answer = questionType === "choice" ? answerId : answerId.trim();
    if (!answer || (questionType === "choice" && !answerId)) return;
    if (questionType === "short_answer" && selfAssessed === undefined) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/quiz-attempts`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, answerId: answer, durationMs: Date.now() - startedAt.current, selfAssessed }),
      });
      const data = await response.json() as { success?: boolean; attempt?: QuizAttempt; error?: string };
      if (!response.ok || !data.success || !data.attempt) throw new Error(data.error || "作答提交失败");
      onReaderChange({ ...reader, quizAttempts: [...reader.quizAttempts, data.attempt] });
      notifyEvidenceUpdated();
    } finally { setSubmitting(false); }
  };
  if (!question) return <EmptyReader label="习题" />;
  // 提交后当场标出对错：正确答案绿色，错选/答错红色；未提交时保持选中高亮
  const answered = Boolean(latest);
  const optionState = (optionId: string): "idle" | "selected" | "correct" | "wrong" => {
    if (answered && optionId === question.answerId) return "correct";
    if (answered && !latest!.correct && optionId === latest!.answerId) return "wrong";
    if (!answered && answerId === optionId) return "selected";
    return "idle";
  };
  const optionClass = (state: ReturnType<typeof optionState>) => {
    switch (state) {
      case "correct": return "border-emerald-400 bg-emerald-50/80";
      case "wrong": return "border-rose-300 bg-rose-50/80";
      case "selected": return "border-blue-300 bg-blue-50 shadow-sm";
      default: return "hover:border-foreground/35 hover:bg-muted/25 hover:shadow-sm";
    }
  };
  const chipClass = (state: ReturnType<typeof optionState>) => {
    switch (state) {
      case "correct": return "border-emerald-500 bg-emerald-500 text-white";
      case "wrong": return "border-rose-500 bg-rose-500 text-white";
      case "selected": return "border-blue-400 bg-blue-400 text-white";
      default: return "border-border text-muted-foreground";
    }
  };
  const canSubmit = questionType === "choice" ? Boolean(answerId) : questionType === "blank" ? Boolean(answerId.trim()) : Boolean(answerId.trim()) && showReference;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div><div className="text-[11px] text-muted-foreground">分层习题</div><h1 className="mt-0.5 text-sm font-semibold">{reader.asset.title}</h1></div><div className="flex items-center gap-2"><span className="rounded-full border px-2.5 py-1 text-[11px]">{question.level}</span><span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">{QUESTION_TYPE_LABELS[questionType]}</span>{answered ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${latest!.correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{latest!.correct ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{latest!.correct ? "答对" : "再想想"}</span> : null}</div></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl px-8 py-10"><div className="text-xs text-muted-foreground">第 {index + 1} 题 / 共 {questions.length} 题</div><h2 className="mt-4 text-xl font-semibold leading-8">{question.prompt}</h2>
    {questionType === "choice" ? <div className="mt-8 space-y-3">{(question.options ?? []).map((option) => {
      const state = optionState(option.id);
      return <button key={option.id} type="button" onClick={() => setAnswerId(option.id)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-6 transition-all ${optionClass(state)}`}><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md border text-[11px] font-semibold transition-colors ${chipClass(state)}`}>{option.id}</span><span>{option.text}</span></button>;
    })}</div> : null}
    {questionType === "blank" ? <div className="mt-8"><input value={answerId} disabled={answered} onChange={(event) => setAnswerId(event.target.value)} placeholder="在横线上填入你的答案" className={`h-12 w-full rounded-xl border px-4 text-sm outline-none transition-colors focus:ring-2 focus:ring-foreground/10 ${answered ? (latest!.correct ? "border-emerald-400 bg-emerald-50/60" : "border-rose-300 bg-rose-50/60") : "bg-card"}`} />{answered ? <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50/50 px-4 py-3 text-xs leading-5 text-emerald-800">标准答案：{question.answerId.split("|").join(" / ")}</div> : null}</div> : null}
    {questionType === "short_answer" ? <div className="mt-8 space-y-3">
      <textarea value={answerId} disabled={answered} onChange={(event) => setAnswerId(event.target.value)} rows={5} placeholder="写下你的思路和判断依据……" className={`w-full resize-none rounded-xl border bg-card p-4 text-sm leading-7 outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/10 ${answered ? (latest!.correct ? "border-emerald-400" : "border-rose-300") : ""}`} />
      {!showReference && !answered ? <button type="button" disabled={!answerId.trim()} onClick={() => setShowReference(true)} className="inline-flex h-9 items-center gap-1.5 rounded-lg border px-3.5 text-xs font-medium hover:bg-muted disabled:opacity-40">写完了，对照参考答案</button> : null}
      {showReference && !answered ? <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs font-semibold">参考答案要点</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{question.answerId}</p><div className="mt-4 flex gap-2"><button type="button" onClick={() => void submit(true)} className="h-9 flex-1 rounded-lg border border-emerald-300 bg-emerald-50 text-xs font-medium text-emerald-700 hover:bg-emerald-100">我答出了关键要点</button><button type="button" onClick={() => void submit(false)} className="h-9 flex-1 rounded-lg border border-amber-300 bg-amber-50 text-xs font-medium text-amber-700 hover:bg-amber-100">还有要点没答到</button></div></div> : null}
      {answered ? <div className={`rounded-xl border px-4 py-3 text-xs leading-5 ${latest!.correct ? "border-emerald-200 bg-emerald-50/50 text-emerald-800" : "border-amber-200 bg-amber-50/50 text-amber-800"}`}>你的回答：{latest!.answerId || "（未作答）"}</div> : null}
    </div> : null}
    {questionType !== "short_answer" ? <button type="button" disabled={!canSubmit || submitting} onClick={() => void submit()} className="mt-8 inline-flex h-10 items-center justify-center rounded-lg bg-blue-400 px-5 text-sm font-medium text-white shadow-sm shadow-blue-200 transition-colors hover:bg-blue-500 disabled:opacity-35">{submitting ? "正在提交" : answered ? "再次提交" : "提交答案"}</button> : null}
    </article></div><div className="shrink-0 border-t bg-background px-5 py-4"><div className="flex flex-wrap gap-2">{questions.map((item, itemIndex) => { const attempt = reader.quizAttempts.filter((record) => record.questionId === item.id).at(-1); return <button key={item.id} type="button" onClick={() => jump(itemIndex)} className={`flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-medium transition-colors ${itemIndex === index ? "border-blue-400 bg-blue-400 text-white" : attempt?.correct ? "border-emerald-300 bg-emerald-50 text-emerald-700" : attempt ? "border-rose-300 bg-rose-50 text-rose-700" : "hover:bg-muted"}`}>{itemIndex + 1}</button>; })}</div></div></div>;
}

function QuizAnswerPanel({ reader }: { reader: ReaderData }) {
  const questions = getQuizQuestions(reader.asset);
  const latestAttempt = reader.quizAttempts.at(-1) ?? null;
  const question = latestAttempt ? questions.find((item) => item.id === latestAttempt.questionId) : null;
  const correctCount = questions.filter((item) => reader.quizAttempts.filter((attempt) => attempt.questionId === item.id).at(-1)?.correct).length;
  const questionType: QuizQuestionType = question?.type ?? "choice";
  const answerText = !question ? "" : questionType === "choice"
    ? `${question.answerId}. ${question.options?.find((item) => item.id === question.answerId)?.text ?? ""}`
    : questionType === "blank"
      ? question.answerId.split("|").join(" / ")
      : question.answerId;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">答案与解析</div><div className="mt-0.5 text-[11px] text-muted-foreground">正确 {correctCount} / {questions.length}</div></div><div className="min-h-0 flex-1 overflow-y-auto p-5">{!latestAttempt || !question ? <div className="flex h-full items-center justify-center text-center text-sm leading-6 text-muted-foreground">选择答案并提交后，<br />这里会显示判分与解析。</div> : <div><div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${latestAttempt.correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{latestAttempt.correct ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{latestAttempt.correct ? (questionType === "short_answer" ? "已掌握" : "回答正确") : (questionType === "short_answer" ? "需再巩固" : "需要复习")}</div>{questionType !== "short_answer" ? <div className="mt-5"><div className="text-xs text-muted-foreground">正确答案</div><div className="mt-1 text-sm font-semibold">{answerText}</div></div> : <div className="mt-5"><div className="text-xs text-muted-foreground">参考答案要点</div><p className="mt-1 text-sm leading-6 text-muted-foreground">{answerText}</p></div>}<div className="mt-5 border-t pt-4"><div className="text-xs text-muted-foreground">解析</div><p className="mt-2 text-sm leading-7 text-muted-foreground">{question.explanation}</p></div><div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />本次用时 {Math.max(1, Math.round(latestAttempt.durationMs / 1000))} 秒</div></div>}</div></div>;
}

function GenericReader({ reader, onExport }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onExport: (format: "md" | "txt" | "json" | "ppt") => void }) {
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div><div className="text-[11px] text-muted-foreground">{typeLabel(reader.asset.type)}</div><h1 className="mt-0.5 text-sm font-semibold">{reader.asset.title}</h1></div><button type="button" onClick={() => onExport("md")} className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />Markdown</button></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl space-y-7 px-8 py-9"><div><div className="text-[11px] text-muted-foreground">学习目标</div><ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{reader.asset.learningObjectives.map((objective) => <li key={objective} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" />{objective}</li>)}</ul></div>{reader.asset.blocks.sort((a, b) => a.position - b.position).map((block) => <section key={block.id}>{renderBlockContent(block)}</section>)}</article></div></div>;
}

function GenericFeedback({ apiBase, reader, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const markRead = async () => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/feedback`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) });
    const data = await response.json() as { success?: boolean };
    if (response.ok && data.success) { onReaderChange({ ...reader, feedback: { completed: true, mastered: reader.feedback?.mastered ?? false, masteryLevel: reader.feedback?.masteryLevel ?? null, updatedAt: Date.now() } }); notifyEvidenceUpdated(); }
  };
  return <div className="flex h-full flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">学习记录</div></div><div className="flex flex-1 flex-col justify-between p-5"><div><div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">当前资源</div><div className="mt-2 text-sm font-semibold">{typeLabel(reader.asset.type)}</div></div></div><div><button type="button" onClick={() => void markRead()} className={`h-9 w-full rounded-lg border text-xs font-medium ${reader.feedback?.completed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "hover:bg-muted"}`}>{reader.feedback?.completed ? "已记录完成" : "记录已学习"}</button><button type="button" onClick={onReinforce} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-foreground/25 bg-muted/40 text-xs font-medium hover:bg-muted"><Target className="h-3.5 w-3.5" />按这份资源的薄弱点生成练习</button></div></div></div>;
}
