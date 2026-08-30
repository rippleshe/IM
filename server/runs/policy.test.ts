import { describe, expect, it } from 'vitest';
import {
  defaultVerificationPolicy,
  deriveRiskLevelWithTaskRisk,
  deriveVerificationPolicy,
  taskFactRisk,
} from './policy.js';
import { computeRunLearnerSignals } from '../profile-insights.js';

function packInput(overrides: {
  structuredItems?: number;
  documentItems?: number;
  coverage?: number;
  crossStatus?: 'corroborated' | 'needs_review' | 'conflict' | 'unsupported';
  degraded?: boolean;
}) {
  const item = (id: string) => ({
    id, sourceType: 'dataset' as const, sourceId: 'ds', locator: 'row 1',
    content: '样本', retrievalMethod: 'sql' as const, relevanceScore: 0.9, trustLevel: 'high' as const,
  });
  const crossValidation = {
    status: overrides.crossStatus ?? ('corroborated' as const),
    score: 1, checks: [], notes: [],
  };
  return {
    structuredPack: overrides.structuredItems === undefined
      ? null
      : { items: Array.from({ length: overrides.structuredItems }, (_, index) => item(`s-${index}`)), coverageScore: overrides.coverage ?? 0.8, crossValidation },
    documentPack: overrides.documentItems === undefined
      ? null
      : {
          items: Array.from({ length: overrides.documentItems }, (_, index) => item(`d-${index}`)),
          coverageScore: overrides.coverage ?? 0.8,
          crossValidation,
          hybrid: overrides.degraded
            ? { vectorUsed: false, degraded: true, reason: 'embed_failed', ftsCandidates: 3, vectorCandidates: 0 }
            : { vectorUsed: true, degraded: false, ftsCandidates: 3, vectorCandidates: 3 },
        },
  };
}

const BASE_POLICY_INPUT = {
  ...packInput({ structuredItems: 4, documentItems: 4, coverage: 0.8 }),
  resourceType: 'lecture' as const,
  taskRisk: 0.1,
  learnerConfidence: 0.8,
  strictAdjudication: false,
};

describe('任务事实风险（升级计划 §4.7）', () => {
  it('数值/因果/操作表述提升对应密度，习题任务风险更高', () => {
    const numeric = taskFactRisk({ task: '统计故障阈值并计算百分比准确率', resourceType: 'lecture' });
    expect(numeric.numericDensity).toBeGreaterThan(0);
    const causal = taskFactRisk({ task: '解释故障原因和因果机理', resourceType: 'lecture' });
    expect(causal.causalDensity).toBeGreaterThan(0);
    const operational = taskFactRisk({ task: '给出现场检修操作步骤', resourceType: 'lecture' });
    expect(operational.operationalDensity).toBeGreaterThan(0);
    const quiz = taskFactRisk({ task: '分析数据', resourceType: 'tiered_quiz' });
    const plain = taskFactRisk({ task: '分析数据', resourceType: 'lecture' });
    expect(quiz.score).toBeGreaterThan(plain.score);
    expect(taskFactRisk({ task: '随机泛化任务', resourceType: 'lecture' }).score).toBeLessThan(0.15);
  });
});

describe('检索后验证策略 deriveVerificationPolicy（升级计划 §4.7 测试矩阵）', () => {
  it('实际证据为空：sparse，禁止强事实表达并启动反证检索', () => {
    const policy = deriveVerificationPolicy({ ...BASE_POLICY_INPUT, ...packInput({ structuredItems: 0, documentItems: 0, coverage: 0 }) });
    expect(policy.coverageStatus).toBe('sparse');
    expect(policy.forbidStrongFactualClaims).toBe(true);
    expect(policy.requireCounterevidenceSearch).toBe(true);
    expect(policy.amended).toBe(true);
    expect(policy.reasons.join('')).toContain('禁止');
  });

  it('结构化与文档结论冲突：conflict policy，裁决从严', () => {
    const policy = deriveVerificationPolicy({ ...BASE_POLICY_INPUT, ...packInput({ structuredItems: 3, documentItems: 3, coverage: 0.7, crossStatus: 'conflict' }) });
    expect(policy.conflictMode).toBe(true);
    expect(policy.strength).toBe('strict');
  });

  it('文档检索降级：如实记录 degraded，门禁不减少', () => {
    const policy = deriveVerificationPolicy({ ...BASE_POLICY_INPUT, ...packInput({ structuredItems: 4, documentItems: 2, coverage: 0.8, degraded: true }) });
    expect(policy.degraded).toBe(true);
    // 门禁不减少：策略不含任何放松语义
    expect(policy.strength).not.toBe('relaxed');
    expect(policy.forbidStrongFactualClaims).toBe(false);
  });

  it('低学情置信度：增加难度适配质询，不增加事实宽松度', () => {
    const policy = deriveVerificationPolicy({ ...BASE_POLICY_INPUT, learnerConfidence: 0.3 });
    expect(policy.difficultyChallenge).toBe(true);
    expect(policy.forbidStrongFactualClaims).toBe(false);
    expect(policy.strength).toBe('standard');
  });

  it('高掌握 + 高置信 + 证据充足：维持默认策略且门禁不放松', () => {
    const policy = deriveVerificationPolicy(BASE_POLICY_INPUT);
    expect(policy.amended).toBe(false);
    expect(policy.coverageStatus).toBe('normal');
    expect(policy).toEqual({ ...defaultVerificationPolicy(false), amended: false });
  });

  it('证据覆盖低：标记 sparse（门禁与默认一致，仅附加约束）', () => {
    const policy = deriveVerificationPolicy({ ...BASE_POLICY_INPUT, ...packInput({ structuredItems: 2, documentItems: 1, coverage: 0.3 }) });
    expect(policy.coverageStatus).toBe('sparse');
    expect(policy.forbidStrongFactualClaims).toBe(true);
  });
});

describe('运行前学情信号 computeRunLearnerSignals（升级计划 §4.7）', () => {
  it('低置信 + 高错误：knowledgeRisk 进入高风险区间', () => {
    const signals = computeRunLearnerSignals({
      profileAccuracy: 0.3,
      hasStudyHistory: true,
      targetState: { pMastery: 0.25, confidence: 0.3, attemptCount: 6, correctCount: 2 },
      prereqStates: [{ pMastery: 0.3, confidence: 0.25, attemptCount: 4, correctCount: 1 }],
      prereqTotal: 2,
    });
    expect(signals.knowledgeRisk).toBeGreaterThan(0.5);
    expect(signals.profileUncertainty).toBeGreaterThan(0.5);
    // 2 个先修节点中仅 1 个有状态且未掌握 → 缺口 1
    expect(signals.prereqGap).toBeCloseTo(1, 5);
  });

  it('高掌握 + 高置信：风险低、不确定度低', () => {
    const signals = computeRunLearnerSignals({
      profileAccuracy: 0.95,
      hasStudyHistory: true,
      targetState: { pMastery: 0.9, confidence: 0.85, attemptCount: 10, correctCount: 9 },
      prereqStates: [{ pMastery: 0.85, confidence: 0.8, attemptCount: 8, correctCount: 7 }],
      prereqTotal: 1,
    });
    expect(signals.knowledgeRisk).toBeLessThan(0.2);
    expect(signals.profileUncertainty).toBeLessThan(0.2);
    expect(signals.prereqGap).toBe(0);
  });

  it('无先修时目标知识点权重全占；无数据时错误率取保守默认', () => {
    const noPrereq = computeRunLearnerSignals({
      profileAccuracy: null, hasStudyHistory: false,
      targetState: { pMastery: 0.2, confidence: 0.1, attemptCount: 0, correctCount: 0 },
      prereqStates: [], prereqTotal: 0,
    });
    expect(noPrereq.weightedConfidence).toBe(0.1);
    expect(noPrereq.recentErrorRate).toBeCloseTo(0.3, 5);
    expect(noPrereq.hasAnswerHistory).toBe(false);
  });
});

describe('任务风险并入风险等级', () => {
  it('taskRisk 足够高时风险等级升级为 high', () => {
    expect(deriveRiskLevelWithTaskRisk({ profileUncertainty: 0.2, knowledgeRisk: 0.1 }, 0.7)).toBe('high');
    expect(deriveRiskLevelWithTaskRisk({ profileUncertainty: 0.2, knowledgeRisk: 0.1 }, 0.35)).toBe('medium');
    expect(deriveRiskLevelWithTaskRisk({ profileUncertainty: 0.2, knowledgeRisk: 0.1 }, 0.1)).toBe('low');
  });
});
