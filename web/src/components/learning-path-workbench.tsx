"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowDownUp,
  Bot,
  Check,
  ChevronRight,
  Loader2,
  MessageSquareText,
  Move,
  Network,
  Plus,
  RefreshCw,
  Send,
  Trophy,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { SettingsDialog } from "@/components/settings-dialog";
import { ProfileDialog } from "@/components/profile-dialog";
import { RichText, DescriptionList } from "@/components/rich-text";
import { WorkspaceHeader } from "@/components/workspace-header";

type PathStatus = "not_started" | "learning" | "completed";
type PathRelation = "prerequisite" | "branch" | "application" | "review";

export type NodeRecommendation = {
  level: "no_evidence" | "reinforce" | "maintain" | "advance";
  reason: string;
  attemptCount: number;
  correctCount: number;
  mastery: number;
  sources?: Array<"diagnostic" | "quiz_attempt" | "asset_feedback" | "learning_decision">;
  updatedAt?: number | null;
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
  const sourceLabels: Record<NonNullable<NodeRecommendation["sources"]>[number], string> = {
    diagnostic: "入学诊断",
    quiz_attempt: "习题作答",
    asset_feedback: "资源反馈",
    learning_decision: "学习决策",
  };
  const sources = (recommendation.sources ?? []).map((source) => sourceLabels[source]);
  return <div className="min-w-0">
    <div className="flex items-start gap-2">
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] leading-4 ${view.chipClass}`}>{view.label}</span>
      <span className="text-[11px] leading-4 text-muted-foreground">{recommendationMessage(recommendation.level)}</span>
    </div>
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] leading-4 text-muted-foreground">
      {sources.length > 0 ? <span>依据：{sources.join("、")}</span> : <span>该节点暂无直接作答或资源反馈</span>}
      {recommendation.attemptCount > 0 ? <span>· {recommendation.attemptCount} 次作答，答对 {recommendation.correctCount} 次</span> : null}
      {recommendation.updatedAt ? <span>· 更新于 {new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(recommendation.updatedAt)}</span> : null}
    </div>
  </div>;
}

function recommendationMessage(level: NodeRecommendation["level"]): string {
  switch (level) {
    case "reinforce": return "先补一份讲义，再做一组练习把基础稳住。";
    case "advance": return "基础已经比较稳，可以尝试下一个节点。";
    case "maintain": return "继续保持当前节奏，完成一组练习巩固。";
    default: return "还没有足够的学习记录，先完成一次学习或练习。";
  }
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
  metadata: { activities?: Activity[]; pathChanged?: boolean; agentMessagesPersisted?: boolean; kind?: "agent"; agentId?: string; agentName?: string; producer?: "llm" | "rule" | "mixed"; streaming?: boolean };
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
  asset_feedback: "资料反馈",
  guidance_session: "学习追问",
};

function readablePathActivityText(text: string): string {
  return text
    .replace(/学情与路径智能体/g, "学习规划助手")
    .replace(/知识检索智能体/g, "资料检索助手")
    .replace(/交叉验证智能体/g, "内容检查助手")
    .replace(/协同/g, "任务处理");
}

function pathAgentTone(agentId: string | undefined): string {
  if (agentId === "evidence_retrieval") return "bg-sky-100 text-sky-700";
  if (agentId === "cross_validation") return "bg-emerald-100 text-emerald-700";
  return "bg-slate-100 text-slate-700";
}

function pathProducerLabel(producer: ChatMessage["metadata"]["producer"]): string {
  if (producer === "llm") return "模型生成";
  if (producer === "rule") return "规则检查";
  return "规则 + 模型";
}

/** 里程碑 G（路径页小改）：节点建议的“依据”——最近一次持久化学习决策与 BKT 前后值 */
function NodeDecisionBasis({ apiBase, knowledgePointId }: { apiBase: string; knowledgePointId: string }) {
  const [result, setResult] = useState<{ knowledgePointId: string; decision: LearningDecisionSummary | null; loaded: boolean }>({ knowledgePointId, decision: null, loaded: false });

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/learning/decisions?limit=30`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { decisions?: LearningDecisionSummary[] };
        if (!active) return;
        const match = (data.decisions ?? []).find((item) => item.knowledgePointId === knowledgePointId);
        setResult({ knowledgePointId, decision: match ?? null, loaded: true });
      })
      .catch(() => { if (active) setResult({ knowledgePointId, decision: null, loaded: true }); });
    return () => { active = false; };
  }, [apiBase, knowledgePointId]);

  if (!result.loaded || result.knowledgePointId !== knowledgePointId) return null;
  const decision = result.decision;
  if (!decision) return null;
  const resourceLabel = decision.recommendedResourceType === "lecture" ? "讲义"
    : decision.recommendedResourceType === "tiered_quiz" ? "分层习题"
    : decision.recommendedResourceType === "presentation" ? "PPT"
    : decision.recommendedResourceType === "concept_map" ? "知识脉络" : "资源";
  return <div className="path-node-decision mt-3 text-[11px] leading-4">
    <div className="flex items-center justify-between">
      <span className="font-medium">最近学习建议</span>
      <span className="text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(decision.createdAt)}</span>
    </div>
    <p className="mt-1.5 text-muted-foreground">根据最近一次{TRIGGER_LABELS[decision.triggerType] ?? "学习反馈"}，下一步建议：<b className="font-semibold text-foreground">{DECISION_LABELS[decision.decision] ?? "继续学习"}</b>{decision.recommendedResourceType ? `，优先${resourceLabel}` : ""}。</p>
    <p className="mt-1 text-muted-foreground">完成下一次学习或练习后自动更新。</p>
  </div>;
}

function nodeStatusLabel(node: PathNode): string {
  if (node.mastered) return "已掌握";
  if (node.userStatus === "completed") return "已学完";
  if (node.userStatus === "learning") return "学习中";
  return "未开始";
}

export function PathNodeDetails({
  apiBase,
  node,
  onPrimary,
  primaryLabel,
  onRequestNodeAddition,
  onUpdateNode,
  saving = false,
  compact = false,
}: {
  apiBase: string;
  node: PathNode;
  onPrimary: () => void;
  primaryLabel: string;
  onRequestNodeAddition?: (kind: string) => void;
  onUpdateNode: (node: PathNode, patch: Partial<Pick<PathNode, "userStatus" | "mastered">>) => void;
  saving?: boolean;
  compact?: boolean;
}) {
  return <div className={`path-node-detail ${compact ? "path-node-detail-compact" : ""}`}>
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="path-node-kicker">当前节点</div>
        <h3 className="path-node-title mt-1">{node.title}</h3>
      </div>
      <span className={`path-node-status path-node-status-${node.mastered ? "mastered" : node.userStatus}`}>{nodeStatusLabel(node)}</span>
    </div>
    {node.recommendation ? <div className={`path-node-recommendation path-node-recommendation-${node.recommendation.level} mt-3`}><RecommendationBadge recommendation={node.recommendation} /></div> : null}
    <div className="path-node-focus mt-4">
      <div className="path-node-section-label">这一节点要学会</div>
      <DescriptionList text={node.description} compact={compact} />
    </div>
    <NodeDecisionBasis key={node.knowledgePointId} apiBase={apiBase} knowledgePointId={node.knowledgePointId} />
    <div className="path-node-actions mt-4">
      <button type="button" onClick={onPrimary} className="path-node-primary inline-flex h-8 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-medium">{primaryLabel}</button>
      {onRequestNodeAddition ? <div className="flex flex-wrap gap-1.5">
        {(["前置", "分支", "应用"] as const).map((kind) => <button key={kind} type="button" onClick={() => onRequestNodeAddition(kind)} className="path-node-chip inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px]"><Plus className="h-3 w-3" />{kind}</button>)}
      </div> : null}
      <div className="flex gap-2">
        <button type="button" disabled={saving} onClick={() => onUpdateNode(node, { userStatus: node.userStatus === "completed" ? "learning" : "completed" })} className="path-node-secondary inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs disabled:opacity-50"><Check className="h-3.5 w-3.5" />{node.userStatus === "completed" ? "继续学习" : "标记学完"}</button>
        <button type="button" disabled={saving} onClick={() => onUpdateNode(node, { mastered: !node.mastered, userStatus: node.mastered ? node.userStatus : "completed" })} className={`path-node-secondary inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg px-2 text-xs disabled:opacity-50 ${node.mastered ? "path-node-secondary-active" : ""}`}><Trophy className="h-3.5 w-3.5" />{node.mastered ? "取消掌握" : "标记掌握"}</button>
      </div>
    </div>
  </div>;
}

function statusDot(node: PathNode) {
  if (node.mastered) return "bg-emerald-600";
  if (node.userStatus === "completed") return "bg-blue-600";
  if (node.userStatus === "learning") return "bg-amber-500";
  return "bg-zinc-300";
}

function nodeClassName(node: PathNode, selected: boolean, next = false) {
  const ring = selected ? "ring-2 ring-foreground/15 shadow-md" : next ? "ring-2 ring-amber-300 shadow-sm" : "hover:shadow-sm";
  if (node.mastered) return `border-emerald-300 bg-emerald-50 hover:border-emerald-500 ${ring}`;
  if (node.userStatus === "completed") return `border-blue-300 bg-blue-50/60 hover:border-blue-500 ${ring}`;
  if (node.userStatus === "learning") return `border-amber-300 bg-amber-50/70 hover:border-amber-500 ${ring}`;
  return `border-border bg-card hover:border-foreground/40 ${ring}`;
}

type TreeLayout = {
  width: number;
  height: number;
  positions: Map<string, { x: number; y: number; width: number; height: number }>;
};

type TreeDirection = "horizontal" | "vertical";

function getTreeLayout(graph: PathGraph, direction: TreeDirection): TreeLayout {
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
  const laneGap = 52;
  const itemGap = 20;
  const maxRows = Math.max(1, ...[...columns.values()].map((items) => items.length));
  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  const levels = [...columns.entries()].sort(([a], [b]) => a - b);
  if (direction === "horizontal") {
    const height = Math.max(290, maxRows * (nodeHeight + itemGap) + 34);
    levels.forEach(([level, items]) => {
      const columnHeight = items.length * nodeHeight + Math.max(0, items.length - 1) * itemGap;
      const startY = Math.max(17, (height - columnHeight) / 2);
      items.forEach((node, index) => positions.set(node.id, { x: 20 + level * (nodeWidth + laneGap), y: startY + index * (nodeHeight + itemGap), width: nodeWidth, height: nodeHeight }));
    });
    return { width: Math.max(650, levels.length * (nodeWidth + laneGap) + 20), height, positions };
  }

  const width = Math.max(430, maxRows * (nodeWidth + itemGap) + 34);
  levels.forEach(([level, items]) => {
    const rowWidth = items.length * nodeWidth + Math.max(0, items.length - 1) * itemGap;
    const startX = Math.max(17, (width - rowWidth) / 2);
    items.forEach((node, index) => positions.set(node.id, { x: startX + index * (nodeWidth + itemGap), y: 20 + level * (nodeHeight + laneGap), width: nodeWidth, height: nodeHeight }));
  });
  return { width, height: Math.max(340, levels.length * (nodeHeight + laneGap) + 20), positions };
}

function getPathSequence(graph: PathGraph): PathNode[] {
  const nodes = [...graph.nodes].sort((a, b) => a.sortOrder - b.sortOrder);
  const nodeIds = new Set(nodes.map((node) => node.id));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));
  const outgoing = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) continue;
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }
  const ready = nodes.filter((node) => indegree.get(node.id) === 0);
  const sequence: PathNode[] = [];
  while (ready.length > 0) {
    ready.sort((a, b) => a.sortOrder - b.sortOrder);
    const node = ready.shift()!;
    sequence.push(node);
    for (const nextId of outgoing.get(node.id) ?? []) {
      const nextDegree = (indegree.get(nextId) ?? 0) - 1;
      indegree.set(nextId, nextDegree);
      if (nextDegree === 0) {
        const next = nodes.find((item) => item.id === nextId);
        if (next) ready.push(next);
      }
    }
  }
  if (sequence.length < nodes.length) {
    const included = new Set(sequence.map((node) => node.id));
    sequence.push(...nodes.filter((node) => !included.has(node.id)));
  }
  return sequence;
}

export function TreeCanvas({ graph, selectedNodeId, onSelect }: { graph: PathGraph; selectedNodeId: string | null; onSelect: (node: PathNode) => void }) {
  const [direction, setDirection] = useState<TreeDirection>(() => {
    if (typeof window === "undefined") return "horizontal";
    try {
      const saved = window.localStorage.getItem("im-training-agent:path-direction");
      return saved === "vertical" ? "vertical" : "horizontal";
    } catch { return "horizontal"; }
  });
  const layout = useMemo(() => getTreeLayout(graph, direction), [direction, graph]);
  const sequence = useMemo(() => getPathSequence(graph), [graph]);
  const nextNode = sequence.find((node) => node.userStatus !== "completed" && !node.mastered) ?? null;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ distance: number; zoom: number } | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [fitZoom, setFitZoom] = useState(1);
  const [zoomOffset, setZoomOffset] = useState(0);
  const canvasPadding = 180;
  const clampZoom = (value: number) => Math.max(0.45, Math.min(1.8, Number(value.toFixed(2))));
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const updateFitZoom = () => {
      const availableWidth = Math.max(320, viewport.clientWidth - 16);
      const availableHeight = Math.max(220, viewport.clientHeight - 16);
      setFitZoom(Math.max(0.45, Math.min(1, Number((Math.min(availableWidth / layout.width, availableHeight / layout.height)).toFixed(2)))));
    };
    updateFitZoom();
    const observer = new ResizeObserver(updateFitZoom);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [layout.height, layout.width]);
  const zoom = clampZoom(fitZoom + zoomOffset);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const worldWidth = layout.width * zoom + canvasPadding * 2;
    const worldHeight = layout.height * zoom + canvasPadding * 2;
    viewport.scrollTo({ left: Math.max(0, (worldWidth - viewport.clientWidth) / 2), top: Math.max(0, (worldHeight - viewport.clientHeight) / 2) });
  }, [canvasPadding, layout.height, layout.width, zoom]);
  const distanceOfTouches = () => {
    const [first, second] = [...pointersRef.current.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : 0;
  };
  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size === 1) {
      panRef.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
    } else if (pointersRef.current.size === 2) {
      pinchRef.current = { distance: distanceOfTouches(), zoom };
      panRef.current = null;
    }
  };
  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(event.pointerId)) return;
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointersRef.current.size >= 2 && pinchRef.current?.distance) {
      event.preventDefault();
      setZoomOffset(clampZoom(pinchRef.current.zoom * (distanceOfTouches() / pinchRef.current.distance)) - fitZoom);
      return;
    }
    if (pointersRef.current.size === 1 && panRef.current) {
      event.preventDefault();
      event.currentTarget.scrollLeft = panRef.current.left - (event.clientX - panRef.current.x);
      event.currentTarget.scrollTop = panRef.current.top - (event.clientY - panRef.current.y);
    }
  };
  const releasePointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) panRef.current = null;
  };
  const toggleDirection = () => setDirection((current) => {
    const next = current === "horizontal" ? "vertical" : "horizontal";
    try { window.localStorage.setItem("im-training-agent:path-direction", next); } catch { /* 忽略本地存储异常 */ }
    return next;
  });
  const resetViewport = () => {
    setZoomOffset(0);
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTo({ left: Math.max(0, (layout.width * fitZoom + canvasPadding * 2 - viewport.clientWidth) / 2), top: Math.max(0, (layout.height * fitZoom + canvasPadding * 2 - viewport.clientHeight) / 2) });
  };
  return <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border bg-card">
    <div className="flex shrink-0 items-center justify-between border-b bg-background px-3 py-2 text-[10px] text-muted-foreground"><span className="inline-flex items-center gap-1.5"><Move className="h-3.5 w-3.5 text-blue-500" />拖动查看，点击节点</span><div className="flex items-center gap-1"><button type="button" onClick={toggleDirection} aria-label={direction === "horizontal" ? "切换为纵向路径" : "切换为横向路径"} title={direction === "horizontal" ? "切换为纵向路径" : "切换为横向路径"} className="tree-canvas-tool"><ArrowDownUp className={`h-3.5 w-3.5 ${direction === "horizontal" ? "rotate-90" : ""}`} />{direction === "horizontal" ? "横向" : "纵向"}</button><button type="button" onClick={resetViewport} className="tree-canvas-tool" title="适应窗口"><RefreshCw className="h-3.5 w-3.5" /><span className="sr-only">适应窗口</span></button></div></div>
    <div className="shrink-0 border-b bg-slate-50/70 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3 text-[10px]"><span className="font-semibold text-slate-700">建议学习顺序</span><span className="min-w-0 truncate text-muted-foreground">{nextNode ? `下一步：${nextNode.title}` : "全部节点已学完"}</span></div>
      <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5" aria-label="建议学习顺序">
        {sequence.map((node, index) => {
          const done = node.mastered || node.userStatus === "completed";
          const next = node.id === nextNode?.id;
          const selected = node.id === selectedNodeId;
          return <button key={node.id} type="button" title={`${index + 1}. ${node.title}`} aria-label={`${index + 1}. ${node.title}${next ? "，下一步" : ""}`} aria-pressed={selected} onClick={() => onSelect(node)} className={`path-sequence-item ${selected ? "is-selected" : ""} ${next ? "is-next" : ""}`}>
            <span className={`path-sequence-number ${done ? "is-done" : ""}`}>{done ? <Check className="h-3 w-3" /> : index + 1}</span>
            <span className="max-w-24 truncate">{node.title}</span>
          </button>;
        })}
      </div>
    </div>
    <div ref={viewportRef} aria-label="可拖动学习路径画布" onWheel={(event) => { event.preventDefault(); setZoomOffset(clampZoom(zoom * (event.deltaY > 0 ? 0.9 : 1.1)) - fitZoom); }} onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button")) return; handlePointerDown(event); }} onPointerMove={handlePointerMove} onPointerUp={releasePointer} onPointerCancel={releasePointer} className="min-h-0 flex-1 cursor-grab select-none overflow-auto active:cursor-grabbing" style={{ touchAction: "none", overscrollBehavior: "contain" }}>
      <div className="relative shrink-0" style={{ width: layout.width * zoom + canvasPadding * 2, height: layout.height * zoom + canvasPadding * 2 }}>
        <div className="absolute origin-top-left" style={{ left: canvasPadding, top: canvasPadding, width: layout.width, height: layout.height, transform: `scale(${zoom})` }}>
          <svg className="pointer-events-none absolute inset-0" width={layout.width} height={layout.height} aria-hidden="true">
            {graph.edges.map((edge) => {
              const from = layout.positions.get(edge.fromNodeId);
              const to = layout.positions.get(edge.toNodeId);
              if (!from || !to) return null;
              const path = direction === "horizontal"
                ? `M ${from.x + from.width} ${from.y + from.height / 2} C ${from.x + from.width + 30} ${from.y + from.height / 2}, ${to.x - 30} ${to.y + to.height / 2}, ${to.x} ${to.y + to.height / 2}`
                : `M ${from.x + from.width / 2} ${from.y + from.height} C ${from.x + from.width / 2} ${from.y + from.height + 30}, ${to.x + to.width / 2} ${to.y - 30}, ${to.x + to.width / 2} ${to.y}`;
              return <path key={edge.id} d={path} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-border" />;
            })}
          </svg>
          {[...graph.nodes].sort((a, b) => a.sortOrder - b.sortOrder).map((node) => {
            const position = layout.positions.get(node.id);
            if (!position) return null;
             const isNext = node.id === nextNode?.id;
             return <button key={node.id} type="button" title={node.title} aria-label={`${node.title}${isNext ? "，下一步" : node.id === selectedNodeId ? "，当前查看" : ""}`} aria-pressed={node.id === selectedNodeId} onClick={() => onSelect(node)} className={`absolute rounded-lg border p-2.5 text-left transition-all ${nodeClassName(node, node.id === selectedNodeId, isNext)}`} style={{ left: position.x, top: position.y, width: position.width, height: position.height }}>
              <div className="flex items-center gap-1.5"><span className={`h-2 w-2 shrink-0 rounded-full ${statusDot(node)}`} /><span className="min-w-0 flex-1 truncate text-xs font-semibold">{node.title}</span>{node.recommendation && recommendationView(node.recommendation.level).dotClass ? <span aria-label={recommendationView(node.recommendation.level).label} title={recommendationView(node.recommendation.level).label} className={`h-1.5 w-1.5 shrink-0 rounded-full ${recommendationView(node.recommendation.level).dotClass}`} /> : null}<ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /></div>
            </button>;
          })}
        </div>
      </div>
    </div>
  </div>;
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
  const [notice, setNotice] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const feedRef = useRef<HTMLDivElement | null>(null);
  const feedFollowRef = useRef(true);
  const detailsRef = useRef<HTMLDivElement | null>(null);
  const streamMessageRef = useRef<string | null>(null);
  const agentTimersRef = useRef(new Map<string, number>());

  useEffect(() => () => {
    agentTimersRef.current.forEach((timer) => window.clearInterval(timer));
    agentTimersRef.current.clear();
  }, []);

  const consumePathPrefill = useCallback((graph: PathGraph) => {
    try {
      const raw = window.localStorage.getItem("im-training-agent:path-prefill");
      if (!raw) return null;
      window.localStorage.removeItem("im-training-agent:path-prefill");
      const parsed = JSON.parse(raw) as { draft?: unknown; nodeId?: unknown; createdAt?: unknown };
      if (typeof parsed.draft !== "string" || !parsed.draft.trim()) return null;
      if (typeof parsed.createdAt === "number" && Date.now() - parsed.createdAt > 120_000) return null;
      setDraft(parsed.draft);
      return typeof parsed.nodeId === "string" && graph.nodes.some((node) => node.id === parsed.nodeId) ? parsed.nodeId : null;
    } catch { return null; }
  }, []);

  const rememberedNodeId = (graph: PathGraph): string | null => {
    try {
      const raw = window.localStorage.getItem("im-training-agent:selected-path-node");
      if (!raw) return null;
      const parsed = JSON.parse(raw) as { nodeId?: unknown; createdAt?: unknown };
      if (typeof parsed.createdAt === "number" && Date.now() - parsed.createdAt > 86_400_000) return null;
      return typeof parsed.nodeId === "string" && graph.nodes.some((node) => node.id === parsed.nodeId) ? parsed.nodeId : null;
    } catch { return null; }
  };

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/profile`, { credentials: "include" }),
      fetch(`${apiBase}/api/learning/chat`, { credentials: "include" }),
    ]).then(async ([pathResponse, profileResponse, chatResponse]) => {
      if (!pathResponse.ok || !profileResponse.ok || !chatResponse.ok) throw new Error("学习路径读取失败，请重新登录后再试");
      const [pathData, profileData, chatData] = await Promise.all([
        pathResponse.json() as Promise<{ path?: PathGraph }>,
        profileResponse.json() as Promise<{ profile?: ProfileMetric }>,
        chatResponse.json() as Promise<{ messages?: ChatMessage[] }>,
      ]);
      if (!alive) return;
      const nextPath = pathData.path ?? { nodes: [], edges: [] };
      const preferredNodeId = consumePathPrefill(nextPath) ?? rememberedNodeId(nextPath);
      setPath(nextPath);
      setProfile(profileData.profile ?? null);
      setMessages(chatData.messages ?? []);
      setSelectedNodeId((current) => preferredNodeId ?? (current && nextPath.nodes.some((node) => node.id === current) ? current : nextPath.nodes[0]?.id ?? null));
    }).catch((error) => { if (alive) setNotice(error instanceof Error ? error.message : "学习路径读取失败"); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [apiBase, consumePathPrefill]);

  useEffect(() => {
    if (loading) return;
    let frame = 0;
    const scrollToLatest = () => {
      const feed = feedRef.current;
      if (!feed || !feedFollowRef.current) return;
      feed.scrollTop = feed.scrollHeight;
      // 只在用户仍停留在底部时校正，避免流式输出期间把用户正在看的历史消息推走。
      frame = window.requestAnimationFrame(() => {
        if (feedRef.current && feedFollowRef.current) feedRef.current.scrollTop = feedRef.current.scrollHeight;
      });
    };
    frame = window.requestAnimationFrame(scrollToLatest);
    return () => window.cancelAnimationFrame(frame);
  }, [loading, messages, sending]);

  const refreshPathAndProfile = useCallback(async () => {
    try {
      const [pathResponse, profileResponse] = await Promise.all([
        fetch(`${apiBase}/api/learning/path-graph`, { credentials: "include" }),
        fetch(`${apiBase}/api/learning/profile`, { credentials: "include" }),
      ]);
      if (!pathResponse.ok || !profileResponse.ok) return;
      const pathData = await pathResponse.json() as { path?: PathGraph };
      const profileData = await profileResponse.json() as { profile?: ProfileMetric };
      if (pathData.path) {
        setPath(pathData.path);
        setSelectedNodeId((current) => current && pathData.path!.nodes.some((node) => node.id === current) ? current : pathData.path!.nodes[0]?.id ?? null);
      }
      if (profileData.profile) setProfile(profileData.profile);
    } catch { /* 页面保持现状，下一次聚焦继续同步 */ }
  }, [apiBase]);

  useEffect(() => {
    const refresh = () => void refreshPathAndProfile();
    window.addEventListener("im-training-agent:learning-evidence-updated", refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("im-training-agent:learning-evidence-updated", refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [refreshPathAndProfile]);

  const selectedNode = path.nodes.find((node) => node.id === selectedNodeId) ?? null;
  const completedNodes = path.nodes.filter((node) => node.userStatus === "completed").length;
  const masteredNodes = path.nodes.filter((node) => node.mastered).length;

  const carryIntoChat = (node: PathNode) => {
    const mention = `@${node.title}`;
    selectNode(node);
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

  const sendMessage = async (requestedContent?: string) => {
    const content = (requestedContent ?? draft).trim();
    if (!content || sending) return;
    setSending(true);
    setDraft("");
    setNotice("");
    feedFollowRef.current = true;
    const temporaryUser: ChatMessage = { id: `local-${Date.now()}`, role: "user", content, metadata: {}, createdAt: Date.now() };
    setMessages((current) => [...current, temporaryUser]);
    try {
      const response = await fetch(`${apiBase}/api/learning/chat`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body: JSON.stringify({ content }) });
      if (!response.ok || !response.body) throw new Error("路径调整失败，请稍后重试");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const finalDataBox: { value: { success?: boolean; error?: string; userMessage?: ChatMessage; agentMessages?: ChatMessage[]; assistantMessage?: ChatMessage; path?: PathGraph; profile?: ProfileMetric | null } | null } = { value: null };
      const liveId = `live-path-${Date.now()}`;
      streamMessageRef.current = liveId;
      setMessages((current) => [...current, { id: liveId, role: "assistant", content: "", metadata: {}, createdAt: Date.now() }]);
      const consumeFrame = (frame: string) => {
        const eventName = frame.match(/^event:\s*(.+)$/m)?.[1]?.trim() ?? "message";
        const dataLine = frame.match(/^data:\s*(.+)$/m)?.[1];
        if (!dataLine) return;
        try {
          const payload = JSON.parse(dataLine) as { text?: string; content?: string; id?: string; createdAt?: number; agentId?: string; agentName?: string; producer?: ChatMessage["metadata"]["producer"]; assistantMessage?: ChatMessage; path?: PathGraph; profile?: ProfileMetric | null; success?: boolean; error?: string };
          if (eventName === "token" && typeof payload.text === "string") setMessages((current) => current.map((item) => item.id === liveId ? { ...item, content: `${item.content}${payload.text}` } : item));
          if (eventName === "agent_message" && typeof payload.content === "string") {
            const agentMessageId = payload.id || `live-agent-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const agentContent = payload.content;
            setMessages((current) => [...current, {
              id: agentMessageId,
              role: "assistant",
              content: "",
              metadata: { kind: "agent", agentId: payload.agentId, agentName: payload.agentName, producer: payload.producer, streaming: true },
              createdAt: payload.createdAt ?? Date.now(),
            }]);
            let cursor = 0;
            const timer = window.setInterval(() => {
              cursor = Math.min(agentContent.length, cursor + Math.max(2, Math.ceil(agentContent.length / 36)));
              setMessages((current) => current.map((item) => item.id === agentMessageId ? { ...item, content: agentContent.slice(0, cursor), metadata: { ...item.metadata, streaming: cursor < agentContent.length } } : item));
              if (cursor >= agentContent.length) {
                window.clearInterval(timer);
                agentTimersRef.current.delete(agentMessageId);
              }
            }, 28);
            agentTimersRef.current.set(agentMessageId, timer);
          }
          if (eventName === "final") finalDataBox.value = payload;
          // Status frames are intentionally not rendered as a banner. The
          // conversation and the sending indicator already provide the useful
          // feedback without interrupting the chat flow with low-value noise.
        } catch { /* 忽略不完整帧 */ }
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), { stream: !chunk.done });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        frames.forEach(consumeFrame);
        if (chunk.done) break;
      }
      const finalData = finalDataBox.value;
      if (!finalData?.success || !finalData.userMessage || !finalData.assistantMessage) throw new Error(finalData?.error || "路径调整失败");
      const persistedAgents = finalData.agentMessages ?? [];
      const persistedAgentIds = new Set(persistedAgents.map((message) => message.id));
      for (const [id, timer] of agentTimersRef.current) {
        if (persistedAgentIds.has(id)) {
          window.clearInterval(timer);
          agentTimersRef.current.delete(id);
        }
      }
      setMessages((current) => {
        const rebuilt = current.filter((item) => item.id !== temporaryUser.id && item.id !== liveId && !persistedAgentIds.has(item.id));
        const seen = new Set(rebuilt.map((item) => item.id));
        if (!seen.has(finalData.userMessage!.id)) rebuilt.push(finalData.userMessage as ChatMessage);
        for (const agentMessage of persistedAgents) {
          if (!seen.has(agentMessage.id)) rebuilt.push({ ...agentMessage, metadata: { ...agentMessage.metadata, streaming: false } });
        }
        if (!seen.has(finalData.assistantMessage!.id)) rebuilt.push(finalData.assistantMessage as ChatMessage);
        return rebuilt;
      });
      if (finalData.path) setPath(finalData.path);
      if (finalData.profile) setProfile(finalData.profile);
      setNotice("");
    } catch (error) {
      const liveId = streamMessageRef.current;
      setMessages((current) => current.filter((item) => item.id !== temporaryUser.id && item.id !== liveId));
      setDraft(content);
      setNotice(error instanceof Error ? error.message : "路径调整失败");
    } finally {
      streamMessageRef.current = null;
      setSending(false);
    }
  };

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };
  const selectNode = (node: PathNode) => {
    setSelectedNodeId(node.id);
    try {
      window.localStorage.setItem("im-training-agent:selected-path-node", JSON.stringify({ nodeId: node.id, knowledgePointId: node.knowledgePointId, createdAt: Date.now() }));
    } catch { /* 本地存储不可用时仍保留当前页面的选择 */ }
  };

  useEffect(() => {
    detailsRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  }, [selectedNodeId]);

  return <main className="app-shell flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
    <WorkspaceHeader user={user} activeView="path" onNavigate={(nextView) => onNavigate?.(nextView)} onSettings={() => setSettingsOpen(true)} onProfile={() => setProfileOpen(true)} onLogout={logout} />

    <div className="path-layout grid min-h-0 flex-1 grid-cols-[minmax(360px,40%)_minmax(0,1fr)] overflow-hidden">
       <section className="flex min-h-0 min-w-0 flex-col bg-card" aria-label="路径调整对话与处理过程">
        <div className="workspace-pane-titlebar flex shrink-0 items-center justify-between border-b px-5 py-3.5 sm:px-6"><div className="flex items-center gap-2"><MessageSquareText className="h-4 w-4" /><h1 className="text-sm font-semibold">路径调整</h1></div></div>
         <div ref={feedRef} role="log" aria-live="polite" aria-busy={sending} onScroll={(event) => { const feed = event.currentTarget; feedFollowRef.current = feed.scrollHeight - feed.scrollTop - feed.clientHeight < 72; }} className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="mx-auto max-w-2xl space-y-5">
            {loading ? <div className="flex min-h-[250px] items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4" />正在加载路径对话</div> : messages.length === 0 ? <div className="path-empty-state"><div className="path-empty-icon"><Network className="h-5 w-5" /></div><h2>从你的目标开始调整</h2><p>告诉路径助手你想学到什么、时间有多少，或从当前节点继续往前拆。</p><div className="path-suggestion-list"><button type="button" onClick={() => setDraft("我每周只有 4 小时，先帮我排一条能完成的学习路线")}>每周时间有限，重新排节奏</button><button type="button" onClick={() => setDraft("我想尽快做出一份设备诊断报告，请把当前路径拆成最短可行路线")}>先完成一份诊断报告</button><button type="button" onClick={() => setDraft("把当前节点拆成更容易跟着做的前置步骤")}>把当前节点拆细一点</button></div></div> : messages.map((chat) => chat.role === "user"
              ? <article key={chat.id} className="ml-auto max-w-[84%] border-r border-blue-200 pr-3 text-right text-[13px] leading-6 text-blue-950"><RichText text={chat.content} /><div className="mt-1 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(chat.createdAt)}</div></article>
              : chat.metadata.kind === "agent"
                ? <article key={chat.id} className="max-w-[94%]">
                  <div className="flex items-start gap-2.5">
                    <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${pathAgentTone(chat.metadata.agentId)}`}>{(chat.metadata.agentName ?? "任务协调员").slice(0, 1)}</span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground"><span>{chat.metadata.agentName ?? "任务协调员"}</span><span className="rounded-full border border-border/70 px-1.5 py-0.5 text-[9px] font-normal">{pathProducerLabel(chat.metadata.producer)}</span>{chat.metadata.streaming ? <span className="agent-streaming-label">正在输出</span> : null}</div>
                      <div className={`agent-message-bubble mt-1.5 text-[13px] leading-7 text-slate-700 ${chat.metadata.streaming ? "is-streaming" : ""}`}><RichText text={chat.content} />{chat.metadata.streaming ? <span aria-label="正在流式输出" className="agent-streaming-caret" /> : null}</div>
                    </div>
                  </div>
                  <div className="mt-1 pl-[42px] text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(chat.createdAt)}</div>
                </article>
                : <article key={chat.id} className="max-w-[94%]">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-blue-600"><Bot className="h-4 w-4" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-muted-foreground">路径助手</div>
                      <div className="mt-1 text-[13px] leading-7 text-slate-700"><RichText text={chat.content} /></div>
                      {!chat.metadata.agentMessagesPersisted && (chat.metadata.activities?.length || chat.metadata.pathChanged) ? <div className="mt-3 border-l border-teal-200 bg-teal-50/45 py-2 pl-3 text-xs text-teal-900"><div className="mb-1 font-medium text-teal-950">处理过程{chat.metadata.pathChanged ? " · 路径已更新" : ""}</div>{chat.metadata.activities?.map((activity) => <div className="flex gap-2 py-1" key={`${chat.id}-${activity.agentId}`}><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-400" /><span><b className="font-medium text-teal-950">{readablePathActivityText(activity.name)}</b>：{readablePathActivityText(activity.action)}</span></div>)}</div> : null}
                    </div>
                  </div>
                  <div className="mt-1 pl-[42px] text-[10px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(chat.createdAt)}</div>
                </article>)}
            {sending && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在为你调整路径</div>}
          </div>
        </div>
        <div className="shrink-0 border-t bg-background p-4 sm:px-6">{notice && <div className="mb-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</div>}<div className="mx-auto flex max-w-2xl items-end gap-2 rounded-2xl border bg-card p-2 focus-within:ring-2 focus-within:ring-foreground/10"><textarea value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendMessage(); } }} rows={2} placeholder="输入想如何调整路径" className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground" /><button type="button" disabled={!draft.trim() || sending} onClick={() => void sendMessage()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground text-background disabled:cursor-not-allowed disabled:opacity-35"><Send className="h-4 w-4" /></button></div></div>
      </section>

      <aside className="flex min-w-0 flex-col overflow-hidden border-l bg-muted/15" aria-label="知识树学习路径">
        <div className="workspace-pane-titlebar flex shrink-0 items-center justify-between border-b bg-background px-5 py-3.5"><div className="flex items-center gap-2"><Network className="h-4 w-4" /><h2 className="text-sm font-semibold">我的学习路径</h2></div><div className="flex items-center gap-2"><button type="button" aria-label="一键更新路径" title="根据最新画像、学习记录与资源更新路径" disabled={sending || loading || path.nodes.length === 0} onClick={() => void sendMessage("请根据当前学习画像、最近学习记录、已生成资源与证据，重新评估并更新我的学习路径；只有在有充分依据时才修改节点或关系，并说明本次变更原因。") } className="path-update-action"><RefreshCw className={`h-3.5 w-3.5 ${sending ? "animate-spin" : ""}`} />更新路径</button></div></div>
         <div className="flex min-h-0 basis-[56%] flex-col p-4 pb-2"><div className="mb-3 flex shrink-0 items-center justify-between"><div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground"><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-zinc-300" />未开始</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-600" />学完</span><span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-600" />掌握</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-amber-500" />建议补强</span><span className="flex items-center gap-1"><i className="h-1.5 w-1.5 rounded-full bg-emerald-500" />可进阶</span></div></div>{loading ? <div className="flex min-h-0 flex-1 items-center justify-center"><Loader2 className="h-4 w-4" /></div> : path.nodes.length === 0 ? <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed text-sm text-muted-foreground">尚未建立学习路径</div> : <TreeCanvas graph={path} selectedNodeId={selectedNodeId} onSelect={selectNode} />}</div>
         <div ref={detailsRef} className="min-h-0 basis-[44%] overflow-y-auto border-t bg-background p-4">
          {selectedNode ? <PathNodeDetails apiBase={apiBase} node={selectedNode} primaryLabel="带入对话" onPrimary={() => carryIntoChat(selectedNode)} onRequestNodeAddition={requestNodeAddition} onUpdateNode={updateNode} saving={savingNodeId === selectedNode.id} /> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">选择一个节点查看详情</div>}
        </div>
      </aside>
    </div>
    {profileOpen && <ProfileDialog apiBase={apiBase} user={user} onUserChange={onUserChange} extraMetrics={[{ label: '今日新增', value: profile?.todayAssetsCount ?? 0 }, { label: '已学完节点', value: completedNodes }, { label: '已掌握节点', value: masteredNodes }]} onClose={() => setProfileOpen(false)} />}
    {settingsOpen && <SettingsDialog apiBase={apiBase} onClose={() => setSettingsOpen(false)} />}
  </main>;
}
