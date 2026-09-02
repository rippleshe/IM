/**
 * 检索后策略修正（docs/挑战杯技术开发总规.md §5）
 *
 * 两阶段决策的第二阶段：结构化与文档检索完成后，由纯函数根据实际证据产物
 * 修正审核策略。策略只能收紧门禁，不能放松（与总规裁决从严原则一致）。
 * 策略变化追加 plan.amended 事件并写入 policy artifact。
 */
import type { EvidencePack, LearningResourceType } from '../../src/learning/types.js';
import type { RunRiskLevel, StudyRunRequest } from './protocol.js';

/* ----------------------------- 任务事实风险 ----------------------------- */

const NUMERIC_HINTS = [
  '数值', '数字', '阈值', '百分比', '统计', '计算', '相关系数', '均值', '方差', '标准差',
  '准确率', '错误率', '比例', '占比', '多少', '几', '数量', '指标', '读数',
];
const CAUSAL_HINTS = [
  '为什么', '原因', '导致', '引发', '因果', '机理', '故障原因', '诊断结论', '判断故障',
  '必然', '一定', '肯定', '根因', '解释故障', '说明故障',
];
const OPERATIONAL_HINTS = [
  '操作', '步骤', '现场', '维修', '检修', '更换', '停机', '重启', '处置', '排查流程',
  '实操', '处理方法', '规程', '指令',
];

function densityOf(text: string, hints: readonly string[]): number {
  const hits = hints.filter((hint) => text.includes(hint)).length;
  return Math.min(1, hits / 3);
}

export interface TaskFactRisk {
  /** 0~1：越高表示越依赖可核验事实 */
  score: number;
  numericDensity: number;
  causalDensity: number;
  operationalDensity: number;
  reasons: string[];
}

/** 任务事实风险纯函数：数值分析、因果判断与现场操作风险更高（升级计划 §4.7） */
export function taskFactRisk(request: Pick<StudyRunRequest, 'task' | 'resourceType'>): TaskFactRisk {
  const text = request.task.slice(0, 2000);
  const numericDensity = densityOf(text, NUMERIC_HINTS);
  const causalDensity = densityOf(text, CAUSAL_HINTS);
  const operationalDensity = densityOf(text, OPERATIONAL_HINTS);
  const reasons: string[] = [];
  if (numericDensity > 0) reasons.push(`任务含数值/统计类表述（密度 ${numericDensity.toFixed(2)}），数字必须逐条核对`);
  if (causalDensity > 0) reasons.push('任务含因果判断表述，禁止把相关/异常升级为确定故障原因');
  if (operationalDensity > 0) reasons.push('任务含现场操作表述，操作建议必须有证据或标注为通用流程');
  const resourceRisk = request.resourceType === 'tiered_quiz' ? 0.15 : 0;
  const score = Math.min(1, 0.4 * numericDensity + 0.35 * causalDensity + 0.25 * operationalDensity + resourceRisk);
  return { score: Number(score.toFixed(3)), numericDensity, causalDensity, operationalDensity, reasons };
}

/* ----------------------------- 检索后验证策略 ----------------------------- */

export interface VerificationPolicy {
  /** 审核强度：standard = 计划默认；strict = 检索后要求从严；不存在放松档 */
  strength: 'standard' | 'strict';
  /** 证据为空或覆盖低：禁止强事实表达（具体数字/确定性结论） */
  forbidStrongFactualClaims: boolean;
  /** 启动反证/边界检索（不联网，在已有知识库与数据中执行） */
  requireCounterevidenceSearch: boolean;
  /** 数值 Claim 逐条确定性核验 */
  numericVerification: boolean;
  /** 越界因果规则：相关/异常不得直接升级为确定故障原因 */
  causalBoundaryRules: boolean;
  /** 学情置信度低：增加难度适配质询（不增加事实宽松度） */
  difficultyChallenge: boolean;
  /** 数据与文档结论不一致：裁决必须从严 */
  conflictMode: boolean;
  /** 文档向量路降级：如实记录，门禁不减少 */
  degraded: boolean;
  coverageStatus: 'sparse' | 'normal' | 'rich';
  /** 触发策略修正的具体原因；空 = 维持默认 */
  reasons: string[];
  /** true = 与运行前默认策略存在实质差异，需要 plan.amended 事件与 policy artifact */
  amended: boolean;
}

export interface PolicyInput {
  structuredPack: Pick<EvidencePack, 'items' | 'coverageScore' | 'crossValidation'> | null;
  documentPack: Pick<EvidencePack, 'items' | 'coverageScore' | 'crossValidation' | 'hybrid'> | null;
  resourceType: LearningResourceType;
  taskRisk: number;
  /** 目标知识点掌握置信度（0~1；无数据记 0.1） */
  learnerConfidence: number;
  /** 计划阶段已开启的从严裁决 */
  strictAdjudication: boolean;
}

export function defaultVerificationPolicy(strictAdjudication: boolean): VerificationPolicy {
  return {
    strength: strictAdjudication ? 'strict' : 'standard',
    forbidStrongFactualClaims: false,
    requireCounterevidenceSearch: false,
    numericVerification: false,
    causalBoundaryRules: false,
    difficultyChallenge: false,
    conflictMode: false,
    degraded: false,
    coverageStatus: 'normal',
    reasons: [],
    amended: false,
  };
}

/**
 * 依据实际证据产物推导审核策略（纯函数，可单测）。
 * 门禁在任何分支下都不减少：策略只能新增约束。
 */
export function deriveVerificationPolicy(input: PolicyInput): VerificationPolicy {
  const structured = input.structuredPack;
  const document = input.documentPack;
  const itemCount = (structured?.items.length ?? 0) + (document?.items.length ?? 0);
  const coverage = Math.max(structured?.coverageScore ?? 0, document?.coverageScore ?? 0);
  const degraded = Boolean(document?.hybrid?.degraded);
  const conflictDetected = structured?.crossValidation.status === 'conflict'
    || document?.crossValidation.status === 'conflict'
    || (structured !== null && document !== null
      && structured.items.length > 0 && document.items.length > 0
      && structured.crossValidation.status !== 'corroborated'
      && document.crossValidation.status !== 'corroborated');

  const reasons: string[] = [];
  const policy = defaultVerificationPolicy(input.strictAdjudication);

  // 证据为空或覆盖低：sparse，禁止强事实表达，启动反证/边界检索
  if (itemCount === 0 || coverage < 0.35) {
    policy.coverageStatus = 'sparse';
    policy.forbidStrongFactualClaims = true;
    policy.requireCounterevidenceSearch = true;
    reasons.push(itemCount === 0
      ? '两路检索均无证据：禁止一切强事实表达，无证据 Claim 不发布'
      : `证据覆盖度 ${coverage.toFixed(2)} 偏低：按 sparse 处理，禁止强事实表达`);
  } else if (coverage < 0.6) {
    policy.coverageStatus = 'sparse';
    reasons.push(`证据覆盖度 ${coverage.toFixed(2)} 一般：审慎表达`);
  }

  // 数据与文档结论不一致：裁决必须从严
  if (conflictDetected) {
    policy.conflictMode = true;
    policy.strength = 'strict';
    reasons.push('结构化数据与文档证据结论不一致：裁决从严，partial 亦不放行');
  }

  // 数值与因果 Claim 密度高：启用数值核验与越界因果规则
  if (input.taskRisk >= 0.35) {
    policy.numericVerification = true;
    policy.causalBoundaryRules = true;
    reasons.push(`任务事实风险 ${input.taskRisk.toFixed(2)} 偏高：数值逐条核验并执行越界因果规则`);
  }

  // 学情置信度低：增加难度适配质询，不增加事实宽松度
  if (input.learnerConfidence < 0.5) {
    policy.difficultyChallenge = true;
    reasons.push(`学情置信度 ${input.learnerConfidence.toFixed(2)} 偏低：增加难度适配质询`);
  }

  // 检索降级：如实记录；门禁不减少
  if (degraded) {
    policy.degraded = true;
    reasons.push('文档向量检索降级为全文检索：如实记录，门禁保持齐全');
  }

  // 知识脉络：可减少生成型调用，但门禁不减少
  if (input.resourceType === 'concept_map') {
    reasons.push('结构化模板资源：生成型调用减少，门禁不减少');
  }

  policy.amended = reasons.length > 0;
  policy.reasons = reasons;
  return policy;
}

/** 策略摘要（SSE/事件公开摘要用） */
export function policySummary(policy: VerificationPolicy): string {
  if (!policy.amended) return '沿用运行前默认门禁策略';
  return policy.reasons.join('；');
}

/** 风险等级推导（运行前阶段）：纳入任务事实风险（升级计划 §4.7 taskRisk） */
export function deriveRiskLevelWithTaskRisk(
  base: { profileUncertainty: number; knowledgeRisk: number },
  taskRisk: number,
): RunRiskLevel {
  if (base.knowledgeRisk > 0.5 || base.profileUncertainty > 0.7 || taskRisk > 0.6) return 'high';
  if (base.knowledgeRisk > 0.3 || base.profileUncertainty > 0.4 || taskRisk > 0.3) return 'medium';
  return 'low';
}
