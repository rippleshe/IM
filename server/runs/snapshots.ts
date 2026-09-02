/**
 * 学情状态快照（docs/挑战杯技术开发总规.md §6）
 *
 * - run_start：createStudyRun 时立即固化，后续 BKT 变化不影响（修 G7 导出语义）；
 * - generation_end：发布收尾时固化，供前后对照；
 * - feedback_update：作答/反馈驱动决策时固化（里程碑 E 接入）。
 * 快照内容只含学习者本人数据；读取按 run + learner 双重校验。
 */
import { and, desc, eq } from 'drizzle-orm';
import { getLearningDatabase } from '../db/client.js';
import { runStateSnapshots } from '../db/schema.js';
import { sha256, stableStringify } from './artifacts.js';
import { learningStore } from '../study-context.js';

export type SnapshotType = 'run_start' | 'generation_end' | 'feedback_update';

export interface RunStateSnapshot {
  id: string;
  runId: string;
  learnerId: string;
  snapshotType: SnapshotType;
  pathNodeId: string | null;
  skillStates: Array<Record<string, unknown>>;
  profileSummary: Record<string, unknown>;
  sourceEventId: string | null;
  contentHash: string;
  createdAt: number;
}

/** 当前学情状态的可快照投影：技能状态 + 画像概要 */
async function captureLearnerState(learnerId: string): Promise<{
  skillStates: Array<Record<string, unknown>>;
  profileSummary: Record<string, unknown>;
}> {
  const [skillStates, profile] = await Promise.all([
    learningStore.getSkillStates(learnerId),
    learningStore.getProfile(learnerId),
  ]);
  return {
    skillStates: skillStates as unknown as Array<Record<string, unknown>>,
    profileSummary: {
      accuracy: profile.accuracy,
      studyMinutes: profile.studyMinutes,
      assetsCount: profile.assetsCount,
      skills: profile.skills.slice(0, 12),
    },
  };
}

function snapshotContentHash(input: {
  runId: string;
  learnerId: string;
  snapshotType: SnapshotType;
  pathNodeId: string | null;
  skillStates: Array<Record<string, unknown>>;
  profileSummary: Record<string, unknown>;
}): string {
  return sha256(stableStringify({
    runId: input.runId,
    learnerId: input.learnerId,
    snapshotType: input.snapshotType,
    pathNodeId: input.pathNodeId,
    skillStates: input.skillStates,
    profileSummary: input.profileSummary,
  }));
}

/** 保存快照（幂等）：同 (run, type) 唯一，重复调用返回既有快照 */
export async function saveRunSnapshot(input: {
  runId: string;
  learnerId: string;
  snapshotType: SnapshotType;
  pathNodeId?: string | null;
  sourceEventId?: string | null;
}): Promise<RunStateSnapshot> {
  const pathNodeId = input.pathNodeId ?? null;
  const state = await captureLearnerState(input.learnerId);
  const id = `${input.runId}:${input.snapshotType}`;
  const contentHash = snapshotContentHash({
    runId: input.runId,
    learnerId: input.learnerId,
    snapshotType: input.snapshotType,
    pathNodeId,
    skillStates: state.skillStates,
    profileSummary: state.profileSummary,
  });
  const database = getLearningDatabase().db;
  const inserted = await database
    .insert(runStateSnapshots)
    .values({
      id,
      runId: input.runId,
      learnerId: input.learnerId,
      snapshotType: input.snapshotType,
      pathNodeId,
      skillStatesJson: state.skillStates,
      profileSummaryJson: state.profileSummary,
      sourceEventId: input.sourceEventId ?? null,
      contentHash,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return rowToSnapshot(inserted[0]);
  const existing = await getRunSnapshot(input.runId, input.snapshotType);
  if (existing) return existing;
  throw new Error(`学情快照持久化失败且无法回读：${id}`);
}

function rowToSnapshot(row: typeof runStateSnapshots.$inferSelect): RunStateSnapshot {
  return {
    id: row.id,
    runId: row.runId,
    learnerId: row.learnerId,
    snapshotType: row.snapshotType as SnapshotType,
    pathNodeId: row.pathNodeId,
    skillStates: (row.skillStatesJson as Array<Record<string, unknown>>) ?? [],
    profileSummary: (row.profileSummaryJson as Record<string, unknown>) ?? {},
    sourceEventId: row.sourceEventId,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
  };
}

export async function getRunSnapshot(runId: string, snapshotType: SnapshotType): Promise<RunStateSnapshot | null> {
  const rows = await getLearningDatabase().db
    .select().from(runStateSnapshots)
    .where(and(eq(runStateSnapshots.runId, runId), eq(runStateSnapshots.snapshotType, snapshotType)))
    .limit(1);
  return rows[0] ? rowToSnapshot(rows[0]) : null;
}

/** 学习者隔离读取：learnerId 不匹配视为不存在 */
export async function getRunSnapshotForLearner(learnerId: string, runId: string, snapshotType: SnapshotType): Promise<RunStateSnapshot | null> {
  const rows = await getLearningDatabase().db
    .select().from(runStateSnapshots)
    .where(and(
      eq(runStateSnapshots.runId, runId),
      eq(runStateSnapshots.snapshotType, snapshotType),
      eq(runStateSnapshots.learnerId, learnerId),
    ))
    .limit(1);
  return rows[0] ? rowToSnapshot(rows[0]) : null;
}

/** 学习者最近的快照（画像弹窗 before/after 展示用） */
export async function listLearnerSnapshots(learnerId: string, limit = 20): Promise<RunStateSnapshot[]> {
  const rows = await getLearningDatabase().db
    .select().from(runStateSnapshots)
    .where(eq(runStateSnapshots.learnerId, learnerId))
    .orderBy(desc(runStateSnapshots.createdAt))
    .limit(limit);
  return rows.map(rowToSnapshot);
}
