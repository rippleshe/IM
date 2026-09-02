/**
 * StudyRun 持久化服务（docs/挑战杯技术开发总规.md §4.2）
 * study_runs / study_run_nodes / run_events 是运行状态唯一事实；
 * learnerId 以数据库记录为准，队列消息与 URL 不作为授权依据。
 */
import { and, asc, eq, gt } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import { createLearningDatabase, type LearningDatabase } from '../db/client.js';
import { runEvents, studyRunNodes, studyRuns } from '../db/schema.js';
import { publishRunEvent } from './events.js';
import { NODE_ACTOR_KEY } from './artifacts.js';
import { saveRunSnapshot } from './snapshots.js';
import {
  type LearningAgentId,
  type RunEvent,
  type RunEventType,
  type RunNodeKey,
  type RunStatus,
  type StudyRunPlan,
  type StudyRunRequest,
} from './protocol.js';

let instance: LearningDatabase | null = null;

function db(): LearningDatabase {
  instance ??= createLearningDatabase();
  return instance;
}

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`运行不存在或无权访问：${runId}`);
    this.name = 'RunNotFoundError';
  }
}

export interface StudyRunRow {
  id: string;
  learnerId: string;
  request: StudyRunRequest;
  plan: StudyRunPlan;
  context: Record<string, unknown>;
  status: RunStatus;
  revisionRound: number;
  riskLevel: string;
  cancelRequested: boolean;
  finalAssetId: string | null;
  /** 检索后策略修正结果（升级计划 §4.7），未修正时为 null */
  verificationPolicy: Record<string, unknown> | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface StudyRunNodeRow {
  id: string;
  runId: string;
  nodeKey: RunNodeKey;
  role: LearningAgentId;
  actorKey: string | null;
  attempt: number;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
  mandatory: boolean;
  primaryArtifactId: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  resultSummary: string | null;
  errorMessage: string | null;
}

function rowToRun(row: typeof studyRuns.$inferSelect): StudyRunRow {
  return {
    id: row.id,
    learnerId: row.learnerId,
    request: row.requestJson as StudyRunRequest,
    plan: row.planJson as StudyRunPlan,
    context: (row.contextJson as Record<string, unknown> | null) ?? {},
    status: row.status as RunStatus,
    revisionRound: row.revisionRound,
    riskLevel: row.riskLevel,
    cancelRequested: row.cancelRequested,
    finalAssetId: row.finalAssetId,
    verificationPolicy: (row.verificationPolicyJson as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

function rowToNode(row: typeof studyRunNodes.$inferSelect): StudyRunNodeRow {
  return {
    id: row.id,
    runId: row.runId,
    nodeKey: row.nodeKey as RunNodeKey,
    role: row.role as LearningAgentId,
    actorKey: row.actorKey,
    attempt: row.attempt,
    status: row.status as StudyRunNodeRow['status'],
    mandatory: row.mandatory,
    primaryArtifactId: row.primaryArtifactId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    resultSummary: row.resultSummary,
    errorMessage: row.errorMessage,
  };
}

export async function createStudyRun(input: {
  runId: string;
  learnerId: string;
  request: StudyRunRequest;
  plan: StudyRunPlan;
  idempotencyKey?: string | null;
}): Promise<StudyRunRow> {
  const now = Date.now();
  await db().db.insert(studyRuns).values({
    id: input.runId,
    learnerId: input.learnerId,
    idempotencyKey: input.idempotencyKey ?? null,
    requestJson: input.request,
    planJson: input.plan,
    contextJson: {},
    status: 'queued',
    revisionRound: 0,
    riskLevel: input.plan.riskLevel,
    cancelRequested: false,
    createdAt: now,
  });
  if (input.plan.nodes.length > 0) {
    await db().db.insert(studyRunNodes).values(input.plan.nodes.map((node) => ({
      id: `${input.runId}:${node.key}:1`,
      runId: input.runId,
      nodeKey: node.key,
      role: node.role,
      actorKey: NODE_ACTOR_KEY[node.key],
      attempt: 1,
      status: 'pending' as const,
      mandatory: node.mandatory,
    })));
  }
  // VACP（升级计划 G7）：run_start 学情快照立即固化，导出初稿画像取自这里
  const snapshot = await saveRunSnapshot({
    runId: input.runId,
    learnerId: input.learnerId,
    snapshotType: 'run_start',
    pathNodeId: input.request.pathNodeId,
  });
  await db().db.update(studyRuns).set({ startSnapshotId: snapshot.id })
    .where(eq(studyRuns.id, input.runId));
  return (await getRunById(input.runId))!;
}

export async function getRunById(runId: string): Promise<StudyRunRow | null> {
  const rows = await db().db.select().from(studyRuns).where(eq(studyRuns.id, runId)).limit(1);
  return rows[0] ? rowToRun(rows[0]) : null;
}

/**
 * 隐私门禁完成后立即从运行请求中抹掉上传正文；来源若获准沉淀，正文只保留在
 * 版本化知识来源中，否则数据库里仅留下文件名、哈希与用户选择。
 */
export async function redactRunTemporaryReference(run: StudyRunRow): Promise<void> {
  const reference = run.request.temporaryReference;
  if (!reference) return;
  await db().db.update(studyRuns).set({
    requestJson: {
      ...run.request,
      temporaryReference: {
        name: reference.name,
        content: '',
        allowKnowledgeRetention: reference.allowKnowledgeRetention === true,
      },
    },
  }).where(eq(studyRuns.id, run.id));
}

/** 幂等键查询（总规 §3）：同 learner 同 key 返回既有运行 */
export async function findRunByIdempotencyKey(learnerId: string, key: string): Promise<StudyRunRow | null> {
  const rows = await db().db.select().from(studyRuns)
    .where(and(eq(studyRuns.learnerId, learnerId), eq(studyRuns.idempotencyKey, key)))
    .limit(1);
  return rows[0] ? rowToRun(rows[0]) : null;
}

export async function getRunForLearner(learnerId: string, runId: string): Promise<StudyRunRow> {
  const rows = await db().db.select().from(studyRuns)
    .where(and(eq(studyRuns.id, runId), eq(studyRuns.learnerId, learnerId)))
    .limit(1);
  if (!rows[0]) throw new RunNotFoundError(runId);
  return rowToRun(rows[0]);
}

export async function listRunNodes(runId: string): Promise<StudyRunNodeRow[]> {
  const rows = await db().db.select().from(studyRunNodes)
    .where(eq(studyRunNodes.runId, runId))
    .orderBy(asc(studyRunNodes.attempt), asc(studyRunNodes.id));
  return rows.map(rowToNode);
}

export async function getNodeRow(runId: string, nodeKey: RunNodeKey, attempt: number): Promise<StudyRunNodeRow | null> {
  const rows = await db().db.select().from(studyRunNodes)
    .where(and(eq(studyRunNodes.runId, runId), eq(studyRunNodes.nodeKey, nodeKey), eq(studyRunNodes.attempt, attempt)))
    .limit(1);
  return rows[0] ? rowToNode(rows[0]) : null;
}

export async function setNodeStatus(
  runId: string,
  nodeKey: RunNodeKey,
  attempt: number,
  status: StudyRunNodeRow['status'],
  patch: { resultSummary?: string; errorMessage?: string } = {},
): Promise<void> {
  const now = Date.now();
  await db().db.update(studyRunNodes).set({
    status,
    ...(status === 'running' ? { startedAt: now } : {}),
    ...(status === 'succeeded' || status === 'failed' || status === 'skipped' || status === 'cancelled'
      ? { finishedAt: now }
      : {}),
    ...(patch.resultSummary !== undefined ? { resultSummary: patch.resultSummary } : {}),
    ...(patch.errorMessage !== undefined ? { errorMessage: patch.errorMessage } : {}),
  }).where(and(
    eq(studyRunNodes.runId, runId),
    eq(studyRunNodes.nodeKey, nodeKey),
    eq(studyRunNodes.attempt, attempt),
  ));
}

export async function markRunRunning(runId: string): Promise<void> {
  await db().db.update(studyRuns).set({ status: 'running', startedAt: Date.now() })
    .where(and(eq(studyRuns.id, runId), eq(studyRuns.status, 'queued')));
}

export async function finishRun(runId: string, status: Extract<RunStatus, 'succeeded' | 'failed' | 'cancelled'>, patch: { finalAssetId?: string } = {}): Promise<void> {
  const existing = await getRunById(runId);
  if (!existing || (existing.status !== 'queued' && existing.status !== 'running')) return;
  const reference = existing?.request.temporaryReference;
  await db().db.update(studyRuns).set({
    status,
    finishedAt: Date.now(),
    ...(patch.finalAssetId ? { finalAssetId: patch.finalAssetId } : {}),
    ...(reference ? {
      requestJson: {
        ...existing!.request,
        temporaryReference: { name: reference.name, content: '', allowKnowledgeRetention: reference.allowKnowledgeRetention === true },
      },
    } : {}),
  }).where(and(eq(studyRuns.id, runId), sql`${studyRuns.status} IN ('queued', 'running')`));
}

export async function setRunRevisionRound(runId: string, round: number): Promise<void> {
  await db().db.update(studyRuns).set({ revisionRound: round }).where(eq(studyRuns.id, runId));
}

/** 检索后策略修正（升级计划 §4.7）：写入 verification_policy_json */
export async function setRunVerificationPolicy(runId: string, policy: Record<string, unknown>): Promise<void> {
  await db().db.update(studyRuns).set({ verificationPolicyJson: policy }).where(eq(studyRuns.id, runId));
}

/** 发布收尾时固化全部 artifact 散列清单（升级计划 §5.1 execution manifest） */
export async function setRunExecutionManifestHash(runId: string, manifestHash: string): Promise<void> {
  await db().db.update(studyRuns).set({ executionManifestHash: manifestHash }).where(eq(studyRuns.id, runId));
}

/** jsonb 顶层键原子合并；并行节点写不同顶层键即可避免覆盖 */
export async function mergeRunContext(runId: string, patch: Record<string, unknown>): Promise<void> {
  await db().db.update(studyRuns).set({
    contextJson: sql`coalesce(${studyRuns.contextJson}, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
  }).where(eq(studyRuns.id, runId));
}

export async function requestCancelRun(learnerId: string, runId: string): Promise<StudyRunRow> {
  const run = await getRunForLearner(learnerId, runId);
  if (run.status === 'queued' || run.status === 'running') {
    await db().db.update(studyRuns).set({ cancelRequested: true, status: 'cancelled', finishedAt: Date.now() })
      .where(eq(studyRuns.id, runId));
    await appendRunEvent(runId, { nodeKey: null, type: 'run.cancelled', summary: '运行已被学习者取消，未完成的节点停止执行。' });
    return (await getRunById(runId))!;
  }
  return run;
}

/** 在同一数据库事务中锁定 run、分配 seq 并写事件，允许根节点并行启动但不发生序号竞争。 */
export async function appendRunEvent(
  runId: string,
  input: { nodeKey: RunNodeKey | null; type: RunEventType; summary: string; payload?: Record<string, unknown> },
): Promise<RunEvent> {
  const now = Date.now();
  const seq = await db().db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${runId}))`);
    const rows = await tx.select({ seq: sql<number>`coalesce(max(${runEvents.seq}), 0) + 1` })
      .from(runEvents)
      .where(eq(runEvents.runId, runId));
    const nextSeq = Number(rows[0]?.seq ?? 0);
    if (nextSeq <= 0) throw new Error(`run_events seq 分配失败：${runId}`);
    await tx.insert(runEvents).values({
      runId,
      seq: nextSeq,
      nodeKey: input.nodeKey,
      type: input.type,
      summary: input.summary,
      payload: input.payload ?? null,
      createdAt: now,
    });
    return nextSeq;
  });
  if (seq > 0) {
    const event: RunEvent = {
      seq,
      runId,
      nodeKey: input.nodeKey,
      type: input.type,
      summary: input.summary,
      payload: input.payload,
      createdAt: new Date(now).toISOString(),
    };
    publishRunEvent(runId, event);
    return event;
  }
  throw new Error(`run_events seq 分配失败：${runId}`);
}

export async function listEventsSince(runId: string, afterSeq: number): Promise<RunEvent[]> {
  const rows = await db().db.select().from(runEvents)
    .where(and(eq(runEvents.runId, runId), gt(runEvents.seq, afterSeq)))
    .orderBy(asc(runEvents.seq));
  return rows.map((row) => ({
    seq: row.seq,
    runId: row.runId,
    nodeKey: (row.nodeKey as RunNodeKey | null) ?? null,
    type: row.type as RunEventType,
    summary: row.summary,
    payload: (row.payload as Record<string, unknown> | null) ?? undefined,
    createdAt: new Date(row.createdAt).toISOString(),
  }));
}

/** 运行创建后调用：把无依赖的根节点入队（总规 §4.3） */
export async function enqueueRootNodes(run: StudyRunRow): Promise<void> {
  const { enqueueRunNode } = await import('./queue.js');
  const rows = await listRunNodes(run.id);
  for (const row of rows) {
    const spec = run.plan.nodes.find((node) => node.key === row.nodeKey);
    if (spec && spec.dependsOn.length === 0) {
      await enqueueRunNode(run.id, row.nodeKey, row.attempt);
    }
  }
}
