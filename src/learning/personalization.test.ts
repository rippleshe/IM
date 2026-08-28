import { describe, expect, it } from 'vitest';
import {
  bktUpdate,
  confidenceAfter,
  createBktState,
  socraticPriority,
} from './bkt.js';
import { calibrateDifficulty, SUCCESS_RATE_BAND, TARGET_SUCCESS_RATE } from './difficulty.js';
import { DIAGNOSTIC_QUESTIONS, initialBktStates, scoreDiagnostic } from './diagnostic.js';

describe('bkt（docs/挑战杯技术开发总规.md §7.1）', () => {
  it('答对提升掌握概率，答错降低', () => {
    const base = createBktState(0.4);
    const afterCorrect = bktUpdate(base, true);
    const afterWrong = bktUpdate(base, false);
    expect(afterCorrect.pMastery).toBeGreaterThan(base.pMastery);
    expect(afterWrong.pMastery).toBeLessThan(base.pMastery);
    expect(afterCorrect.attemptCount).toBe(1);
    expect(afterCorrect.correctCount).toBe(1);
    expect(afterWrong.correctCount).toBe(0);
  });

  it('连续答对使掌握度逼近高值且置信度单调上升，9 次后越过 0.80 门限', () => {
    let state = createBktState(0.15);
    let previousConfidence = state.confidence;
    for (let i = 0; i < 12; i += 1) {
      state = bktUpdate(state, true);
      expect(state.confidence).toBeGreaterThan(previousConfidence);
      expect(state.confidence).toBeLessThanOrEqual(0.95);
      previousConfidence = state.confidence;
    }
    expect(state.pMastery).toBeGreaterThan(0.8);
    expect(state.confidence).toBeGreaterThanOrEqual(0.8);
    expect(confidenceAfter(9)).toBeGreaterThanOrEqual(0.8);
  });

  it('苏格拉底优先级：关键度越高、置信度越低越优先', () => {
    expect(socraticPriority({ criticality: 1, confidence: 0.1 })).toBeGreaterThan(
      socraticPriority({ criticality: 1, confidence: 0.9 }),
    );
    expect(socraticPriority({ criticality: 0.9, confidence: 0.2 })).toBeGreaterThan(
      socraticPriority({ criticality: 0.4, confidence: 0.2 }),
    );
  });
});

describe('calibrateDifficulty（docs/挑战杯技术开发总规.md §7.2）', () => {
  it('初学者 + 高脚手架落在 65%-80% 成功率区间且难度偏低', () => {
    const result = calibrateDifficulty({ pMastery: 0.15, confidence: 0.2, prereqReadiness: 0.2, scaffold: 'high' });
    expect(result.expectedSuccessRate).toBeGreaterThanOrEqual(SUCCESS_RATE_BAND[0]);
    expect(result.expectedSuccessRate).toBeLessThanOrEqual(SUCCESS_RATE_BAND[1]);
    expect(result.targetDifficulty).toBeLessThan(0.5);
  });

  it('高水平 + 低脚手架（挑战任务）同样落在区间且难度偏高', () => {
    const result = calibrateDifficulty({ pMastery: 0.92, confidence: 0.9, prereqReadiness: 1, scaffold: 'low' });
    expect(result.expectedSuccessRate).toBeGreaterThanOrEqual(SUCCESS_RATE_BAND[0]);
    expect(result.expectedSuccessRate).toBeLessThanOrEqual(SUCCESS_RATE_BAND[1]);
    expect(result.targetDifficulty).toBeGreaterThan(0.4);
  });

  it('先修缺口触发补强提示，rationale 可审计', () => {
    const result = calibrateDifficulty({ pMastery: 0.5, confidence: 0.5, prereqReadiness: 0.2, scaffold: 'medium' });
    expect(result.rationale.join('')).toContain('先修');
    expect(result.rationale.length).toBeGreaterThanOrEqual(4);
  });

  it('目标成功率取区间中值 0.72', () => {
    expect(TARGET_SUCCESS_RATE).toBe(0.72);
  });
});

describe('diagnostic（docs/挑战杯技术开发总规.md §7.3）', () => {
  it('题集固定为 12 题，五维覆盖符合配比', () => {
    expect(DIAGNOSTIC_QUESTIONS).toHaveLength(12);
    const byDim = new Map<string, number>();
    for (const question of DIAGNOSTIC_QUESTIONS) {
      byDim.set(question.dimension, (byDim.get(question.dimension) ?? 0) + 1);
    }
    expect(byDim.get('python')).toBe(3);
    expect(byDim.get('data_processing')).toBe(3);
    expect(byDim.get('statistics')).toBe(2);
    expect(byDim.get('time_series')).toBe(2);
    expect(byDim.get('device_diagnosis')).toBe(2);
  });

  it('判分正确并按知识点输出 BKT 观测序列', () => {
    const result = scoreDiagnostic([
      { questionId: 'diag-py-1', answerId: 'b', durationMs: 3000 },
      { questionId: 'diag-py-1', answerId: 'a' }, // 重复题仍按题判分（服务层去重）
      { questionId: 'diag-dd-2', answerId: 'c' }, // 答错
    ]);
    expect(result.total).toBe(3);
    expect(result.correct).toBe(1);
    expect(result.byDimension.python.total).toBe(2);
    expect(result.byKnowledgePoint).toHaveLength(3);
    expect(result.byKnowledgePoint.filter((item) => item.correct)).toHaveLength(1);
  });

  it('诊断作答驱动初始 BKT：连续答对的知识点高于先验', () => {
    const result = scoreDiagnostic(
      DIAGNOSTIC_QUESTIONS.slice(0, 4).map((question) => ({ questionId: question.id, answerId: question.answerId })),
    );
    const states = initialBktStates(result);
    expect(states.size).toBeGreaterThan(0);
    for (const state of states.values()) {
      expect(state.pMastery).toBeGreaterThan(0.15);
      expect(state.attemptCount).toBeGreaterThan(0);
    }
  });
});
