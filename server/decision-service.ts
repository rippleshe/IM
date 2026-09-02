/**
 * 学习决策服务（docs/挑战杯技术开发总规.md §7）
 *
 * 作答/反馈/追问会话结束后：固化 feedback_update 学情快照 → 纯函数决策 →
 * 持久化 learning_decisions（触发事件、输入快照、BKT 前后值、理由、推荐资源）。
 * 路径节点建议优先读取这里最近的决策；缺失时才回退即时计算。
 */
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { getLearningDatabase } from './db/client.js';
import { learningDecisions } from './db/schema.js';
import { saveRunSnapshot } from './runs/snapshots.js';
import { decisionToRecommendationLevel, decideLearningNextStep, type DecisionKind, type DecisionTrigger, type RecentDecisionHint } from '../src/learning/decision.js';
import { learningStore } from './study-context.js';
import type { LearningResourceType } from '../src/learning/types.js';

export interface LearningDecisionView {
  id: string;
  knowledgePointId: string;
  triggerType: DecisionTrigger;
  decision: DecisionKind;
  recommendedResourceType: LearningResourceType | null;
  rationale: Record<string, unknown>;
  assetId: string | null;
  runId: string | null;
  createdAt: number;
  /** 路径建议等级映射（前端复用现有 recommendation 徽标语义） */
  recommendationLevel: string;
}

function recentHints(learnerId: string, knowledgePointId: string, limit = 5): Promise<RecentDecisionHint[]> {
  return listDecisions(learnerId, limit * 4).then((rows) =>
    rows
      .filter((row) => row.knowledgePointId === knowledgePointId)
      .slice(0, limit)
      .map((row) => ({
        decision: row.decision,
        knowledgePointId: row.knowledgePointId,
        recommendedResourceType: row.recommendedResourceType,
        createdAt: row.createdAt,
      })),
  );
}

/** 记录一次反馈后决策：快照 → 纯函数 → 落库（fail-open：决策失败不阻断作答主流程） */
export async function recordLearningDecision(input: {
  learnerId: string;
  knowledgePointId: string;
  triggerType: DecisionTrigger;
  assetId?: string | null;
  runId?: string | null;
  bktBefore: { pMastery: number; confidence: number };
  bktAfter: { pMastery: number; confidence: number };
  attemptCount?: number;
  correctCount?: number;
  masteryFeedback?: 'low' | 'medium' | 'high' | null;
  difficultyRating?: number | null;
  resourceDifficulty?: number | null;
  expectedSuccessRate?: number | null;
  prereqGap?: number;
}): Promise<LearningDecisionView | null> {
  try {
    const recentDecisions = await recentHints(input.learnerId, input.knowledgePointId);
    const snapshot = await saveRunSnapshot({
      runId: `feedback-${randomUUID()}`,
      learnerId: input.learnerId,
      snapshotType: 'feedback_update',
    });
    const output = decideLearningNextStep({
      triggerType: input.triggerType,
      knowledgePointId: input.knowledgePointId,
      bktBefore: input.bktBefore,
      bktAfter: input.bktAfter,
      attemptCount: input.attemptCount ?? 0,
      correctCount: input.correctCount ?? 0,
      masteryFeedback: input.masteryFeedback ?? null,
      difficultyRating: input.difficultyRating ?? null,
      resourceDifficulty: input.resourceDifficulty ?? null,
      expectedSuccessRate: input.expectedSuccessRate ?? null,
      prereqGap: input.prereqGap ?? 0,
      recentDecisions,
    });
    const id = `decision-${randomUUID()}`;
    await getLearningDatabase().db.insert(learningDecisions).values({
      id,
      learnerId: input.learnerId,
      runId: input.runId ?? null,
      assetId: input.assetId ?? null,
      knowledgePointId: input.knowledgePointId,
      triggerType: input.triggerType,
      inputSnapshotId: snapshot.id,
      decision: output.decision,
      recommendedResourceType: output.recommendedResourceType,
      rationaleJson: output.rationale as unknown as Record<string, unknown>,
      createdAt: Date.now(),
    });
    await learningStore.recordLearningEvent(input.learnerId, 'learning_decision_recorded', {
      decisionId: id, knowledgePointId: input.knowledgePointId, triggerType: input.triggerType,
      decision: output.decision, recommendedResourceType: output.recommendedResourceType,
    });
    return {
      id,
      knowledgePointId: input.knowledgePointId,
      triggerType: input.triggerType,
      decision: output.decision,
      recommendedResourceType: output.recommendedResourceType,
      rationale: output.rationale as unknown as Record<string, unknown>,
      assetId: input.assetId ?? null,
      runId: input.runId ?? null,
      createdAt: Date.now(),
      recommendationLevel: decisionToRecommendationLevel(output.decision),
    };
  } catch (error) {
    console.error('[decision] 记录学习决策失败：', error instanceof Error ? error.message : error);
    return null;
  }
}

export async function listDecisions(learnerId: string, limit = 20): Promise<LearningDecisionView[]> {
  const rows = await getLearningDatabase().db
    .select().from(learningDecisions)
    .where(eq(learningDecisions.learnerId, learnerId))
    .orderBy(desc(learningDecisions.createdAt))
    .limit(limit);
  return rows.map((row) => ({
    id: row.id,
    knowledgePointId: row.knowledgePointId,
    triggerType: row.triggerType as DecisionTrigger,
    decision: row.decision as DecisionKind,
    recommendedResourceType: (row.recommendedResourceType as LearningResourceType | null) ?? null,
    rationale: (row.rationaleJson as Record<string, unknown>) ?? {},
    assetId: row.assetId,
    runId: row.runId,
    createdAt: row.createdAt,
    recommendationLevel: decisionToRecommendationLevel(row.decision as DecisionKind),
  }));
}

/** 每个知识点的最近一条决策（路径节点建议优先消费） */
export async function latestDecisionByKnowledgePoint(learnerId: string): Promise<Map<string, LearningDecisionView>> {
  const rows = await listDecisions(learnerId, 80);
  const byKp = new Map<string, LearningDecisionView>();
  for (const row of rows) {
    if (!byKp.has(row.knowledgePointId)) byKp.set(row.knowledgePointId, row);
  }
  return byKp;
}

/** 最近一次 BKT 更新的前后值（作答触发时由 applySkillObservation 写入 bkt_updates） */
export async function latestBktUpdate(learnerId: string, knowledgePointId: string): Promise<{ before: { pMastery: number; confidence: number }; after: { pMastery: number; confidence: number } } | null> {
  const row = (await getLearningDatabase().pool.query(
    `SELECT before, after FROM bkt_updates
     WHERE learner_id = $1 AND knowledge_point_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [learnerId, knowledgePointId],
  )).rows[0] as { before: { pMastery: number; confidence: number }; after: { pMastery: number; confidence: number } } | undefined;
  return row ?? null;
}

/** 单份习题资产内的作答统计（会话范围：本次资源） */
export async function assetAttemptStats(learnerId: string, assetId: string): Promise<{ attemptCount: number; correctCount: number; avgDurationMs: number | null }> {
  const row = (await getLearningDatabase().pool.query(
    `SELECT COUNT(*)::int AS "attemptCount", COALESCE(SUM(CASE WHEN correct THEN 1 ELSE 0 END), 0)::int AS "correctCount",
       AVG(duration_ms)::float AS "avgDurationMs"
     FROM learning_quiz_attempts WHERE learner_id = $1 AND asset_id = $2`,
    [learnerId, assetId],
  )).rows[0] as { attemptCount: number; correctCount: number; avgDurationMs: number | null };
  return { attemptCount: Number(row.attemptCount), correctCount: Number(row.correctCount), avgDurationMs: row.avgDurationMs === null ? null : Number(row.avgDurationMs) };
}

/** 先修未掌握比例：按路径前置边与 BKT 状态计算（0~1；无先修记 0） */
export async function prereqGapFor(learnerId: string, knowledgePointId: string): Promise<number> {
  try {
    const graph = await learningStore.getPathGraph(learnerId);
    const target = graph.nodes.find((node) => node.knowledgePointId === knowledgePointId);
    if (!target) return 0;
    const prereqIds = graph.edges
      .filter((edge) => edge.toNodeId === target.id && /prereq|before|先行|前置/i.test(edge.relation))
      .map((edge) => edge.fromNodeId);
    if (prereqIds.length === 0) return 0;
    const states = await learningStore.getSkillStates(learnerId);
    const stateByKp = new Map(states.map((state) => [state.knowledgePointId, state]));
    const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
    const mastered = prereqIds.filter((id) => {
      const node = nodeById.get(id);
      if (!node) return true;
      if (node.mastered || node.userStatus === 'completed') return true;
      const state = stateByKp.get(node.knowledgePointId);
      return Boolean(state && state.pMastery >= 0.6);
    }).length;
    return Number((1 - mastered / prereqIds.length).toFixed(3));
  } catch {
    return 0;
  }
}
