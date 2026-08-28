import { describe, expect, it } from 'vitest';
import { computeNodeRecommendation } from './store.js';

describe('computeNodeRecommendation', () => {
  it('没有作答与反馈时返回暂无记录', () => {
    const result = computeNodeRecommendation({ skill: null, feedbackLevel: null });
    expect(result.level).toBe('no_evidence');
    expect(result.attemptCount).toBe(0);
  });

  it('只有讲义反馈时建议做练习验证', () => {
    const result = computeNodeRecommendation({ skill: null, feedbackLevel: 'high' });
    expect(result.level).toBe('maintain');
  });

  it('正确率不足时建议补强', () => {
    const result = computeNodeRecommendation({ skill: { mastery: 0.2, attemptCount: 3, correctCount: 1 } });
    expect(result.level).toBe('reinforce');
    expect(result.reason).toContain('正确率 33%');
  });

  it('证据不足但表现稳定时保持节奏', () => {
    const result = computeNodeRecommendation({ skill: { mastery: 0.36, attemptCount: 2, correctCount: 2 } });
    expect(result.level).toBe('maintain');
  });

  it('持续高质量作答后建议进阶', () => {
    const result = computeNodeRecommendation({ skill: { mastery: 0.64, attemptCount: 6, correctCount: 5 } });
    expect(result.level).toBe('advance');
  });

  it('主观反馈为低时即使作答表现好也建议补强', () => {
    const result = computeNodeRecommendation({ skill: { mastery: 0.64, attemptCount: 6, correctCount: 5 }, feedbackLevel: 'low' });
    expect(result.level).toBe('reinforce');
  });
});
