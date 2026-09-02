"use client";

import { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Circle, LoaderCircle, RotateCcw } from "lucide-react";

export type DagNodeState = "pending" | "running" | "succeeded" | "failed" | "revising";

type DagEvent = { id: string; type: string; nodeKey: string | null; summary: string };
type DagState = { key: string; state: Exclude<DagNodeState, "pending"> };

const phases = [
  { label: "准备", keys: ["assess.learner", "retrieve.structured", "retrieve.document"] },
  { label: "分析与生成", keys: ["analyze.domain", "generate.resource"] },
  { label: "核验", keys: ["audit.claims", "debate.challenge", "adjudicate.verdict"] },
  { label: "保护与交付", keys: ["privacy.compliance", "finalize.publish"] },
] as const;

const labels: Record<string, string> = {
  "assess.learner": "分析画像",
  "retrieve.structured": "查找数据",
  "retrieve.document": "查找资料",
  "analyze.domain": "分析内容",
  "generate.resource": "制作材料",
  "audit.claims": "检查内容",
  "debate.challenge": "复核疑点",
  "adjudicate.verdict": "判断依据",
  "privacy.compliance": "隐私检查",
  "finalize.publish": "保存结果",
};

function statusPresentation(state: DagNodeState) {
  if (state === "succeeded") return { label: "已完成", tone: "border-emerald-200 bg-emerald-50 text-emerald-800", Icon: CheckCircle2 };
  if (state === "failed") return { label: "未完成", tone: "border-rose-200 bg-rose-50 text-rose-800", Icon: AlertCircle };
  if (state === "revising") return { label: "修改中", tone: "border-amber-200 bg-amber-50 text-amber-800", Icon: RotateCcw };
  if (state === "running") return { label: "进行中", tone: "border-blue-200 bg-blue-50 text-blue-800", Icon: LoaderCircle };
  return { label: "等待中", tone: "border-slate-200 bg-background text-slate-500", Icon: Circle };
}

/** 只呈现公开的节点状态与摘要；模型内部推理不进入这个组件。 */
export function DagProgress({ states, events, summary, completed }: { states: DagState[]; events: DagEvent[]; summary: string; completed: boolean }) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const stateByKey = useMemo(() => new Map(states.map((item) => [item.key, item.state])), [states]);
  const revisionCount = events.filter((event) => event.type === "run.revision").length;
  const currentKey = phases.flatMap((phase) => phase.keys).find((key) => stateByKey.get(key) === "running" || stateByKey.get(key) === "revising") ?? null;
  const focusKey = selectedKey ?? currentKey;
  const detail = focusKey ? [...events].reverse().find((event) => event.nodeKey === focusKey)?.summary ?? "该步骤暂未产生可公开的处理摘要。" : summary;
  const completedCount = phases.flatMap((phase) => phase.keys).filter((key) => stateByKey.get(key) === "succeeded").length;

  return <section aria-label="多智能体协同进度" className="rounded-xl border bg-muted/20 p-3">
    <div className="flex items-center justify-between gap-3">
      <div><div className="text-xs font-semibold text-slate-800">协同处理流程</div><p className="mt-0.5 text-[10px] leading-4 text-muted-foreground">{completed ? "本次处理已结束，点击步骤查看公开摘要。" : "状态由实时处理事件更新，点击步骤查看公开摘要。"}</p></div>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">{completedCount} / 10</span>
    </div>
    <div className="mt-3 space-y-2.5" aria-label="十个协同处理步骤">
      {phases.map((phase, phaseIndex) => <div key={phase.label}>
        <div className="mb-1 text-[10px] font-medium text-slate-500">{phase.label}</div>
        <div className="grid min-w-0 grid-cols-2 gap-1.5">
          {phase.keys.map((key) => {
            const state = stateByKey.get(key) ?? "pending";
            const presentation = statusPresentation(state);
            const Icon = presentation.Icon;
            const active = focusKey === key;
            return <button key={key} type="button" title={`${labels[key]}：${presentation.label}`} onClick={() => setSelectedKey(key)} aria-pressed={active} className={`flex min-w-0 items-center gap-1.5 rounded-lg border px-2 py-1.5 text-left text-[10px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 ${presentation.tone} ${active ? "ring-1 ring-current" : "hover:bg-white/80"}`}>
              <Icon aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 ${state === "running" ? "animate-spin" : ""}`} />
              <span className="min-w-0 whitespace-nowrap">{labels[key]}</span>
            </button>;
          })}
          {phaseIndex === 0 && <div className="col-span-2 text-[9px] leading-3 text-slate-400">画像、数据与资料可并行完成后再进入分析。</div>}
        </div>
      </div>)}
    </div>
    {revisionCount > 0 && <div className="mt-2 flex items-center gap-1.5 rounded-lg border border-dashed border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[10px] leading-4 text-amber-800"><RotateCcw className="h-3.5 w-3.5 shrink-0" />内容已根据检查结果回到生成环节修改 {revisionCount} 次。</div>}
    {(detail || summary) && <div aria-live="polite" className="mt-2 border-t pt-2"><div className="text-[10px] font-medium text-slate-700">{focusKey ? `${labels[focusKey]} · 公开摘要` : "最新公开摘要"}</div><p className="mt-1 break-words text-[10px] leading-4 text-muted-foreground">{detail || summary}</p></div>}
  </section>;
}
