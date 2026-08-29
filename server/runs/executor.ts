/**
 * StudyRun 节点执行器（docs/挑战杯技术开发总规.md §4.3、§5.2）
 * - learnerId 以 PostgreSQL study_runs 记录为准，队列消息不作为授权依据；
 * - 每个节点把公开摘要写入 run_events（SSE）与学习页群聊（回放），不输出思维链；
 * - Claim/质询/裁决逐轮落 claims / debate_issues / audit_decisions，修订最多 2 次；
 * - 节点依赖以 run.plan 为准（custom 裁剪后依赖已闭合），中间产物存 context_json。
 */
import { randomUUID } from 'node:crypto';
import type { Job } from 'bullmq';
import { auditResource, type ClaimAuditRecord } from '../../src/learning/audit.js';
import { crossValidate } from '../../src/learning/evidence.js';
import { calibrateDifficulty, type DifficultyCalibration, type ScaffoldStrength } from '../../src/learning/difficulty.js';
import { normalizeKnowledgePointId } from '../../src/learning/store.js';
import { buildLlmResourceDocument, buildResourceDraft } from '../../src/learning/resource-builder.js';
import type { EvidencePack, LearningResourceType, ResourceDocument } from '../../src/learning/types.js';
import { evidenceService, learningStore } from '../study-context.js';
import { getAgentExecutionSettings, multiModelClient, parseJson, withTimeout } from '../study-runtime.js';
import { getLearningDatabase } from '../db/client.js';
import {
  auditDecisions,
  claimEvidence,
  claims as claimsTable,
  debateIssues,
  privacyAuditEvents,
  studyRunNodes,
} from '../db/schema.js';
import { enqueueRunNode } from './queue.js';
import {
  appendRunEvent,
  finishRun,
  getNodeRow,
  getRunById,
  listRunNodes,
  markRunRunning,
  mergeRunContext,
  setNodeStatus,
  setRunRevisionRound,
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
  adjudication?: { verdict: string; released: boolean; round: number };
  revision_failed?: Array<{ text: string; critique: string }>;
}

function contextOf(run: StudyRunRow): RunContext {
  return run.context as RunContext;
}

function runDb() {
  return getLearningDatabase().db;
}

async function callAgent(agentId: LearningAgentId, system: string, user: string, maxTokens = 1600): Promise<string> {
  const route = getAgentExecutionSettings(agentId, undefined, undefined);
  const response = await withTimeout(
    multiModelClient.simple({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(route.thinking.maxTokens, maxTokens),
    }),
    30_000,
    '模型调用超时',
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

function evidenceDigest(pack: EvidencePack | null): unknown {
  if (!pack) return [];
  return pack.items.slice(0, 10).map((item) => ({
    title: item.sourceTitle,
    locator: item.locator,
    content: item.content.slice(0, 240),
  }));
}

async function pathNodeOf(run: StudyRunRow) {
  if (!run.request.pathNodeId) return null;
  const graph = await learningStore.getPathGraph(run.learnerId);
  return graph.nodes.find((node) => node.id === run.request.pathNodeId) ?? null;
}

/** 脚手架强度按资源类型：讲义/实操/卡片/图谱高，习题中，挑战任务低（总规 §7.2） */
function scaffoldOfType(type: LearningResourceType): ScaffoldStrength {
  if (type === 'tiered_quiz') return 'medium';
  if (type === 'challenge_task') return 'low';
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

async function runAssessLearner(run: StudyRunRow, node: RunNodeSpec): Promise<string> {
  const profile = await learningStore.getProfile(run.learnerId);
  const pathNode = await pathNodeOf(run);
  const taskLabel = run.request.task.slice(0, 60);
  let analysis = '';
  let requirements: string[] = [];
  try {
    const raw = await callAgent('learning_planning',
      '你是学习协同中的“学情与路径智能体”。只输出 JSON：{"analysis":"不超过120字的第一人称分析：你看到了什么学习状态，因此本次资源如何定位","requirements":["3到5条对本次资源的具体设计要求"]}。禁止虚构任何数据或作答记录。',
      JSON.stringify({
        node: pathNode ? { title: pathNode.title, description: pathNode.description, recommendation: pathNode.recommendation } : null,
        profile: { accuracy: profile.accuracy, studyMinutes: profile.studyMinutes, assetsCount: profile.assetsCount, skills: profile.skills.slice(0, 6) },
        task: { resourceType: run.request.resourceType, content: taskLabel },
      }));
    const parsed = parseJson<{ analysis?: unknown; requirements?: unknown }>(raw) ?? {};
    analysis = typeof parsed.analysis === 'string' ? parsed.analysis.slice(0, 300) : '';
    requirements = Array.isArray(parsed.requirements) ? parsed.requirements.map((item) => String(item).slice(0, 80)).filter(Boolean).slice(0, 5) : [];
  } catch { /* 回退确定性文案 */ }
  if (!analysis || requirements.length === 0) {
    analysis = `我先核对了你的学习状态：累计学习 ${profile.studyMinutes} 分钟，正确率 ${profile.accuracy === null || profile.accuracy === undefined ? '暂无' : `${Math.round(profile.accuracy * 100)}%`}。本次任务围绕「${taskLabel}」展开：先把概念讲准，再配合真实数据摘录。`;
    requirements = ['从学习者当前水平切入，不跳步', '引用证据中的数据并保留定位', '明确结论边界与不确定处'];
  }
  await mergeRunContext(run.id, { assess: { analysis, requirements } });
  await bubble(run, node.role, `${analysis}\n设计要求：\n${requirements.map((item) => `- ${item}`).join('\n')}`);
  return analysis.slice(0, 120);
}

async function retrieveEvidence(run: StudyRunRow, node: RunNodeSpec, plan: Array<'structured' | 'document'>): Promise<string> {
  const pack = await evidenceService.buildEvidencePack(run.request.task, {
    learnerId: run.learnerId,
    sessionId: `study-run-${run.id}`,
    retrievalPlan: plan,
  });
  await mergeRunContext(run.id, plan.includes('structured') ? { ev_structured: pack } : { ev_document: pack });
  if (plan.includes('structured')) {
    await bubble(run, node.role,
      `完成结构化检索：取回 ${pack.items.length} 条数据证据，可回溯定位如：${pack.items[0]?.locator ?? '无'}。`);
    return `结构化证据 ${pack.items.length} 条`;
  }
  // 混合检索降级上报（总规 §7.5）：向量路不可用时如实展示，不静默
  if (pack.hybrid?.degraded) {
    const reasonText = pack.hybrid.reason === 'embed_failed' ? '查询向量生成失败' : pack.hybrid.reason === 'vector_query_failed' ? '向量查询异常' : '库内暂无向量';
    await emitEvent(run, node, 'node.progress', `混合检索降级：${reasonText}，已回退全文检索。`, { hybrid: pack.hybrid });
    await bubble(run, node.role, `注意：向量检索暂不可用（${reasonText}），文档证据已降级为全文检索，不影响门禁流程。`);
  }
  await bubble(run, node.role, pack.items.length > 0
    ? `完成文档检索：按相关度命中 ${pack.items.length} 份资料，最相关《${pack.items[0]?.sourceTitle ?? ''}》${pack.items[0]?.locator ? `（${pack.items[0].locator}）` : ''}。`
    : '文档检索未命中可用资料，将提示生成端只依赖结构化数据并保守表达。');
  return `文档证据 ${pack.items.length} 条`;
}

async function runAnalyzeDomain(run: StudyRunRow, node: RunNodeSpec): Promise<string> {
  const ctx = contextOf(run);
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  if (merged) await mergeRunContext(run.id, { merged_pack: merged });
  let points: string[] = [];
  let boundaries: string[] = [];
  try {
    const raw = await callAgent('domain_expert',
      '你是“领域诊断智能体”，负责设备数据分析领域的专业准确性。只输出 JSON：{"points":["3到5条讲解要点"],"boundaries":["2到3条必须强调的专业边界或不确定性提醒"]}。要点与边界必须能在给定证据中找到依据，禁止编造阈值或数据。',
      JSON.stringify({ task: run.request.task, evidence: evidenceDigest(merged) }));
    const parsed = parseJson<{ points?: unknown; boundaries?: unknown }>(raw) ?? {};
    points = Array.isArray(parsed.points) ? parsed.points.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 5) : [];
    boundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 3) : [];
  } catch { /* 回退确定性文案 */ }
  if (points.length === 0) {
    points = ['先解释关键字段含义与观察方法', '用证据中的数据示例说明判断依据'];
    boundaries = ['数据异常只支持风险判断，不等于确定故障', '结论需保留现场复核建议'];
  }
  await mergeRunContext(run.id, { domain: { points, boundaries } });
  await bubble(run, node.role, `讲解要点：\n${points.map((item) => `- ${item}`).join('\n')}\n专业边界：\n${boundaries.map((item) => `- ${item}`).join('\n')}`);
  return `${points.length} 个要点、${boundaries.length} 条边界`;
}

const RESOURCE_TYPE_LABELS: Record<string, string> = {
  lecture: '讲义', tiered_quiz: '分层习题', practice_guide: '实操指南',
  concept_map: '知识图谱', review_cards: '复习卡片', challenge_task: '挑战任务',
};

async function runGenerateResource(run: StudyRunRow, node: RunNodeSpec, attempt: number): Promise<string> {
  const ctx = contextOf(run);
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  const assess = ctx.assess ?? { analysis: '', requirements: ['从学习者当前水平切入，不跳步'] };
  const domain = ctx.domain ?? { points: [], boundaries: [] };
  const pathNode = await pathNodeOf(run);
  const typeLabel = RESOURCE_TYPE_LABELS[run.request.resourceType] ?? '讲义';
  const isRevision = attempt > 1;
  const llmEligible = run.request.resourceType === 'lecture' || run.request.resourceType === 'practice_guide';
  const calibration = await calibrateForLearner(run, pathNode, run.request.resourceType);

  let generated: ResourceDocument | null = null;
  let note = '';
  if (llmEligible) {
    const prompt = isRevision
      ? `你是“个性化资源生成智能体”。审核退回了${typeLabel}初稿中无法与证据核对的内容。只输出修订后的 JSON：{"title":"资源标题","objectives":["2到3条学习目标"],"sections":[{"heading":"小节标题","text":"150到260字的正文"}]}。要求：保持其余内容不变；被退回的表述要么改成与证据一致的数字，要么删除数字改为定性描述；仍禁止编造证据之外的阈值。`
      : `你是“个性化资源生成智能体”，为学习者生成${typeLabel}。只输出 JSON：{"title":"资源标题","objectives":["2到3条学习目标"],"sections":[{"heading":"小节标题","text":"150到260字的正文"}]}，sections 给 2 到 4 个。要求：融合给定证据；引用数字必须与证据一致；面向初学者；禁止编造证据之外的阈值或结论。`;
    const payload = isRevision
      ? { failedClaims: ctx.revision_failed ?? [], designRequirements: assess.requirements, evidence: evidenceDigest(merged) }
      : { designRequirements: assess.requirements, domainPoints: domain.points, domainBoundaries: domain.boundaries, evidence: evidenceDigest(merged) };
    try {
      const raw = await callAgent('resource_generation', prompt, JSON.stringify(payload), 2400);
      const parsed = parseJson<{ title?: unknown; objectives?: unknown; sections?: unknown }>(raw);
      const sections = parsed && Array.isArray(parsed.sections) ? parsed.sections.flatMap((item) => {
        const section = item as { heading?: unknown; text?: unknown };
        return typeof section.heading === 'string' && typeof section.text === 'string' ? [{ heading: section.heading, text: section.text }] : [];
      }) : [];
      if (parsed && typeof parsed.title === 'string' && sections.length >= 2) {
        generated = buildLlmResourceDocument(`study-${run.id}-${attempt}`, run.request.task, run.request.resourceType, merged, pathNode?.knowledgePointId, {
          title: parsed.title,
          objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map((item) => String(item)) : [],
          sections,
        }, { calibration });
      }
    } catch { /* 模板兜底 */ }
    if (!generated) {
      generated = buildResourceDraft(`study-${run.id}-${attempt}`, run.request.task, run.request.resourceType, merged, pathNode?.knowledgePointId, { calibration });
      note = isRevision ? '修订轮使用内置结构模板保证可追溯。' : '生成模型不可用，已使用内置结构模板。';
    }
  } else {
    generated = buildResourceDraft(`study-${run.id}-${attempt}`, run.request.task, run.request.resourceType, merged, pathNode?.knowledgePointId, { calibration });
    note = '该资源类型使用结构化模板生成，证据引用保持可回溯。';
  }
  const resource = generated;
  await mergeRunContext(run.id, { draft: resource });
  await bubble(run, node.role,
    `${isRevision ? `第 ${attempt} 轮修订完成` : '初稿完成'}：《${resource.title}》，共 ${resource.blocks.length} 个内容块（含代码示例与数据摘录）。${note || '已融入证据引用，交由审核。'}`);
  return `草稿《${resource.title}》共 ${resource.blocks.length} 块`;
}

async function runAuditClaims(run: StudyRunRow, node: RunNodeSpec): Promise<string> {
  const ctx = contextOf(run);
  const draft = ctx.draft;
  const merged = ctx.merged_pack ?? await mergeEvidencePacks(ctx, run.request.task);
  if (!draft) throw new Error('缺少草稿，无法执行 Claim 审核');
  const result = auditResource(draft, merged);
  await learningStore.saveResourceAudit(draft.id, result.claims);
  await persistClaims(run, result.claims);
  await mergeRunContext(run.id, { audit: { claims: result.claims, summary: result.summary } });
  const supported = result.claims.filter((claim) => claim.verdict === 'supported').length;
  const review = result.claims.filter((claim) => claim.verdict === 'review').length;
  const unsupported = result.claims.filter((claim) => claim.verdict === 'unsupported').length;
  await bubble(run, node.role,
    `逐条核对 ${result.claims.length} 条内容声明：支持 ${supported}、待复核 ${review}、无证据支持 ${unsupported}。来源交叉验证：${result.summary.status === 'corroborated' ? '结构化数据与领域文档互证通过' : '来源单一，需保守表达'}。`);
  return `Claim 审核 ${result.claims.length} 条（支持 ${supported}/待复核 ${review}/无证据 ${unsupported}）`;
}

async function persistClaims(run: StudyRunRow, items: ClaimAuditRecord[]): Promise<void> {
  if (items.length === 0) return;
  await runDb().insert(claimsTable).values(items.map((claim) => ({
    id: `${run.id}:${claim.id}`,
    resourceId: run.id,
    learnerId: run.learnerId,
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
  issueType: 'no_evidence' | 'conflict' | 'out_of_scope_causality' | 'difficulty_mismatch';
  targetClaimId: string | null;
  argument: string;
  source: 'rule' | 'critic';
};

/** 独立批评 Agent（总规 §5.2 升级）：LLM 从反方立场逐条审查草稿；失败返回空，规则兜底不受影响 */
async function criticAgentIssues(run: StudyRunRow, audit: NonNullable<RunContext['audit']>): Promise<DebateIssueInput[]> {
  const ctx = contextOf(run);
  const draft = ctx.draft;
  const merged = ctx.merged_pack;
  if (!draft) return [];
  const focus = run.plan.challengeFocus;
  try {
    const raw = await callAgent('cross_validation',
      '你是独立批评智能体（反方），只负责挑错，不负责修改。只输出 JSON：{"issues":[{"issueType":"no_evidence|conflict|out_of_scope_causality|difficulty_mismatch","targetClaimId":"对应声明的 id 或 null","argument":"不超过80字的具体批评"}]}。审查维度：no_evidence=声明在证据里找不到支持；conflict=声明数字或结论与证据冲突；out_of_scope_causality=把数据异常写成了越界的确定性因果；difficulty_mismatch=内容难度与学习者状态不匹配。只在确有问题时列出，最多 4 条，没有问题就输出空数组。',
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
      }), 1200);
    const parsed = parseJson<{ issues?: unknown }>(raw) ?? {};
    if (!Array.isArray(parsed.issues)) return [];
    const allowed = new Set(['no_evidence', 'conflict', 'out_of_scope_causality', 'difficulty_mismatch']);
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

async function runDebateChallenge(run: StudyRunRow, node: RunNodeSpec): Promise<string> {
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
  await bubble(run, node.role,
    issues.length > 0
      ? `质询提出 ${issues.length} 个议题（规则 ${issues.length - criticIssues.length} 条、批评 Agent 补充 ${criticIssues.length} 条：无证据 ${issues.filter((issue) => issue.issueType === 'no_evidence').length}、冲突 ${issues.filter((issue) => issue.issueType === 'conflict').length}、越界因果 ${issues.filter((issue) => issue.issueType === 'out_of_scope_causality').length}、难度适配 ${issues.filter((issue) => issue.issueType === 'difficulty_mismatch').length}）。无法核对或越界的表述将被从严裁决。`
      : '质询（含独立批评 Agent）未发现无证据、冲突或越界表述，提交裁决确认。');
  return `反方质询 ${issues.length} 个议题`;
}

const VERDICT_SEVERITY: Record<string, number> = { supported: 0, partial: 1, conflict: 2, unsupported: 3 };

/** 裁决 Agent（总规 §5.2 升级）：LLM 独立给出整体判决；失败返回 null，规则兜底不受影响 */
async function adjudicatorAgentVerdict(run: StudyRunRow, audit: NonNullable<RunContext['audit']>): Promise<{ verdict: 'supported' | 'partial' | 'conflict' | 'unsupported'; rationale: string } | null> {
  try {
    const raw = await callAgent('cross_validation',
      '你是证据裁决智能体（裁判），在反方质询后给出整体判决。只输出 JSON：{"verdict":"supported|partial|conflict|unsupported","rationale":"不超过80字的公开判决理由"}。判据：全部实质性声明都有证据支持且来源互证=supported；存在待复核表述=partial；证据之间存在冲突=conflict；存在无证据支持的实质性结论=unsupported。你的判决只能基于给定材料。',
      JSON.stringify({
        claims: audit.claims.map((claim) => ({ id: claim.id, text: claim.text.slice(0, 140), verdict: claim.verdict })),
        crossValidation: audit.summary,
        challengeFocus: run.plan.challengeFocus,
        strictAdjudication: run.plan.strictAdjudication,
      }), 800);
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
  const unsupported = audit.claims.filter((claim) => claim.verdict === 'unsupported').length;
  const review = audit.claims.filter((claim) => claim.verdict === 'review').length;
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
  const strict = run.plan.strictAdjudication;
  const released = verdict === 'supported' || (verdict === 'partial' && !strict);
  await runDb().insert(auditDecisions).values({
    id: `${run.id}:decision-${randomUUID()}`,
    runId: run.id,
    resourceId: run.id,
    round: attempt,
    verdict,
    rationale: `规则裁决 ${ruleVerdict}；裁决 Agent ${agent ? agent.verdict : '不可用（回退规则）'}；${agent ? agent.rationale : ''}支持 ${audit.claims.length - review - unsupported}/${audit.claims.length}，待复核 ${review}，无证据 ${unsupported}；交叉验证 ${summaryStatus}${strict ? '；知识风险高，partial 亦不放行' : ''}`.slice(0, 900),
    released,
    createdAt: Date.now(),
  });
  await mergeRunContext(run.id, { adjudication: { verdict, released, round: attempt } });
  await bubble(run, node.role,
    `第 ${attempt} 轮裁决：${verdict}（规则 ${ruleVerdict}${agent ? `；裁决 Agent ${agent.verdict}` : '；裁决 Agent 不可用，按规则执行'}）。${released ? '通过发布门禁。' : '未通过发布门禁。'}`);

  if (!released) {
    if (attempt <= REVISION_BUDGET) {
      const nextAttempt = attempt + 1;
      await setRunRevisionRound(run.id, attempt);
      await mergeRunContext(run.id, {
        revision_failed: audit.claims
          .filter((claim) => claim.verdict !== 'supported')
          .map((claim) => ({ text: claim.text.slice(0, 160), critique: claim.critique })),
      });
      await createRevisionNodes(run, nextAttempt);
      await emitEvent(run, node, 'run.revision', `第 ${attempt} 轮未通过，退回生成端修订（第 ${nextAttempt} 轮）。`, { verdict, nextAttempt });
      await bubble(run, node.role, `已退回资源生成智能体修订 ${audit.claims.filter((claim) => claim.verdict !== 'supported').length} 处内容。`);
      await enqueueRunNode(run.id, 'generate.resource', nextAttempt);
      return 'revised';
    }
    await emitEvent(run, node, 'run.revision', `修订预算（${REVISION_BUDGET} 轮）已用尽，资源标记为人工复核，不发布。`, { verdict });
    await bubble(run, node.role, '修订预算已用尽，资源不发布，进入人工复核。');
    return 'rejected';
  }
  return 'released';
}

/** 修订轮：为生成及其下游门禁创建 attempt+1 的节点行 */
async function createRevisionNodes(run: StudyRunRow, nextAttempt: number): Promise<void> {
  const chain: RunNodeKey[] = ['generate.resource', 'audit.claims', 'debate.challenge', 'adjudicate.verdict', 'privacy.compliance', 'finalize.publish'];
  await runDb().insert(studyRunNodes).values(chain.map((key) => ({
    id: `${run.id}:${key}:${nextAttempt}`,
    runId: run.id,
    nodeKey: key,
    role: run.plan.nodes.find((node) => node.key === key)?.role ?? ('cross_validation' as LearningAgentId),
    attempt: nextAttempt,
    status: 'pending' as const,
    mandatory: true,
  }))).onConflictDoNothing();
}

async function runPrivacyCompliance(run: StudyRunRow, node: RunNodeSpec): Promise<string> {
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
  await bubble(run, node.role, reference
    ? `本次使用了上传的临时参考《${reference.name}》：仅用于当前任务，不写入知识库、不进入画像，原文不保存。`
    : '未检测到上传资料，无隐私边界问题。');
  return reference ? '临时参考已审计，正文未保存' : '无隐私边界问题';
}

async function runFinalizePublish(run: StudyRunRow): Promise<string> {
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
    case 'assess.learner': return runAssessLearner(run, node);
    case 'retrieve.structured': return retrieveEvidence(run, node, ['structured']);
    case 'retrieve.document': return retrieveEvidence(run, node, ['document']);
    case 'analyze.domain': return runAnalyzeDomain(run, node);
    case 'generate.resource': return runGenerateResource(run, node, attempt);
    case 'audit.claims': return runAuditClaims(run, node);
    case 'debate.challenge': return runDebateChallenge(run, node);
    case 'adjudicate.verdict': return runAdjudicate(run, node, attempt).then((outcome) => `裁决 ${outcome}`);
    case 'privacy.compliance': return runPrivacyCompliance(run, node);
    case 'finalize.publish': return runFinalizePublish(run);
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
    if (ctx.adjudication?.released) {
      await enqueueRunNode(runId, 'privacy.compliance', attempt);
    } else {
      await skipRemaining(fresh, '裁决未放行');
      await finishRun(runId, 'succeeded');
      await emitEvent(fresh, null, 'run.succeeded', '协同完成：资源未通过发布门禁，未入库。', { verdict: ctx.adjudication?.verdict ?? 'unsupported' });
    }
    return;
  }
  await scheduleNext(fresh);
}
