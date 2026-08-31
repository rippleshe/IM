/**
 * StudyRun 节点执行器（docs/挑战杯技术开发总规.md §4.3、§5.2）
 * - learnerId 以 PostgreSQL study_runs 记录为准，队列消息不作为授权依据；
 * - 每个节点把公开摘要写入 run_events（SSE）与学习页群聊（回放），不输出思维链；
 * - Claim/质询/裁决逐轮落 claims / debate_issues / audit_decisions，修订最多 2 次；
 * - 节点依赖以 run.plan 为准（custom 裁剪后依赖已闭合），中间产物存 context_json。
 */
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Job } from 'bullmq';
import { auditResource, type ClaimAuditRecord } from '../../src/learning/audit.js';
import { verifyClaims } from '../../src/learning/claim-verification.js';
import { crossValidate } from '../../src/learning/evidence-rules.js';
import { calibrateDifficulty, type DifficultyCalibration, type ScaffoldStrength } from '../../src/learning/difficulty.js';
import { normalizeKnowledgePointId } from '../../src/learning/store.js';
import { buildLlmResourceDocument, buildResourceDraft, parseLlmResourceDraft, validateLlmResourceDraftQuality } from '../../src/learning/resource-builder.js';
import type { EvidencePack, LearningResourceType, ResourceDocument } from '../../src/learning/types.js';
import {
  ASSESS_LEARNER_SYSTEM,
  CRITIC_SYSTEM,
  DOMAIN_ANALYST_SYSTEM,
  JUDGE_SYSTEM,
  RESOURCE_TYPE_LABELS,
  resourceGenerationSystem,
  resourceGenerationUserHint,
} from '../prompts.js';
import { evidenceService, learningStore } from '../study-context.js';
import { getAgentExecutionSettings, multiModelClient, parseJson, refreshModelCapabilities, withTimeout } from '../study-runtime.js';
import { getLearningDatabase } from '../db/client.js';
import {
  auditDecisions,
  claimEvidence,
  claims as claimsTable,
  debateIssues,
  privacyAuditEvents,
  studyRunNodes,
} from '../db/schema.js';
import { NODE_ACTOR_KEY } from './artifacts.js';
import { enqueueRunNode } from './queue.js';
import {
  agentProducer,
  artifactIdOf,
  computeExecutionManifestHash,
  listRunArtifacts,
  persistArtifact,
  RULE_PRODUCER,
  setNodePrimaryArtifact,
  sha256,
  TOOL_PRODUCER,
  type ArtifactProducer,
  type ArtifactType,
  type PublicRationale,
} from './artifacts.js';
import { saveRunSnapshot } from './snapshots.js';
import { deriveVerificationPolicy, policySummary, taskFactRisk } from './policy.js';
import {
  appendRunEvent,
  finishRun,
  getNodeRow,
  getRunById,
  listRunNodes,
  markRunRunning,
  mergeRunContext,
  setNodeStatus,
  setRunExecutionManifestHash,
  setRunRevisionRound,
  setRunVerificationPolicy,
  type StudyRunNodeRow,
  type StudyRunRow,
} from './service.js';
import { NODE_TITLES, REVISION_BUDGET, ROLE_LABELS, type LearningAgentId, type RunNodeKey, type RunNodeSpec, type StudyRunPlan } from './protocol.js';

/** 并行检索节点写各自顶层键，规避 jsonb 浅合并覆盖 */
interface RunContext {
  assess?: { analysis: string; requirements: string[] };
  ev_structured?: EvidencePack;
  ev_document?: EvidencePack;
  merged_pack?: EvidencePack;
  domain?: { points: string[]; boundaries: string[] };
  draft?: ResourceDocument;
  audit?: { claims: ClaimAuditRecord[]; summary: EvidencePack['crossValidation'] };
  adjudication?: { verdict: string; released: boolean; round: number; outcome?: 'released' | 'revised' | 'rejected' };
  revision_failed?: Array<{ text: string; critique: string }>;
  counterevidence?: Array<{ request: string; packId: string | null; found: number; note: string }>;
}

function contextOf(run: StudyRunRow): RunContext {
  return run.context as RunContext;
}

function runDb() {
  return getLearningDatabase().db;
}

async function callAgent(agentId: LearningAgentId, system: string, user: string, maxTokens = 3_000): Promise<string> {
  const route = getAgentExecutionSettings(agentId, undefined, undefined);
  const limits = await refreshModelCapabilities(route.model);
  const response = await withTimeout(
    multiModelClient.simple({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model: route.model,
      temperature: route.thinking.temperature,
      // 推理模型的思维段同样占用输出预算，节点的 JSON 正文必须留足余量
      maxTokens: Math.min(route.thinking.maxTokens, maxTokens, limits.maxOutputTokens),
    }),
    90_000,
    '模型调用超时',
  );
  return response.text;
}

/** 资源生成长文专用：不受角色路由的输出上限约束，超时与预算独立放宽 */
async function callResourceGeneration(agentId: LearningAgentId, system: string, user: string, maxTokens: number): Promise<string> {
  const route = getAgentExecutionSettings(agentId, undefined, undefined);
  const limits = await refreshModelCapabilities(route.model);
  const response = await withTimeout(
    multiModelClient.simple({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(maxTokens, limits.maxOutputTokens),
    }),
    200_000,
    '资源生成超时',
  );
  return response.text;
}

async function emitEvent(
  run: StudyRunRow,
  node: RunNodeSpec | null,
  type: Parameters<typeof appendRunEvent>[1]['type'],
  summary: string,
  payload?: Record<string, unknown>,
): Promise<void> {
  await appendRunEvent(run.id, { nodeKey: node?.key ?? null, type, summary, payload });
}

/** 群聊冒泡（与旧 study 流气泡契约一致，供历史回放） */
async function bubble(run: StudyRunRow, role: LearningAgentId, text: string, extra: Record<string, unknown> = {}): Promise<void> {
  await learningStore.saveChatMessage(run.learnerId, 'assistant', text, {
    surface: 'study', kind: 'agent', runId: run.id, agentId: role, agentName: ROLE_LABELS[role], ...extra,
  });
}

function evidenceDigest(pack: EvidencePack | null, options: { itemCount?: number; contentLimit?: number } = {}): unknown {
  if (!pack) return [];
  const itemCount = options.itemCount ?? 10;
  const contentLimit = options.contentLimit ?? 240;
  return pack.items.slice(0, itemCount).map((item) => ({
    title: item.sourceTitle,
    locator: item.locator,
    content: item.content.slice(0, contentLimit),
  }));
}

/** 节点主产物持久化（VACP §4.4）：成功路径收尾调用；失败节点不产生主产物 */
async function persistNodeArtifact(
  run: StudyRunRow,
  node: RunNodeSpec,
  attempt: number,
  artifactType: ArtifactType,
  payload: Record<string, unknown>,
  rationale: PublicRationale,
  upstreamKeys: RunNodeKey[],
  producer: ArtifactProducer,
): Promise<string> {
  const inputRefs = [...(await upstreamArtifactRefs(run.id, upstreamKeys))];
  const artifact = await persistArtifact({
    runId: run.id,
    learnerId: run.learnerId,
    nodeKey: node.key,
    attempt,
    artifactType,
    inputRefs,
    payload,
    publicRationale: rationale,
    producer,
  });
  await setNodePrimaryArtifact(run.id, node.key, attempt, artifact.id);
  return artifact.id;
}

/** 上游产物引用（升级计划 §4.1）：下游节点通过产物 ID 引用上游，不复制自由文本 */
async function upstreamArtifactRefs(runId: string, nodeKeys: RunNodeKey[]): Promise<string[]> {
  if (nodeKeys.length === 0) return [];
  const artifacts = await listRunArtifacts(runId);
  const byNode = new Map<string, string>();
  for (const artifact of artifacts) {
    byNode.set(artifact.nodeKey, artifact.id);
  }
  return nodeKeys
    .map((key) => byNode.get(key))
    .filter((id): id is string => Boolean(id));
}

async function pathNodeOf(run: StudyRunRow) {
  if (!run.request.pathNodeId) return null;
  const graph = await learningStore.getPathGraph(run.learnerId);
  return graph.nodes.find((node) => node.id === run.request.pathNodeId) ?? null;
}

/** 脚手架强度按资源类型：讲义、PPT、图谱高，习题中。 */
function scaffoldOfType(type: LearningResourceType): ScaffoldStrength {
  if (type === 'tiered_quiz') return 'medium';
  return 'high';
}

/** 先修就绪度：当前节点的前置节点中已掌握比例；无前置记 1 */
async function prereqReadinessOf(run: StudyRunRow, nodeId: string | null | undefined): Promise<number> {
  if (!nodeId) return 1;
  const graph = await learningStore.getPathGraph(run.learnerId);
  const prereqIds = graph.edges
    .filter((edge) => edge.toNodeId === nodeId && /prereq|before|先行|前置/i.test(edge.relation))
    .map((edge) => edge.fromNodeId);
  if (prereqIds.length === 0) return 1;
  const mastered = prereqIds.filter((id) => {
    const node = graph.nodes.find((item) => item.id === id);
    return Boolean(node && (node.mastered || node.userStatus === 'completed'));
  }).length;
  return mastered / prereqIds.length;
}

/** 难度校准（D2 修复）：以 BKT 状态与先修就绪度计算，替换历史硬编码 0.42 */
async function calibrateForLearner(run: StudyRunRow, pathNode: Awaited<ReturnType<typeof pathNodeOf>>, type: LearningResourceType): Promise<DifficultyCalibration> {
  const knowledgePointId = normalizeKnowledgePointId(pathNode?.knowledgePointId ?? '') || 'industrial-diagnosis-foundation';
  const state = await learningStore.getSkillState(run.learnerId, knowledgePointId);
  return calibrateDifficulty({
    pMastery: state?.pMastery ?? 0.15,
    confidence: state?.confidence ?? 0.1,
    prereqReadiness: await prereqReadinessOf(run, pathNode?.id),
    scaffold: scaffoldOfType(type),
  });
}

async function mergeEvidencePacks(ctx: RunContext, query: string): Promise<EvidencePack> {
  const packs = [ctx.ev_structured, ctx.ev_document].filter((item): item is EvidencePack => Boolean(item));
  if (packs.length === 0) {
    // 双路都无产出：合成空证据包，让门禁链以 unsupported 正常走完
    const empty: EvidencePack['items'] = [];
    return {
      id: `evidence-pack-${randomUUID()}`,
      query,
      items: empty,
      retrievalPlan: [],
      coverageScore: 0,
      crossValidation: crossValidate(empty),
      structuredCount: 0,
      documentCount: 0,
      temporaryCount: 0,
      privacy: { temporaryReferenceUsed: false, retained: false },
      createdAt: Date.now(),
    };
  }
  const items: EvidencePack['items'] = [];
  for (const pack of packs) {
    for (const item of pack.items) {
      if (!items.some((existing) => existing.id === item.id)) items.push(item);
    }
  }
  const base = packs[0]!;
  const merged: EvidencePack = {
    ...base,
    id: `evidence-pack-${randomUUID()}`,
    items,
    retrievalPlan: [...new Set(packs.flatMap((pack) => pack.retrievalPlan))],
    structuredCount: items.filter((item) => item.sourceType === 'dataset').length,
    documentCount: items.filter((item) => item.sourceType === 'document').length,
    crossValidation: crossValidate(items),
  };
  await evidenceService.persistEvidencePack(merged);
  return merged;
}

/* ----------------------------- 各节点实现 ----------------------------- */

async function runAssessLearner(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const profile = await learningStore.getProfile(run.learnerId);
  const pathNode = await pathNodeOf(run);
  const taskLabel = run.request.task.slice(0, 60);
  let analysis = '';
  let requirements: string[] = [];
  let usedAgent = false;
  let systemPrompt = '';
  try {
    systemPrompt = ASSESS_LEARNER_SYSTEM;
    const raw = await callAgent('learning_planning',
      systemPrompt,
      JSON.stringify({
        node: pathNode ? { title: pathNode.title, description: pathNode.description, recommendation: pathNode.recommendation } : null,
        profile: { accuracy: profile.accuracy, studyMinutes: profile.studyMinutes, assetsCount: profile.assetsCount, skills: profile.skills.slice(0, 6) },
        task: { resourceType: run.request.resourceType, content: taskLabel },
        conversation: run.request.conversationContext ?? [],
      }));
    const parsed = parseJson<{ analysis?: unknown; requirements?: unknown }>(raw) ?? {};
    analysis = typeof parsed.analysis === 'string' ? parsed.analysis.slice(0, 300) : '';
    requirements = Array.isArray(parsed.requirements) ? parsed.requirements.map((item) => String(item).slice(0, 80)).filter(Boolean).slice(0, 5) : [];
    usedAgent = analysis.length > 0 && requirements.length > 0;
  } catch { /* 回退确定性文案 */ }
  if (!usedAgent) {
    analysis = `我先核对了你的学习状态：累计学习 ${profile.studyMinutes} 分钟，正确率 ${profile.accuracy === null || profile.accuracy === undefined ? '暂无' : `${Math.round(profile.accuracy * 100)}%`}。本次任务围绕「${taskLabel}」展开：先把概念讲准，再配合真实数据摘录。`;
    requirements = ['从学习者当前水平切入，不跳步', '引用证据中的数据并保留定位', '明确结论边界与不确定处'];
  }
  await mergeRunContext(run.id, { assess: { analysis, requirements } });
  await persistNodeArtifact(run, node, attempt, 'learner_snapshot', {
    profile: { accuracy: profile.accuracy, studyMinutes: profile.studyMinutes, assetsCount: profile.assetsCount },
    skills: profile.skills.slice(0, 12),
    pathNode: pathNode ? { id: pathNode.id, title: pathNode.title, knowledgePointId: pathNode.knowledgePointId, recommendation: pathNode.recommendation } : null,
    analysis,
    requirements,
  }, {
    observations: [
      `累计学习 ${profile.studyMinutes} 分钟`,
      `历史正确率 ${profile.accuracy === null || profile.accuracy === undefined ? '暂无' : `${Math.round(profile.accuracy * 100)}%`}`,
      pathNode ? `目标节点「${pathNode.title}」` : '未绑定路径节点',
    ],
    basisRefs: [run.request.pathNodeId ?? 'learner-profile'],
    decision: analysis.slice(0, 200),
    uncertainty: usedAgent ? [] : ['学情分析由确定性规则兜底生成'],
    nextAction: `为「${taskLabel}」生成${RESOURCE_TYPE_LABELS[run.request.resourceType] ?? '讲义'}前先完成证据检索`,
  }, [], usedAgent
    ? agentProducer(systemPrompt, getAgentExecutionSettings('learning_planning', undefined, undefined))
    : RULE_PRODUCER);
  await bubble(run, node.role, `${analysis}\n设计要求：\n${requirements.map((item) => `- ${item}`).join('\n')}`);
  return analysis.slice(0, 120);
}

async function retrieveEvidence(run: StudyRunRow, node: RunNodeSpec, attempt: number, plan: Array<'structured' | 'document'>): Promise<string> {
  const pack = await evidenceService.buildEvidencePack(run.request.task, {
    learnerId: run.learnerId,
    sessionId: `study-run-${run.id}`,
    retrievalPlan: plan,
  });
  await mergeRunContext(run.id, plan.includes('structured') ? { ev_structured: pack } : { ev_document: pack });
  const degraded = Boolean(pack.hybrid?.degraded);
  if (plan.includes('structured')) {
    await bubble(run, node.role,
      `完成结构化检索：取回 ${pack.items.length} 条数据证据，可回溯定位如：${pack.items[0]?.locator ?? '无'}。`);
  } else {
    // 混合检索降级上报（总规 §7.5）：向量路不可用时如实展示，不静默
    if (degraded) {
      const reasonText = pack.hybrid?.reason === 'embed_failed' ? '查询向量生成失败' : pack.hybrid?.reason === 'vector_query_failed' ? '向量查询异常' : '库内暂无向量';
      await emitEvent(run, node, 'node.progress', `混合检索降级：${reasonText}，已回退全文检索。`, { hybrid: pack.hybrid });
      await bubble(run, node.role, `注意：向量检索暂不可用（${reasonText}），文档证据已降级为全文检索，不影响门禁流程。`);
    }
    await bubble(run, node.role, pack.items.length > 0
      ? `完成文档检索：按相关度命中 ${pack.items.length} 份资料，最相关《${pack.items[0]?.sourceTitle ?? ''}》${pack.items[0]?.locator ? `（${pack.items[0].locator}）` : ''}。`
      : '文档检索未命中可用资料，将提示生成端只依赖结构化数据并保守表达。');
  }
  await persistNodeArtifact(run, node, attempt, 'evidence_set', {
    packId: pack.id,
    query: pack.query,
    retrievalPlan: pack.retrievalPlan,
    itemCount: pack.items.length,
    coverageScore: pack.coverageScore,
    crossValidation: pack.crossValidation,
    hybrid: pack.hybrid ?? null,
    items: pack.items.slice(0, 12).map((item) => ({
      id: item.id,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceTitle: item.sourceTitle ?? null,
      locator: item.locator,
      trustLevel: item.trustLevel,
      retrievalMethod: item.retrievalMethod,
      relevanceScore: item.relevanceScore,
      content: item.content.slice(0, 500),
    })),
  }, {
    observations: [
      `${plan.includes('structured') ? '结构化' : '文档'}检索取回 ${pack.items.length} 条证据`,
      `证据覆盖度 ${pack.coverageScore}`,
      degraded ? '向量检索降级为全文检索' : '混合检索两路可用',
    ],
    basisRefs: pack.items.slice(0, 6).map((item) => item.id),
    decision: pack.items.length > 0
      ? `以 ${pack.items[0]?.locator ?? ''} 等来源作为本任务证据集`
      : '证据为空，后续节点必须保守表达并走最严门禁',
    uncertainty: pack.items.length === 0 ? ['未命中任何可用证据'] : [],
    nextAction: plan.includes('structured') ? '并行文档检索继续' : '证据移交领域分析与生成端',
  }, [], TOOL_PRODUCER);
  return `${plan.includes('structured') ? '结构化' : '文档'}证据 ${pack.items.length} 条`;
}

async function runAnalyzeDomain(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  if (merged) await mergeRunContext(run.id, { merged_pack: merged });
  let points: string[] = [];
  let boundaries: string[] = [];
  let usedAgent = false;
  let systemPrompt = '';
  try {
    systemPrompt = DOMAIN_ANALYST_SYSTEM;
    const raw = await callAgent('domain_expert',
      systemPrompt,
      JSON.stringify({ task: run.request.task, conversation: run.request.conversationContext ?? [], evidence: evidenceDigest(merged) }));
    const parsed = parseJson<{ points?: unknown; boundaries?: unknown }>(raw) ?? {};
    points = Array.isArray(parsed.points) ? parsed.points.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 5) : [];
    boundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 3) : [];
    usedAgent = points.length > 0;
  } catch { /* 回退确定性文案 */ }
  if (!usedAgent) {
    points = ['先解释关键字段含义与观察方法', '用证据中的数据示例说明判断依据'];
    boundaries = ['数据异常只支持风险判断，不等于确定故障', '结论需保留现场复核建议'];
  }
  await mergeRunContext(run.id, { domain: { points, boundaries } });
  // VACP（升级计划 §4.7 两阶段决策·第二阶段）：按实际证据产物修正审核策略
  const targetKp = normalizeKnowledgePointId((await pathNodeOf(run))?.knowledgePointId ?? '');
  const targetState = await learningStore.getSkillState(run.learnerId, targetKp || 'industrial-diagnosis-foundation');
  const policy = deriveVerificationPolicy({
    structuredPack: ctx.ev_structured ?? null,
    documentPack: ctx.ev_document ?? null,
    resourceType: run.request.resourceType,
    taskRisk: taskFactRisk(run.request).score,
    learnerConfidence: targetState?.confidence ?? 0.1,
    strictAdjudication: run.plan.strictAdjudication,
  });
  if (policy.amended) {
    await setRunVerificationPolicy(run.id, policy as unknown as Record<string, unknown>);
    await persistArtifact({
      runId: run.id,
      learnerId: run.learnerId,
      nodeKey: 'audit.claims',
      attempt: 1,
      artifactType: 'design_constraints',
      inputRefs: await upstreamArtifactRefs(run.id, ['retrieve.structured', 'retrieve.document']),
      payload: { phase: 'post_retrieval_policy', policy },
      publicRationale: {
        observations: [policySummary(policy)],
        basisRefs: [`pack:${ctx.ev_structured?.id ?? 'none'}`, `pack:${ctx.ev_document?.id ?? 'none'}`],
        decision: policy.strength === 'strict' ? '审核与裁决按 strict 策略执行' : '审核门禁保持齐全，附加约束已启用',
        uncertainty: [],
        nextAction: '生成端与门禁端按修正后策略执行',
      },
      producer: RULE_PRODUCER,
    });
    await emitEvent(run, node, 'plan.amended', `审核策略按实际证据修正：${policySummary(policy)}`, {
      policy,
    });
  }
  await persistNodeArtifact(run, node, attempt, 'domain_brief', {
    task: run.request.task.slice(0, 200),
    points,
    boundaries,
    evidencePackId: merged?.id ?? null,
    evidenceCount: merged?.items.length ?? 0,
  }, {
    observations: [`基于 ${merged?.items.length ?? 0} 条证据进行领域分析`],
    basisRefs: (merged?.items ?? []).slice(0, 6).map((item) => item.id),
    decision: `给出 ${points.length} 条讲解要点与 ${boundaries.length} 条专业边界`,
    uncertainty: usedAgent ? [] : ['领域分析由确定性规则兜底生成'],
    nextAction: '要点与边界移交资源生成端',
  }, ['retrieve.structured', 'retrieve.document'], usedAgent
    ? agentProducer(systemPrompt, getAgentExecutionSettings('domain_expert', undefined, undefined))
    : RULE_PRODUCER);
  await bubble(run, node.role, `讲解要点：\n${points.map((item) => `- ${item}`).join('\n')}\n专业边界：\n${boundaries.map((item) => `- ${item}`).join('\n')}`);
  return `${points.length} 个要点、${boundaries.length} 条边界`;
}

/** 各资源类型的生成预算：推理模型的思维段占用输出预算，讲义长文需要大额余量 */
const GENERATION_MAX_TOKENS: Record<LearningResourceType, number> = {
  lecture: 12_000,
  presentation: 10_000,
  tiered_quiz: 10_000,
  concept_map: 8_000,
};

async function runGenerateResource(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  const assess = ctx.assess ?? { analysis: '', requirements: ['从学习者当前水平切入，不跳步'] };
  const domain = ctx.domain ?? { points: [], boundaries: [] };
  const pathNode = await pathNodeOf(run);
  const type = run.request.resourceType;
  const isRevision = attempt > 1;
  const calibration = await calibrateForLearner(run, pathNode, type);

  let generated: ResourceDocument | null = null;
  let note = '';
  let usedLlm = false;
  let generationPrompt = '';
  // 检索后策略（升级计划 §4.7）：证据稀疏时禁止强事实表达，门禁不放松
  const forbidStrongClaims = run.verificationPolicy?.['forbidStrongFactualClaims'] === true;
  generationPrompt = resourceGenerationSystem({ type, isRevision, forbidStrongClaims });
  const sharedInput = {
    task: run.request.task,
    pathNode: pathNode ? {
      knowledgePointId: pathNode.knowledgePointId,
      title: pathNode.title,
      description: pathNode.description,
      currentStatus: pathNode.userStatus,
    } : null,
    learner: {
      analysis: assess.analysis,
      requirements: assess.requirements,
    },
    difficultyCalibration: calibration,
  };
  const payload = isRevision
    ? {
        ...sharedInput,
        failedClaims: ctx.revision_failed ?? [],
        domainPoints: domain.points,
        domainBoundaries: domain.boundaries,
        evidence: evidenceDigest(merged, { itemCount: 14, contentLimit: 500 }),
      }
    : {
        ...sharedInput,
        domainPoints: domain.points,
        domainBoundaries: domain.boundaries,
        evidence: evidenceDigest(merged, { itemCount: 14, contentLimit: 500 }),
      };
  try {
    const raw = await callResourceGeneration('resource_generation', generationPrompt, `${JSON.stringify(payload)}\n\n${resourceGenerationUserHint(isRevision)}`, GENERATION_MAX_TOKENS[type]);
    let llm = parseLlmResourceDraft(type, parseJson<unknown>(raw));
    let qualityIssues = llm ? validateLlmResourceDraftQuality(llm) : ['输出不是该资源类型要求的完整 JSON 结构'];
    if (qualityIssues.length > 0) {
      try {
        const repairPrompt = resourceGenerationSystem({ type, isRevision, forbidStrongClaims, qualityIssues });
        const repairPayload = {
          ...payload,
          qualityIssues,
          previousDraft: llm ?? raw.slice(0, 20_000),
        };
        const repairedRaw = await callResourceGeneration(
          'resource_generation',
          repairPrompt,
          `${JSON.stringify(repairPayload)}\n\n请依据 qualityIssues 重新交付完整成品。${resourceGenerationUserHint(isRevision)}`,
          GENERATION_MAX_TOKENS[type],
        );
        const repaired = parseLlmResourceDraft(type, parseJson<unknown>(repairedRaw));
        const repairedIssues = repaired ? validateLlmResourceDraftQuality(repaired) : ['返修输出仍无法解析'];
        if (repaired && (!llm || repairedIssues.length <= qualityIssues.length)) {
          llm = repaired;
          qualityIssues = repairedIssues;
          generationPrompt = repairPrompt;
        }
      } catch (repairError) {
        console.warn('[generate.resource] 质量返修调用失败，保留可解析初稿交由发布审核：', repairError instanceof Error ? repairError.message : repairError);
      }
    }
    if (llm) {
      generated = buildLlmResourceDocument(`study-${run.id}-${attempt}`, run.request.task, type, merged, pathNode?.knowledgePointId, llm, { calibration });
      usedLlm = generated !== null;
      if (qualityIssues.length > 0) note = `模型已完成质量返修，仍有 ${qualityIssues.length} 项由发布审核继续把关。`;
    } else {
      console.warn(`[generate.resource] 模型输出无法解析为 ${type} 草稿，回退模板：${raw.slice(0, 200)}`);
    }
  } catch (error) {
    // 生成失败必须留下原因（超时/网络/额度），否则排障时只能看到"模型不可用"
    console.warn(`[generate.resource] 模型调用失败（${type}${isRevision ? '，修订轮' : ''}），回退模板：`, error instanceof Error ? error.message : error);
  }
  if (!generated) {
    generated = buildResourceDraft(`study-${run.id}-${attempt}`, run.request.task, type, merged, pathNode?.knowledgePointId, { calibration });
    note = isRevision ? '修订轮使用内置结构模板保证可追溯。' : '生成模型不可用，已使用内置结构模板。';
  }
  if (forbidStrongClaims) {
    note = note ? `${note}证据稀疏：已按策略要求保守表达。` : '证据稀疏：已按策略要求保守表达。';
  }
  const resource = generated;
  await mergeRunContext(run.id, { draft: resource });
  await persistNodeArtifact(run, node, attempt, 'resource_draft', resource as unknown as Record<string, unknown>, {
    observations: [
      `${isRevision ? `第 ${attempt} 轮修订` : '初稿'}：${resource.blocks.length} 个内容块`,
      `难度校准目标 ${calibration.targetDifficulty}、预计成功率 ${calibration.expectedSuccessRate}`,
      `绑定证据 ${resource.evidenceIds.length} 条`,
    ],
    basisRefs: resource.evidenceIds.slice(0, 8),
    decision: `生成《${resource.title}》并提交 Claim 审核`,
    uncertainty: note ? [note] : [],
    nextAction: '草稿移交 claim_auditor 逐条核对',
  }, ['assess.learner', 'retrieve.structured', 'retrieve.document', 'analyze.domain'], usedLlm
    ? agentProducer(generationPrompt, getAgentExecutionSettings('resource_generation', undefined, undefined))
    : RULE_PRODUCER);
  // 气泡向学习者公开生成结构：不同资源类型给出各自的构成清单，而不是只有块数
  const describeStructure = (doc: ResourceDocument): string => {
    const headings = doc.blocks.filter((block) => block.type === 'heading').map((block) => String(block.content));
    const questionBlock = doc.blocks.find((block) => block.type === 'question')?.content as { questions?: unknown[] } | undefined;
    const charCount = doc.blocks.reduce((sum, block) => sum + (typeof block.content === 'string' ? block.content.length : 0), 0);
    if (doc.type === 'tiered_quiz' && questionBlock?.questions) return `共 ${questionBlock.questions.length} 道题（选择/填空/简答混合，L1-L3 分层）`;
    if (doc.type === 'presentation') return `${headings.length} 页幻灯片，每页要点与讲解词`;
    if (doc.type === 'concept_map') return '知识关系图 + 逐节点解读 + 阅读路径';
    return `${headings.length} 节正文（约 ${charCount} 字），含代码示例与数据摘录`;
  };
  await bubble(run, node.role,
    `${isRevision ? `第 ${attempt} 轮修订完成` : '初稿完成'}：《${resource.title}》——${describeStructure(resource)}。${note || '所有内容已绑定证据引用，交由审核智能体逐条核对。'}`);
  return `草稿《${resource.title}》共 ${resource.blocks.length} 块`;
}

async function runAuditClaims(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const draft = ctx.draft;
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  if (!draft) throw new Error('缺少草稿，无法执行 Claim 审核');
  const result = auditResource(draft, merged);
  // 里程碑 D：确定性核验（数值/字段含义/越界因果/引用越界），结论只能比基础审核更严
  const datasetFields = await loadDatasetFields();
  const verifiedClaims = verifyClaims(result.claims, merged, { datasetFields });
  const auditedResult = { ...result, claims: verifiedClaims };
  await learningStore.saveResourceAudit(draft.id, auditedResult.claims);
  const draftArtifactId = artifactIdOf(run.id, 'generate.resource', attempt, 'resource_draft');
  await persistClaims(run, auditedResult.claims, attempt, draftArtifactId);
  await mergeRunContext(run.id, { audit: { claims: auditedResult.claims, summary: auditedResult.summary } });
  const supported = auditedResult.claims.filter((claim) => claim.verdict === 'supported').length;
  const review = auditedResult.claims.filter((claim) => claim.verdict === 'review').length;
  const unsupported = auditedResult.claims.filter((claim) => claim.verdict === 'unsupported').length;
  const nonFactual = auditedResult.claims.filter((claim) => claim.claimType === 'non_factual').length;
  await persistNodeArtifact(run, node, attempt, 'claim_audit', {
    draftArtifactId,
    draftId: draft.id,
    claims: auditedResult.claims,
    summary: auditedResult.summary,
    verification: { datasetFieldCount: datasetFields.length, nonFactualExcludedFromDenominator: nonFactual },
  }, {
    observations: [
      `逐条核对 ${auditedResult.claims.length} 条内容声明（数值/字段含义/方法步骤/因果/风险建议）`,
      `来源交叉验证 ${auditedResult.summary.status}`,
      nonFactual > 0 ? `${nonFactual} 条非事实教学表达不计入幻觉率分母` : '无非事实教学表达',
    ],
    basisRefs: [draftArtifactId, ...(merged?.items ?? []).slice(0, 6).map((item) => item.id)],
    decision: `支持 ${supported}、待复核 ${review}、无证据支持 ${unsupported}`,
    uncertainty: review > 0 ? [`${review} 条数字或单位待复核`] : [],
    nextAction: unsupported + review > 0 ? '移交反方质询重点核查未通过表述' : '移交反方质询确认',
  }, ['generate.resource', 'retrieve.structured', 'retrieve.document'], RULE_PRODUCER);
  await bubble(run, node.role,
    `逐条核对 ${auditedResult.claims.length} 条内容声明：支持 ${supported}、待复核 ${review}、无证据支持 ${unsupported}${nonFactual > 0 ? `（另有 ${nonFactual} 条非事实教学表达不计入分母）` : ''}。来源交叉验证：${auditedResult.summary.status === 'corroborated' ? '结构化数据与领域文档互证通过' : '来源单一，需保守表达'}。`);
  return `Claim 审核 ${auditedResult.claims.length} 条（支持 ${supported}/待复核 ${review}/无证据 ${unsupported}）`;
}

/** 字段字典（PG dataset_fields）：字段含义 Claim 核验依据 */
async function loadDatasetFields(): Promise<Array<{ fieldName: string; meaning: string }>> {
  const rows = await runDb().execute(
    `SELECT field_name AS "fieldName", meaning FROM dataset_fields LIMIT 200`,
  );
  return (rows.rows as Array<{ fieldName: string; meaning: string }>).map((row) => ({
    fieldName: row.fieldName,
    meaning: row.meaning,
  }));
}

async function persistClaims(run: StudyRunRow, items: ClaimAuditRecord[], attempt: number, draftArtifactId: string): Promise<void> {
  if (items.length === 0) return;
  // supersedes（升级计划 §4.5）：与上一轮同 logicalKey 的声明建立替代关系
  const previousRows = attempt > 1
    ? (await runDb().select({ id: claimsTable.id, logicalKey: claimsTable.logicalKey })
        .from(claimsTable)
        .where(and(eq(claimsTable.resourceId, run.id), eq(claimsTable.attempt, attempt - 1))))
    : [];
  const previousByKey = new Map(previousRows.map((row) => [row.logicalKey ?? '', row.id]));
  await runDb().insert(claimsTable).values(items.map((claim) => ({
    id: `${run.id}:${claim.id}`,
    resourceId: run.id,
    learnerId: run.learnerId,
    runId: run.id,
    attempt,
    draftArtifactId,
    claimType: claim.claimType ?? null,
    logicalKey: claim.logicalKey ?? null,
    supersedesClaimId: previousByKey.get(claim.logicalKey ?? '') ?? null,
    text: claim.text.slice(0, 2000),
    verdict: claim.verdict,
    critique: claim.critique.slice(0, 1000),
    factualScore: claim.factualScore,
    createdAt: Date.now(),
  }))).onConflictDoNothing();
  const edges = items.flatMap((claim) => claim.evidenceIds.map((evidenceId) => ({
    claimId: `${run.id}:${claim.id}`,
    evidenceId,
    supportLevel: claim.verdict,
  })));
  if (edges.length > 0) {
    await runDb().insert(claimEvidence).values(edges).onConflictDoNothing();
  }
}

type DebateIssueInput = {
  issueType: 'no_evidence' | 'conflict' | 'out_of_scope_causality' | 'difficulty_mismatch' | 'counterevidence_request';
  targetClaimId: string | null;
  argument: string;
  source: 'rule' | 'critic';
};

/** 独立批评 Agent（总规 §5.2 升级）：LLM 从反方立场逐条审查草稿；失败返回空，规则兜底不受影响 */
const CRITIC_SYSTEM_PROMPT = CRITIC_SYSTEM;

async function criticAgentIssues(run: StudyRunRow, audit: NonNullable<RunContext['audit']>): Promise<DebateIssueInput[]> {
  const ctx = contextOf(run);
  const draft = ctx.draft;
  const merged = ctx.merged_pack;
  if (!draft) return [];
  const focus = run.plan.challengeFocus;
  try {
    const raw = await callAgent('cross_validation',
      CRITIC_SYSTEM_PROMPT,
      JSON.stringify({
        claims: audit.claims.map((claim) => ({ id: claim.id, text: claim.text.slice(0, 160), verdict: claim.verdict })),
        draftExcerpt: draft.blocks
          .filter((block) => block.type === 'heading' || block.type === 'paragraph' || block.type === 'list')
          .map((block) => (typeof block.content === 'string' ? block.content : ''))
          .filter(Boolean).join('\n').slice(0, 1200),
        evidence: evidenceDigest(merged ?? null),
        focus,
        learnerState: ctx.assess?.analysis ?? '',
        resourceDifficulty: draft.difficulty,
      }), 3_000);
    const parsed = parseJson<{ issues?: unknown }>(raw) ?? {};
    if (!Array.isArray(parsed.issues)) return [];
    const allowed = new Set(['no_evidence', 'conflict', 'out_of_scope_causality', 'difficulty_mismatch', 'counterevidence_request']);
    return parsed.issues.flatMap((item): Array<DebateIssueInput> => {
      const issue = item as { issueType?: unknown; targetClaimId?: unknown; argument?: unknown };
      if (!allowed.has(String(issue.issueType))) return [];
      const argument = typeof issue.argument === 'string' && issue.argument.trim() ? issue.argument.trim().slice(0, 300) : '';
      if (!argument) return [];
      const targetClaimId = typeof issue.targetClaimId === 'string' && audit.claims.some((claim) => claim.id === issue.targetClaimId)
        ? issue.targetClaimId
        : null;
      return [{ issueType: String(issue.issueType) as DebateIssueInput['issueType'], targetClaimId, argument, source: 'critic' }];
    }).slice(0, 4);
  } catch {
    return [];
  }
}

async function runDebateChallenge(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const audit = ctx.audit;
  if (!audit) throw new Error('缺少审核结果，无法发起反方质询');
  const focus = run.plan.challengeFocus;
  const issues: DebateIssueInput[] = [];
  for (const claim of audit.claims) {
    if (claim.verdict === 'unsupported') {
      issues.push({ issueType: 'no_evidence', targetClaimId: claim.id, argument: claim.critique || '该表述在证据包中找不到支持来源', source: 'rule' });
    } else if (claim.verdict === 'review' && focus.includes('conflict')) {
      issues.push({ issueType: 'conflict', targetClaimId: claim.id, argument: claim.critique || '该数字无法与证据核对，存在证据冲突风险', source: 'rule' });
    }
  }
  if (focus.includes('out_of_scope_causality')) {
    issues.push({ issueType: 'out_of_scope_causality', targetClaimId: null, argument: '数据异常只能支持风险判断，越界的因果结论必须降级为待现场复核', source: 'rule' });
  }
  if (focus.includes('difficulty_mismatch') && ctx.assess) {
    issues.push({ issueType: 'difficulty_mismatch', targetClaimId: null, argument: `学情侧提示：${ctx.assess.analysis.slice(0, 120)}——请核对资源难度是否匹配当前掌握度`, source: 'rule' });
  }
  // 独立批评 Agent：LLM 从反方立场补充议题（失败静默回退规则兜底）
  const ruleKeys = new Set(issues.map((issue) => `${issue.issueType}:${issue.targetClaimId ?? ''}`));
  const criticIssues = (await criticAgentIssues(run, audit))
    .filter((issue) => !ruleKeys.has(`${issue.issueType}:${issue.targetClaimId ?? ''}`));
  issues.push(...criticIssues);
  // 里程碑 D 第 7 条：counterevidence_request → 在已有知识库和数据中执行反证检索，不联网
  const counterevidence: Array<{ request: string; packId: string | null; found: number; note: string }> = [];
  for (const issue of issues.filter((item) => item.issueType === 'counterevidence_request').slice(0, 2)) {
    try {
      const pack = await evidenceService.buildEvidencePack(issue.argument, {
        learnerId: run.learnerId,
        sessionId: `study-run-${run.id}`,
        retrievalPlan: ['document'],
      });
      counterevidence.push({
        request: issue.argument.slice(0, 120),
        packId: pack.id,
        found: pack.items.length,
        note: pack.items.length > 0 ? `命中 ${pack.items.length} 条潜在反证，已并入合并证据包` : '未命中反证，声明暂时站得住',
      });
      if (pack.items.length > 0) {
        const current = contextOf(run).merged_pack;
        if (current) {
          const items = [...current.items];
          for (const item of pack.items) {
            if (!items.some((existing) => existing.id === item.id)) items.push(item);
          }
          await mergeRunContext(run.id, {
            merged_pack: { ...current, items, documentCount: items.filter((item) => item.sourceType === 'document').length, crossValidation: crossValidate(items) },
            counterevidence,
          });
        } else {
          await mergeRunContext(run.id, { counterevidence });
        }
      }
    } catch (error) {
      counterevidence.push({
        request: issue.argument.slice(0, 120),
        packId: null,
        found: -1,
        note: `反证检索失败：${error instanceof Error ? error.message.slice(0, 80) : '未知错误'}`,
      });
      await mergeRunContext(run.id, { counterevidence });
    }
  }
  if (issues.length > 0) {
    await runDb().insert(debateIssues).values(issues.map((issue) => ({
      id: `${run.id}:issue-${randomUUID()}`,
      runId: run.id,
      resourceId: run.id,
      issueType: issue.issueType,
      targetClaimId: issue.targetClaimId ? `${run.id}:${issue.targetClaimId}` : null,
      argument: issue.argument.slice(0, 1000),
      source: issue.source,
      status: 'raised' as const,
      createdAt: Date.now(),
    })));
  }
  await persistNodeArtifact(run, node, attempt, 'challenge_set', {
    focus,
    issueCount: issues.length,
    issues,
    counterevidence,
  }, {
    observations: [
      `质询提出 ${issues.length} 个议题（规则 ${issues.length - criticIssues.length} 条、批评 Agent 补充 ${criticIssues.length} 条）`,
      counterevidence.length > 0
        ? `执行 ${counterevidence.length} 次反证检索（仅用已有知识库与数据）：${counterevidence.map((item) => item.note).join('；')}`
        : '无需反证检索',
      '批评端只读取草稿、Claim 与证据，不读取生成端分析理由',
    ],
    basisRefs: issues.filter((issue) => issue.targetClaimId).slice(0, 6).map((issue) => `${run.id}:${issue.targetClaimId}`),
    decision: issues.length > 0 ? '将未通过与越界表述提交从严裁决' : '未发现需拦截的表述，提交裁决确认',
    uncertainty: counterevidence.filter((item) => item.found < 0).map((item) => item.note),
    nextAction: '移交 evidence_judge 裁决',
  }, ['audit.claims', 'generate.resource'], criticIssues.length > 0
    ? agentProducer(CRITIC_SYSTEM_PROMPT, getAgentExecutionSettings('cross_validation', undefined, undefined))
    : RULE_PRODUCER);
  await bubble(run, node.role,
    issues.length > 0
      ? `质询提出 ${issues.length} 个议题（规则 ${issues.length - criticIssues.length} 条、批评 Agent 补充 ${criticIssues.length} 条：无证据 ${issues.filter((issue) => issue.issueType === 'no_evidence').length}、冲突 ${issues.filter((issue) => issue.issueType === 'conflict').length}、越界因果 ${issues.filter((issue) => issue.issueType === 'out_of_scope_causality').length}、难度适配 ${issues.filter((issue) => issue.issueType === 'difficulty_mismatch').length}）。无法核对或越界的表述将被从严裁决。`
      : '质询（含独立批评 Agent）未发现无证据、冲突或越界表述，提交裁决确认。');
  return `反方质询 ${issues.length} 个议题`;
}

const VERDICT_SEVERITY: Record<string, number> = { supported: 0, partial: 1, conflict: 2, unsupported: 3 };

/** 裁决 Agent（总规 §5.2 升级）：LLM 独立给出整体判决；失败返回 null，规则兜底不受影响 */
const JUDGE_SYSTEM_PROMPT = JUDGE_SYSTEM;

async function adjudicatorAgentVerdict(run: StudyRunRow, audit: NonNullable<RunContext['audit']>): Promise<{ verdict: 'supported' | 'partial' | 'conflict' | 'unsupported'; rationale: string } | null> {
  try {
    const raw = await callAgent('cross_validation',
      JUDGE_SYSTEM_PROMPT,
      JSON.stringify({
        claims: audit.claims.map((claim) => ({ id: claim.id, text: claim.text.slice(0, 140), verdict: claim.verdict })),
        crossValidation: audit.summary,
        challengeFocus: run.plan.challengeFocus,
        strictAdjudication: run.plan.strictAdjudication,
        // 裁决端只读结构化材料：反证检索结果（不读取生成端对话或理由）
        counterevidence: contextOf(run).counterevidence ?? [],
      }), 2_400);
    const parsed = parseJson<{ verdict?: unknown; rationale?: unknown }>(raw) ?? {};
    const verdict = String(parsed.verdict);
    if (!(verdict in VERDICT_SEVERITY)) return null;
    return {
      verdict: verdict as 'supported' | 'partial' | 'conflict' | 'unsupported',
      rationale: typeof parsed.rationale === 'string' && parsed.rationale.trim() ? parsed.rationale.trim().slice(0, 160) : '裁决 Agent 未给出理由。',
    };
  } catch {
    return null;
  }
}

async function runAdjudicate(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<'released' | 'revised' | 'rejected'> {
  const ctx = contextOf(run);
  const audit = ctx.audit;
  if (!audit) throw new Error('缺少审核结果，无法裁决');
  // 幻觉率分母口径：non_factual 教学表达不参与裁决计数
  const auditable = audit.claims.filter((claim) => claim.claimType !== 'non_factual');
  const unsupported = auditable.filter((claim) => claim.verdict === 'unsupported').length;
  const review = auditable.filter((claim) => claim.verdict === 'review').length;
  const summaryStatus = audit.summary.status;
  const ruleVerdict = unsupported > 0
    ? 'unsupported'
    : summaryStatus === 'conflict'
      ? 'conflict'
      : (review > 0 || summaryStatus !== 'corroborated') ? 'partial' : 'supported';
  // 裁决 Agent 独立判决；与规则结论取更严者——门禁只能收紧不能放松（总规 §5.2）
  const agent = await adjudicatorAgentVerdict(run, audit);
  const verdict = agent && (VERDICT_SEVERITY[agent.verdict] ?? 0) > (VERDICT_SEVERITY[ruleVerdict] ?? 0)
    ? agent.verdict
    : ruleVerdict;
  const strict = run.plan.strictAdjudication
    // 检索后策略修正（升级计划 §4.7）：数据与文档结论冲突或策略 strict 时从严
    || run.verificationPolicy?.['conflictMode'] === true
    || run.verificationPolicy?.['strength'] === 'strict';
  const released = verdict === 'supported' || (verdict === 'partial' && !strict);
  await runDb().insert(auditDecisions).values({
    id: `${run.id}:decision-${randomUUID()}`,
    runId: run.id,
    resourceId: run.id,
    round: attempt,
    verdict,
    rationale: `规则裁决 ${ruleVerdict}；裁决 Agent ${agent ? agent.verdict : '不可用（回退规则）'}；${agent ? agent.rationale : ''}支持 ${auditable.length - review - unsupported}/${auditable.length}，待复核 ${review}，无证据 ${unsupported}；交叉验证 ${summaryStatus}${strict ? '；知识风险高，partial 亦不放行' : ''}`.slice(0, 900),
    released,
    createdAt: Date.now(),
  });
  const adjudicationOutcome: 'released' | 'revised' | 'rejected' = released
    ? 'released'
    : attempt <= REVISION_BUDGET ? 'revised' : 'rejected';
  await mergeRunContext(run.id, { adjudication: { verdict, released, round: attempt, outcome: adjudicationOutcome } });
  if (adjudicationOutcome === 'revised') {
    // 修订轮绕过当前链的下游：旧 attempt 的 privacy/finalize 不再执行（修：修订环被调度器跳过的历史缺陷）
    await skipStaleChainNodes(run, [attempt]);
  }
  await persistNodeArtifact(run, node, attempt, 'adjudication', {
    verdict,
    ruleVerdict,
    agentVerdict: agent ? agent.verdict : null,
    agentAvailable: agent !== null,
    released,
    round: attempt,
    strictAdjudication: strict,
    counts: { total: auditable.length, supported: auditable.length - review - unsupported, review, unsupported },
    crossValidation: summaryStatus,
  }, {
    observations: [
      `规则裁决 ${ruleVerdict}；裁决 Agent ${agent ? agent.verdict : '不可用，回退规则'}`,
      `支持 ${audit.claims.length - review - unsupported}/${audit.claims.length}、待复核 ${review}、无证据 ${unsupported}`,
    ],
    basisRefs: [artifactIdOf(run.id, 'audit.claims', attempt, 'claim_audit'), artifactIdOf(run.id, 'debate.challenge', attempt, 'challenge_set')],
    decision: `第 ${attempt} 轮裁决 ${verdict}，${released ? '通过发布门禁' : '不通过发布门禁'}`,
    uncertainty: agent ? [] : ['裁决 Agent 不可用，仅按确定性规则裁决'],
    nextAction: released ? '移交隐私合规与发布收尾' : attempt <= REVISION_BUDGET ? '退回生成端修订' : '标记人工复核，不发布',
  }, [], agent
    ? agentProducer(JUDGE_SYSTEM_PROMPT, getAgentExecutionSettings('cross_validation', undefined, undefined))
    : RULE_PRODUCER);
  await bubble(run, node.role,
    `第 ${attempt} 轮裁决：${verdict}（规则 ${ruleVerdict}${agent ? `；裁决 Agent ${agent.verdict}` : '；裁决 Agent 不可用，按规则执行'}）。${released ? '通过发布门禁。' : '未通过发布门禁。'}`);

  if (!released) {
    if (attempt <= REVISION_BUDGET) {
      const nextAttempt = attempt + 1;
      await setRunRevisionRound(run.id, attempt);
      await mergeRunContext(run.id, {
        revision_failed: auditable
          .filter((claim) => claim.verdict !== 'supported')
          .map((claim) => ({ text: claim.text.slice(0, 160), critique: claim.critique })),
      });
      await createRevisionNodes(run, nextAttempt);
      await emitEvent(run, node, 'run.revision', `第 ${attempt} 轮未通过，退回生成端修订（第 ${nextAttempt} 轮）。`, { verdict, nextAttempt });
      await bubble(run, node.role, `已退回资源生成智能体修订 ${auditable.filter((claim) => claim.verdict !== 'supported').length} 处内容。`);
      await enqueueRunNode(run.id, 'generate.resource', nextAttempt);
      return 'revised';
    }
    await emitEvent(run, node, 'run.revision', `修订预算（${REVISION_BUDGET} 轮）已用尽，资源标记为人工复核，不发布。`, { verdict });
    await bubble(run, node.role, '修订预算已用尽，资源不发布，进入人工复核。');
    return 'rejected';
  }
  return 'released';
}

/** 修订/放行后，把不再执行的 privacy/finalize 行如实标记 skipped（保持 DAG 视图诚实） */
async function skipStaleChainNodes(run: StudyRunRow, attempts: number[], keys: RunNodeKey[] = ['privacy.compliance', 'finalize.publish']): Promise<void> {
  if (attempts.length === 0) return;
  const rows = await listRunNodes(run.id);
  for (const row of rows) {
    if (keys.includes(row.nodeKey) && attempts.includes(row.attempt) && (row.status === 'pending' || row.status === 'running')) {
      await setNodeStatus(run.id, row.nodeKey, row.attempt, 'skipped', { errorMessage: '修订轮绕过本轮下游' });
    }
  }
}

/** 修订轮：为生成及其下游门禁创建 attempt+1 的节点行（新轮次新产物，不覆盖旧轮） */
async function createRevisionNodes(run: StudyRunRow, nextAttempt: number): Promise<void> {
  const chain: RunNodeKey[] = ['generate.resource', 'audit.claims', 'debate.challenge', 'adjudicate.verdict', 'privacy.compliance', 'finalize.publish'];
  await runDb().insert(studyRunNodes).values(chain.map((key) => ({
    id: `${run.id}:${key}:${nextAttempt}`,
    runId: run.id,
    nodeKey: key,
    role: run.plan.nodes.find((node) => node.key === key)?.role ?? ('cross_validation' as LearningAgentId),
    actorKey: NODE_ACTOR_KEY[key],
    attempt: nextAttempt,
    status: 'pending' as const,
    mandatory: true,
  }))).onConflictDoNothing();
}

async function runPrivacyCompliance(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const reference = run.request.temporaryReference;
  if (reference) {
    const { createHash } = await import('node:crypto');
    await runDb().insert(privacyAuditEvents).values({
      id: `privacy-${randomUUID()}`,
      learnerId: run.learnerId,
      sessionId: `study-run-${run.id}`,
      eventType: 'temporary_reference_used',
      fileName: reference.name.slice(0, 160),
      byteCount: Buffer.byteLength(reference.content, 'utf8'),
      contentHash: createHash('sha256').update(reference.content).digest('hex'),
      redactedFieldsJson: [],
      retained: false,
      createdAt: Date.now(),
    });
  }
  // VACP：临时上传正文不得进入 artifact，只保存文件名、字节数、散列与审计结论
  await persistNodeArtifact(run, node, attempt, 'privacy_decision', {
    temporaryReferenceUsed: Boolean(reference),
    fileName: reference ? reference.name.slice(0, 160) : null,
    byteCount: reference ? Buffer.byteLength(reference.content, 'utf8') : 0,
    contentHash: reference ? sha256(reference.content) : null,
    retained: false,
    bodyStored: false,
  }, {
    observations: [reference ? `使用了上传的临时参考《${reference.name.slice(0, 60)}》` : '未检测到上传资料'],
    basisRefs: [],
    decision: reference ? '临时参考仅用于当前任务，原文不保存、不入知识库' : '无隐私边界问题',
    uncertainty: [],
    nextAction: '移交发布收尾',
  }, ['adjudicate.verdict'], RULE_PRODUCER);
  await bubble(run, node.role, reference
    ? `本次使用了上传的临时参考《${reference.name}》：仅用于当前任务，不写入知识库、不进入画像，原文不保存。`
    : '未检测到上传资料，无隐私边界问题。');
  return reference ? '临时参考已审计，正文未保存' : '无隐私边界问题';
}

async function runFinalizePublish(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const draft = ctx.draft;
  const merged = ctx.merged_pack;
  const adjudication = ctx.adjudication;
  const released = adjudication?.released === true && Boolean(draft) && Boolean(merged);
  let finalAssetId: string | null = null;
  if (released && draft && merged) {
    const audited: ResourceDocument = { ...draft, evidencePackId: merged.id, auditSummary: ctx.audit?.summary, auditStatus: 'passed' };
    await learningStore.saveAsset(run.learnerId, undefined, audited);
    finalAssetId = audited.id;
  }
  await persistNodeArtifact(run, node, attempt, 'publication_decision', {
    released,
    finalAssetId,
    verdict: adjudication?.verdict ?? 'unsupported',
    revisionRound: attempt,
    evidenceCount: merged?.items.length ?? 0,
    claimCount: ctx.audit?.claims.length ?? 0,
  }, {
    observations: [
      `发布门禁结果：${released ? '通过' : '未通过'}`,
      `裁决结论 ${adjudication?.verdict ?? 'unsupported'}`,
    ],
    basisRefs: [
      artifactIdOf(run.id, 'adjudicate.verdict', attempt, 'adjudication'),
      artifactIdOf(run.id, 'privacy.compliance', attempt, 'privacy_decision'),
    ],
    decision: finalAssetId ? `《${draft!.title}》已通过全部门禁并入库` : '资源未通过发布门禁，不入库',
    uncertainty: finalAssetId ? [] : ['门禁未通过：资源标记 manual_review_required'],
    nextAction: finalAssetId ? '等待学习者阅读与作答反馈' : '建议补充更具体的任务关键词后重试',
  }, ['adjudicate.verdict', 'privacy.compliance', 'generate.resource'], RULE_PRODUCER);
  // VACP：运行收尾固化全部产物散列清单与 generation_end 学情快照
  await setRunExecutionManifestHash(run.id, await computeExecutionManifestHash(run.id));
  await saveRunSnapshot({
    runId: run.id,
    learnerId: run.learnerId,
    snapshotType: 'generation_end',
    pathNodeId: run.request.pathNodeId,
  });
  await learningStore.saveChatMessage(run.learnerId, 'assistant', finalAssetId ? `已生成《${draft!.title}》` : `《${draft?.title ?? '资源'}》待复核，未入库`, {
    surface: 'study', kind: 'asset', runId: run.id,
    pathNodeId: run.request.pathNodeId, resourceType: run.request.resourceType,
    asset: finalAssetId
      ? { id: draft!.id, title: draft!.title, type: draft!.type, auditStatus: 'passed', persisted: true }
      : { id: draft?.id ?? '', title: draft?.title ?? '资源', type: run.request.resourceType, auditStatus: 'manual_review_required', persisted: false },
    evidence: { count: merged?.items.length ?? 0, score: merged?.coverageScore ?? 0, crossValidation: ctx.audit?.summary.status ?? 'unsupported' },
  });
  await learningStore.recordLearningEvent(run.learnerId, 'study_run_completed', {
    runId: run.id, pathNodeId: run.request.pathNodeId, resourceType: run.request.resourceType,
    persisted: Boolean(finalAssetId), evidenceCount: merged?.items.length ?? 0,
    claims: ctx.audit?.claims.length ?? 0, verdict: adjudication?.verdict ?? 'unsupported',
  });
  await bubble(run, 'cross_validation', finalAssetId
    ? '发布门禁通过，资源已入库，可前往「资源」页阅读。'
    : '本次协同未产出已审核资产（发布门禁未通过），建议补充更具体的设备数据关键词再试。');
  await finishRun(run.id, 'succeeded', finalAssetId ? { finalAssetId } : {});
  await emitEvent(run, null, 'run.succeeded', finalAssetId
    ? `协同完成：《${draft!.title}》已通过全部门禁并入库。`
    : '协同完成：资源未通过发布门禁，未入库。', { finalAssetId, verdict: adjudication?.verdict });
  return finalAssetId ? `已发布《${draft!.title}》` : '未发布（门禁未通过）';
}

async function executeNode(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  switch (node.key) {
    case 'assess.learner': return runAssessLearner(run, node, attempt);
    case 'retrieve.structured': return retrieveEvidence(run, node, attempt, ['structured']);
    case 'retrieve.document': return retrieveEvidence(run, node, attempt, ['document']);
    case 'analyze.domain': return runAnalyzeDomain(run, node, attempt);
    case 'generate.resource': return runGenerateResource(run, node, attempt);
    case 'audit.claims': return runAuditClaims(run, node, attempt);
    case 'debate.challenge': return runDebateChallenge(run, node, attempt);
    case 'adjudicate.verdict': return runAdjudicate(run, node, attempt).then((outcome) => `裁决 ${outcome}`);
    case 'privacy.compliance': return runPrivacyCompliance(run, node, attempt);
    case 'finalize.publish': return runFinalizePublish(run, node, attempt);
    default: {
      const unknown: never = node.key;
      throw new Error(`未知节点：${unknown}`);
    }
  }
}

/* ----------------------------- 调度 ----------------------------- */

function planNodeOf(plan: StudyRunPlan, key: RunNodeKey): RunNodeSpec {
  const node = plan.nodes.find((item) => item.key === key);
  if (!node) throw new Error(`计划缺少节点 ${key}`);
  return node;
}

/** 最新一轮节点视图：同节点取 attempt 最大的一行 */
function latestNodes(rows: StudyRunNodeRow[]): Map<RunNodeKey, StudyRunNodeRow> {
  const latest = new Map<RunNodeKey, StudyRunNodeRow>();
  for (const row of rows) {
    const current = latest.get(row.nodeKey);
    if (!current || row.attempt > current.attempt) latest.set(row.nodeKey, row);
  }
  return latest;
}

/** 依赖按 run.plan 判定（custom 裁剪后依赖已闭合）；返回就绪的 pending 节点 */
function readyNodes(run: StudyRunRow, rows: StudyRunNodeRow[]): StudyRunNodeRow[] {
  const latest = latestNodes(rows);
  const statusOf = (key: RunNodeKey): StudyRunNodeRow['status'] | null => latest.get(key)?.status ?? null;
  return rows.filter((row) => {
    if (row.status !== 'pending' || row.attempt !== latest.get(row.nodeKey)?.attempt) return false;
    const deps = planNodeOf(run.plan, row.nodeKey).dependsOn;
    return deps.every((dep) => statusOf(dep) === 'succeeded');
  });
}

async function scheduleNext(run: StudyRunRow): Promise<void> {
  const rows = await listRunNodes(run.id);
  for (const row of readyNodes(run, rows)) {
    await enqueueRunNode(run.id, row.nodeKey, row.attempt);
  }
}

/** 终局节点之后无下游；兜底把仍 pending 的节点标记 skipped */
async function skipRemaining(run: StudyRunRow, reason: string): Promise<void> {
  const rows = await listRunNodes(run.id);
  for (const row of rows) {
    if (row.status === 'pending' || row.status === 'running') {
      await setNodeStatus(run.id, row.nodeKey, row.attempt, 'skipped', { errorMessage: reason });
    }
  }
}

/* ----------------------------- 入口 ----------------------------- */

export async function processStudyRunNode(job: Job<{ runId: string; nodeKey: string; attempt: number }>): Promise<void> {
  const runId = job.data.runId;
  const nodeKey = job.data.nodeKey as RunNodeKey;
  const attempt = job.data.attempt;
  const run = await getRunById(runId);
  if (!run) throw new Error(`运行不存在：${runId}`);
  const node = planNodeOf(run.plan, nodeKey);
  const nodeRow = await getNodeRow(runId, nodeKey, attempt);
  if (!nodeRow) throw new Error(`节点行不存在：${nodeKey}@${attempt}`);
  if (nodeRow.status === 'succeeded') return; // 幂等：已完成不重复执行

  if (run.status === 'cancelled' || run.cancelRequested) {
    await skipRemaining(run, '运行已取消');
    await finishRun(runId, 'cancelled');
    await emitEvent(run, null, 'run.cancelled', '运行已被学习者取消，全部未完成节点停止执行。');
    return;
  }

  await markRunRunning(runId);
  await setNodeStatus(runId, nodeKey, attempt, 'running');
  await emitEvent(run, node, 'node.started', `${NODE_TITLES[nodeKey]} 开始执行。`);

  let summary: string;
  try {
    summary = await withTimeout(executeNode(run, node, attempt), node.timeoutMs, `${NODE_TITLES[nodeKey]} 执行超时`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const attempts = job.opts.attempts ?? 1;
    const started = Math.max(job.attemptsMade ?? 0, job.attemptsStarted ?? 1);
    if (started < attempts) {
      await emitEvent(run, node, 'node.retrying', `${NODE_TITLES[nodeKey]} 失败，将重试：${message.slice(0, 120)}`);
      throw error; // BullMQ 按退避策略重试同一 jobId
    }
    await setNodeStatus(runId, nodeKey, attempt, 'failed', { errorMessage: message.slice(0, 500) });
    await emitEvent(run, node, 'node.failed', `${NODE_TITLES[nodeKey]} 最终失败：${message.slice(0, 160)}`, { nodeKey });
    await bubble(run, node.role, `执行中断：${message.slice(0, 160)}。请重试，或换个更具体的任务描述。`);
    await skipRemaining(run, `上游 ${nodeKey} 失败`);
    await finishRun(runId, 'failed');
    await emitEvent(run, null, 'run.failed', `运行失败：${NODE_TITLES[nodeKey]} 无法完成。`);
    return;
  }

  await setNodeStatus(runId, nodeKey, attempt, 'succeeded', { resultSummary: summary.slice(0, 500) });
  await emitEvent(run, node, 'node.succeeded', `${NODE_TITLES[nodeKey]} 完成：${summary}`, { nodeKey });

  const fresh = await getRunById(runId);
  if (!fresh || fresh.status === 'cancelled' || fresh.cancelRequested) {
    if (fresh) {
      await skipRemaining(fresh, '运行已取消');
      await finishRun(runId, 'cancelled');
      await emitEvent(fresh, null, 'run.cancelled', '运行已被学习者取消。');
    }
    return;
  }
  // finalize.publish 内部已收尾运行；其余节点推进调度
  if (nodeKey === 'finalize.publish') return;

  if (nodeKey === 'adjudicate.verdict') {
    const ctx = contextOf(fresh);
    const outcome = ctx.adjudication?.outcome;
    if (outcome === 'revised') {
      // 修订轮已由裁决节点直接入队 generate.resource@nextAttempt；这里不得
      // skipRemaining（历史缺陷：修订链刚建即被跳过，运行被错误收尾为 succeeded）
      return;
    }
    if (ctx.adjudication?.released || outcome === undefined) {
      if (attempt > 1) {
        // 修订轮放行后清理此前轮次遗留的下游节点行
        await skipStaleChainNodes(fresh, Array.from({ length: attempt - 1 }, (_, index) => index + 1));
      }
      await enqueueRunNode(runId, 'privacy.compliance', attempt);
    } else {
      // 修订预算用尽：同样固化发布决定与收尾快照（fail closed 也要有完整审计链）
      await persistArtifact({
        runId,
        learnerId: fresh.learnerId,
        nodeKey: 'finalize.publish',
        attempt,
        artifactType: 'publication_decision',
        inputRefs: await upstreamArtifactRefs(runId, ['adjudicate.verdict']),
        payload: { released: false, finalAssetId: null, verdict: ctx.adjudication?.verdict ?? 'unsupported', revisionRound: attempt, reason: 'revision_budget_exhausted' },
        publicRationale: {
          observations: [`修订预算（${REVISION_BUDGET} 轮）已用尽`],
          basisRefs: [artifactIdOf(runId, 'adjudicate.verdict', attempt, 'adjudication')],
          decision: '资源不发布，进入人工复核',
          uncertainty: [],
          nextAction: '建议补充更具体的任务关键词后重试',
        },
        producer: RULE_PRODUCER,
      });
      await setNodePrimaryArtifact(runId, 'finalize.publish', attempt, artifactIdOf(runId, 'finalize.publish', attempt, 'publication_decision'));
      await setRunExecutionManifestHash(runId, await computeExecutionManifestHash(runId));
      await saveRunSnapshot({ runId, learnerId: fresh.learnerId, snapshotType: 'generation_end', pathNodeId: fresh.request.pathNodeId });
      await skipRemaining(fresh, '修订预算已用尽，未放行');
      await finishRun(runId, 'succeeded');
      await emitEvent(fresh, null, 'run.succeeded', '协同完成：修订预算用尽，资源未通过发布门禁，未入库。', { verdict: ctx.adjudication?.verdict ?? 'unsupported' });
    }
    return;
  }
  await scheduleNext(fresh);
}
