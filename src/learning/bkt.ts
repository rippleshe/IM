/**
 * BKT 知识状态追踪（docs/挑战杯技术开发总规.md §7.1）
 * 纯函数：输入当前状态与一次作答观测，输出可审计的新状态。
 * 每次更新必须由调用方写入 bkt_updates（前后值 + 触发事件），保证可回溯。
 */

export interface BktParams {
  pGuess: number;
  pSlip: number;
  pLearn: number;
}

export interface BktState extends BktParams {
  pMastery: number;
  confidence: number;
  attemptCount: number;
  correctCount: number;
}

export const DEFAULT_BKT_PARAMS: BktParams = { pGuess: 0.25, pSlip: 0.1, pLearn: 0.1 };
export const INITIAL_CONFIDENCE = 0.1;
export const MAX_CONFIDENCE = 0.95;

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function createBktState(pMasteryPrior = 0.2, params: Partial<BktParams> = {}): BktState {
  return {
    pMastery: clamp01(pMasteryPrior),
    pGuess: clamp01(params.pGuess ?? DEFAULT_BKT_PARAMS.pGuess),
    pSlip: clamp01(params.pSlip ?? DEFAULT_BKT_PARAMS.pSlip),
    pLearn: clamp01(params.pLearn ?? DEFAULT_BKT_PARAMS.pLearn),
    confidence: INITIAL_CONFIDENCE,
    attemptCount: 0,
    correctCount: 0,
  };
}

/**
 * 置信度随证据量单调增长：confidence = 1 - 0.9 * (2.5 / (2.5 + n))，封顶 0.95。
 * n=1 → 0.357，n=3 → 0.591，n=5 → 0.700，n=9 → 0.804（越过 0.80 门限）。
 */
export function confidenceAfter(attemptCount: number): number {
  const n = Math.max(0, attemptCount);
  return Math.min(MAX_CONFIDENCE, 1 - (1 - INITIAL_CONFIDENCE) * (2.5 / (2.5 + n)));
}

/** 单次作答观测后的 BKT 更新：贝叶斯修正 + 学习转移 */
export function bktUpdate(state: BktState, correct: boolean): BktState {
  const g = clamp01(state.pGuess);
  const s = clamp01(state.pSlip);
  const pM = clamp01(state.pMastery);
  const likelihood = correct
    ? (pM * (1 - s)) / Math.max(1e-9, pM * (1 - s) + (1 - pM) * g)
    : (pM * s) / Math.max(1e-9, pM * s + (1 - pM) * (1 - g));
  const postObservation = clamp01(likelihood);
  const pMastery = clamp01(postObservation + (1 - postObservation) * clamp01(state.pLearn));
  const attemptCount = state.attemptCount + 1;
  return {
    ...state,
    pMastery,
    confidence: confidenceAfter(attemptCount),
    attemptCount,
    correctCount: state.correctCount + (correct ? 1 : 0),
  };
}

/** 苏格拉底选题优先级：路径关键度 × 掌握置信度最低（总规 §7.4） */
export function socraticPriority(input: { criticality: number; confidence: number }): number {
  return clamp01(input.criticality) * (1 - clamp01(input.confidence));
}
