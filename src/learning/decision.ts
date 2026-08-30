/**
 * 反馈驱动的学习决策（docs/挑战杯多智能体可信协同升级计划.md 里程碑 E）
 *
 * 纯函数：一次作答/反馈后，依据 BKT 前后状态、实际作答正确率、掌握与难度反馈、
 * 先修缺口与最近决策历史，输出持久化的下一步学习动作：
 * - remediate：低掌握或连续错误 → 补先修讲义/PPT/低阶题
 * - continue：掌握提高但置信度不足 → 同级练习或再采样
 * - advance：掌握与置信度均达标 → 知识脉络或下一节点
 * - collect_more_evidence：反馈冲突或证据太少 → 先以讲义收集学习证据
 */
import type { LearningResourceType } from './types.js';

export type DecisionKind = 'remediate' | 'continue' | 'advance' | 'collect_more_evidence';

export type DecisionTrigger = 'quiz_attempt' | 'asset_feedback' | 'guidance_session';

export interface BktSnapshot {
  pMastery: number;
  confidence: number;
}

export interface RecentDecisionHint {
  decision: DecisionKind;
  knowledgePointId: string;
  recommendedResourceType: LearningResourceType | null;
  createdAt: number;
}

export interface LearningDecisionInput {
  triggerType: DecisionTrigger;
  knowledgePointId: string;
  bktBefore: BktSnapshot;
  bktAfter: BktSnapshot;
  /** 本次会话范围内的作答（quiz 触发时） */
  attemptCount: number;
  correctCount: number;
  /** 讲义三档掌握反馈（asset_feedback 触发时） */
  masteryFeedback: 'low' | 'medium' | 'high' | null;
  /** 难度反馈 1~5（越大越难） */
  difficultyRating: number | null;
  resourceDifficulty: number | null;
  expectedSuccessRate: number | null;
  /** 先修未掌握比例 0~1 */
  prereqGap: number;
  /** 最近的持久化决策（避免重复生成同一种补强材料） */
  recentDecisions: RecentDecisionHint[];
}

export interface LearningDecisionOutput {
  decision: DecisionKind;
  recommendedResourceType: LearningResourceType;
  rationale: {
    observations: string[];
    reasons: string[];
    uncertainty: string[];
    bktBefore: BktSnapshot;
    bktAfter: BktSnapshot;
  };
}

const MASTERY_ADVANCE = 0.72;
const CONFIDENCE_ADVANCE = 0.6;
const MASTERY_REMEDIATE = 0.45;

/** remediate 推荐资源的轮换序列：避免连续生成同一种补强材料（升级计划 里程碑 E 输入项） */
const REMEDIATION_CYCLE: LearningResourceType[] = ['lecture', 'presentation', 'tiered_quiz'];

function correctRateOf(input: LearningDecisionInput): number | null {
  return input.attemptCount > 0 ? input.correctCount / input.attemptCount : null;
}

function lastRemediationResource(input: LearningDecisionInput): { resource: LearningResourceType; index: number } | null {
  for (let offset = 0; offset < input.recentDecisions.length; offset += 1) {
    const hint = input.recentDecisions[offset]!;
    if (hint.decision === 'remediate' && hint.recommendedResourceType) {
      const index = REMEDIATION_CYCLE.indexOf(hint.recommendedResourceType);
      return { resource: hint.recommendedResourceType, index: index >= 0 ? index : -1 };
    }
  }
  return null;
}

/** 学习决策纯函数（升级计划 里程碑 E 决策规则） */
export function decideLearningNextStep(input: LearningDecisionInput): LearningDecisionOutput {
  const before = { pMastery: round3(input.bktBefore.pMastery), confidence: round3(input.bktBefore.confidence) };
  const after = { pMastery: round3(input.bktAfter.pMastery), confidence: round3(input.bktAfter.confidence) };
  const correctRate = correctRateOf(input);
  const observations = [
    `BKT 掌握概率 ${before.pMastery} → ${after.pMastery}`,
    `置信度 ${before.confidence} → ${after.confidence}`,
    correctRate === null ? '本次无作答记录' : `本次作答 ${input.correctCount}/${input.attemptCount}（${Math.round(correctRate * 100)}%）`,
    input.masteryFeedback ? `掌握反馈：${masteryLabel(input.masteryFeedback)}` : '无掌握反馈',
    input.difficultyRating ? `难度反馈：${input.difficultyRating}/5` : '无难度反馈',
    input.prereqGap > 0 ? `先修缺口 ${(input.prereqGap * 100).toFixed(0)}%` : '先修已就绪',
  ];

  const feedbackConflicts = detectFeedbackConflict(input, correctRate);
  const evidenceThin = input.attemptCount === 0 && input.masteryFeedback === null && input.triggerType !== 'guidance_session';
  if (evidenceThin || feedbackConflicts) {
    return {
      decision: 'collect_more_evidence',
      recommendedResourceType: 'lecture',
      rationale: {
        observations,
        reasons: feedbackConflicts
          ? ['作答正确率与掌握反馈相互冲突：先追问澄清，不武断升降阶']
          : ['作答与反馈证据都不足：先以低风险材料采样，收集更多证据'],
        uncertainty: feedbackConflicts
          ? ['需要一次掌握度追问来确认真实状态']
          : ['当前证据量不足以判断掌握趋势'],
        bktBefore: before,
        bktAfter: after,
      },
    };
  }

  const masteryLow = after.pMastery < MASTERY_REMEDIATE
    || (correctRate !== null && correctRate < 0.4 && input.attemptCount >= 3)
    || input.masteryFeedback === 'low';
  if (masteryLow) {
    // 先修缺口大 → 回到讲义补先修；否则在补强资源间轮换，避免重复
    const last = lastRemediationResource(input);
    const recommended = input.prereqGap >= 0.3
      ? 'lecture'
      : last
        ? REMEDIATION_CYCLE[(last.index + 1 + REMEDIATION_CYCLE.length) % REMEDIATION_CYCLE.length]!
        : 'lecture';
    return {
      decision: 'remediate',
      recommendedResourceType: recommended,
      rationale: {
        observations,
        reasons: [
          after.pMastery < MASTERY_REMEDIATE
            ? `掌握概率 ${after.pMastery} 低于补强线 ${MASTERY_REMEDIATE}`
            : input.masteryFeedback === 'low'
              ? '学习者自评掌握不好'
              : `连续作答正确率仅 ${Math.round((correctRate ?? 0) * 100)}%`,
          ...(input.prereqGap >= 0.3 ? [`先修缺口 ${(input.prereqGap * 100).toFixed(0)}%，优先回到先修讲义`] : []),
          ...(last ? ['轮换补强资源类型，避免重复生成同一种材料'] : []),
        ],
        uncertainty: [],
        bktBefore: before,
        bktAfter: after,
      },
    };
  }

  const masteryReady = after.pMastery >= MASTERY_ADVANCE;
  const confidenceEnough = after.confidence >= CONFIDENCE_ADVANCE;
  if (masteryReady && confidenceEnough) {
    return {
      decision: 'advance',
      recommendedResourceType: 'concept_map',
      rationale: {
        observations,
        reasons: [
          `掌握概率 ${after.pMastery} ≥ ${MASTERY_ADVANCE} 且置信度 ${after.confidence} ≥ ${CONFIDENCE_ADVANCE}`,
          '可查看知识脉络或推进下一个路径节点',
        ],
        uncertainty: [],
        bktBefore: before,
        bktAfter: after,
      },
    };
  }

  return {
    decision: 'continue',
    recommendedResourceType: 'tiered_quiz',
    rationale: {
      observations,
      reasons: [
        masteryReady
          ? `掌握概率 ${after.pMastery} 已达标但置信度 ${after.confidence} 不足：再做一组同级练习采样`
          : `掌握概率 ${after.pMastery} 处于中段：按当前节奏继续同级练习`,
      ],
      uncertainty: masteryReady ? [] : [`掌握概率未到 ${MASTERY_ADVANCE}，暂不进阶`],
      bktBefore: before,
      bktAfter: after,
    },
  };
}

function detectFeedbackConflict(input: LearningDecisionInput, correctRate: number | null): boolean {
  if (correctRate === null || input.masteryFeedback === null) return false;
  if (correctRate >= 0.8 && input.masteryFeedback === 'low') return true;
  if (correctRate <= 0.3 && input.masteryFeedback === 'high') return true;
  return false;
}

function masteryLabel(level: 'low' | 'medium' | 'high'): string {
  return level === 'low' ? '掌握不好' : level === 'medium' ? '基本掌握' : '掌握良好';
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/** 决策 → 路径建议等级映射（路径节点建议优先读取持久化决策） */
export function decisionToRecommendationLevel(decision: DecisionKind): 'no_evidence' | 'reinforce' | 'maintain' | 'advance' {
  switch (decision) {
    case 'remediate': return 'reinforce';
    case 'advance': return 'advance';
    case 'continue': return 'maintain';
    case 'collect_more_evidence': return 'no_evidence';
  }
}
