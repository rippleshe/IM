import { describe, expect, it } from 'vitest';
import {
  PERSONA_PRIORS,
  buildEvaluationCases,
  coverageRate,
  difficultyMatches,
  hallucinationRate,
} from './evaluation.js';
import { calibrateDifficulty } from './difficulty.js';

describe('evaluation（docs/挑战杯技术开发总规.md §8.2）', () => {
  it('生成 60 个固定案例：三画像各 20，覆盖六类资源与三层任务', () => {
    const cases = buildEvaluationCases();
    expect(cases).toHaveLength(60);
    const regen = buildEvaluationCases();
    expect(regen).toEqual(cases); // 确定性生成，可复现
    for (const persona of ['learner-foundation', 'learner-advanced', 'learner-maintenance']) {
      expect(cases.filter((item) => item.persona === persona)).toHaveLength(20);
    }
    const types = new Set(cases.map((item) => item.resourceType));
    expect(types.size).toBe(6);
    const levels = new Set(cases.map((item) => item.taskLevel));
    expect([...levels].sort()).toEqual(['advanced', 'basic', 'transfer']);
  });

  it('案例携带黄金知识点、目标难度区间与证据范围', () => {
    const cases = buildEvaluationCases();
    for (const item of cases) {
      expect(item.requiredKnowledgePoints.length).toBeGreaterThanOrEqual(5);
      expect(item.targetDifficultyRange[0]).toBeLessThanOrEqual(item.targetDifficultyRange[1]);
      expect(item.allowedEvidenceScope.length).toBe(2);
      expect(item.task.length).toBeGreaterThan(8);
    }
  });

  it('画像先验的校准难度落入对应案例区间（难度适配通路自洽）', () => {
    const cases = buildEvaluationCases();
    const sample = cases.filter((item) => item.resourceType === 'lecture').slice(0, 3);
    for (const item of sample) {
      const prior = PERSONA_PRIORS[item.persona];
      const calibration = calibrateDifficulty({
        pMastery: prior.pMastery, confidence: prior.confidence,
        prereqReadiness: prior.prereqReadiness, scaffold: 'high',
      });
      expect(difficultyMatches(calibration, item.targetDifficultyRange)).toBe(true);
    }
  });

  it('覆盖率与幻觉率指标计算正确', () => {
    expect(coverageRate(['a', 'b'], ['a', 'b', 'c'])).toBeCloseTo(2 / 3);
    expect(coverageRate([], ['a'])).toBe(0);
    expect(coverageRate(['x'], [])).toBe(1);
    expect(hallucinationRate([{ verdict: 'supported' }, { verdict: 'unsupported' }])).toBeCloseTo(0.5);
    expect(hallucinationRate([{ verdict: 'review' }])).toBeNull(); // 无可审计声明
  });
});
