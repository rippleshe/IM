"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  CheckCircle2,
  ClipboardList,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileText,
  LogOut,
  Map as MapIcon,
  MessageCircleQuestion,
  Pencil,
  Plus,
  Presentation,
  Quote,
  Save,
  Target,
  ListTree,
  Trash2,
  XCircle,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { AvatarBubble, ProfileDialog } from "@/components/profile-dialog";
import { ResourceQuestionDialog } from "@/components/resource-question-dialog";
import { CodeFigure, RichInlineText, RichText } from "@/components/rich-text";

type ResourceType = "lecture" | "tiered_quiz" | "presentation" | "concept_map";
type ResourceBlock = { id: string; type: string; position: number; content: unknown; evidenceIds: string[] };
type ResourceAsset = {
  id: string;
  type: ResourceType;
  title: string;
  tags?: string[];
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

// 证据 ID 已随资源、区块和审核记录持久化；原始证据卡只适合验证页，不应混入学习正文。
function visibleLearningBlocks(blocks: ResourceBlock[]): ResourceBlock[] {
  return [...blocks].filter((block) => block.type !== "evidence").sort((a, b) => a.position - b.position);
}

const typeItems: Array<{ type: ResourceType; label: string; icon: typeof BookOpen }> = [
  { type: "lecture", label: "讲义", icon: BookOpen },
  { type: "tiered_quiz", label: "习题", icon: ClipboardList },
  { type: "presentation", label: "PPT", icon: Presentation },
  { type: "concept_map", label: "知识脉络", icon: MapIcon },
];

function typeLabel(type: ResourceType) {
  return typeItems.find((item) => item.type === type)?.label ?? "资源";
}

function ResourcePrimer({ type }: { type: ResourceType }) {
  const message = type === "tiered_quiz"
    ? "不会的词不用硬背。先读题干里的中文说明，再判断这一题只问哪一个小问题。"
    : type === "presentation"
      ? "每页只抓一个重点：先看它在解决什么问题，再看示例和讲解词，最后跟着做一个小动作。"
      : "不用先记住整张字段表。每个新词都会先用中文说明，再给一个小例子，最后带你做一步。";
  return <div className="mb-7 rounded-xl border border-amber-200 bg-amber-50/70 px-5 py-4 text-[12px] leading-6 text-amber-950" aria-label="阅读方法提示">
    <div className="flex items-center gap-2 font-semibold"><BookOpen className="h-3.5 w-3.5 text-amber-700" />先这样读</div>
    <p className="mt-1.5">{message}</p>
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-amber-800"><span>① 先看懂</span><span>② 跟着做</span><span>③ 再判断</span></div>
  </div>;
}

function conciseAssetTitle(title: string, type: ResourceType): string {
  const cleaned = title.replace(/\s+/g, " ").replace(/^(压缩机诊断讲义|诊断训练\s*PPT|分层练习|知识脉络|讲义|PPT)\s*[·:：-]?\s*/u, "").trim();
  const subject = cleaned || typeLabel(type);
  return subject.length > 19 ? `${subject.slice(0, 18)}…` : subject;
}

function defaultAssetTags(asset: ResourceAsset): string[] {
  return asset.tags?.length ? asset.tags : ["设备诊断", typeLabel(asset.type)];
}

function ResourceExportMenu({ assetType, onExport }: { assetType: ResourceType; onExport: (format: "md" | "txt" | "json" | "ppt") => void }) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const options: Array<{ format: "md" | "txt" | "json" | "ppt"; label: string }> = [
    { format: "md", label: "Markdown" },
    { format: "txt", label: "纯文本" },
    { format: "json", label: "数据 JSON" },
    ...(assetType === "presentation" ? [{ format: "ppt" as const, label: "PowerPoint" }] : []),
  ];
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!menuRef.current?.contains(event.target as Node)) setOpen(false); };
    const keydown = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", keydown); };
  }, [open]);
  return <div ref={menuRef} className="relative">
    <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu" className="resource-toolbar-button"><Download className="h-3.5 w-3.5" />导出<ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} /></button>
    {open ? <div role="menu" className="resource-export-menu">
      {options.map((option) => <button key={option.format} type="button" role="menuitem" onClick={() => { onExport(option.format); setOpen(false); }} className="resource-export-option">{option.label}<span aria-hidden="true">↓</span></button>)}
    </div> : null}
  </div>;
}

function notifyEvidenceUpdated() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("im-training-agent:learning-evidence-updated"));
}

function currentTimestamp() {
  return Date.now();
}

type MermaidRelation = { from: string; to: string };

function normalizeMermaidCode(source: string): string {
  return source
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line
      .replace(/\[([^\]\n]*)\]/g, (_, label: string) => `[${cleanMermaidLabel(label)}]`)
      .replace(/\{([^}\n]*)\}/g, (_, label: string) => `{${cleanMermaidLabel(label)}}`)
      .replace(/\(([^)\n]*)\)/g, (_, label: string) => `(${cleanMermaidLabel(label)})`)
      .replace(/\|([^|\n]*)\|/g, (_, label: string) => `|${cleanMermaidLabel(label)}|`)
      .replace(/["'`]/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter(Boolean)
    .join("\n");
}

function cleanMermaidLabel(label: string): string {
  return label
    .replace(/@/g, "引用")
    .replace(/[<>:"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 46) || "节点";
}

function getMermaidRelations(code: string): { nodes: string[]; relations: MermaidRelation[] } {
  const labels = new Map<string, string>();
  const nodePattern = /\b([A-Za-z][\w-]*)\s*[\[({]([^\]})\n]*)[\]})]/g;
  for (const match of code.matchAll(nodePattern)) labels.set(match[1], cleanMermaidLabel(match[2]));
  const relations: MermaidRelation[] = [];
  const edgePattern = /\b([A-Za-z][\w-]*)\s*(?:-->|---|-.->|==>)\s*(?:\|[^|\n]*\|\s*)?([A-Za-z][\w-]*)/g;
  for (const match of code.matchAll(edgePattern)) {
    const from = labels.get(match[1]) ?? match[1];
    const to = labels.get(match[2]) ?? match[2];
    if (!relations.some((relation) => relation.from === from && relation.to === to)) relations.push({ from, to });
  }
  return { nodes: Array.from(labels.values()), relations };
}

function MermaidFallback({ code }: { code: string }) {
  const { nodes, relations } = getMermaidRelations(code);
  return <div className="resource-diagram-fallback">
    <div className="resource-diagram-fallback-heading"><span className="resource-diagram-fallback-icon"><MapIcon className="h-3.5 w-3.5" /></span><div><div className="text-xs font-semibold text-slate-700">知识关系</div><p className="mt-0.5 text-[11px] text-slate-500">关系图已整理为可读路径，内容不受影响。</p></div></div>
    {relations.length > 0 ? <div className="resource-diagram-relations">{relations.map((relation, index) => <div key={`${relation.from}-${relation.to}-${index}`} className="resource-diagram-relation"><span>{relation.from}</span><span className="resource-diagram-arrow" aria-hidden="true">→</span><span>{relation.to}</span></div>)}</div> : nodes.length > 0 ? <div className="resource-diagram-nodes">{nodes.map((node) => <span key={node}>{node}</span>)}</div> : <p className="text-xs text-slate-500">这份资源暂时没有可识别的节点关系。</p>}
    <details className="resource-diagram-source"><summary>查看关系图源码</summary><pre>{code}</pre></details>
  </div>;
}

// Mermaid 知识图谱渲染：概念图资源以 flowchart 文本存储，客户端动态加载 mermaid 绘制。
function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [failed, setFailed] = useState(false);
  const safeCode = useMemo(() => normalizeMermaidCode(code), [code]);
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
        const parsed = await mermaid.parse(safeCode, { suppressErrors: true });
        if (!parsed) {
          if (active) setFailed(true);
          return;
        }
        const { svg: rendered } = await mermaid.render(renderId, safeCode);
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
  }, [safeCode]);
  if (failed) return <MermaidFallback code={code} />;
  if (!svg) return <div className="flex h-24 items-center justify-center rounded-xl border bg-muted/20 text-xs text-muted-foreground">正在渲染知识图谱…</div>;
  return <div className="flex justify-center overflow-x-auto rounded-xl border bg-gradient-to-b from-background to-muted/20 p-5 [&_svg]:h-auto [&_svg]:max-w-full" dangerouslySetInnerHTML={{ __html: svg }} />;
}

function renderBlockContent(block: ResourceBlock, sectionNumber?: number) {
  if (block.type === "evidence") return null;
  if (block.type === "heading") return <h3 className="flex items-center gap-3 border-b border-border/70 pb-3 text-xl font-semibold tracking-tight text-foreground">{typeof sectionNumber === "number" ? <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500 to-indigo-500 text-[13px] font-bold text-white">{sectionNumber}</span> : <span className="h-5 w-1 rounded-full bg-gradient-to-b from-blue-500 to-indigo-500" />}<RichInlineText text={String(block.content)} /></h3>;
  if (block.type === "paragraph" && typeof block.content === "string" && /^(flowchart|graph)\b/.test(block.content.trim())) {
    return <MermaidDiagram code={block.content} />;
  }
  if (typeof block.content === "string") return <div className="space-y-1"><RichText text={block.content} variant="doc" /></div>;
  if (Array.isArray(block.content)) return <ul className="space-y-2 rounded-xl border border-border/70 bg-card/60 p-4 text-sm leading-7 text-muted-foreground">{block.content.map((item, index) => <li key={index} className="flex gap-2"><span className="mt-[11px] h-1.5 w-1.5 shrink-0 rounded-full bg-foreground/45" />{typeof item === "string" ? <RichInlineText text={item} /> : String(item)}</li>)}</ul>;
  if (block.content && typeof block.content === "object") {
    const data = block.content as { label?: string; locator?: string; summary?: string; language?: string; caption?: string; code?: string; columns?: unknown; rows?: unknown };
    if (Array.isArray(data.columns) && Array.isArray(data.rows)) {
      return <div className="resource-data-table"><div className="border-b bg-muted/30 px-4 py-3"><div className="text-xs font-medium">先看一小段数据</div><p className="mt-1 text-[11px] leading-5 text-muted-foreground">每一行是一次记录，每一列是一个观察项。字段名先不用背，先对照上面的中文解释，观察它记录了什么。</p></div><div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b bg-muted/15 text-muted-foreground">{(data.columns as string[]).map((column) => <th key={column} className="whitespace-nowrap px-3 py-2 font-medium">{column}</th>)}</tr></thead><tbody>{(data.rows as Array<Array<string | number | null>>).map((row, rowIndex) => <tr key={rowIndex} className="border-b transition-colors last:border-b-0 hover:bg-muted/20">{row.map((cell, cellIndex) => <td key={cellIndex} className="whitespace-nowrap px-3 py-2 font-mono text-[11px] text-muted-foreground">{cell === null ? "—" : String(cell)}</td>)}</tr>)}</tbody></table></div></div>;
    }
    if (typeof data.code === "string") {
      return <div><div className="mb-2 rounded-lg bg-slate-50 px-3 py-2 text-[11px] leading-5 text-slate-600">跟着做：这段代码只完成当前这一步。先看注释，运行后只检查它是否完成了本节要解决的小问题。</div><CodeFigure language={data.language ?? "python"} code={data.code} caption={data.caption ?? "代码示例"} /></div>;
    }
    if (data.summary || data.locator) return <div className="resource-callout"><div className="flex items-center gap-1.5 text-xs font-medium"><span className="flex h-4 w-4 items-center justify-center rounded bg-[#e5f2e9] text-[9px] font-bold text-[#397b61]">证</span>{data.label ?? "证据说明"}</div><p className="mt-2 text-sm leading-6 text-[#53645a]">{data.summary}</p></div>;
  }
  return <p className="text-sm text-muted-foreground">该部分暂时没有可显示内容。</p>;
}

type PresentationTable = { columns?: string[]; rows?: Array<Array<string | number | null>>; sources?: string[] };
type PresentationSlide = {
  title: string;
  paragraphs: string[];
  bullets: string[];
  table?: PresentationTable;
  code?: { caption?: string; language?: string; code?: string };
  kind: "cover" | "agenda" | "glossary" | "evidence" | "process" | "practice" | "summary" | "concept";
};

function presentationPlainText(value: string): string {
  return value.replace(/\*\*/g, "").replace(/`/g, "").replace(/^[-•]\s*/, "").replace(/\s+/g, " ").trim();
}

function presentationDisplayTitle(value: string): string {
  return value.replace(/^(?:PPT|PowerPoint)\s*[·:：-]?\s*/u, "").trim() || value;
}

function presentationShortText(value: string, max = 90): string {
  const text = presentationPlainText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function presentationSlideKind(title: string, hasTable: boolean, hasCode: boolean): PresentationSlide["kind"] {
  if (hasTable) return "evidence";
  if (/词|术语|字段含义|关键词/.test(title)) return "glossary";
  if (/练习|自测|检查|任务/.test(title)) return "practice";
  if (/总结|行动|下一步|复核|边界|误区/.test(title)) return "summary";
  if (/步骤|流程|方法|如何|解析|清洗|读取|观察/.test(title) || hasCode) return "process";
  return "concept";
}

function buildPresentationSlides(blocks: ResourceBlock[], asset: ResourceAsset): PresentationSlide[] {
  const groups: ResourceBlock[][] = [];
  let current: ResourceBlock[] = [];
  for (const block of blocks) {
    if (block.type === "heading" && current.length > 0) { groups.push(current); current = []; }
    current.push(block);
  }
  if (current.length > 0) groups.push(current);
  return (groups.length ? groups : [blocks]).map((group) => {
    const heading = group.find((block) => block.type === "heading");
    const paragraphs = group.filter((block) => block.type === "paragraph" && typeof block.content === "string").map((block) => String(block.content).trim()).filter(Boolean);
    const bullets = group.filter((block) => (block.type === "list" || block.type === "checklist") && Array.isArray(block.content)).flatMap((block) => (block.content as unknown[]).filter((item): item is string => typeof item === "string")).map(presentationPlainText).filter(Boolean).slice(0, 5);
    const tableBlock = group.find((block) => block.type === "table");
    const codeBlock = group.find((block) => block.type === "code");
    const title = heading ? presentationPlainText(String(heading.content)) : asset.title;
    return {
      title,
      paragraphs,
      bullets,
      table: tableBlock?.content && typeof tableBlock.content === "object" ? tableBlock.content as PresentationTable : undefined,
      code: codeBlock?.content && typeof codeBlock.content === "object" ? codeBlock.content as PresentationSlide["code"] : undefined,
      kind: heading ? presentationSlideKind(title, Boolean(tableBlock), Boolean(codeBlock)) : "cover",
    };
  });
}

function PresentationMiniChart({ table }: { table?: PresentationTable }) {
  const columns = table?.columns ?? [];
  const rows = table?.rows ?? [];
  const numericIndex = columns.findIndex((_, columnIndex) => rows.length > 1 && rows.every((row) => typeof row[columnIndex] === "number" && Number.isFinite(row[columnIndex] as number)));
  if (numericIndex < 0) return <div className="presentation-chart-empty">这组样本暂时不适合画趋势图，先对照表格看读数。</div>;
  const values = rows.map((row) => Number(row[numericIndex])).filter((value) => Number.isFinite(value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => `${12 + (index * 176) / Math.max(1, values.length - 1)},${78 - ((value - min) / span) * 52}`).join(" ");
  return <div className="presentation-chart-wrap"><div className="presentation-chart-title"><span>读数变化</span><span>{columns[numericIndex]}</span></div><svg viewBox="0 0 200 96" role="img" aria-label={`${columns[numericIndex]}样本读数变化`} className="presentation-mini-chart"><path d="M12 78H188 M12 52H188 M12 26H188" className="presentation-chart-grid" /><polyline points={points} className="presentation-chart-line" />{values.map((value, index) => { const x = 12 + (index * 176) / Math.max(1, values.length - 1); const y = 78 - ((value - min) / span) * 52; return <circle key={`${value}-${index}`} cx={x} cy={y} r="3.2" className="presentation-chart-point" />; })}</svg><div className="presentation-chart-range"><span>样本低点 {String(min)}</span><span>样本高点 {String(max)}</span></div></div>;
}

function PresentationTableView({ table }: { table?: PresentationTable }) {
  const columns = table?.columns ?? [];
  const rows = table?.rows ?? [];
  if (!columns.length || !rows.length) return <div className="presentation-table-empty">暂时没有可展示的样本表。</div>;
  return <div className="presentation-table-wrap"><table><thead><tr>{columns.slice(0, 6).map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{rows.slice(0, 4).map((row, rowIndex) => <tr key={rowIndex}>{columns.slice(0, 6).map((_, columnIndex) => <td key={columnIndex}>{row[columnIndex] === null || row[columnIndex] === undefined ? "—" : String(row[columnIndex])}</td>)}</tr>)}</tbody></table></div>;
}

function PresentationSlideCanvas({ slide, asset, index, total }: { slide: PresentationSlide; asset: ResourceAsset; index: number; total: number }) {
  if (slide.kind === "cover") {
    return <div className="presentation-slide presentation-slide-cover"><div className="presentation-cover-orbit presentation-cover-orbit-one" /><div className="presentation-cover-orbit presentation-cover-orbit-two" /><div className="presentation-cover-kicker">设备数据诊断  /  学习演示</div><h2>{presentationDisplayTitle(asset.title)}</h2><p className="presentation-cover-lead">{presentationShortText(slide.paragraphs[0] ?? "从一个真实问题出发，先看懂，再观察，最后做出可复查的判断。", 180)}</p><div className="presentation-cover-method"><span>这套演示怎么用</span><strong>每页只抓一个重点，再完成一个小动作。</strong><small>遇到不懂的字段，回到中文解释，不靠猜。</small></div><div className="presentation-cover-footer"><span>{asset.learningObjectives[0] ?? "理解主题，沿着证据完成一次基础判断"}</span><span>01 / {String(total).padStart(2, "0")}</span></div></div>;
  }
  if (slide.kind === "agenda") {
    const phases = [["先定义问题", "知道这一页要解决什么"], ["读懂最少字段", "只认识完成任务所需的词"], ["跟着看证据", "从样本、步骤和现象开始"], ["做判断与练习", "说清能得出什么、还缺什么"]];
    return <div className="presentation-slide presentation-slide-light"><PresentationSlideHeader title={slide.title} index={index} total={total} /><p className="presentation-slide-intro">整套演示按“先看懂，再判断，最后行动”的节奏展开。你可以把它当作一张路线图。</p><div className="presentation-agenda-grid">{phases.map(([title, detail], phaseIndex) => <div key={title} className={`presentation-agenda-item ${phaseIndex % 2 ? "is-teal" : ""}`}><span>{phaseIndex + 1}</span><div><strong>{title}</strong><small>{detail}</small></div></div>)}</div><p className="presentation-slide-footnote">后面会落到：{slide.bullets.join(" · ")}</p></div>;
  }
  return <div className="presentation-slide presentation-slide-light"><PresentationSlideHeader title={slide.title} index={index} total={total} /><div className={`presentation-slide-content presentation-kind-${slide.kind}`}>
    {slide.kind === "glossary" ? <div className="presentation-glossary-grid">{slide.bullets.slice(0, 4).map((item, itemIndex) => { const [term, ...rest] = item.split(/[:：]/); return <div key={itemIndex} className={`presentation-glossary-card ${itemIndex % 2 ? "is-teal" : ""}`}><strong>{term}</strong><p>{presentationShortText(rest.join("：") || item, 108)}</p></div>; })}</div>
      : slide.kind === "evidence" ? <div className="presentation-evidence-layout"><div><div className="presentation-visual-label">当前样本 · 先描述再判断</div><PresentationTableView table={slide.table} />{slide.table?.sources?.[0] ? <p className="presentation-source">来源：{presentationShortText(slide.table.sources[0], 70)}</p> : null}</div><PresentationMiniChart table={slide.table} /></div>
        : slide.kind === "process" ? <div className="presentation-process-row">{slide.bullets.slice(0, 4).map((item, itemIndex) => <div key={itemIndex} className="presentation-process-step"><span>{itemIndex + 1}</span><strong>{presentationShortText(item, 64)}</strong></div>)}</div>
          : slide.kind === "practice" ? <div className="presentation-practice-layout"><div className="presentation-practice-question"><span>现在只做一件事</span><strong>{presentationShortText(slide.paragraphs[0] ?? slide.bullets[0] ?? "请用自己的话说出这一页的关键判断。", 170)}</strong><small>完成后再看讲解词，先保留自己的判断。</small></div><div className="presentation-practice-steps">{slide.bullets.slice(0, 3).map((item, itemIndex) => <div key={itemIndex}><span>{itemIndex + 1}</span><p>{presentationShortText(item, 80)}</p></div>)}</div></div>
            : <div className="presentation-concept-layout"><div className="presentation-focus-panel"><span>这一页只记住</span><strong>{presentationShortText(slide.bullets[0] ?? slide.paragraphs[0] ?? "先用一句话说清这一页的核心意思。", 105)}</strong><small>{slide.kind === "summary" ? "把结论和边界一起说" : "先观察，再解释"}</small></div><div className="presentation-bullet-list">{slide.bullets.slice(1, 5).map((item, itemIndex) => <div key={itemIndex}><span>{itemIndex + 2}</span><p>{presentationShortText(item, 110)}</p></div>)}</div></div>}
  </div><div className="presentation-slide-action">{slide.kind === "evidence" ? "读图提醒：表格告诉你“记录是什么样”，不能单独证明设备已经故障。" : slide.kind === "process" ? "跟着做：每完成一步，先说出“我看到了什么”，再决定下一步。" : "跟着做：先用自己的话复述重点，再回到样本中找一个对应的地方。"}</div></div>;
}

function PresentationSlideHeader({ title, index, total }: { title: string; index: number; total: number }) {
  return <><div className="presentation-slide-topline"><span>智辩无幻  /  学习演示</span><span>{String(index).padStart(2, "0")} / {String(total).padStart(2, "0")}</span></div><h2 className="presentation-slide-title">{title}</h2></>;
}

function getQuizQuestions(asset: ResourceAsset): QuizQuestion[] {
  const block = asset.blocks.find((item) => item.type === "question");
  const raw = block?.content as { questions?: unknown } | undefined;
  if (!Array.isArray(raw?.questions)) return [];
  return raw.questions.filter((item): item is QuizQuestion => Boolean(item) && typeof item === "object" && typeof (item as QuizQuestion).id === "string" && typeof (item as QuizQuestion).prompt === "string");
}

function getGlossaryItems(asset: ResourceAsset): string[] {
  const headingIndex = asset.blocks.findIndex((block) => block.type === "heading" && String(block.content) === "先把几个词说清楚");
  if (headingIndex < 0) return [];
  const glossaryBlock = asset.blocks.slice(headingIndex + 1).find((block) => block.type === "list" && Array.isArray(block.content));
  return glossaryBlock && Array.isArray(glossaryBlock.content)
    ? glossaryBlock.content.filter((item): item is string => typeof item === "string").slice(0, 5)
    : [];
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

/** 轻量元数据区：保留 Obsidian 的属性感，但使用项目已有的浅蓝色语言。 */
function ResourceFrontmatter({ asset, onOpenValidation, onSaveTags }: { asset: ResourceAsset; onOpenValidation: (runId: string) => void; onSaveTags: (tags: string[]) => Promise<void> }) {
  const runId = runIdOfAsset(asset.id);
  const createdAt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(asset.createdAt);
  const status = asset.auditStatus === "passed" ? "已通过检查" : asset.auditStatus === "revise" ? "待复核" : "等待检查";
  const [editingTags, setEditingTags] = useState(false);
  const [tags, setTags] = useState(() => defaultAssetTags(asset));
  const [tagDraft, setTagDraft] = useState("");
  const [savingTags, setSavingTags] = useState(false);
  const saveTags = async (nextTags = tags) => {
    const next = Array.from(new Set(nextTags.map((tag) => tag.trim()).filter(Boolean))).slice(0, 12);
    setSavingTags(true);
    try { await onSaveTags(next); setTags(next); setEditingTags(false); setTagDraft(""); } finally { setSavingTags(false); }
  };
  const addDraftTag = () => {
    const value = tagDraft.trim();
    if (!value) return;
    setTags((current) => Array.from(new Set([...current, value])).slice(0, 12));
    setTagDraft("");
  };
  return <section className="resource-frontmatter shrink-0" aria-label="资源元数据">
    <div className="flex items-center justify-end gap-3">
      {runId ? <button type="button" onClick={() => onOpenValidation(runId)} className="resource-frontmatter-action">查看验证记录</button> : null}
    </div>
    <h1 className="mt-1.5 text-[18px] font-semibold tracking-[-0.025em] text-[#334155]">{asset.title}</h1>
    {asset.auditStatus === "revise" ? <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2 text-[11px] leading-5 text-amber-800">自动检查未通过，已保留可查看版本。可先阅读内容，再补充依据或降低事实表述强度后重新生成。</p> : null}
    <dl className="resource-frontmatter-grid mt-4">
      <div><dt>类型</dt><dd>{typeLabel(asset.type)}</dd></div>
      <div><dt>状态</dt><dd className={asset.auditStatus === "passed" ? "text-[#397b61]" : "text-[#9a6b32]"}>{status}</dd></div>
      <div><dt>难度</dt><dd>{asset.difficulty.toFixed(2)}</dd></div>
      <div><dt>关联知识点</dt><dd>{asset.knowledgePointIds.length ? `${asset.knowledgePointIds.length} 个` : "未关联"}</dd></div>
      <div><dt>创建时间</dt><dd>{createdAt}</dd></div>
      <div className="resource-frontmatter-tags"><div className="flex items-center justify-between gap-3"><dt>标签</dt><div className="flex items-center gap-1.5"><button type="button" onClick={() => { if (editingTags) void saveTags(); else setEditingTags(true); }} disabled={savingTags} className="resource-frontmatter-edit"><Pencil className="h-3 w-3" />{savingTags ? "保存中" : editingTags ? "完成" : "编辑"}</button></div></div><dd>{tags.map((tag) => editingTags ? <button key={tag} type="button" onClick={() => setTags((current) => current.filter((item) => item !== tag))} className="resource-tag-chip resource-tag-chip-edit" title="删除标签">{tag}<span aria-hidden="true">×</span></button> : <span key={tag} className="resource-tag-chip">{tag}</span>)}{editingTags ? <div className="resource-tag-add"><input value={tagDraft} onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addDraftTag(); } }} placeholder="添加标签" aria-label="添加标签" /><button type="button" onClick={addDraftTag} aria-label="添加标签"><Plus className="h-3 w-3" /></button></div> : null}</dd></div>
    </dl>
  </section>;
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
  const [selectedQuote, setSelectedQuote] = useState("");
  const readerRequestRef = useRef(0);

  const activeAssets = useMemo(() => assets.filter((asset) => asset.type === activeType), [assets, activeType]);
  const selectedAsset = assets.find((asset) => asset.id === selectedId) ?? null;
  const selectedReader = reader?.asset.id === selectedId ? reader : null;

  const loadReader = useCallback(async (assetId: string) => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(assetId)}/reader`, { credentials: "include" });
    const data = await response.json() as { success?: boolean; error?: string } & Partial<ReaderData>;
    if (!response.ok || !data.success || !data.asset) throw new Error(data.error || "资源内容读取失败");
    return { asset: data.asset, pageNotes: data.pageNotes ?? [], feedback: data.feedback ?? null, quizAttempts: data.quizAttempts ?? [] } satisfies ReaderData;
  }, [apiBase]);

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/learning/assets`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; error?: string; assets?: ResourceAsset[] };
        if (!response.ok || !data.success) throw new Error(data.error || "学习资产读取失败");
        if (!active) return;
        const nextAssets = data.assets ?? [];
        setAssets(nextAssets);
        setSelectedId((current) => current && nextAssets.some((asset) => asset.id === current) ? current : (nextAssets.find((asset) => asset.type === "lecture")?.id ?? null));
      })
      .catch((error) => { if (active) setNotice(error instanceof Error ? error.message : "学习资产读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiBase]);
  useEffect(() => {
    const requestId = ++readerRequestRef.current;
    if (!selectedId) return;
    void loadReader(selectedId).then((nextReader) => {
      if (requestId === readerRequestRef.current) setReader(nextReader);
    }).catch((error) => {
      if (requestId === readerRequestRef.current) setNotice(error instanceof Error ? error.message : "资源内容读取失败");
    });
  }, [loadReader, selectedId]);
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
    setSelectedQuote("");
    setNotice("");
  };

  const selectAsset = (assetId: string) => {
    setSelectedId(assetId);
    setSelectedQuote("");
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

  const saveAssetTags = async (tags: string[]) => {
    if (!selectedAsset) return;
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(selectedAsset.id)}`, { method: "PATCH", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tags }) });
    const data = await response.json() as { success?: boolean; error?: string; asset?: ResourceAsset };
    if (!response.ok || !data.success || !data.asset) throw new Error(data.error || "标签保存失败");
    setAssets((current) => current.map((asset) => asset.id === data.asset!.id ? data.asset as ResourceAsset : asset));
    setReader((current) => current && current.asset.id === data.asset!.id ? { ...current, asset: data.asset as ResourceAsset } : current);
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
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span><span className="block text-sm font-semibold tracking-tight">智辩无幻</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={() => setSettingsOpen(true)} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">设置</button><button type="button" onClick={() => setProfileOpen(true)} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">画像</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" onClick={() => onNavigate("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">资源</button><button type="button" onClick={() => onNavigate("validation")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">验证</button></nav>
      <button type="button" onClick={logout} className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"><LogOut className="h-3.5 w-3.5" />退出</button>
    </header>

    <div className="resource-layout flex min-h-0 min-w-[1180px] flex-1 overflow-hidden">
      <aside aria-label="资源目录" className="flex w-[208px] shrink-0 flex-col border-r bg-slate-50/80">
        <nav aria-label="资源类型" className="resource-folder-nav shrink-0 border-b px-3 py-3">
          <div className="resource-folder-heading"><span>资源库</span><span>{assets.length} 份</span></div>
          {typeItems.map((item) => { const Icon = item.icon; const active = activeType === item.type; const count = assets.filter((asset) => asset.type === item.type).length; return <button key={item.type} type="button" onClick={() => selectType(item.type)} className={`resource-folder-row ${active ? "resource-folder-row-active" : ""}`}><Icon className="h-4 w-4 shrink-0" /><span className="flex-1">{item.label}</span>{count > 0 ? <span className="resource-folder-count">{count}</span> : null}</button>; })}
        </nav>
        <div className="resource-file-list min-h-0 flex-1 overflow-y-auto p-2">{loading ? <div className="px-2 py-4 text-xs text-muted-foreground">正在读取资源</div> : activeAssets.length === 0 ? <div className="border border-dashed px-3 py-8 text-center text-xs leading-5 text-muted-foreground">还没有{typeLabel(activeType)}，从学习页生成后会出现在这里。</div> : <div className="space-y-0.5">{activeAssets.map((asset) => <article key={asset.id} className={`resource-file-row group ${selectedId === asset.id ? "resource-file-row-active" : ""}`}><button type="button" onClick={() => selectAsset(asset.id)} className="flex min-w-0 flex-1 items-start gap-2 text-left" title={asset.title}><FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#8aa0b7]" /><span className="min-w-0"><span className="block truncate text-xs font-medium leading-5">{conciseAssetTitle(asset.title, asset.type)}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(asset.createdAt)}</span></span></button><button type="button" onClick={() => void deleteAsset(asset)} className="mt-1 inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100" aria-label={`删除${asset.title}`}><Trash2 className="h-3 w-3" /></button></article>)}</div>}</div>
        <div className="shrink-0 border-t p-3"><button type="button" onClick={() => setQaOpen(true)} className="resource-sidebar-action"><MessageCircleQuestion className="h-3.5 w-3.5" />资源问答</button></div>
      </aside>

      <section className="flex min-w-[460px] flex-1 flex-col overflow-hidden bg-card" aria-label="资源阅读与作答">
        {notice ? <div className="shrink-0 border-b border-destructive/20 bg-destructive/5 px-5 py-2 text-xs text-destructive">{notice}</div> : null}
        {selectedAsset ? <ResourceFrontmatter key={selectedAsset.id} asset={selectedAsset} onSaveTags={saveAssetTags} onOpenValidation={(runId) => {
          try { window.localStorage.setItem("im-training-agent:validation-prefill", JSON.stringify({ runId })); } catch { /* 忽略 */ }
          onNavigate("validation");
        }} /> : null}
        {selectedReader?.asset.type === "lecture" ? <LectureReader reader={selectedReader} onExport={exportAsset} onQuote={setSelectedQuote} /> : selectedReader?.asset.type === "tiered_quiz" ? <QuizReader key={selectedReader.asset.id} apiBase={apiBase} reader={selectedReader} onReaderChange={setReader} /> : selectedReader?.asset.type === "presentation" ? <PresentationReader reader={selectedReader} onExport={exportAsset} /> : selectedReader ? <GenericReader apiBase={apiBase} reader={selectedReader} onReaderChange={setReader} onExport={exportAsset} /> : loading || selectedAsset ? <div className="flex h-full items-center justify-center text-sm text-muted-foreground">正在读取资源</div> : <EmptyReader label={typeLabel(activeType)} />}
      </section>

      <div role="separator" aria-orientation="vertical" onMouseDown={() => setResizing(true)} className="w-1.5 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-foreground/30" />
      <aside style={{ width: notesWidth }} className="flex shrink-0 flex-col border-l bg-muted/15" aria-label="资源笔记或解析">
        {selectedReader?.asset.type === "lecture" ? <LectureNotes key={selectedReader.asset.id} apiBase={apiBase} reader={selectedReader} selectedQuote={selectedQuote} onClearQuote={() => setSelectedQuote("")} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(selectedReader.asset, selectedReader.feedback?.masteryLevel ?? null)} /> : selectedReader?.asset.type === "tiered_quiz" ? <QuizAnswerPanel reader={selectedReader} /> : selectedReader ? <GenericFeedback apiBase={apiBase} reader={selectedReader} onReaderChange={setReader} onReinforce={() => reinforceFromAsset(selectedReader.asset, selectedReader.feedback?.masteryLevel ?? null)} /> : <div className="flex h-full items-center justify-center px-8 text-center text-sm text-muted-foreground">选择一份资源后，在这里查看笔记、反馈或答案解析。</div>}
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
function LectureReader({ reader, onExport, onQuote }: { reader: ReaderData; onExport: (format: "md" | "txt" | "json" | "ppt") => void; onQuote: (quote: string) => void }) {
  const blocks = useMemo(() => visibleLearningBlocks(reader.asset.blocks), [reader.asset.blocks]);
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
  const captureSelection = () => {
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? "";
    const anchor = selection?.anchorNode;
    if (text.length >= 2 && anchor && scrollRef.current?.contains(anchor)) onQuote(text.slice(0, 1_200));
  };
  return <div className="flex min-h-0 flex-1 flex-col">
    <div className="resource-reading-toolbar flex shrink-0 items-center justify-end gap-3 border-b px-5 py-3">
      <div className="flex shrink-0 items-center gap-2.5">
        {headings.length > 0 && <div className="relative">
          <button type="button" onClick={() => setTocOpen((open) => !open)} aria-expanded={tocOpen} className="resource-toolbar-button"><ListTree className="h-3.5 w-3.5" />章节目录<span className="resource-toolbar-count">{headings.length}</span></button>
          {tocOpen && <div className="resource-toc-menu">{headings.map((block, index) => <button key={block.id} type="button" onClick={() => { document.getElementById(`sec-${block.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); setTocOpen(false); }} className="resource-toc-option"><span className="resource-toc-index">{index + 1}</span><span className="line-clamp-2">{String(block.content)}</span></button>)}</div>}
        </div>}
        <ResourceExportMenu assetType={reader.asset.type} onExport={onExport} />
      </div>
    </div>
    <div ref={scrollRef} onScroll={handleScroll} onMouseUp={captureSelection} className="min-h-0 flex-1 overflow-y-auto bg-background/40">
      <div className="sticky top-0 z-10 h-0.5 bg-transparent"><div className="h-full rounded-r-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-[width] duration-150" style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      <article className="mx-auto max-w-3xl px-8 py-8">
        <ResourcePrimer type="lecture" />
        {reader.asset.learningObjectives.length > 0 && <div className="mb-8 border-y border-blue-100 bg-blue-50/45 px-5 py-4"><div className="flex items-center gap-2 text-[11px] font-semibold tracking-wide text-blue-700"><Target className="h-3.5 w-3.5" />学习目标</div><ul className="mt-3 space-y-2">{reader.asset.learningObjectives.map((objective) => <li key={objective} className="flex gap-2.5 text-[13px] leading-6 text-blue-950"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" />{objective}</li>)}</ul></div>}
        <div className="space-y-7">{blocks.map((block) => <section key={block.id} id={block.type === "heading" ? `sec-${block.id}` : undefined} className="scroll-mt-4">{renderBlockContent(block, sectionNumber.get(block.id))}</section>)}</div>
        <div className="h-12" />
      </article>
    </div>
  </div>;
}

function PresentationReader({ reader, onExport }: { reader: ReaderData; onExport: (format: "md" | "txt" | "json" | "ppt") => void }) {
  const blocks = useMemo(() => visibleLearningBlocks(reader.asset.blocks), [reader.asset.blocks]);
  const slides = useMemo(() => {
    const contentSlides = buildPresentationSlides(blocks, reader.asset);
    const cover = contentSlides[0]?.kind === "cover" ? contentSlides[0] : { title: reader.asset.title, paragraphs: [], bullets: [], kind: "cover" as const };
    const agenda: PresentationSlide = { title: "今天走一条清晰的线", paragraphs: [], bullets: contentSlides.slice(1).map((slide) => slide.title).slice(0, 6), kind: "agenda" };
    return [cover, agenda, ...contentSlides.slice(contentSlides[0]?.kind === "cover" ? 1 : 0)];
  }, [blocks, reader.asset]);
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setIndex((value) => Math.max(0, value - 1));
      if (event.key === "ArrowRight") setIndex((value) => Math.min(slides.length - 1, value + 1));
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [slides.length]);
  const slide = slides[index] ?? slides[0];
  return <div className="resource-presentation-reader flex min-h-0 flex-1 flex-col bg-[#eef3f7]">
    <div className="resource-reading-toolbar flex shrink-0 items-center justify-between border-b bg-background px-5 py-3.5"><div className="resource-reading-title"><Presentation className="h-4 w-4" /><span>演示阅读</span><span className="presentation-reader-hint">每页一个重点 · 方向键可翻页</span></div><ResourceExportMenu assetType={reader.asset.type} onExport={onExport} /></div>
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-6 sm:px-6 sm:py-7">
      <div className="mx-auto w-full max-w-5xl"><div className="presentation-stage"><PresentationSlideCanvas slide={slide} asset={reader.asset} index={index + 1} total={slides.length} /></div><details className="presentation-speaker-notes"><summary><span>讲解词</span><span>打开查看本页怎么讲</span></summary><div>{slide.paragraphs.length > 0 ? slide.paragraphs.map((paragraph, paragraphIndex) => <RichText key={paragraphIndex} text={paragraph} />) : <p>这一页先让学习者复述重点，再完成页面底部的小动作。</p>}</div></details></div>
    </div>
    <div className="presentation-pagination border-t bg-background px-4 py-3"><div className="presentation-pager"><button type="button" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))} aria-label="上一页" className="presentation-pager-button"><ChevronLeft className="h-4 w-4" /></button><div className="presentation-slide-strip" role="tablist" aria-label="演示页码">{slides.map((item, itemIndex) => <button key={`${item.title}-${itemIndex}`} type="button" role="tab" aria-selected={index === itemIndex} onClick={() => setIndex(itemIndex)} className={`presentation-slide-tab ${index === itemIndex ? "is-active" : ""}`}><span>{String(itemIndex + 1).padStart(2, "0")}</span><strong>{presentationShortText(item.title, 16)}</strong></button>)}</div><button type="button" disabled={index === slides.length - 1} onClick={() => setIndex((value) => Math.min(slides.length - 1, value + 1))} aria-label="下一页" className="presentation-pager-button"><ChevronRight className="h-4 w-4" /></button></div></div>
  </div>;
}

function LectureNotes({ apiBase, reader, selectedQuote, onClearQuote, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; selectedQuote: string; onClearQuote: () => void; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const [draft, setDraft] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [noteError, setNoteError] = useState("");
  const notes = reader.pageNotes.filter((note) => note.content.trim()).sort((a, b) => b.updatedAt - a.updatedAt);
  const startNewNote = () => { setEditingKey(null); setDraft(""); setSaved(false); setNoteError(""); };
  const editNote = (note: PageNote) => { setEditingKey(note.pageKey); setDraft(note.content); setSaved(false); setNoteError(""); };
  const insertQuote = () => {
    if (!selectedQuote) return;
    const quote = selectedQuote.split("\n").map((line) => `> ${line}`).join("\n");
    setDraft((current) => current.trim() ? `${current.trim()}\n\n${quote}\n\n` : `${quote}\n\n`);
    onClearQuote();
  };
  const save = async () => {
    if (!draft.trim()) return;
    setSaving(true);
    setNoteError("");
    try {
      const pageKey = editingKey ?? `note-${Date.now()}`;
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/pages/${encodeURIComponent(pageKey)}/note`, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft }) });
      const data = await response.json() as { success?: boolean; note?: PageNote; error?: string };
      if (!response.ok || !data.success || !data.note) throw new Error(data.error || "笔记保存失败");
      onReaderChange({ ...reader, pageNotes: [...reader.pageNotes.filter((note) => note.pageKey !== data.note!.pageKey), data.note] });
      setEditingKey(data.note.pageKey);
      setSaved(true);
    } catch (error) { setNoteError(error instanceof Error ? error.message : "笔记保存失败"); }
    finally { setSaving(false); }
  };
  const feedback = async (level: "high" | "medium" | "low") => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/feedback`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true, masteryLevel: level }) });
    const data = await response.json() as { success?: boolean; error?: string };
    if (!response.ok || !data.success) return;
    onReaderChange({ ...reader, feedback: { completed: true, mastered: level === "high", masteryLevel: level, updatedAt: currentTimestamp() } });
    notifyEvidenceUpdated();
  };
  const level = reader.feedback?.masteryLevel;
  return <div className="resource-notes flex min-h-0 flex-1 flex-col">
    <div className="resource-notes-header"><div><div className="text-sm font-semibold">讲义笔记</div><div className="mt-0.5 text-[10px] text-muted-foreground">{notes.length ? `${notes.length} 条笔记` : "还没有笔记"}</div></div><button type="button" onClick={startNewNote} className="resource-note-new"><Plus className="h-3.5 w-3.5" />新建</button></div>
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {selectedQuote ? <div className="resource-selection-quote"><div className="flex items-center gap-1.5 text-[10px] font-medium text-blue-700"><Quote className="h-3 w-3" />已选正文</div><blockquote className="mt-2 line-clamp-4 text-xs leading-5 text-slate-600">{selectedQuote}</blockquote><button type="button" onClick={insertQuote} className="mt-2 text-[11px] font-medium text-blue-700 hover:text-blue-800">引用到当前笔记</button></div> : null}
      <div className="resource-note-editor"><div className="resource-note-editor-label">{editingKey ? "编辑笔记" : "新笔记"}</div><textarea value={draft} onChange={(event) => { setDraft(event.target.value); setSaved(false); }} placeholder="写下你的笔记" aria-label="笔记内容" />{noteError ? <div className="mb-2 text-[10px] text-rose-600">{noteError}</div> : null}<div className="flex items-center justify-between gap-2"><span className="text-[10px] text-muted-foreground">{draft.length} 字</span><button type="button" disabled={saving || !draft.trim()} onClick={() => void save()} className="resource-note-save">{saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}{saved ? "已保存" : saving ? "保存中" : "保存笔记"}</button></div></div>
      {notes.length > 0 ? <div className="mt-4 space-y-2"><div className="resource-note-list-label">已保存</div>{notes.map((note) => <button key={note.pageKey} type="button" onClick={() => editNote(note)} className={`resource-note-card ${editingKey === note.pageKey ? "resource-note-card-active" : ""}`}><span className="line-clamp-3">{note.content.replace(/^> /gm, "")}</span><time>{new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(note.updatedAt)}</time></button>)}</div> : null}
    </div>
    <div className="resource-notes-feedback border-t bg-background p-4"><div className="flex items-baseline justify-between gap-3"><div className="text-xs font-semibold">学习反馈</div><span className="text-[10px] text-muted-foreground">选择最贴近当前状态的一项</span></div><div className="resource-feedback-options mt-3" role="group" aria-label="掌握程度">{([['high', '完全掌握'], ['medium', '掌握一般'], ['low', '还需巩固']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => void feedback(value)} aria-pressed={level === value} data-level={value} className={`resource-feedback-choice ${level === value ? "resource-feedback-choice-active" : ""}`}><span className="resource-feedback-dot" />{label}</button>)}</div><button type="button" onClick={onReinforce} className="resource-feedback-reinforce mt-3"><Target className="h-3.5 w-3.5" />生成针对性练习</button></div>
  </div>;
}

const QUESTION_TYPE_LABELS: Record<QuizQuestionType, string> = { choice: "选择", blank: "填空", short_answer: "简答" };

function QuizReader({ apiBase, reader, onReaderChange }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void }) {
  const questions = useMemo(() => getQuizQuestions(reader.asset), [reader.asset]);
  const [index, setIndex] = useState(0);
  const [answerId, setAnswerId] = useState("");
  const [showReference, setShowReference] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const startedAt = useRef<number | null>(null);
  useEffect(() => { startedAt.current = currentTimestamp(); }, []);
  const question = questions[index];
  const glossary = useMemo(() => getGlossaryItems(reader.asset), [reader.asset]);
  const questionType: QuizQuestionType = question?.type ?? "choice";
  const latest = reader.quizAttempts.filter((attempt) => attempt.questionId === question?.id).at(-1) ?? null;
  const jump = (next: number) => { setIndex(next); setAnswerId(""); setShowReference(false); setSubmitError(""); startedAt.current = currentTimestamp(); };
  const submit = async (selfAssessed?: boolean) => {
    if (!question || submitting) return;
    const answer = questionType === "choice" ? answerId : answerId.trim();
    if (!answer || (questionType === "choice" && !answerId)) return;
    if (questionType === "short_answer" && selfAssessed === undefined) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/quiz-attempts`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ questionId: question.id, answerId: answer, durationMs: Math.max(0, currentTimestamp() - (startedAt.current ?? currentTimestamp())), selfAssessed }),
      });
      const data = await response.json() as { success?: boolean; attempt?: QuizAttempt; error?: string };
      if (!response.ok || !data.success || !data.attempt) throw new Error(data.error || "作答提交失败");
      onReaderChange({ ...reader, quizAttempts: [...reader.quizAttempts, data.attempt] });
      notifyEvidenceUpdated();
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "作答提交失败，请重试");
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
  return <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div className="text-[10px] font-medium tracking-wide text-[#74837b]">开始练习</div><div className="flex items-center gap-2"><span className="rounded-full border px-2.5 py-1 text-[11px]">{question.level}</span><span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">{QUESTION_TYPE_LABELS[questionType]}</span>{answered ? <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium ${latest!.correct ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"}`}>{latest!.correct ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}{latest!.correct ? "答对" : "再想想"}</span> : null}</div></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl px-8 py-10"><ResourcePrimer type="tiered_quiz" />{glossary.length > 0 && <div className="mb-7 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"><div className="text-xs font-semibold text-slate-700">先认识几个词</div><ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-700">{glossary.map((item, itemIndex) => <li key={itemIndex}><RichInlineText text={item} /></li>)}</ul></div>}<div className="text-xs text-muted-foreground">第 {index + 1} 题 / 共 {questions.length} 题</div><h2 className="mt-4 text-xl font-semibold leading-8">{question.prompt}</h2>
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
    {submitError ? <p role="alert" className="mt-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700">{submitError}</p> : null}
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
  const blocks = useMemo(() => visibleLearningBlocks(reader.asset.blocks), [reader.asset.blocks]);
  return <div className="resource-generic-reader flex min-h-0 flex-1 flex-col"><div className="resource-reading-toolbar flex shrink-0 items-center justify-between border-b px-5 py-3.5"><div className="resource-reading-title"><MapIcon className="h-4 w-4" /><span>知识脉络</span></div><ResourceExportMenu assetType={reader.asset.type} onExport={onExport} /></div><div className="min-h-0 flex-1 overflow-y-auto"><article className="mx-auto max-w-3xl space-y-7 px-8 py-9"><ResourcePrimer type="concept_map" /><div className="resource-learning-objectives"><div className="text-[11px] font-semibold text-slate-700">学习目标</div><ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">{reader.asset.learningObjectives.map((objective) => <li key={objective} className="flex gap-2"><span className="resource-objective-dot" />{objective}</li>)}</ul></div>{blocks.map((block) => <section key={block.id}>{renderBlockContent(block)}</section>)}</article></div></div>;
}

function GenericFeedback({ apiBase, reader, onReaderChange, onReinforce }: { apiBase: string; reader: ReaderData; onReaderChange: (data: ReaderData) => void; onReinforce: () => void }) {
  const markRead = async () => {
    const response = await fetch(`${apiBase}/api/learning/assets/${encodeURIComponent(reader.asset.id)}/feedback`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }) });
    const data = await response.json() as { success?: boolean };
    if (response.ok && data.success) { onReaderChange({ ...reader, feedback: { completed: true, mastered: reader.feedback?.mastered ?? false, masteryLevel: reader.feedback?.masteryLevel ?? null, updatedAt: Date.now() } }); notifyEvidenceUpdated(); }
  };
  return <div className="flex h-full flex-col"><div className="border-b bg-background px-5 py-3.5"><div className="text-sm font-semibold">学习记录</div></div><div className="flex flex-1 flex-col justify-between p-5"><div><div className="rounded-xl border bg-card p-4"><div className="text-xs text-muted-foreground">当前资源</div><div className="mt-2 text-sm font-semibold">{typeLabel(reader.asset.type)}</div></div></div><div><button type="button" onClick={() => void markRead()} className={`h-9 w-full rounded-lg border text-xs font-medium ${reader.feedback?.completed ? "border-emerald-300 bg-emerald-50 text-emerald-700" : "hover:bg-muted"}`}>{reader.feedback?.completed ? "已记录完成" : "记录已学习"}</button><button type="button" onClick={onReinforce} className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-foreground/25 bg-muted/40 text-xs font-medium hover:bg-muted"><Target className="h-3.5 w-3.5" />按这份资源的薄弱点生成练习</button></div></div></div>;
}
