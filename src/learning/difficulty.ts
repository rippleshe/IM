/**
 * 难度校准（docs/挑战杯技术开发总规.md §7.2）
 * 目标：资源预计成功率落在 65%-80% 有效学习区间（目标中值 0.72）。
 * 纯函数，依据（readiness/scaffold）写入 rationale 随资源入库，替换历史硬编码 0.42。
 */
import { clamp01 } from './bkt.js';

export type ScaffoldStrength = 'high' | 'medium' | 'low';

export interface DifficultyCalibration {
  /** 资源难度 0-1（越高越难） */
  targetDifficulty: number;
  /** 预计一次作答/阅读达标成功率 */
  expectedSuccessRate: number;
  rationale: string[];
}

export interface DifficultyInput {
  /** 知识点掌握概率（BKT p_mastery） */
  pMastery: number;
  /** 掌握置信度 */
  confidence: number;
  /** 先修就绪度：已掌握先修 / 全部先修（无先修时给 1） */
  prereqReadiness: number;
  /** 脚手架强度：讲义 high、习题 medium、挑战任务 low */
  scaffold: ScaffoldStrength;
}

export const TARGET_SUCCESS_RATE = 0.72;
export const SUCCESS_RATE_BAND: [number, number] = [0.65, 0.8];

const SCAFFOLD_STRENGTH: Record<ScaffoldStrength, number> = { high: 0.85, medium: 0.6, low: 0.35 };

export function calibrateDifficulty(input: DifficultyInput): DifficultyCalibration {
  const pMastery = clamp01(input.pMastery);
  const confidence = clamp01(input.confidence);
  const prereq = clamp01(input.prereqReadiness);
  const scaffold = SCAFFOLD_STRENGTH[input.scaffold] ?? SCAFFOLD_STRENGTH.medium;

  const readiness = clamp01(0.6 * pMastery + 0.25 * prereq + 0.15 * confidence);
  // 成功率模型：p̂(d) = readiness + support·(1-d) − 0.2·d
  //   support = (1-readiness)·scaffold·0.9 —— 内容越简单、脚手架越强，即使低就绪度也能读懂/做对；
  //   −0.2·d —— 难度本身始终降低成功率。
  // 解 p̂(d) = 0.72：d = (readiness + support − 0.72) / (support + 0.2)，clamp 到 [0,1]。
  const support = (1 - readiness) * scaffold * 0.9;
  const denominator = support + 0.2;
  const targetDifficulty = clamp01((readiness + support - TARGET_SUCCESS_RATE) / denominator);
  const rawExpected = readiness + support * (1 - targetDifficulty) - 0.2 * targetDifficulty;
  const expectedSuccessRate = Math.min(
    SUCCESS_RATE_BAND[1],
    Math.max(SUCCESS_RATE_BAND[0], clamp01(rawExpected)),
  );

  const rationale = [
    `掌握概率 ${pMastery.toFixed(2)}、置信度 ${confidence.toFixed(2)}、先修就绪 ${(prereq * 100).toFixed(0)}%`,
    `学习就绪度 readiness=${readiness.toFixed(2)}（0.6×掌握 + 0.25×先修 + 0.15×置信）`,
    `脚手架 ${input.scaffold}（强度 ${scaffold.toFixed(2)}），目标成功率 ${(TARGET_SUCCESS_RATE * 100).toFixed(0)}%`,
    `预计成功率 ${(expectedSuccessRate * 100).toFixed(0)}%（要求 65%-80%）`,
  ];
  if (prereq < 0.5) rationale.push('先修缺口较大：建议同时注入先修补强内容');
  return { targetDifficulty, expectedSuccessRate, rationale };
}
