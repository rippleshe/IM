"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck,
  Download,
  FileJson,
  Link2,
  ListChecks,
  LogOut,
  RefreshCw,
  ScrollText,
  ShieldCheck,
  Table2,
} from "lucide-react";
import type { AuthenticatedUser } from "@/components/auth-entry";
import { AvatarBubble } from "@/components/profile-dialog";

type ResourceType = "lecture" | "tiered_quiz" | "practice_guide" | "concept_map" | "review_cards" | "challenge_task";

type RunSummary = {
  id: string;
  status: string;
  revisionRound: number;
  riskLevel: string;
  finalAssetId: string | null;
  task: string;
  resourceType: string;
  createdAt: number;
  finishedAt: number | null;
};

type TraceArtifact = {
  id: string;
  nodeKey: string;
  actorKey: string;
  attempt: number;
  artifactType: string;
  inputRefs: string[];
  payload: Record<string, unknown>;
  publicRationale: { observations: string[]; basisRefs: string[]; decision: string; uncertainty: string[]; nextAction: string | null };
  producer: { kind: string; model: string | null; promptHash: string | null; settingsHash: string | null };
  contentHash: string;
  createdAt: number;
};

type ClaimStage = { attempt: number; claimId: string; text: string; verdict: string; critique: string; claimType: string | null; evidence: Array<{ evidenceId: string; supportLevel: string }>; supersedesClaimId: string | null };

type TraceData = {
  run: { id: string; status: string; revisionRound: number; riskLevel: string; finalAssetId: string | null; executionManifestHash?: string | null };
  plan: { nodes: Array<{ key: string; dependsOn: string[]; mandatory: boolean }>; gates: string[] };
  verificationPolicy: { coverageStatus?: string; strength?: string; reasons?: string[] } | null;
  nodes: Array<{ nodeKey: string; role: string; attempt: number; status: string; mandatory: boolean; resultSummary: string | null }>;
  artifacts: TraceArtifact[];
  claimGraph: Array<{ id: string; attempt: number | null; text: string; verdict: string; claimType: string | null; evidence: Array<{ evidenceId: string }> }>;
  debateIssues: Array<{ id: string; issueType: string; argument: string; source: string; status: string }>;
  auditDecisions: Array<{ round: number; verdict: string; released: boolean; rationale: string }>;
  claimTrace: Array<{
    logicalKey: string | null;
    auditable: boolean;
    claimType: string | null;
    stages: ClaimStage[];
    issues: Array<{ attempt: number; issueType: string; argument: string; source: string; status: string }>;
    finalAttempt: number;
    finalVerdict: string | null;
  }>;
  snapshots: { runStart: unknown; generationEnd: unknown };
};

type VerifyResult = {
  integrity: { passed: boolean; checks: Array<{ id: string; label: string; passed: boolean; detail: string }> };
  manifestHash: string | null;
  manifestMatchesOnline: boolean | null;
  replay: { passed: boolean; attempts: Array<{ attempt: number; auditableClaims: number; unsupportedClaims: number; hallucinationRate: number | null; ruleGate: string; recordedVerdict: string | null; match: boolean }>; draftFinal: { draftRate: number | null; finalRate: number | null; gateNetGain: number | null }; differences: string[] };
};

const ACTOR_LABELS: Record<string, string> = {
  learner_modeler: "学情建模者",
  structured_retriever: "结构化检索者",
  document_retriever: "文档检索者",
  domain_analyst: "领域分析者",
  resource_author: "资源作者",
  claim_auditor: "声明审核者",
  red_team_critic: "反方质询者",
  evidence_judge: "证据裁决者",
  privacy_guard: "隐私守门人",
  publisher: "发布者",
};

const NODE_LABELS: Record<string, string> = {
  "assess.learner": "学情建模",
  "retrieve.structured": "结构化证据检索",
  "retrieve.document": "文档证据检索",
  "analyze.domain": "领域分析",
  "generate.resource": "资源生成",
  "audit.claims": "Claim 逐条审核",
  "debate.challenge": "反方质询",
  "adjudicate.verdict": "证据裁决",
  "privacy.compliance": "隐私合规",
  "finalize.publish": "发布收尾",
};

const RESOURCE_LABELS: Record<string, string> = {
  lecture: "讲义", tiered_quiz: "分层习题", practice_guide: "实操指南",
  concept_map: "知识图谱", review_cards: "复习卡片", challenge_task: "挑战任务",
};

function rateText(rate: number | null): string {
  return rate === null ? "N/A（空分母）" : `${(rate * 100).toFixed(1)}%`;
}

function timeText(value: number | null | undefined): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(value);
}

type ValidationWorkbenchProps = {
  apiBase: string;
  user: AuthenticatedUser;
  onLogout: () => void;
  onNavigate: (view: "path" | "study" | "resources" | "validation") => void;
};

export function ValidationWorkbench({ apiBase, user, onLogout, onNavigate }: ValidationWorkbenchProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [trace, setTrace] = useState<TraceData | null>(null);
  const [verify, setVerify] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  const loadRuns = useCallback(async () => {
    const response = await fetch(`${apiBase}/api/learning/runs`, { credentials: "include" });
    const data = await response.json() as { runs?: RunSummary[] };
    const list = data.runs ?? [];
    setRuns(list);
    setLoading(false);
    // 预填：学习页/资源页“查看验证记录”带入 runId
    try {
      const raw = window.localStorage.getItem("im-training-agent:validation-prefill");
      if (raw) {
        window.localStorage.removeItem("im-training-agent:validation-prefill");
        const parsed = JSON.parse(raw) as { runId?: unknown };
        if (typeof parsed.runId === "string" && list.some((run) => run.id === parsed.runId)) {
          setSelectedRunId(parsed.runId);
          return;
        }
      }
    } catch { /* 预填损坏忽略 */ }
    setSelectedRunId((current) => current ?? list[0]?.id ?? null);
  }, [apiBase]);

  const loadTrace = useCallback(async (runId: string) => {
    setTrace(null);
    setVerify(null);
    const response = await fetch(`${apiBase}/api/learning/runs/${encodeURIComponent(runId)}/trace`, { credentials: "include" });
    if (!response.ok) {
      setNotice("验证记录读取失败：该运行可能尚无产物链");
      return;
    }
    setNotice("");
    const data = await response.json() as TraceData;
    setTrace(data);
  }, [apiBase]);

  useEffect(() => { void loadRuns(); }, [loadRuns]);
  useEffect(() => {
    if (selectedRunId) void loadTrace(selectedRunId);
  }, [selectedRunId, loadTrace]);

  const runVerify = async () => {
    if (!selectedRunId) return;
    setVerifying(true);
    try {
      const response = await fetch(`${apiBase}/api/learning/runs/${encodeURIComponent(selectedRunId)}/verify`, { method: "POST", credentials: "include" });
      const data = await response.json() as VerifyResult & { success?: boolean };
      if (!response.ok || !data.integrity) throw new Error("离线校验失败");
      setVerify(data);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "离线校验失败");
    } finally {
      setVerifying(false);
    }
  };

  const logout = async () => { await fetch(`${apiBase}/api/auth/logout`, { method: "POST", credentials: "include" }).catch(() => undefined); onLogout(); };

  const auditableClaims = trace?.claimTrace.filter((entry) => entry.auditable) ?? [];
  const unsupportedFinal = auditableClaims.filter((entry) => entry.finalVerdict === "unsupported").length;
  const evidenceCount = new Set(trace?.claimGraph.flatMap((claim) => claim.evidence.map((edge) => edge.evidenceId)) ?? []).size;
  const conflictClaims = trace?.claimGraph.filter((claim) => claim.verdict === "review").length ?? 0;
  const revisionCount = trace?.auditDecisions.length ?? 0;
  const released = trace?.auditDecisions.at(-1)?.released === true;
  const attempts = [...new Set(trace?.claimGraph.map((claim) => claim.attempt ?? 1))].sort((a, b) => a - b);
  const published = Boolean(trace?.run.finalAssetId);

  return <main className="flex h-screen min-h-0 flex-col overflow-hidden bg-background">
    <header className="flex h-16 shrink-0 items-center justify-between border-b px-5 sm:px-7">
      <div className="flex items-center gap-2.5"><AvatarBubble user={user} size="h-9 w-9 text-xs" /><span className="min-w-0"><span className="block text-sm font-semibold tracking-tight">IM-Training-Agent</span><span className="block text-[11px] text-muted-foreground">{user.displayName}</span></span></div>
      <nav aria-label="学习空间" className="flex items-center rounded-lg border bg-muted/40 p-1 text-sm"><button type="button" onClick={logout} className="rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground">退出</button><button type="button" onClick={() => onNavigate("path")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">路径</button><button type="button" onClick={() => onNavigate("study")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">学习</button><button type="button" onClick={() => onNavigate("resources")} className="px-4 py-1.5 text-muted-foreground hover:text-foreground">资源</button><button type="button" className="rounded-md bg-background px-4 py-1.5 font-medium shadow-sm">验证</button></nav>
      <span className="text-xs text-muted-foreground">可信协同验证台</span>
    </header>

    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl space-y-6 px-5 py-6 sm:px-7">

        {/* 1. 运行选择区 */}
        <section aria-label="运行选择" className="rounded-2xl border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2"><ListChecks className="h-4 w-4" /><h2 className="text-sm font-semibold">最近运行</h2></div>
            <button type="button" onClick={() => void loadRuns()} className="inline-flex items-center gap-1 rounded-lg border px-2.5 py-1.5 text-[11px] hover:bg-muted"><RefreshCw className="h-3 w-3" />刷新</button>
          </div>
          {loading ? <p className="mt-3 text-xs text-muted-foreground">正在读取运行历史…</p> : runs.length === 0
            ? <p className="mt-3 text-xs leading-5 text-muted-foreground">还没有协同运行记录。到「学习」页发起一次协同生成，这里会展示完整的验证链。</p>
            : <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {runs.map((run) => (
                  <button key={run.id} type="button" onClick={() => setSelectedRunId(run.id)}
                    className={`rounded-xl border p-3 text-left transition-colors ${selectedRunId === run.id ? "border-foreground bg-muted/40" : "hover:bg-muted/20"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-medium">{RESOURCE_LABELS[run.resourceType] ?? run.resourceType}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] ${run.status === "succeeded" ? "bg-emerald-100 text-emerald-700" : run.status === "failed" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700"}`}>{run.status === "succeeded" ? "已完成" : run.status === "failed" ? "失败" : run.status === "cancelled" ? "已取消" : "进行中"}</span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs leading-4">{run.task || "（无任务描述）"}</p>
                    <p className="mt-1.5 text-[10px] text-muted-foreground">{timeText(run.createdAt)}{run.finalAssetId ? " · 资源已入库" : " · 未入库"}</p>
                  </button>
                ))}
              </div>}
        </section>

        {notice && <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">{notice}</div>}

        {trace && <>
          {/* 2. 可信摘要 */}
          <section aria-label="可信摘要" className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2"><ShieldCheck className="h-4 w-4" /><h2 className="text-sm font-semibold">可信摘要</h2><span className="text-[11px] text-muted-foreground">{trace.run.id}</span></div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center sm:grid-cols-6">
              <Metric label="证据条数" value={evidenceCount} />
              <Metric label="事实声明" value={auditableClaims.length} />
              <Metric label="终稿无证据" value={unsupportedFinal} tone={unsupportedFinal > 0 ? "warn" : "ok"} />
              <Metric label="待复核" value={conflictClaims} />
              <Metric label="修订轮数" value={revisionCount} />
              <Metric label="发布结论" value={released ? "已放行" : published ? "异常" : "未放行"} tone={released ? "ok" : "warn"} />
            </div>
            {trace.verificationPolicy?.reasons?.length ? <p className="mt-3 text-[11px] leading-4 text-muted-foreground">检索后策略修正：{trace.verificationPolicy.reasons.join("；")}</p> : null}
          </section>

          {/* 3. 协同链 */}
          <section aria-label="协同链" className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2"><Link2 className="h-4 w-4" /><h2 className="text-sm font-semibold">协同运行链</h2><span className="text-[11px] text-muted-foreground">每个执行者的输入引用、公开结论与产物散列（默认折叠）</span></div>
            <div className="mt-3 space-y-2">
              {trace.nodes.map((node) => {
                const artifact = trace.artifacts.find((item) => item.nodeKey === node.nodeKey && item.attempt === node.attempt && ["learner_snapshot", "evidence_set", "domain_brief", "resource_draft", "claim_audit", "challenge_set", "adjudication", "privacy_decision", "publication_decision"].includes(item.artifactType));
                return <details key={`${node.nodeKey}-${node.attempt}`} className="rounded-xl border bg-background px-3.5 py-3">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-xs">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${node.status === "succeeded" ? "bg-emerald-600" : node.status === "failed" ? "bg-destructive" : "bg-zinc-300"}`} />
                      <span className="font-medium">{NODE_LABELS[node.nodeKey] ?? node.nodeKey}</span>
                      {node.attempt > 1 ? <span className="rounded-full bg-amber-100 px-1.5 text-[10px] text-amber-700">第 {node.attempt} 轮</span> : null}
                      {node.mandatory ? <span className="rounded-full border px-1.5 text-[10px] text-muted-foreground">门禁</span> : null}
                    </span>
                    <span className="text-[10px] text-muted-foreground">{ACTOR_LABELS[artifact?.actorKey ?? ""] ?? "—"}{artifact ? ` · ${artifact.artifactType}` : ""}</span>
                  </summary>
                  <div className="mt-2.5 space-y-2 border-t pt-2.5 text-[11px] leading-4">
                    {artifact ? <>
                      <p><span className="text-muted-foreground">公开结论：</span>{artifact.publicRationale.decision}</p>
                      {artifact.publicRationale.observations.length > 0 ? <p><span className="text-muted-foreground">观察到：</span>{artifact.publicRationale.observations.join("；")}</p> : null}
                      <p><span className="text-muted-foreground">输入引用：</span>{artifact.inputRefs.length > 0 ? artifact.inputRefs.length + " 个上游产物" : "学习者状态 / 检索层"}</p>
                      <p className="break-all"><span className="text-muted-foreground">产物散列：</span><code className="text-[10px]">{artifact.contentHash.slice(0, 32)}…</code></p>
                      <p><span className="text-muted-foreground">生产者：</span>{artifact.producer.kind === "agent" ? `模型 ${artifact.producer.model ?? "—"}` : artifact.producer.kind === "rule" ? "确定性规则" : artifact.producer.kind}</p>
                      {artifact.publicRationale.uncertainty.length > 0 ? <p className="text-amber-700"><span className="text-muted-foreground">不确定：</span>{artifact.publicRationale.uncertainty.join("；")}</p> : null}
                    </> : <p className="text-muted-foreground">{node.resultSummary ?? "该节点暂无主产物（可能未执行或历史运行）"}</p>}
                  </div>
                </details>;
              })}
            </div>
          </section>

          {/* 4. 声明证据表 */}
          <section aria-label="声明证据表" className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2"><Table2 className="h-4 w-4" /><h2 className="text-sm font-semibold">声明证据表</h2><span className="text-[11px] text-muted-foreground">按逻辑声明聚组：终稿 verdict 与证据定位</span></div>
            {trace.claimTrace.length === 0 ? <p className="mt-3 text-xs text-muted-foreground">该运行没有可核对的声明（历史运行或尚未生成）。</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-[11px]">
                  <thead><tr className="border-b text-muted-foreground"><th className="py-2 pr-3 font-medium">声明内容</th><th className="py-2 pr-3 font-medium">类型</th><th className="py-2 pr-3 font-medium">轮次</th><th className="py-2 pr-3 font-medium">终稿结论</th><th className="py-2 pr-3 font-medium">证据定位</th><th className="py-2 font-medium">质询议题</th></tr></thead>
                  <tbody>
                    {trace.claimTrace.map((entry) => {
                      const finalStage = entry.stages.at(-1);
                      return <tr key={entry.logicalKey ?? entry.stages[0]?.claimId} className="border-b last:border-0 align-top">
                        <td className="max-w-[240px] py-2 pr-3 leading-4">{entry.stages[0]?.text.slice(0, 80)}{entry.stages.length > 1 ? <span className="ml-1 text-[10px] text-muted-foreground">（修订 {entry.stages.length - 1} 次）</span> : null}</td>
                        <td className="py-2 pr-3">{claimTypeLabel(entry.claimType)}</td>
                        <td className="py-2 pr-3">{entry.stages.map((stage) => stage.attempt).join("→")}</td>
                        <td className="py-2 pr-3"><span className={`rounded-full px-2 py-0.5 text-[10px] ${finalStage?.verdict === "supported" ? "bg-emerald-100 text-emerald-700" : finalStage?.verdict === "unsupported" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-700"}`}>{verdictLabel(finalStage?.verdict)}</span></td>
                        <td className="py-2 pr-3">{finalStage?.evidence.length ? `${finalStage.evidence.length} 条` : entry.auditable ? "无" : "不适用"}</td>
                        <td className="py-2">{entry.issues.length ? `${entry.issues.length} 条（${entry.issues.map((issue) => issue.issueType).join("、")}）` : "—"}</td>
                      </tr>;
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* 5. 前后对照 */}
          <section aria-label="前后对照" className="rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2"><BadgeCheck className="h-4 w-4" /><h2 className="text-sm font-semibold">前后对照</h2><span className="text-[11px] text-muted-foreground">同一运行各修订轮的声明与结论变化</span></div>
            {attempts.length <= 1
              ? <p className="mt-3 text-xs leading-5 text-muted-foreground">本次运行 {attempts.length === 1 ? `只有第 ${attempts[0]} 轮（一轮通过门禁，无修订）` : "没有声明数据"}。运行起点与生成结束的学情快照{trace.snapshots.runStart && trace.snapshots.generationEnd ? "均已固化，可在导出包中对照" : "仅部分固化（历史运行）"}。</p>
              : <div className="mt-3 space-y-2">
                  {attempts.map((attempt) => {
                    const stageClaims = trace.claimGraph.filter((claim) => (claim.attempt ?? 1) === attempt);
                    const unsupported = stageClaims.filter((claim) => claim.verdict === "unsupported").length;
                    const decision = trace.auditDecisions.find((item) => item.round === attempt);
                    return <div key={attempt} className="rounded-xl border bg-background px-3.5 py-3 text-[11px]">
                      <div className="flex items-center justify-between"><span className="font-medium">第 {attempt} 轮</span><span>{decision ? `裁决 ${decision.verdict}${decision.released ? "（放行）" : ""}` : "无裁决记录"}</span></div>
                      <p className="mt-1 text-muted-foreground">事实声明 {stageClaims.filter((claim) => claim.claimType !== "non_factual").length} 条、无证据支持 {unsupported} 条</p>
                    </div>;
                  })}
                </div>}
          </section>

          {/* 6. 离线校验结果 */}
          <section aria-label="离线校验" className="rounded-2xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2"><ScrollText className="h-4 w-4" /><h2 className="text-sm font-semibold">离线校验</h2></div>
              <button type="button" onClick={() => void runVerify()} disabled={verifying} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50">{verifying ? "校验中…" : "运行离线复算"}</button>
            </div>
            {verify ? <div className="mt-3 space-y-1.5 text-[11px]">
              {verify.integrity.checks.map((check) => <div key={check.id} className="flex items-start gap-2"><span className={check.passed ? "text-emerald-600" : "text-destructive"}>{check.passed ? "✔" : "✘"}</span><span><span className="font-medium">{check.label}</span><span className="text-muted-foreground">：{check.detail}</span></span></div>)}
              {verify.replay.attempts.map((attempt) => <div key={attempt.attempt} className="text-muted-foreground">第 {attempt.attempt} 轮回放门禁 {attempt.ruleGate}，在线裁决 {attempt.recordedVerdict ?? "缺记录"} → {attempt.match ? "一致（不更松）" : "✘ 不一致"}</div>)}
              {verify.replay.differences.length > 0 ? <p className="text-destructive">{verify.replay.differences.join("；")}</p> : null}
            </div> : <p className="mt-3 text-xs leading-5 text-muted-foreground">离线复算不调用模型：核对产物散列、引用完整、门禁一致与发布依据，可在不依赖模型的情况下复核本次运行。</p>}
          </section>

          {/* 7. 导出入口 */}
          <section aria-label="导出" className="flex flex-wrap items-center justify-between rounded-2xl border bg-card p-5">
            <div className="flex items-center gap-2"><FileJson className="h-4 w-4" /><div><h2 className="text-sm font-semibold">比赛证据包</h2><p className="mt-0.5 text-[11px] text-muted-foreground">画像快照 + 协同链产物 + 声明图 + 裁决 + 资源，可用于离线回放复核</p></div></div>
            <div className="flex gap-2">
              <button type="button" onClick={() => window.open(`${apiBase}/api/learning/runs/${encodeURIComponent(trace.run.id)}/export`, "_blank", "noopener,noreferrer")} className="inline-flex h-8 items-center gap-1 rounded-lg border px-3 text-xs font-medium hover:bg-muted"><Download className="h-3.5 w-3.5" />下载 JSON</button>
              <button type="button" onClick={() => onNavigate("resources")} className="inline-flex h-8 items-center rounded-lg border px-3 text-xs hover:bg-muted">前往资源页</button>
            </div>
          </section>
        </>}
      </div>
    </div>
  </main>;
}

function Metric({ label, value, tone }: { label: string; value: string | number; tone?: "ok" | "warn" }) {
  return <div className={`rounded-lg p-2.5 ${tone === "warn" ? "bg-amber-50" : tone === "ok" ? "bg-emerald-50" : "bg-muted/60"}`}>
    <div className="text-[10px] text-muted-foreground">{label}</div>
    <div className={`mt-1 text-sm font-semibold ${tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : ""}`}>{value}</div>
  </div>;
}

function claimTypeLabel(claimType: string | null): string {
  switch (claimType) {
    case "numeric": return "数值";
    case "field_meaning": return "字段含义";
    case "method_step": return "方法步骤";
    case "causal": return "因果判断";
    case "risk_advice": return "风险建议";
    case "non_factual": return "非事实表达";
    default: return "事实声明";
  }
}

function verdictLabel(verdict: string | undefined): string {
  switch (verdict) {
    case "supported": return "支持";
    case "review": return "待复核";
    case "partial": return "部分支持";
    case "conflict": return "冲突";
    case "unsupported": return "无证据";
    default: return "—";
  }
}
