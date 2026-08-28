"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Clock3,
  Download,
  FileText,
  Flag,
  Layers3,
  LogOut,
  Map,
  Save,
  Target,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";

type ResourceType = "lecture" | "tiered_quiz" | "practice_guide" | "concept_map" | "review_cards" | "challenge_task";
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
type QuizQuestion = { id: string; level: "L1" | "L2" | "L3"; prompt: string; options: Array<{ id: string; text: string }>; answerId: string; explanation: string; evidenceIds: string[] };
type QuizAttempt = { id: string; questionId: string; answerId: string; correct: boolean; durationMs: number; createdAt: number };
type ReaderData = { asset: ResourceAsset; pageNotes: PageNote[]; feedback: Feedback | null; quizAttempts: QuizAttempt[] };

const LecturePageContext = createContext<{ pageIndex: number; setPageIndex: (index: number) => void }>({ pageIndex: 0, setPageIndex: () => undefined });

const typeItems: Array<{ type: ResourceType; label: string; icon: typeof BookOpen }> = [
  { type: "lecture", label: "讲义", icon: BookOpen },
  { type: "tiered_quiz", label: "习题", icon: ClipboardList },
  { type: "practice_guide", label: "实操", icon: Wrench },
  { type: "concept_map", label: "脉络", icon: Map },
  { type: "review_cards", label: "复习卡", icon: Layers3 },
  { type: "challenge_task", label: "挑战", icon: Flag },
];

const avatarClasses: Record<AuthenticatedUser["avatarKey"], string> = {
  graphite: "bg-zinc-900 text-white", ocean: "bg-sky-600 text-white", violet: "bg-violet-600 text-white",
  forest: "bg-emerald-600 text-white", amber: "bg-amber-500 text-white", rose: "bg-rose-600 text-white",
};

function typeLabel(type: ResourceType) {
  return typeItems.find((item) => item.type === type)?.label ?? "资源";
}

function renderBlockContent(block: ResourceBlock) {
  if (block.type === "heading") return <h3 className="text-lg font-semibold tracking-tight">{String(block.content)}</h3>;
  if (typeof block.content === "string") return <p className="whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{block.content}</p>;
  if (Array.isArray(block.content)) return <ul className="space-y-2 pl-1 text-sm leading-6 text-muted-foreground">{block.content.map((item, index) => <li key={index} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" />{String(item)}</li>)}</ul>;
  if (block.content && typeof block.content === "object") {
    const data = block.content as { label?: string; locator?: string; summary?: string; language?: string; caption?: string; code?: string; columns?: unknown; rows?: unknown; sources?: string[] };
    if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
      return <div className="overflow-hidden rounded-xl border"><div className="border-b bg-muted/30 px-4 py-2.5 text-xs font-medium">{data.caption ?? "数据摘录"}</div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-muted/15 text-muted-foreground">{(data.columns as string[]).map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{(data.rows as Array<Array<string | number | null>>).map((row, rowIndex) => <tr key={rowIndex} className="border-b last:border-b-0">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">{cell === null ? "—" : String(cell)}</td>)}</tr>)}</tbody></table></div>{data.sources?.length ? <div className="border-t bg-muted/15 px-4 py-2 font-mono text-[10px] text-muted-foreground">{data.sources[0]}</div> : null}</div>;
    }
    if (typeof data.code === "string") {
      return <figure className="overflow-hidden rounded-xl border bg-zinc-950"><figcaption className="flex items-center justify-between border-b border-zinc-800 px-4 py-2.5 text-xs text-zinc-300"><span className="font-medium">{data.caption ?? "代码示例"}</span><span className="font-mono text-[10px] text-zinc-500">{data.language ?? "python"}</span></figcaption><pre className="overflow-x-auto px-4 py-4 text-xs leading-6 text-zinc-100"><code>{data.code}</code></pre></figure>;
    }
    if (data.summary || data.locator) return <div className="rounded-xl border bg-muted/30 p-4"><div className="text-xs font-medium">{data.label ?? "证据"}</div><p className="mt-2 text-sm leading-6 text-muted-foreground">{data.summary}</p>{data.locator ? <div className="mt-3 font-mono text-[11px] text-muted-foreground">{data.locator}</div> : null}</div>;
  }
  return <p className="text-sm text-muted-foreground">该部分暂时没有可显示内容。</p>;
}

function getQuizQuestions(asset: ResourceAsset): QuizQuestion[] {
  const block = asset.blocks.find((item) => item.type === "question");
  const raw = block?.content as { questions?: unknown } | undefined;
  if (!Array.isArray(raw?.questions)) return [];
  return raw.questions.filter((item): item is QuizQuestion => Boolean(item) && typeof item === "object" && typeof (item as QuizQuestion).id === "string" && Array.isArray((item as QuizQuestion).options));
}

type LecturePage = { key: string; title: string; blocks: ResourceBlock[] };

function blockPageTitle(block: ResourceBlock, sawHeading: boolean) {
  if (block.type === "evidence") return "证据参考";
  if (block.type === "question") return "思考与练习";
  if (block.type === "code") return "代码示例";
  if (block.type === "table") return "数据摘录";
  return sawHeading ? "学习内容" : "学习概览";
}

// 标题块开启新页并跟随其正文；代码/表格/证据/习题独立成页，其余正文并入当前页。
function buildLecturePages(asset: ResourceAsset): LecturePage[] {
  const blocks = [...asset.blocks].sort((a, b) => a.position - b.position);
  const pages: LecturePage[] = [];
  let current: LecturePage | null = null;
  let sawHeading = false;
  for (const block of blocks) {
    if (block.type === "heading") {
      sawHeading = true;
      current = { key: `block-${block.id}`, title: String(block.content ?? "学习内容"), blocks: [block] };
      pages.push(current);
      continue;
    }
    const standalone = block.type === "evidence" || block.type === "table" || block.type === "code" || block.type === "question";
    if (!current || standalone) {
      current = { key: `block-${block.id}`, title: blockPageTitle(block, sawHeading), blocks: [] };
      pages.push(current);
    }
    current.blocks.push(block);
    if (block.type === "question") current = null;
  }
  return pages.filter((page) => page.blocks.length > 0);
}

type ResourceWorkbenchProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  onNavigate: (view: "path" | "study" | "resources") => void;
};

export function ResourceWorkbench({ apiBase, user, onLogout, onNavigate }: ResourceWorkbenchProps) {
  const [assets, setAssets] = useState<ResourceAsset[]>([]);
  const [activeType, setActiveType] = useState<ResourceType>("lecture");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reader, setReader] = useState<ReaderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [catalogHover, setCatalogHover] = useState(false);
  const closeTimer = useRef<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notesWidth, setNotesWidth] = useState(330);
  const [resizing, setResizing] = useState(false);
  const [lecturePageIndex, setLecturePageIndex] = useState(0);

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
  useEffect(() => setLecturePageIndex(0), [reader?.asset.id]);
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
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
  };

  const openCatalog = () => {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setCatalogHover(true);
  };

  const scheduleCatalogClose = () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setCatalogHover(false), 180);
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

  const exportAsset = (format: "md" | "txt" | "json") => {
    if (!selectedAsset) return;
    window.open(`${apiBase}/api/learning/assets/${encodeURIComponent(selectedAsset.id)}/export?format=${format}`, "_blank", "noopener,noreferrer");
  };

  // 把“当前资源 + 掌握反馈”带到学习页，由多智能体针对薄弱点生成练习。
  const reinforceFromAsset = (asset: ResourceAsset, level: "high" | "medium" | "low" | null) => {
    const wording = level === "low" ? "掌握不好" : level === "medium" ? "掌握一般" : level === "high" ? "已完全掌握" : "尚未反馈掌握情况";
    const draft = `针对《${asset.title}》做针对性练习：我的阅读反馈是“${wording}”，请围绕它覆盖的知识点生成分层习题并附解析，重点考薄弱处。`;
    try { window.localStorage.setItem("im-training-agent:study-prefill", JSON.stringify({ draft, knowledgePointId: asset.knowledgePointIds[0] ?? "", resourceType: "tiered_quiz", createdAt: Date.now() })); } catch { /* 存储不可用时仅跳转 */ }
    onNavigate("study");
  };

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };

  return <LecturePageContext.Provider value={{ pageIndex: lecturePageIndex, setPageIndex: setLecturePageIndex }}><main className={`flex h-screen min-h-0 flex-col overflow-hidden bg-background ${resizing ? "select-none" : ""}`}>
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <button type="button" onClick={() => onNavigate("path")} className="flex items-center gap-2.5 text-left"><span className={`flex h-9 w-9 items-center justify-center rounded-full text-xs font-semibold ${avatarClasses[user.avatarKey]}`}>{user.displayName.slice(0, 1).toUpperCase()}</span><span><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName} · 学习画像</span></span></button>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" onClick={() => onNavigate("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">资源</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="relative flex min-h-0 min-w-[1040px] flex-1 overflow-hidden">
      <div aria-hidden onMouseEnter={openCatalog} className="absolute inset-y-0 left-0 z-40 w-3" />
      <aside onMouseLeave={scheduleCatalogClose} className={`absolute inset-y-0 left-0 z-30 w-[236px] overflow-hidden border-r bg-card shadow-xl transition-transform duration-200 ${catalogHover ? "translate-x-0" : "-translate-x-full"}`} aria-label="资源类型导航">
        <div className="flex h-14 shrink-0 items-center border-b px-4 text-sm font-semibold">资源类型</div>
        <div className="p-2">
          {typeItems.map((item) => { const Icon = item.icon; const active = activeType === item.type; const count = assets.filter((asset) => asset.type === item.type).length; return <button key={item.type} type="button" onClick={() => { selectType(item.type); setCatalogHover(false); }} className={`mb-1 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-xs transition-colors ${active ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"}`}><Icon className="h-4 w-4 shrink-0" /><span className="min-w-0 flex-1">{item.label}</span><span className="shrink-0 text-[10px] text-muted-foreground">{count} 份</span></button>; })}
        </div>
      </aside>

      <section className="flex min-w-[460px] flex-1 flex-col overflow-hidden bg-card" aria-label="资源阅读与作答">
        {notice ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">{notice}</div> : null}
        {selectedAsset ? <div className="flex shrink-0 items-center gap-2 border-b bg-background px-5 py-2"><span className="shrink-0 rounded-full border px-2 py-0.5 text-[10px] text-muted-foreground">{typeLabel(selectedAsset.type)}</span><select value={selectedAsset.id} onChange={(event) => setSelectedId(event.target.value)} aria-label="切换同类型资源" className="h-7 min-w-0 flex-1 truncate rounded-lg border bg-background px-2 text-xs">{activeAssets.map((asset) => <option key={asset.id} value={asset.id}>{asset.title}</option>)}</select><button type="button" onClick={() => void deleteAsset(selectedAsset)} aria-label="删除当前资源" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button></div> : null}
        {reader?.asset.type === "lecture" ? <LectureReader apiBase={apiBase} reader={reader} onReaderChange={setReader} onExport={exportAsset} /> : reader?.asset.type === "tiered_quiz" ? <QuizReader apiBase={apiBase} reader={reader} onReaderChange={setReader} /> : reader ? <GenericReader apiBase={apiBase} reader={reader} onReaderChange={setReader} onExport={exportAsset} /> : loading ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取资源</div> : <EmptyReader label={typeLabel(activeType)} />}
      </section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing(true)} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: notesWidth }} className="flex shrink-0 flex-col border-l bg-muted/15" aria-label="资源笔记或解析">
        {reader?.asset.type === "lecture" ? <LectureNotes apiBase={apiBase} reader={reader} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(reader.asset, reader.feedback?.masteryLevel ?? null)} /> : reader?.asset.type === "tiered_quiz" ? <QuizAnswerPanel reader={reader} /> : reader ? <GenericFeedback apiBase={apiBase} reader={reader} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(reader.asset, reader.feedback?.masteryLevel ?? null)} /> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">选择一份资源后，在这里查看笔记、反馈或答案解析。</div>}
      </aside>
    </div>
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main></LecturePageContext.Provider>;
}

function EmptyReader({ label }: { label: string }) {
  return <div className="flex h-full flex-col items-center justify-center text-center"><FileText className="mb-3 h-8 w-8 text-muted-foreground/45" /><p className="text-sm font-medium">选择一份{label}</p><p className="mt-1 text-xs text-muted-foreground">学习页生成并通过审核后，会自动保存到这里。</p></div>;
}

function LectureReader({ apiBase, reader, onReaderChange, onExport }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onExport: (format: "md" | "txt" | "json") => void }) {
  const pages = useMemo(() => buildLecturePages(reader.asset), [reader.asset]);
  const { pageIndex, setPageIndex } = useContext(LecturePageContext);
  const [tocOpen, setTocOpen] = useState(false);
  const page = pages[pageIndex] ?? pages[0];
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="flex shrink-0 items-center justify-between gap-3 border-b px-5 py-3.5">
      <div className="min-w-0"><div className="text-[11px] text-muted-foreground">讲义</div><h1 className="truncate text-sm font-semibold">{reader.asset.title}</h1></div>
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="relative"><button type="button" onClick={() => setTocOpen((open) => !open)} className="h-8 rounded-lg border px-3 text-xs hover:bg-muted">章节</button>{tocOpen ? <div className="absolute right-0 top-10 z-20 max-h-64 w-56 overflow-y-auto rounded-xl border bg-card p-1.5 shadow-lg">{pages.map((item, index) => <button key={item.key} type="button" onClick={() => { setPageIndex(index); setTocOpen(false); }} className={`w-full rounded-lg px-2.5 py-2 text-left text-xs ${index === pageIndex ? "bg-muted font-medium" : "hover:bg-muted"}`}>{index + 1}. {item.title}</button>)}</div> : null}</div>
        <button type="button" onClick={() => onExport("md")} className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />MD</button>
      </div>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl px-8 py-9"><div className="mb-8 flex items-baseline justify-between border-b pb-4"><div><div className="text-[11px] text-muted-foreground">第 {pageIndex + 1} 页 / {pages.length}</div><h2 className="mt-1 text-2xl font-semibold tracking-tight">{page?.title}</h2></div></div><div className="space-y-6">{page?.blocks.map((block) => <section key={block.id}>{renderBlockContent(block)}</section>)}</div></article></div>
    <div className="flex shrink-0 items-center justify-between border-t px-5 py-3"><button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex(Math.max(0, pageIndex - 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs disabled:opacity-35"><ChevronLeft className="h-3.5 w-3.5" />上一页</button><span className="text-xs text-muted-foreground">{page?.title}</span><button type="button" disabled={pageIndex >= pages.length - 1} onClick={() => setPageIndex(Math.min(pages.length - 1, pageIndex + 1))} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs disabled:opacity-35">下一页<ChevronRight className="h-3.5 w-3.5" /></button></div>
  </div>;
}

function LectureNotes({ apiBase, reader, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const pages = useMemo(() => buildLecturePages(reader.asset), [reader.asset]);
  const { pageIndex } = useContext(LecturePageContext);
  const pageKey = pages[pageIndex]?.key ?? pages[0]?.key ?? "overview";
  const stored = reader.pageNotes.find((note) => note.pageKey === pageKey)?.content ?? "";
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { setDraft(reader.pageNotes.find((note) => note.pageKey === pageKey)?.content ?? ""); setSaved(false); }, [pageKey, reader.asset.id, reader.pageNotes]);
  const save = async () => {
    setSaving(true);
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/pages/${encodeURIComponent(pageKey)}/note`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft }) });
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
  };
  const level = reader.feedback?.masteryLevel;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">本页笔记</div><div className="mt-0.5 text-[11px] text-muted-foreground">笔记会跟随当前讲义页保存</div></div><div className="min-h-0 flex-1 p-4"><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} placeholder="记录关键结论、疑问或自己的理解" className="h-full min-h-[220px] w-full resize-none rounded-xl border bg-card p-3 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-foreground/10" /></div><div className="border-t bg-background p-4"><button type="button" disabled={saving} onClick={() => void save()} className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border text-xs font-medium hover:bg-muted disabled:opacity-50">{saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}{saved ? "笔记已保存" : saving ? "正在保存" : "保存本页笔记"}</button><div className="mt-5 border-t pt-4"><div className="text-sm font-semibold">阅读反馈</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">这会作为学习证据，供画像和下次路径调整参考。</p><div className="mt-3 grid gap-2"><button type="button" onClick={() => void feedback("high")} className={`h-9 rounded-lg border text-xs font-medium ${level === "high" ? "border-emerald-600 bg-emerald-600 text-white" : "hover:bg-emerald-50"}`}>完全掌握</button><button type="button" onClick={() => void feedback("medium")} className={`h-9 rounded-lg border text-xs font-medium ${level === "medium" ? "border-amber-500 bg-amber-500 text-white" : "hover:bg-amber-50"}`}>掌握一般</button><button type="button" onClick={() => void feedback("low")} className={`h-9 rounded-lg border text-xs font-medium ${level === "low" ? "border-rose-600 bg-rose-600 text-white" : "hover:bg-rose-50"}`}>掌握不好</button></div><button type="button" onClick={onReinforce} className="mt-2.5 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-foreground/25 bg-muted/40 text-xs font-medium hover:bg-muted"><Target className="h-3.5 w-3.5" />按这份讲义的薄弱点生成练习</button><p className="mt-2 text-[10px] leading-4 text-muted-foreground">会带着讲义标题与你的反馈跳到学习页，由多智能体针对薄弱处出分层习题；作答结果会继续更新你的技能状态。</p></div></div></div>;
}

function QuizReader({ apiBase, reader, onReaderChange }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void }) {
  const questions = useMemo(() => getQuizQuestions(reader.asset), [reader.asset]);
  const [index, setIndex] = useState(0);
  const [answerId, setAnswerId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const startedAt = useRef(Date.now());
  useEffect(() => { setIndex(0); setAnswerId(""); startedAt.current = Date.now(); }, [reader.asset.id]);
  const question = questions[index];
  const latest = reader.quizAttempts.filter((attempt) => attempt.questionId === question?.id).at(-1) ?? null;
  const jump = (next: number) => { setIndex(next); setAnswerId(""); startedAt.current = Date.now(); };
  const submit = async () => {
    if (!question || !answerId) return;
    setSubmitting(true);
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/quiz-attempts`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ questionId: question.id, answerId, durationMs: Date.now() - startedAt.current }) });
      const data = await response.json() as { success?: boolean; attempt?: QuizAttempt; error?: string };
      if (!response.ok || !data.success || !data.attempt) throw new Error(data.error || "作答提交失败");
      onReaderChange({ ...reader, quizAttempts: [...reader.quizAttempts, data.attempt] });
    } finally { setSubmitting(false); }
  };
  if (!question) return <EmptyReader label="习题" />;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div><div className="text-[11px] text-muted-foreground">分层习题</div><h1 className="mt-0.5 text-sm font-semibold">{reader.asset.title}</h1></div><span className="rounded-full border px-2.5 py-1 text-[11px]">{question.level}</span></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl px-8 py-10"><div className="text-xs text-muted-foreground">第 {index + 1} 题 / 共 {questions.length} 题</div><h2 className="mt-4 text-xl font-semibold leading-8">{question.prompt}</h2><div className="mt-8 space-y-3">{question.options.map((option) => <button key={option.id} type="button" onClick={() => setAnswerId(option.id)} className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left text-sm leading-6 transition-colors ${answerId === option.id ? "border-foreground bg-muted" : "hover:border-foreground/35 hover:bg-muted/30"}`}><span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] ${answerId === option.id ? "border-foreground bg-foreground text-background" : ""}`}>{option.id}</span><span>{option.text}</span></button>)}</div><button type="button" disabled={!answerId || submitting} onClick={() => void submit()} className="mt-8 inline-flex h-10 items-center justify-center rounded-lg bg-foreground px-5 text-sm font-medium text-background disabled:opacity-35">{submitting ? "正在提交" : latest ? "再次提交" : "提交答案"}</button></article></div><div className="shrink-0 border-t bg-background px-5 py-4"><div className="flex flex-wrap gap-2">{questions.map((item, itemIndex) => { const attempt = reader.quizAttempts.filter((record) => record.questionId === item.id).at(-1); return <button key={item.id} type="button" onClick={() => jump(itemIndex)} className={`flex h-9 w-9 items-center justify-center rounded-lg border text-xs font-medium ${itemIndex === index ? "border-foreground bg-foreground text-background" : attempt?.correct ? "border-emerald-300 bg-emerald-50 text-emerald-700" : attempt ? "border-rose-300 bg-rose-50 text-rose-700" : "hover:bg-muted"}`}>{itemIndex + 1}</button>; })}</div></div></div>;
}

function QuizAnswerPanel({ reader }: { reader: ReaderData }) {
  const questions = getQuizQuestions(reader.asset);
  const latestAttempt = reader.quizAttempts.at(-1) ?? null;
  const question = latestAttempt ? questions.find((item) => item.id === latestAttempt.questionId) : null;
  const correctCount = questions.filter((item) => reader.quizAttempts.filter((attempt) => attempt.questionId === item.id).at(-1)?.correct).length;
  return <div className="flex min-h-0 flex-1 flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">答案与解析</div><div className="mt-0.5 text-[11px] text-muted-foreground">正确 {correctCount} / {questions.length}</div></div><div className="min-h-0 flex-1 overflow-y-auto p-5">{!latestAttempt || !question ? <div className="flex h-full items-center justify-center text-center text-sm leading-6 text-muted-foreground">选择答案并提交后，<br />这里会显示判分与解析。</div> : <div><div className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${latestAttempt.correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{latestAttempt.correct ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}{latestAttempt.correct ? "回答正确" : "需要复习"}</div><div className="mt-5"><div className="text-xs text-muted-foreground">正确答案</div><div className="mt-1 text-sm font-semibold">{question.answerId}. {question.options.find((item) => item.id === question.answerId)?.text}</div></div><div className="mt-5 border-t pt-4"><div className="text-xs text-muted-foreground">解析</div><p className="mt-2 text-sm leading-7 text-muted-foreground">{question.explanation}</p></div><div className="mt-5 flex items-center gap-1.5 text-xs text-muted-foreground"><Clock3 className="h-3.5 w-3.5" />本次用时 {Math.max(1, Math.round(latestAttempt.durationMs / 1000))} 秒</div></div>}</div></div>;
}

function GenericReader({ reader, onExport }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onExport: (format: "md" | "txt" | "json") => void }) {
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div><div className="text-[11px] text-muted-foreground">{typeLabel(reader.asset.type)}</div><h1 className="mt-0.5 text-sm font-semibold">{reader.asset.title}</h1></div><button type="button" onClick={() => onExport("md")} className="flex h-8 items-center gap-1 rounded-lg border px-2.5 text-xs hover:bg-muted"><Download className="h-3.5 w-3.5" />MD</button></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl space-y-7 px-8 py-9"><div><div className="text-[11px] text-muted-foreground">学习目标</div><ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{reader.asset.learningObjectives.map((objective) => <li key={objective} className="flex gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" />{objective}</li>)}</ul></div>{reader.asset.blocks.sort((a, b) => a.position - b.position).map((block) => <section key={block.id}>{renderBlockContent(block)}</section>)}</article></div></div>;
}

function GenericFeedback({ apiBase, reader, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const markRead = async () => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/feedback`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) });
    const data = await response.json() as { success?: boolean };
    if (response.ok && data.success) onReaderChange({ ...reader, feedback: { completed: true, mastered: reader.feedback?.mastered ?? false, masteryLevel: reader.feedback?.masteryLevel ?? null, updatedAt: Date.now() } });
  };
  return <div className="flex h-full flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">学习记录</div></div><div className="flex flex-1 flex-col justify-between p-5"><div><div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">当前资源</div><div className="mt-2 text-sm font-semibold">{typeLabel(reader.asset.type)}</div><p className="mt-2 text-xs leading-5 text-muted-foreground">完成使用后可留下学习记录，供个人画像与下一轮路径调整参考。</p></div></div><div><button type="button" onClick={() => void markRead()} className={`h-9 w-full rounded-lg border text-xs font-medium ${reader.feedback?.completed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "hover:bg-muted"}`}>{reader.feedback?.completed ? "已记录完成" : "记录已学习"}</button><button type="button" onClick={onReinforce} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-foreground/25 bg-muted/40 text-xs font-medium hover:bg-muted"><Target className="h-3.5 w-3.5" />按这份资源的薄弱点生成练习</button></div></div></div>;
}
