"use client";

import { CheckCircle2, Clock, XCircle, Loader2, AlertCircle } from "lucide-react";
import { useMemo } from "react";

export interface DagNode {
  id: string;
  label: string;
  status: "pending" | "running" | "succeeded" | "failed";
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata?: {
    evidenceCount?: number;
    outputSummary?: string;
    agentId?: string;
  };
}

interface DagProgressEnhancedProps {
  states: Array<{ key: string; state: string }>;
  summary?: string;
  events?: Array<{ id: string; type: string; nodeKey: string | null; summary: string }>;
  completed?: boolean;
}

export function DagProgressEnhanced({ states }: DagProgressEnhancedProps) {
  // 将 states 转换为 DagNode 格式
  const nodes: DagNode[] = states.map((item) => ({
    id: item.key,
    label: nodeKeyLabel(item.key),
    status: item.state as "pending" | "running" | "succeeded" | "failed",
    metadata: {
      agentId: item.key,
    },
  }));

  return <DagProgress nodes={nodes} currentNodeId={states.find((s) => s.state === "running")?.key} />;
}

interface DagProgressProps {
  nodes: DagNode[];
  currentNodeId?: string;
}

function DagProgress({ nodes, currentNodeId }: DagProgressProps) {
  const stats = useMemo(() => {
    const succeeded = nodes.filter((n) => n.status === "succeeded").length;
    const failed = nodes.filter((n) => n.status === "failed").length;
    const running = nodes.filter((n) => n.status === "running").length;
    const pending = nodes.filter((n) => n.status === "pending").length;
    return { succeeded, failed, running, pending, total: nodes.length };
  }, [nodes]);

  const currentNode = nodes.find((n) => n.id === currentNodeId);

  return (
    <div className="space-y-4">
      {/* 总体进度条 */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between text-xs text-muted-foreground mb-2">
          <span>协同进度</span>
          <span className="font-medium tabular-nums">
            {stats.succeeded + stats.failed} / {stats.total}
          </span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-muted">
          <div className="flex h-full">
            <div
              style={{ width: `${(stats.succeeded / stats.total) * 100}%` }}
              className="bg-emerald-500 transition-all duration-500"
            />
            <div
              style={{ width: `${(stats.running / stats.total) * 100}%` }}
              className="bg-blue-500 transition-all duration-500"
            />
            <div
              style={{ width: `${(stats.failed / stats.total) * 100}%` }}
              className="bg-rose-500 transition-all duration-500"
            />
          </div>
        </div>
        <div className="mt-3 flex items-center gap-4 text-[10px]">
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <span className="text-muted-foreground">完成 {stats.succeeded}</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">进行中 {stats.running}</span>
          </div>
          {stats.failed > 0 && (
            <div className="flex items-center gap-1">
              <div className="h-2 w-2 rounded-full bg-rose-500" />
              <span className="text-muted-foreground">失败 {stats.failed}</span>
            </div>
          )}
        </div>
      </div>

      {/* 当前执行节点 */}
      {currentNode && currentNode.status === "running" && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
          <div className="flex items-start gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-blue-600 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold text-blue-900">{currentNode.label}</div>
              {currentNode.metadata?.agentId && (
                <div className="mt-1 text-[10px] text-blue-700">
                  智能体：{agentIdLabel(currentNode.metadata.agentId)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 节点时序瀑布图 */}
      <div className="space-y-2">
        {nodes.map((node, index) => {
          const duration = node.completedAt && node.startedAt
            ? Math.round((node.completedAt - node.startedAt) / 1000)
            : null;

          const isActive = node.id === currentNodeId;

          return (
            <div
              key={node.id}
              className={`rounded-lg border p-3 transition-all ${
                isActive ? "border-blue-300 bg-blue-50/50 shadow-sm" : "bg-card"
              }`}
            >
              <div className="flex items-start gap-3">
                {/* 状态图标 */}
                <div className="shrink-0 mt-0.5">
                  {node.status === "succeeded" && (
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                  )}
                  {node.status === "failed" && (
                    <XCircle className="h-4 w-4 text-rose-600" />
                  )}
                  {node.status === "running" && (
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                  )}
                  {node.status === "pending" && (
                    <Clock className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>

                {/* 节点信息 */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {index + 1}
                    </span>
                    <h4 className="text-sm font-medium text-slate-800">{node.label}</h4>
                    {duration !== null && (
                      <span className="text-[10px] text-muted-foreground tabular-nums">
                        {duration}s
                      </span>
                    )}
                  </div>

                  {/* 智能体ID */}
                  {node.metadata?.agentId && (
                    <div className="mt-1 text-[10px] text-muted-foreground">
                      {agentIdLabel(node.metadata.agentId)}
                    </div>
                  )}

                  {/* 产出摘要 */}
                  {node.status === "succeeded" && node.metadata?.outputSummary && (
                    <div className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] leading-relaxed text-emerald-800">
                      {node.metadata.outputSummary}
                    </div>
                  )}

                  {/* 证据数量 */}
                  {node.status === "succeeded" && node.metadata?.evidenceCount !== undefined && (
                    <div className="mt-2 text-[10px] text-muted-foreground">
                      产出：{node.metadata.evidenceCount} 条证据
                    </div>
                  )}

                  {/* 错误信息 */}
                  {node.status === "failed" && node.error && (
                    <div className="mt-2 flex items-start gap-1.5 rounded border border-rose-200 bg-rose-50 px-2 py-1 text-[10px] leading-relaxed text-rose-700">
                      <AlertCircle className="h-3 w-3 shrink-0 mt-0.5" />
                      <span>{node.error}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function agentIdLabel(agentId: string): string {
  const labels: Record<string, string> = {
    orchestrator: "协调器",
    evidence_retrieval: "证据检索",
    domain_expert: "领域分析",
    resource_generation: "资源生成",
    cross_validation: "交叉验证",
    privacy_compliance: "隐私审核",
  };
  return labels[agentId] || agentId;
}

function nodeKeyLabel(key: string): string {
  const labels: Record<string, string> = {
    "assess.learner": "分析画像",
    "retrieve.structured": "查找数据",
    "retrieve.document": "查找资料",
    "analyze.domain": "分析内容",
    "generate.resource": "制作材料",
    "audit.claims": "检查内容",
    "debate.challenge": "检查疑点",
    "adjudicate.verdict": "判断依据",
    "privacy.compliance": "隐私检查",
    "finalize.publish": "保存结果",
  };
  return labels[key] || key;
}
