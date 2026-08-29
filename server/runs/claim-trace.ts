/**
 * Claim 追溯链（docs/挑战杯多智能体可信协同升级计划.md 里程碑 D）
 *
 * 通过 logicalKey / supersedes_claim_id 把同一逻辑声明的初稿 → 质询 → 裁决 →
 * 修订 → 终稿串成一条可回溯链，支撑：
 * - 前端验证页的声明证据表；
 * - 离线回放按轮次重算幻觉率（初稿 vs 终稿，non_factual 不入分母）。
 */
import { and, asc, eq, inArray } from 'drizzle-orm';
import { getLearningDatabase } from '../db/client.js';
import { auditDecisions, claimEvidence, claims, debateIssues } from '../db/schema.js';

export interface ClaimTraceStage {
  attempt: number;
  claimId: string;
  draftArtifactId: string | null;
  claimType: string | null;
  text: string;
  verdict: string;
  critique: string;
  evidence: Array<{ evidenceId: string; supportLevel: string }>;
  supersedesClaimId: string | null;
}

export interface ClaimTraceEntry {
  logicalKey: string | null;
  /** 是否进入幻觉率分母（non_factual 与历史空类型除外） */
  auditable: boolean;
  claimType: string | null;
  /** 按 attempt 升序的声明轮次 */
  stages: ClaimTraceStage[];
  /** 指向该逻辑声明的质询议题（按轮次） */
  issues: Array<{ attempt: number; issueType: string; argument: string; source: string; status: string }>;
  /** 涉及该声明的裁决结论 */
  adjudications: Array<{ round: number; verdict: string; released: boolean }>;
  /** 终稿轮次与终稿 verdict */
  finalAttempt: number;
  finalVerdict: string | null;
}

/** 幻觉率分母口径（升级计划 §F 官方口径）：仅可审计事实声明 */
export function isAuditableClaim(claimType: string | null): boolean {
  return claimType !== 'non_factual';
}

/** 构建一次运行的全量声明追溯链 */
export async function buildClaimTrace(runId: string): Promise<ClaimTraceEntry[]> {
  const database = getLearningDatabase().db;
  const claimRows = await database
    .select().from(claims)
    .where(eq(claims.resourceId, runId))
    .orderBy(asc(claims.attempt), asc(claims.id));
  if (claimRows.length === 0) return [];
  const claimIds = claimRows.map((row) => row.id);
  const [edges, issueRows, decisionRows] = await Promise.all([
    database.select().from(claimEvidence).where(inArray(claimEvidence.claimId, claimIds)),
    database.select().from(debateIssues).where(eq(debateIssues.runId, runId)),
    database.select().from(auditDecisions)
      .where(and(eq(auditDecisions.runId, runId)))
      .orderBy(asc(auditDecisions.round)),
  ]);
  const edgesByClaim = new Map<string, Array<{ evidenceId: string; supportLevel: string }>>();
  for (const edge of edges) {
    edgesByClaim.set(edge.claimId, [
      ...(edgesByClaim.get(edge.claimId) ?? []),
      { evidenceId: edge.evidenceId, supportLevel: edge.supportLevel },
    ]);
  }
  // 同一逻辑声明聚组：audit 阶段为每条 Claim 计算稳定 logicalKey；历史行回退自身 id
  const groups = new Map<string, typeof claimRows>();
  for (const row of claimRows) {
    const key = row.logicalKey || row.id;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const targetByClaim = new Map<string, string>(); // claim id (run-scoped raw id) → debate issue row ids
  for (const issue of issueRows) {
    if (issue.targetClaimId) targetByClaim.set(issue.targetClaimId, issue.id);
  }

  const entries: ClaimTraceEntry[] = [];
  for (const [, groupRows] of groups) {
    const sorted = [...groupRows].sort((a, b) => (a.attempt ?? 1) - (b.attempt ?? 1));
    const finalRow = sorted[sorted.length - 1]!;
    const stages: ClaimTraceStage[] = sorted.map((row) => ({
      attempt: row.attempt ?? 1,
      claimId: row.id,
      draftArtifactId: row.draftArtifactId,
      claimType: row.claimType,
      text: row.text,
      verdict: row.verdict,
      critique: row.critique,
      evidence: edgesByClaim.get(row.id) ?? [],
      supersedesClaimId: row.supersedesClaimId,
    }));
    // 质询议题按 raw claim id（claims 表主键 `${runId}:${claimId}`）匹配
    const rawIds = new Set(sorted.map((row) => row.id));
    const relatedIssues = issueRows
      .filter((issue) => issue.targetClaimId && rawIds.has(issue.targetClaimId))
      .map((issue) => ({
        attempt: sorted.find((row) => row.id === issue.targetClaimId)?.attempt ?? 1,
        issueType: issue.issueType,
        argument: issue.argument,
        source: issue.source,
        status: issue.status,
      }));
    entries.push({
      logicalKey: finalRow.logicalKey,
      auditable: isAuditableClaim(finalRow.claimType),
      claimType: finalRow.claimType,
      stages,
      issues: relatedIssues,
      adjudications: decisionRows.map((row) => ({ round: row.round, verdict: row.verdict, released: row.released })),
      finalAttempt: finalRow.attempt ?? 1,
      finalVerdict: finalRow.verdict,
    });
  }
  return entries;
}

/** 按官方口径计算幻觉率：unsupported 可审计事实声明 / 全部可审计事实声明；空分母返回 null（N/A 语义） */
export function hallucinationRateFromTrace(entries: ClaimTraceEntry[], attempt?: number): number | null {
  const inScope = entries.filter((entry) => entry.auditable && (attempt === undefined || entry.stages.some((stage) => stage.attempt === attempt)));
  const relevant = attempt === undefined
    ? inScope.map((entry) => entry.stages[entry.stages.length - 1]!)
    : inScope
      .map((entry) => entry.stages.filter((stage) => stage.attempt === attempt).at(-1))
      .filter((stage): stage is ClaimTraceStage => Boolean(stage));
  if (relevant.length === 0) return null;
  const unsupported = relevant.filter((stage) => stage.verdict === 'unsupported').length;
  return Math.round((unsupported / relevant.length) * 1000) / 1000;
}
