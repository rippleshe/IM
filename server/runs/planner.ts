/**
 * 动态 DAG 编排器（docs/挑战杯技术开发总规.md §5）
 *
 * 纯函数：输入运行请求与画像信号，输出 StudyRunPlan。
 * - auto：完整链路，按画像不确定度/知识风险/证据覆盖决定风险等级与门禁强度。
 * - custom：selectedAgentIds 真实裁剪业务节点；审核与合规门禁任何情况下不可移除。
 */
import { isLearningResourceType, type LearningResourceType } from '../../src/learning/types.js';
import { deriveRiskLevelWithTaskRisk } from './policy.js';
import {
  BUSINESS_ROLES,
  MANDATORY_NODE_KEYS,
  MIN_BUSINESS_ROLES,
  NODE_RETRY_LIMIT,
  NODE_TITLES,
  type LearningAgentId,
  type RunNodeKey,
  type RunNodeSpec,
  type RunRiskLevel,
  type StudyRunPlan,
  type StudyRunRequest,
} from './protocol.js';

export class PlanningError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanningError';
  }
}

/** 画像与知识状态信号，全部来源于 PostgreSQL 持久化数据，可审计 */
export interface PlannerSignals {
  /** 画像不确定度：1 - 目标知识点与先修点加权平均置信度（升级计划 §4.7），0~1 */
  profileUncertainty: number;
  /** 知识风险：0.5×近期错误率 + 0.3×先修缺口 + 0.2×掌握不确定性，0~1 */
  knowledgeRisk: number;
  /** 任务事实风险（taskFactRisk 纯函数输出），0~1 */
  taskRisk: number;
  /** 证据覆盖预估（检索前的主题判断） */
  evidenceCoverageHint: 'sparse' | 'normal' | 'rich';
}

const BASE_TIMEOUT_MS = 90_000;
/** 生成节点：推理模型输出长文（含思维段）需要宽松预算 */
const GENERATION_TIMEOUT_MS = 240_000;

interface NodeSeed {
  key: RunNodeKey;
  role: LearningAgentId;
  dependsOn: RunNodeKey[];
  mandatory?: boolean;
  timeoutMs?: number;
}

const NODE_SEEDS: NodeSeed[] = [
  { key: 'assess.learner', role: 'learning_planning', dependsOn: [] },
  { key: 'retrieve.structured', role: 'evidence_retrieval', dependsOn: [] },
  { key: 'retrieve.document', role: 'evidence_retrieval', dependsOn: [] },
  { key: 'analyze.domain', role: 'domain_expert', dependsOn: ['retrieve.structured', 'retrieve.document'] },
  { key: 'generate.resource', role: 'resource_generation', dependsOn: ['analyze.domain', 'assess.learner'], timeoutMs: GENERATION_TIMEOUT_MS },
  { key: 'audit.claims', role: 'cross_validation', dependsOn: ['generate.resource'], mandatory: true },
  { key: 'debate.challenge', role: 'cross_validation', dependsOn: ['audit.claims'], mandatory: true },
  { key: 'adjudicate.verdict', role: 'cross_validation', dependsOn: ['debate.challenge'], mandatory: true },
  { key: 'privacy.compliance', role: 'privacy_compliance', dependsOn: ['adjudicate.verdict'], mandatory: true },
  { key: 'finalize.publish', role: 'cross_validation', dependsOn: ['privacy.compliance'], mandatory: true },
];

function deriveRiskLevel(signals: PlannerSignals): RunRiskLevel {
  return deriveRiskLevelWithTaskRisk(signals, signals.taskRisk);
}

function deriveChallengeFocus(request: StudyRunRequest, signals: PlannerSignals): StudyRunPlan['challengeFocus'] {
  const focus: StudyRunPlan['challengeFocus'] = ['no_evidence', 'conflict', 'out_of_scope_causality'];
  if (signals.profileUncertainty >= 0.5) focus.push('difficulty_mismatch');
  // 临时参考材料不可核验，越界因果风险更高
  if (request.temporaryReference) focus.push('out_of_scope_causality');
  return [...new Set(focus)];
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function normalizePlannerSignals(raw: Partial<PlannerSignals> | undefined): PlannerSignals {
  return {
    profileUncertainty: clamp01(raw?.profileUncertainty ?? 0.5),
    knowledgeRisk: clamp01(raw?.knowledgeRisk ?? 0),
    taskRisk: clamp01(raw?.taskRisk ?? 0),
    evidenceCoverageHint: raw?.evidenceCoverageHint ?? 'normal',
  };
}

export function parseStudyRunRequest(body: unknown): StudyRunRequest {
  if (typeof body !== 'object' || body === null) {
    throw new PlanningError('请求体必须是对象');
  }
  const raw = body as Record<string, unknown>;
  const task = typeof raw['task'] === 'string' ? raw['task'].trim().slice(0, 12_000) : '';
  if (!task) throw new PlanningError('请输入学习任务内容');

  const resourceType = isLearningResourceType(raw['resourceType'])
    ? raw['resourceType'] as LearningResourceType
    : 'lecture';

  const collaborationMode = raw['collaborationMode'] === 'custom' ? 'custom' : 'auto';

  const selectedAgentIds = Array.isArray(raw['selectedAgentIds'])
    ? (raw['selectedAgentIds'] as unknown[]).filter(
        (id): id is LearningAgentId =>
          typeof id === 'string' && (BUSINESS_ROLES as readonly string[]).includes(id),
      )
    : [];

  const temporaryReferenceRaw = raw['temporaryReference'];
  const temporaryReference = temporaryReferenceRaw && typeof temporaryReferenceRaw === 'object'
    ? {
        name: typeof (temporaryReferenceRaw as Record<string, unknown>)['name'] === 'string'
          ? String((temporaryReferenceRaw as Record<string, unknown>)['name']).slice(0, 200)
          : '临时参考资料',
        content: typeof (temporaryReferenceRaw as Record<string, unknown>)['content'] === 'string'
          ? String((temporaryReferenceRaw as Record<string, unknown>)['content']).slice(0, 120_000)
          : '',
      }
    : null;

  const pathNodeId = typeof raw['pathNodeId'] === 'string' && raw['pathNodeId'] ? raw['pathNodeId'] : null;

  const sourceDecisionId = typeof raw['sourceDecisionId'] === 'string' && raw['sourceDecisionId'].trim()
    ? raw['sourceDecisionId'].trim().slice(0, 120)
    : null;

  return { task, pathNodeId, resourceType, collaborationMode, selectedAgentIds, temporaryReference, sourceDecisionId };
}

/**
 * 生成运行计划。
 * custom 模式：selectedAgentIds 决定哪些业务角色真实参与；业务角色少于
 * MIN_BUSINESS_ROLES 或缺少资源生成角色时拒绝；门禁节点永远保留。
 */
export function planStudyRun(runId: string, request: StudyRunRequest, rawSignals?: Partial<PlannerSignals>): StudyRunPlan {
  const signals = normalizePlannerSignals(rawSignals);
  const allowedRoles = new Set<LearningAgentId>(request.selectedAgentIds);

  if (request.collaborationMode === 'custom') {
    if (allowedRoles.size === 0) {
      throw new PlanningError('指定角色模式下至少选择一个业务角色');
    }
    if (!allowedRoles.has('resource_generation')) {
      throw new PlanningError('资源生成角色是产出资源的必要角色，不能取消');
    }
    const businessSelected = BUSINESS_ROLES.filter((role) => allowedRoles.has(role));
    if (businessSelected.length < MIN_BUSINESS_ROLES) {
      throw new PlanningError(`一次运行至少执行 ${MIN_BUSINESS_ROLES} 个业务角色，当前仅选择 ${businessSelected.length} 个`);
    }
  }
  // 门禁角色永远在场：审核与合规不属于可选范围
  allowedRoles.add('cross_validation');
  allowedRoles.add('privacy_compliance');

  const optionalOnly = request.collaborationMode === 'custom';
  const selectedSeeds = NODE_SEEDS
    .filter((seed) => !optionalOnly || seed.mandatory === true || allowedRoles.has(seed.role));
  const selectedKeys = new Set(selectedSeeds.map((seed) => seed.key));
  const nodes: RunNodeSpec[] = selectedSeeds
    .map((seed) => ({
      key: seed.key,
      role: seed.role,
      title: NODE_TITLES[seed.key],
      // 依赖若因角色裁剪被移除，同步从依赖中剔除，保持 DAG 闭合
      dependsOn: seed.dependsOn.filter((dep) => dep !== seed.key && selectedKeys.has(dep)),
      mandatory: seed.mandatory === true,
      retryLimit: NODE_RETRY_LIMIT,
      timeoutMs: seed.timeoutMs ?? BASE_TIMEOUT_MS,
    }));

  const gates = nodes.filter((node) => node.mandatory).map((node) => node.key);
  const plan: StudyRunPlan = {
    runId,
    nodes,
    gates,
    riskLevel: deriveRiskLevel(signals),
    revisionBudget: 2,
    strictAdjudication: signals.knowledgeRisk > 0.5,
    challengeFocus: deriveChallengeFocus(request, signals),
  };
  const problems = validatePlan(plan);
  if (problems.length > 0) throw new PlanningError(problems.join('；'));
  return plan;
}

/** 计划校验：依赖闭合、无环、门禁齐全、业务角色数达标 */
export function validatePlan(plan: StudyRunPlan): string[] {
  const problems: string[] = [];
  const keys = new Set(plan.nodes.map((node) => node.key));
  const gates = plan.nodes.filter((node) => node.mandatory).map((node) => node.key);

  for (const node of plan.nodes) {
    for (const dep of node.dependsOn) {
      if (!keys.has(dep)) problems.push(`节点 ${node.key} 依赖不存在的 ${dep}`);
    }
  }

  // 环检测：三色标记 DFS
  const color = new Map<RunNodeKey, 1 | 2>();
  let hasCycle = false;
  const dfs = (key: RunNodeKey): void => {
    if (hasCycle) return;
    const state = color.get(key);
    if (state === 1) {
      hasCycle = true;
      return;
    }
    if (state === 2) return;
    color.set(key, 1);
    const node = plan.nodes.find((item) => item.key === key);
    node?.dependsOn.forEach(dfs);
    color.set(key, 2);
  };
  keys.forEach(dfs);
  if (hasCycle) problems.push('计划存在循环依赖');

  for (const gate of MANDATORY_NODE_KEYS) {
    if (!gates.includes(gate)) problems.push(`缺少必要门禁 ${gate}`);
  }

  const businessRoles = new Set(
    plan.nodes.filter((node) => BUSINESS_ROLES.includes(node.role)).map((node) => node.role),
  );
  if (businessRoles.size < MIN_BUSINESS_ROLES) {
    problems.push(`业务角色仅 ${businessRoles.size} 个，少于 ${MIN_BUSINESS_ROLES}`);
  }

  if (plan.revisionBudget < 0 || plan.revisionBudget > 2) problems.push('修订预算必须在 0~2 之间');
  return problems;
}
