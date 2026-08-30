import { describe, expect, it } from 'vitest';
import { decideLearningNextStep, decisionToRecommendationLevel } from './decision.js';
import type { LearningDecisionInput } from './decision.js';

function baseInput(overrides: Partial<LearningDecisionInput> = {}): LearningDecisionInput {
  return {
    triggerType: 'quiz_attempt',
    knowledgePointId: 'anomaly-threshold',
    bktBefore: { pMastery: 0.3, confidence: 0.3 },
    bktAfter: { pMastery: 0.4, confidence: 0.4 },
    attemptCount: 4,
    correctCount: 2,
    masteryFeedback: null,
    difficultyRating: null,
    resourceDifficulty: 0.4,
    expectedSuccessRate: 0.72,
    prereqGap: 0,
    recentDecisions: [],
    ...overrides,
  };
}

describe('反馈驱动学习决策（升级计划 里程碑 E）', () => {
  it('低掌握 → remediate，先修缺口大时优先讲义补先修', () => {
    const gap = decideLearningNextStep(baseInput({ bktAfter: { pMastery: 0.3, confidence: 0.4 }, prereqGap: 0.5 }));
    expect(gap.decision).toBe('remediate');
    expect(gap.recommendedResourceType).toBe('lecture');
    const noGap = decideLearningNextStep(baseInput({ bktAfter: { pMastery: 0.35, confidence: 0.4 } }));
    expect(noGap.decision).toBe('remediate');
  });

  it('连续错误 → remediate 并轮换补强资源，避免重复生成同一种材料', () => {
    const first = decideLearningNextStep(baseInput({
      attemptCount: 4, correctCount: 1, bktAfter: { pMastery: 0.5, confidence: 0.5 },
    }));
    expect(first.decision).toBe('remediate');
    expect(first.recommendedResourceType).toBe('lecture');
    const second = decideLearningNextStep(baseInput({
      attemptCount: 4, correctCount: 1,
      bktAfter: { pMastery: 0.5, confidence: 0.5 },
      recentDecisions: [{ decision: 'remediate', knowledgePointId: 'kp', recommendedResourceType: 'lecture', createdAt: 1 }],
    }));
    expect(second.decision).toBe('remediate');
    expect(second.recommendedResourceType).not.toBe('lecture');
  });

  it('掌握提高但置信度不足 → continue（同级练习）', () => {
    const result = decideLearningNextStep(baseInput({
      bktAfter: { pMastery: 0.8, confidence: 0.3 },
      attemptCount: 4, correctCount: 4,
    }));
    expect(result.decision).toBe('continue');
    expect(result.rationale.reasons.join('')).toContain('置信度');
  });

  it('掌握与置信度均达标 → advance（知识脉络）', () => {
    const result = decideLearningNextStep(baseInput({
      bktBefore: { pMastery: 0.7, confidence: 0.5 },
      bktAfter: { pMastery: 0.8, confidence: 0.7 },
      attemptCount: 4, correctCount: 4,
    }));
    expect(result.decision).toBe('advance');
    expect(result.recommendedResourceType).toBe('concept_map');
  });

  it('反馈冲突（高正确率×掌握差评）→ collect_more_evidence，先追问', () => {
    const result = decideLearningNextStep(baseInput({
      attemptCount: 5, correctCount: 5, masteryFeedback: 'low',
    }));
    expect(result.decision).toBe('collect_more_evidence');
    expect(result.rationale.reasons.join('')).toContain('冲突');
  });

  it('证据太少（无作答无反馈）→ collect_more_evidence', () => {
    const result = decideLearningNextStep(baseInput({
      attemptCount: 0, correctCount: 0, masteryFeedback: null, triggerType: 'asset_feedback',
    }));
    expect(result.decision).toBe('collect_more_evidence');
  });

  it('掌握反馈为差评 → remediate（BKT 不高时）', () => {
    const result = decideLearningNextStep(baseInput({
      triggerType: 'asset_feedback', attemptCount: 0, masteryFeedback: 'low',
      bktAfter: { pMastery: 0.4, confidence: 0.4 },
    }));
    expect(result.decision).toBe('remediate');
  });

  it('决策→路径建议等级映射齐全', () => {
    expect(decisionToRecommendationLevel('remediate')).toBe('reinforce');
    expect(decisionToRecommendationLevel('continue')).toBe('maintain');
    expect(decisionToRecommendationLevel('advance')).toBe('advance');
    expect(decisionToRecommendationLevel('collect_more_evidence')).toBe('no_evidence');
  });

  it('决策理由携带真实 BKT 前后值（可追溯）', () => {
    const result = decideLearningNextStep(baseInput({
      bktBefore: { pMastery: 0.357, confidence: 0.35 },
      bktAfter: { pMastery: 0.5, confidence: 0.45 },
      attemptCount: 3, correctCount: 3,
    }));
    expect(result.rationale.bktBefore.pMastery).toBe(0.357);
    expect(result.rationale.bktAfter.pMastery).toBe(0.5);
    expect(result.rationale.observations.join(' ')).toContain('3/3');
  });
});
