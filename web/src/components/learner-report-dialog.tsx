"use client";

import { useEffect, useState } from "react";
import { BarChart3, BookOpen, CheckCircle2, Target, TrendingUp, X } from "lucide-react";

interface KnowledgeGap {
  nodeId: string;
  title: string;
  masteryLevel: number;
  gapScore: number;
  status: "pending" | "learning" | "completed";
}

interface DifficultyMatch {
  currentMastery: number;
  recommendedMin: number;
  recommendedMax: number;
}

interface PathProgress {
  completed: number;
  inProgress: number;
  pending: number;
  total: number;
}

interface RecentDecision {
  timestamp: number;
  agentId: string;
  decision: string;
  rationale: string;
}

interface LearnerReport {
  knowledgeGaps: KnowledgeGap[];
  difficultyMatch: DifficultyMatch;
  pathProgress: PathProgress;
  recentDecisions: RecentDecision[];
}

interface LearnerReportDialogProps {
  apiBase: string;
  onClose: () => void;
}

export function LearnerReportDialog({ apiBase, onClose }: LearnerReportDialogProps) {
  const [report, setReport] = useState<LearnerReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void fetch(`${apiBase}/api/learning/report`, { credentials: "include" })
      .then(async (response) => {
        const data = await response.json() as { success?: boolean; error?: string; report?: LearnerReport };
        if (!response.ok || !data.success) throw new Error(data.error || "学情报告读取失败");
        if (active) setReport(data.report ?? null);
      })
      .catch((err) => { if (active) setError(err instanceof Error ? err.message : "学情报告读取失败"); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [apiBase]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  if (loading) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-4xl rounded-2xl border bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">正在生成学情报告...</div>
      </div>
    </div>;
  }

  if (error || !report) {
    return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
      <div className="w-full max-w-4xl rounded-2xl border bg-white p-8 shadow-2xl">
        <div className="flex items-center justify-between border-b pb-4">
          <h2 className="text-xl font-semibold">学情报告</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="py-8 text-center text-sm text-destructive">{error || "学情报告暂时不可用"}</div>
      </div>
    </div>;
  }

  const { knowledgeGaps, difficultyMatch, pathProgress, recentDecisions } = report;

  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
    <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl border bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
      {/* 标题栏 */}
      <div className="sticky top-0 z-10 flex items-center justify-between border-b bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white">
            <BarChart3 className="h-5 w-5" />
          </span>
          <div>
            <h2 className="text-xl font-semibold">学情分析报告</h2>
            <p className="text-xs text-muted-foreground">基于BKT模型的个性化学习分析</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-lg p-2 transition-colors hover:bg-muted">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="p-6 space-y-6">
        {/* 路径进度概览 */}
        <section className="rounded-xl border bg-gradient-to-br from-slate-50 to-blue-50/30 p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Target className="h-4 w-4" />
            学习路径进度
          </div>
          <div className="mt-4 grid grid-cols-4 gap-4">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold text-emerald-600">{pathProgress.completed}</div>
              <div className="mt-1 text-xs text-muted-foreground">已掌握节点</div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold text-blue-600">{pathProgress.inProgress}</div>
              <div className="mt-1 text-xs text-muted-foreground">学习中节点</div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold text-slate-500">{pathProgress.pending}</div>
              <div className="mt-1 text-xs text-muted-foreground">待学习节点</div>
            </div>
            <div className="rounded-lg bg-white p-4 shadow-sm">
              <div className="text-2xl font-bold text-indigo-600">{Math.round((pathProgress.completed / pathProgress.total) * 100)}%</div>
              <div className="mt-1 text-xs text-muted-foreground">总体完成度</div>
            </div>
          </div>
          {/* 进度条 */}
          <div className="mt-4 h-3 overflow-hidden rounded-full bg-slate-200">
            <div className="flex h-full">
              <div style={{ width: `${(pathProgress.completed / pathProgress.total) * 100}%` }} className="bg-gradient-to-r from-emerald-500 to-emerald-600" />
              <div style={{ width: `${(pathProgress.inProgress / pathProgress.total) * 100}%` }} className="bg-gradient-to-r from-blue-500 to-blue-600" />
            </div>
          </div>
        </section>

        {/* 知识盲区雷达图 */}
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <TrendingUp className="h-4 w-4" />
            知识盲区分析
          </div>
          <p className="mt-1 text-xs text-muted-foreground">掌握度越低的节点，需要更多关注</p>
          <div className="mt-4 space-y-3">
            {knowledgeGaps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <CheckCircle2 className="h-12 w-12 text-emerald-500" />
                <p className="mt-3 text-sm font-medium">暂无明显知识盲区</p>
                <p className="mt-1 text-xs text-muted-foreground">继续保持，可以挑战更高难度</p>
              </div>
            ) : (
              knowledgeGaps.slice(0, 6).map((gap) => {
                const barWidth = Math.max(5, gap.masteryLevel * 100);
                const barColor = gap.masteryLevel >= 0.7 ? "bg-emerald-500" : gap.masteryLevel >= 0.4 ? "bg-amber-500" : "bg-rose-500";
                const statusLabel = gap.status === "completed" ? "已学完" : gap.status === "learning" ? "学习中" : "待学习";
                const statusColor = gap.status === "completed" ? "text-emerald-700" : gap.status === "learning" ? "text-blue-700" : "text-slate-500";

                return <div key={gap.nodeId} className="group rounded-lg border bg-muted/20 p-3 transition-colors hover:bg-muted/40">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-medium text-slate-800">{gap.title}</h4>
                        <span className={`text-[10px] font-medium ${statusColor}`}>{statusLabel}</span>
                      </div>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1">
                          <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-1">
                            <span>掌握度</span>
                            <span className="font-medium tabular-nums">{Math.round(gap.masteryLevel * 100)}%</span>
                          </div>
                          <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                            <div style={{ width: `${barWidth}%` }} className={`h-full ${barColor} transition-all duration-500`} />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="shrink-0">
                      <div className="text-right">
                        <div className="text-xs font-semibold text-rose-600">盲区评分</div>
                        <div className="text-xl font-bold text-rose-600">{gap.gapScore.toFixed(2)}</div>
                      </div>
                    </div>
                  </div>
                </div>;
              })
            )}
          </div>
        </section>

        {/* 难度匹配曲线 */}
        <section className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <BookOpen className="h-4 w-4" />
            资源难度匹配建议
          </div>
          <p className="mt-1 text-xs text-muted-foreground">基于当前掌握度推荐合适的学习资源难度区间</p>
          <div className="mt-4 space-y-4">
            {/* 当前掌握度 */}
            <div className="rounded-lg bg-blue-50 p-4">
              <div className="text-xs text-blue-700">当前综合掌握度</div>
              <div className="mt-1 text-3xl font-bold text-blue-600">{Math.round(difficultyMatch.currentMastery * 100)}%</div>
            </div>
            {/* 难度区间可视化 */}
            <div className="relative">
              <div className="flex items-center justify-between text-[10px] text-muted-foreground mb-2">
                <span>简单</span>
                <span>适中</span>
                <span>困难</span>
              </div>
              <div className="relative h-12 rounded-lg bg-gradient-to-r from-emerald-100 via-blue-100 to-rose-100">
                {/* 推荐区间 */}
                <div
                  style={{
                    left: `${difficultyMatch.recommendedMin * 100}%`,
                    width: `${(difficultyMatch.recommendedMax - difficultyMatch.recommendedMin) * 100}%`
                  }}
                  className="absolute top-0 h-full border-2 border-indigo-500 bg-indigo-500/20"
                >
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium text-indigo-700">
                    推荐区间
                  </div>
                </div>
                {/* 当前位置标记 */}
                <div
                  style={{ left: `${difficultyMatch.currentMastery * 100}%` }}
                  className="absolute top-1/2 h-16 w-0.5 -translate-y-1/2 bg-blue-600"
                >
                  <div className="absolute -top-8 left-1/2 -translate-x-1/2 flex flex-col items-center">
                    <div className="h-2 w-2 rounded-full bg-blue-600" />
                    <div className="mt-1 whitespace-nowrap text-[10px] font-semibold text-blue-700">你在这里</div>
                  </div>
                </div>
              </div>
              <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-muted-foreground">
                <span>0%</span>
                <span>50%</span>
                <span>100%</span>
              </div>
            </div>
            <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-3 text-xs leading-5 text-indigo-900">
              <strong>建议：</strong>选择难度在 {Math.round(difficultyMatch.recommendedMin * 100)}% - {Math.round(difficultyMatch.recommendedMax * 100)}% 的资源，
              既能巩固已有知识，又能适度挑战认知边界。
            </div>
          </div>
        </section>

        {/* 最近决策记录 */}
        {recentDecisions.length > 0 && (
          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-800">
              <CheckCircle2 className="h-4 w-4" />
              最近学习决策
            </div>
            <p className="mt-1 text-xs text-muted-foreground">系统根据你的学习行为做出的智能决策</p>
            <div className="mt-4 space-y-2">
              {recentDecisions.slice(0, 5).map((decision, index) => (
                <div key={index} className="rounded-lg border bg-muted/20 p-3 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        {decision.agentId === "orchestrator" ? "协调" : decision.agentId === "evidence_retrieval" ? "检索" : decision.agentId === "domain_expert" ? "分析" : "决策"}
                      </span>
                      <span className="font-medium text-slate-800">{decision.decision}</span>
                    </div>
                    <span className="shrink-0 text-[10px] text-muted-foreground">
                      {new Date(decision.timestamp).toLocaleString("zh-CN", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{decision.rationale}</p>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      <div className="border-t bg-muted/20 px-6 py-4">
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">报告基于贝叶斯知识追踪(BKT)模型生成</p>
          <button type="button" onClick={onClose} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
            关闭
          </button>
        </div>
      </div>
    </div>
  </div>;
}
