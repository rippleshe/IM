/**
 * 苏格拉底选题与提问约束（docs/挑战杯技术开发总规.md §7.4）
 * 纯函数：优先级、轮次与终止条件、兜底问题模板；LLM 只负责措辞与公开评价。
 */
import { clamp01 } from './bkt.js';

export const SOCRATIC_MAX_ROUNDS = 5;
/** 目标置信度：达到即终止追问（与 BKT 置信度门限一致） */
export const SOCRATIC_TARGET_CONFIDENCE = 0.8;

export interface SocraticTargetInput {
  knowledgePointId: string;
  /** 路径关键度：当前活跃节点为 1，其前置闭包内 0.7，其余 0.4 */
  criticality: number;
  confidence: number;
  pMastery: number;
}

export interface SocraticTarget {
  knowledgePointId: string;
  criticality: number;
  confidence: number;
  pMastery: number;
  priority: number;
}

/** 选题优先级 = 关键度 × (1 - 置信度)，最低置信的关键点优先（总规 §7.4） */
export function selectSocraticTarget(candidates: SocraticTargetInput[]): SocraticTarget | null {
  if (candidates.length === 0) return null;
  const scored = candidates.map((candidate) => ({
    ...candidate,
    criticality: clamp01(candidate.criticality),
    confidence: clamp01(candidate.confidence),
    priority: clamp01(candidate.criticality) * (1 - clamp01(candidate.confidence)),
  }));
  scored.sort((a, b) => b.priority - a.priority);
  return scored[0] ?? null;
}

/** 终止条件：目标知识点置信度 ≥ 0.80 或完成 5 轮（总规 §7.4） */
export function shouldContinueSocratic(round: number, confidence: number): boolean {
  if (round >= SOCRATIC_MAX_ROUNDS) return false;
  return clamp01(confidence) < SOCRATIC_TARGET_CONFIDENCE;
}

export interface SocraticEvaluation {
  verdict: 'correct' | 'partial' | 'incorrect';
  comment: string;
}

/** LLM 不可用时的确定性兜底评价：以作答长度与要点覆盖做保守判断 */
export function fallbackEvaluation(answer: string): SocraticEvaluation {
  const trimmed = answer.trim();
  if (trimmed.length >= 24) {
    return { verdict: 'partial', comment: '你的回答给出了自己的思考；本轮先按部分正确处理，继续下一问来确认理解。' };
  }
  if (trimmed.length > 0) {
    return { verdict: 'incorrect', comment: '这个回答还没有说清依据；请结合数据与结论边界再想一想。' };
  }
  return { verdict: 'incorrect', comment: '还没有作答内容，无法评价。' };
}

/** 兜底问题模板：保证无 LLM 时会话仍可推进（第 round 轮） */
export function fallbackQuestion(kpLabel: string, round: number): string {
  const templates = [
    `先用你自己的话说说，“${kpLabel}”要解决的是什么问题？`,
    `在“${kpLabel}”里，你会先看哪些数据或字段？为什么？`,
    `如果观察结果异常，你能基于“${kpLabel}”下多强的结论？边界在哪里？`,
    `举一个“${kpLabel}”能解释的实际场景，并说明你的判断依据。`,
    `回顾这几轮：关于“${kpLabel}”，你还有哪一步最不确定？`,
  ];
  return templates[Math.max(0, Math.min(round - 1, templates.length - 1))]!;
}
