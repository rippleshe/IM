/**
 * 指标口径与离线校验（docs/挑战杯技术开发总规.md §8.2）
 *
 * 官方三项指标口径（升级计划 §F）：
 * 1. 幻觉率 = unsupported 事实 Claim / 全部可审计事实 Claim；non_factual 不入分母；
 *    空分母必须报告 N/A（null），不能当作 0。
 * 2. 难度适配准确率 = 目标区间∩脚手架∩画像全匹配案例 / 全部案例（evaluate 脚本按案例判定）。
 * 3. 核心知识覆盖率 = 有有效 evidence edge 支持的必备知识点 / 黄金必备知识点。
 *
 * 本模块同时提供：导出包完整性校验（verifyExportIntegrity）与离线回放重算
 * （replayExport），供 verify-run-export / replay-run 脚本与 /verify 端点复用。
 * 全部为纯函数：不连接数据库、不调用模型。
 */
import { hashArtifactContent, sha256, stableStringify, type ArtifactProducer, type ArtifactType, type PublicRationale, type ActorKey } from './artifacts.js';
import type { RunNodeKey } from './protocol.js';

/* ----------------------------- 口径与指标 ----------------------------- */

const VERDICT_SEVERITY: Record<string, number> = { supported: 0, review: 1, partial: 1, conflict: 2, unsupported: 3 };

/** 幻觉率官方口径：non_factual 不入分母；空分母返回 null（N/A 语义，不得当 0） */
export function officialHallucinationRate(claims: Array<{ verdict: string; claimType?: string | null }>): number | null {
  const auditable = claims.filter((claim) => (claim.claimType ?? 'risk_advice') !== 'non_factual');
  if (auditable.length === 0) return null;
  const unsupported = auditable.filter((claim) => claim.verdict === 'unsupported').length;
  return Math.round((unsupported / auditable.length) * 1000) / 1000;
}

export interface TraceLike {
  logicalKey: string | null;
  auditable: boolean;
  stages: Array<{ attempt: number; verdict: string; claimType?: string | null; evidence: Array<{ evidenceId: string }> }>;
  issues: Array<{ issueType: string; status: string }>;
}

/** 初稿/终稿幻觉率与门禁净增益（修 G10：按轮次口径，N/A 显式保留） */
export function draftFinalRates(trace: TraceLike[]): {
  draftRate: number | null;
  finalRate: number | null;
  gateNetGain: number | null;
  draftAuditableCount: number;
  finalAuditableCount: number;
} {
  const firstAttempt = Math.min(...trace.map((entry) => entry.stages[0]?.attempt ?? 1));
  const lastAttempt = Math.max(...trace.map((entry) => entry.stages.at(-1)?.attempt ?? 1));
  const stagesAt = (attempt: number) => trace
    .map((entry) => entry.stages.filter((stage) => stage.attempt === attempt).at(-1))
    .filter((stage): stage is TraceLike['stages'][number] => Boolean(stage));
  const draftStages = stagesAt(firstAttempt);
  const finalStages = stagesAt(lastAttempt);
  const auditable = (stages: TraceLike['stages']) => stages.filter((stage) => (stage.claimType ?? 'risk_advice') !== 'non_factual');
  const rateOf = (stages: TraceLike['stages']): number | null => {
    const pool = auditable(stages);
    if (pool.length === 0) return null;
    return Math.round((pool.filter((stage) => stage.verdict === 'unsupported').length / pool.length) * 1000) / 1000;
  };
  const draftRate = rateOf(draftStages);
  const finalRate = rateOf(finalStages);
  return {
    draftRate,
    finalRate,
    gateNetGain: draftRate !== null && finalRate !== null ? Math.round((draftRate - finalRate) * 1000) / 1000 : null,
    draftAuditableCount: auditable(draftStages).length,
    finalAuditableCount: auditable(finalStages).length,
  };
}

/** 补充指标：有效质询率（被接受/已解决的议题占比） */
export function validChallengeRate(issues: Array<{ status: string }>): number | null {
  if (issues.length === 0) return null;
  const valid = issues.filter((issue) => issue.status === 'accepted' || issue.status === 'resolved').length;
  return Math.round((valid / issues.length) * 1000) / 1000;
}

/** 确定性规则门禁重算（回放用）：与 executor 规则口径一致（不含 Agent 判决） */
export function recomputeRuleGate(claims: Array<{ verdict: string; claimType?: string | null }>, options: { strict: boolean; crossValidationStatus?: string }): 'supported' | 'partial' | 'conflict' | 'unsupported' {
  const auditable = claims.filter((claim) => (claim.claimType ?? 'risk_advice') !== 'non_factual');
  const unsupported = auditable.filter((claim) => claim.verdict === 'unsupported').length;
  const review = auditable.filter((claim) => claim.verdict === 'review').length;
  const summaryStatus = options.crossValidationStatus ?? 'corroborated';
  if (unsupported > 0) return 'unsupported';
  if (summaryStatus === 'conflict') return 'conflict';
  return review > 0 || summaryStatus !== 'corroborated' ? 'partial' : 'supported';
}

/** 合并判定：规则结论与 Agent 结论取更严格者（门禁只能收紧不能放松） */
export function mergeGateVerdicts(ruleVerdict: string, agentVerdict: string | null): string {
  if (!agentVerdict || !(agentVerdict in VERDICT_SEVERITY)) return ruleVerdict;
  return (VERDICT_SEVERITY[agentVerdict] ?? 0) > (VERDICT_SEVERITY[ruleVerdict] ?? 0) ? agentVerdict : ruleVerdict;
}

/* ----------------------------- 导出包校验与回放 ----------------------------- */

export interface ExportArtifactLike {
  id: string;
  nodeKey: RunNodeKey | string;
  actorKey: ActorKey | string;
  attempt: number;
  artifactType: ArtifactType | string;
  inputRefs: string[];
  payload: Record<string, unknown>;
  publicRationale: PublicRationale;
  producer: ArtifactProducer;
  contentHash: string;
}

export interface ExportPayloadLike {
  plan: { nodes: Array<{ key: string; dependsOn: string[]; mandatory: boolean }>; gates: string[]; strictAdjudication?: boolean };
  run: { id: string; finalAssetId: string | null; executionManifestHash?: string | null };
  events: Array<{ seq: number }>;
  dagNodes?: Array<{ nodeKey: string; primaryArtifactId?: string | null }>;
  artifacts: ExportArtifactLike[];
  evidenceChain: {
    claims: Array<{ id: string; attempt?: number | null; verdict: string; claimType?: string | null; evidence: Array<{ evidenceId: string }> }>;
    auditDecisions: Array<{ round: number; verdict: string; released: boolean }>;
    evidencePacks?: Array<{ id: string; items?: Array<{ id: string }> }>;
  };
  request?: { temporaryReference?: { name?: string; bodyIncluded?: boolean; content?: unknown } | null };
}

const SENSITIVE_KEY_PATTERN = /password|apikey|api_key|secret|cookie|token/i;

function walkSensitive(value: unknown, path: string, hits: string[], depth = 0): void {
  if (depth > 8 || hits.length >= 20) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkSensitive(item, `${path}[${index}]`, hits, depth + 1));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key) && item !== null && item !== undefined && item !== '') {
        hits.push(`${path}.${key}`);
      }
      walkSensitive(item, `${path}.${key}`, hits, depth + 1);
    }
  }
}

/** 重算单条 artifact 内容散列（与 persistArtifact 完全同口径；runId 取自导出包 run.id） */
export function recomputeArtifactHash(artifact: ExportArtifactLike, runId: string): string {
  return hashArtifactContent({
    runId,
    nodeKey: artifact.nodeKey as RunNodeKey,
    actorKey: artifact.actorKey as ActorKey,
    attempt: artifact.attempt,
    artifactType: artifact.artifactType as ArtifactType,
    inputRefs: artifact.inputRefs,
    payload: artifact.payload,
    publicRationale: artifact.publicRationale,
    producer: artifact.producer,
  });
}

export interface IntegrityCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

/** 导出包完整性校验（升级计划 §F verify-run-export 必查清单） */
export function verifyExportIntegrity(payload: ExportPayloadLike): { passed: boolean; checks: IntegrityCheck[]; manifestHash: string | null } {
  const checks: IntegrityCheck[] = [];
  const artifacts = payload.artifacts ?? [];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));

  // 1. manifest 与 artifact hash 一致（篡改检测）
  const hashMismatches = artifacts
    .filter((artifact) => artifact.contentHash !== recomputeArtifactHash(artifact, payload.run.id))
    .map((artifact) => artifact.id);
  checks.push({
    id: 'artifact-hash',
    label: 'artifact 内容散列与 manifest 一致',
    passed: hashMismatches.length === 0,
    detail: hashMismatches.length === 0
      ? `${artifacts.length} 个产物散列全部可重算复现`
      : `散列不匹配：${hashMismatches.join('、')}`,
  });

  // 2. DAG 依赖闭合 + 事件 seq 连续
  const nodeKeys = new Set(payload.plan.nodes.map((node) => node.key));
  const danglingDeps = payload.plan.nodes
    .flatMap((node) => node.dependsOn.filter((dep) => !nodeKeys.has(dep)))
    .filter((dep, index, all) => all.indexOf(dep) === index);
  checks.push({
    id: 'dag-closure',
    label: 'DAG 依赖闭合',
    passed: danglingDeps.length === 0 && nodeKeys.size === payload.plan.nodes.length,
    detail: danglingDeps.length === 0
      ? `${payload.plan.nodes.length} 个节点依赖闭合`
      : `依赖不存在的节点：${danglingDeps.join('、')}`,
  });
  const seqs = (payload.events ?? []).map((event) => event.seq);
  const seqContinuous = seqs.every((seq, index) => index === 0 || seq === seqs[index - 1]! + 1) && (seqs.length === 0 || seqs[0] === 1);
  checks.push({
    id: 'event-seq',
    label: '事件 seq 连续无缺口',
    passed: seqContinuous,
    detail: seqContinuous ? `${seqs.length} 个事件序号连续` : `事件序号存在缺口（首个 ${seqs[0]}，末个 ${seqs.at(-1)}）`,
  });

  // 3. inputRefs 全部存在
  const danglingRefs = artifacts
    .flatMap((artifact) => artifact.inputRefs.filter((ref) => !artifactIds.has(ref)));
  checks.push({
    id: 'input-refs',
    label: '产物 inputRefs 引用完整',
    passed: danglingRefs.length === 0,
    detail: danglingRefs.length === 0
      ? `${artifacts.length} 个产物的输入引用全部可解析`
      : `悬空引用：${[...new Set(danglingRefs)].join('、')}`,
  });

  // 4. Claim—Evidence 无悬空引用
  const evidenceIds = new Set((payload.evidenceChain.evidencePacks ?? []).flatMap((pack) => (pack.items ?? []).map((item) => item.id)));
  const knownEvidence = evidenceIds.size > 0;
  const danglingEvidence = payload.evidenceChain.claims
    .flatMap((claim) => claim.evidence.map((edge) => edge.evidenceId))
    .filter((id, index, all) => all.indexOf(id) === index && knownEvidence && !evidenceIds.has(id));
  checks.push({
    id: 'claim-evidence',
    label: 'Claim—Evidence 无悬空引用',
    passed: !knownEvidence || danglingEvidence.length === 0,
    detail: !knownEvidence
      ? '导出未携带证据包快照，无法核对（旧版导出）'
      : danglingEvidence.length === 0
        ? `${evidenceIds.size} 条证据引用全部可定位`
        : `悬空证据引用：${danglingEvidence.join('、')}`,
  });

  // 5. 每轮 adjudication 与规则结果一致或更严格（门禁只紧不松）
  const adjudicationArtifacts = artifacts.filter((artifact) => artifact.artifactType === 'adjudication');
  const lenientRounds = adjudicationArtifacts
    .filter((artifact) => {
      const payloadData = artifact.payload as { ruleVerdict?: string; verdict?: string };
      const rule = payloadData.ruleVerdict;
      const final = payloadData.verdict;
      return rule && final && (VERDICT_SEVERITY[final] ?? 0) < (VERDICT_SEVERITY[rule] ?? 0);
    })
    .map((artifact) => artifact.id);
  checks.push({
    id: 'adjudication-strictness',
    label: '裁决结论与规则一致或更严格',
    passed: lenientRounds.length === 0 && adjudicationArtifacts.length > 0,
    detail: adjudicationArtifacts.length === 0
      ? '缺少 adjudication 产物'
      : lenientRounds.length === 0
        ? `${adjudicationArtifacts.length} 轮裁决均未放松规则结论`
        : `裁决放松了规则结论：${lenientRounds.join('、')}`,
  });

  // 6. final asset 来自已 released 的 publication decision（fail closed）
  const publication = artifacts.filter((artifact) => artifact.artifactType === 'publication_decision').at(-1);
  const published = Boolean(payload.run.finalAssetId);
  const publicationOk = publication
    ? (publication.payload as { released?: boolean }).released === published
    : !published;
  const claimAuditExists = artifacts.some((artifact) => artifact.artifactType === 'claim_audit');
  checks.push({
    id: 'publication-gate',
    label: '发布结论与门禁产物一致（fail closed）',
    passed: publicationOk && claimAuditExists,
    detail: publicationOk && claimAuditExists
      ? published ? '已发布资源具有 released 的发布决定与 Claim 审核产物' : '未发布：与门禁结论一致'
      : publication
        ? `发布结论与门禁不一致（finalAssetId=${payload.run.finalAssetId ?? '无'}）`
        : '缺少 publication_decision 产物',
  });

  // 7. 敏感字段与上传正文
  const sensitiveHits: string[] = [];
  walkSensitive(payload.request ?? {}, 'request', sensitiveHits);
  walkSensitive(payload.evidenceChain ?? {}, 'evidenceChain', sensitiveHits);
  const tempRef = payload.request?.temporaryReference;
  if (tempRef && typeof tempRef === 'object' && 'content' in tempRef && tempRef.content) {
    sensitiveHits.push('request.temporaryReference.content（上传正文泄漏）');
  }
  checks.push({
    id: 'sensitive-fields',
    label: '无密钥/Cookie/上传正文泄漏',
    passed: sensitiveHits.length === 0,
    detail: sensitiveHits.length === 0 ? '未发现敏感字段' : `可疑字段：${sensitiveHits.join('；')}`,
  });

  const manifestHash = sha256(stableStringify(artifacts.map((artifact) => ({ id: artifact.id, contentHash: artifact.contentHash }))));
  return { passed: checks.every((check) => check.passed), checks, manifestHash };
}

export interface ReplayOutcome {
  passed: boolean;
  attempts: Array<{
    attempt: number;
    auditableClaims: number;
    unsupportedClaims: number;
    hallucinationRate: number | null;
    ruleGate: string;
    recordedVerdict: string | null;
    recordedReleased: boolean | null;
    match: boolean;
  }>;
  draftFinal: ReturnType<typeof draftFinalRates>;
  integrity: { passed: boolean; checks: IntegrityCheck[]; manifestHash: string | null };
  differences: string[];
}

/** 离线回放：根据导出包重算每轮 Claim 汇总与门禁结果，与在线记录对照（不调用模型） */
export function replayExport(payload: ExportPayloadLike): ReplayOutcome {
  const integrity = verifyExportIntegrity(payload);
  const claimsByAttempt = new Map<number, ExportPayloadLike['evidenceChain']['claims']>();
  for (const claim of payload.evidenceChain.claims) {
    const attempt = claim.attempt ?? 1;
    claimsByAttempt.set(attempt, [...(claimsByAttempt.get(attempt) ?? []), claim]);
  }
  const attempts = [...claimsByAttempt.keys()].sort((a, b) => a - b).map((attempt) => {
    const claims = claimsByAttempt.get(attempt)!;
    const auditable = claims.filter((claim) => (claim.claimType ?? 'risk_advice') !== 'non_factual');
    const ruleGate = recomputeRuleGate(claims, {
      strict: Boolean(payload.plan.strictAdjudication),
      crossValidationStatus: integrity.passed ? 'corroborated' : undefined,
    });
    const recorded = payload.evidenceChain.auditDecisions.find((decision) => decision.round === attempt) ?? null;
    // 回放一致性：重算规则门禁不得比在线记录更严（在线可能叠加 Agent 更严结论）
    const match = !recorded
      ? false
      : (VERDICT_SEVERITY[ruleGate] ?? 0) <= (VERDICT_SEVERITY[recorded.verdict] ?? 0);
    return {
      attempt,
      auditableClaims: auditable.length,
      unsupportedClaims: auditable.filter((claim) => claim.verdict === 'unsupported').length,
      hallucinationRate: officialHallucinationRate(claims),
      ruleGate,
      recordedVerdict: recorded?.verdict ?? null,
      recordedReleased: recorded?.released ?? null,
      match,
    };
  });
  const trace: TraceLike[] = payload.evidenceChain.claims.map((claim) => ({
    logicalKey: claim.id,
    auditable: (claim.claimType ?? 'risk_advice') !== 'non_factual',
    stages: [{ attempt: claim.attempt ?? 1, verdict: claim.verdict, claimType: claim.claimType, evidence: claim.evidence }],
    issues: [],
  }));
  const draftFinal = draftFinalRates(trace);
  const differences = [
    ...integrity.checks.filter((check) => !check.passed).map((check) => `${check.label}：${check.detail}`),
    ...attempts.filter((attempt) => !attempt.match).map((attempt) => `第 ${attempt.attempt} 轮回放门禁 ${attempt.ruleGate} 与在线记录 ${attempt.recordedVerdict} 不一致（回放不得更松）`),
  ];
  return {
    passed: integrity.passed && attempts.every((attempt) => attempt.match) && attempts.length > 0,
    attempts,
    draftFinal,
    integrity,
    differences,
  };
}
