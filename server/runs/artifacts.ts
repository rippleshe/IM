/**
 * VACP 协同产物层（docs/挑战杯多智能体可信协同升级计划.md §4.1、§4.4、§5.1）
 *
 * 契约：
 * - 每个节点成功前先持久化不可变 primary artifact，再把 artifactId 写回节点行；
 * - 修订轮（attempt+1）产生新产物，旧产物不覆盖；
 * - payload 只保存公开结果，不保存隐式思维链与上传正文；
 * - contentHash 对稳定序列化后的公开内容计算，离线可重算核对。
 */
import { createHash } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { getLearningDatabase } from '../db/client.js';
import { collaborationArtifacts, studyRunNodes } from '../db/schema.js';
import type { RunNodeKey } from './protocol.js';

/** 执行者键（升级计划 §4.3）：区分真实工作职责，角色用于权限与用户选择 */
export const ACTOR_KEYS = [
  'learner_modeler',
  'structured_retriever',
  'document_retriever',
  'domain_analyst',
  'resource_author',
  'claim_auditor',
  'red_team_critic',
  'evidence_judge',
  'privacy_guard',
  'publisher',
] as const;

export type ActorKey = (typeof ACTOR_KEYS)[number];

/** 节点 → 执行者（同一节点恒定映射，可离线重算） */
export const NODE_ACTOR_KEY: Record<RunNodeKey, ActorKey> = {
  'assess.learner': 'learner_modeler',
  'retrieve.structured': 'structured_retriever',
  'retrieve.document': 'document_retriever',
  'analyze.domain': 'domain_analyst',
  'generate.resource': 'resource_author',
  'audit.claims': 'claim_auditor',
  'debate.challenge': 'red_team_critic',
  'adjudicate.verdict': 'evidence_judge',
  'privacy.compliance': 'privacy_guard',
  'finalize.publish': 'publisher',
};

export const ARTIFACT_TYPES = [
  'learner_snapshot',
  'design_constraints',
  'evidence_set',
  'domain_brief',
  'resource_draft',
  'claim_audit',
  'challenge_set',
  'adjudication',
  'privacy_decision',
  'publication_decision',
  'learning_decision',
] as const;

export type ArtifactType = (typeof ARTIFACT_TYPES)[number];

/** 公开解释契约（升级计划 §5.3）：前端可见的 Agent 结论统一格式 */
export interface PublicRationale {
  /** 看到了哪些可公开事实 */
  observations: string[];
  /** 对应画像/证据/Claim/规则 ID */
  basisRefs: string[];
  /** 做了什么决定 */
  decision: string;
  /** 哪些仍不能确定 */
  uncertainty: string[];
  nextAction: string | null;
}

export interface ArtifactProducer {
  kind: 'agent' | 'rule' | 'tool' | 'mixed';
  /** 底层模型标识；规则/工具产物为 null */
  model: string | null;
  /** 系统提示散列（模型产物） */
  promptHash: string | null;
  /** 模型路由与参数散列 */
  settingsHash: string | null;
}

export interface CollaborationArtifact {
  id: string;
  runId: string;
  learnerId: string;
  nodeKey: RunNodeKey;
  actorKey: ActorKey;
  attempt: number;
  artifactType: ArtifactType;
  inputRefs: string[];
  payload: Record<string, unknown>;
  publicRationale: PublicRationale;
  producer: ArtifactProducer;
  contentHash: string;
  createdAt: number;
}

/** 产物 ID 确定性：重试同节点同 attempt 不产生冲突新产物 */
export function artifactIdOf(runId: string, nodeKey: RunNodeKey, attempt: number, artifactType: ArtifactType): string {
  return `${runId}:${nodeKey}:${attempt}:${artifactType}`;
}

/**
 * 稳定 JSON 序列化：对象 key 递归排序后拼接。
 * 保证「相同内容、不同 key 顺序」得到完全相同的字符串，是离线重算散列一致的前提。
 */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
}

/** SHA-256（Node crypto，无新增依赖） */
export function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

/** 产物内容散列：覆盖公开内容与身份字段；payload 改一个字符结果必须变化 */
export function hashArtifactContent(input: {
  runId: string;
  nodeKey: RunNodeKey;
  actorKey: ActorKey;
  attempt: number;
  artifactType: ArtifactType;
  inputRefs: string[];
  payload: Record<string, unknown>;
  publicRationale: PublicRationale;
  producer: ArtifactProducer;
}): string {
  return sha256(stableStringify({
    runId: input.runId,
    nodeKey: input.nodeKey,
    actorKey: input.actorKey,
    attempt: input.attempt,
    artifactType: input.artifactType,
    inputRefs: input.inputRefs,
    payload: input.payload,
    publicRationale: input.publicRationale,
    producer: input.producer,
  }));
}

export interface PersistArtifactInput {
  runId: string;
  learnerId: string;
  nodeKey: RunNodeKey;
  attempt: number;
  artifactType: ArtifactType;
  inputRefs?: string[];
  payload: Record<string, unknown>;
  publicRationale: PublicRationale;
  producer: ArtifactProducer;
}

/**
 * 持久化不可变产物（幂等）：同 (run, node, attempt, type, actor) 唯一，
 * 冲突时返回既有产物——重试与重复调度不会伪造第二轮产物。
 */
export async function persistArtifact(input: PersistArtifactInput): Promise<CollaborationArtifact> {
  const actorKey = NODE_ACTOR_KEY[input.nodeKey];
  const id = artifactIdOf(input.runId, input.nodeKey, input.attempt, input.artifactType);
  const inputRefs = input.inputRefs ?? [];
  const contentHash = hashArtifactContent({
    runId: input.runId,
    nodeKey: input.nodeKey,
    actorKey,
    attempt: input.attempt,
    artifactType: input.artifactType,
    inputRefs,
    payload: input.payload,
    publicRationale: input.publicRationale,
    producer: input.producer,
  });
  const database = getLearningDatabase().db;
  const inserted = await database
    .insert(collaborationArtifacts)
    .values({
      id,
      runId: input.runId,
      learnerId: input.learnerId,
      nodeKey: input.nodeKey,
      actorKey,
      attempt: input.attempt,
      artifactType: input.artifactType,
      inputRefsJson: inputRefs,
      payloadJson: input.payload,
      publicRationaleJson: input.publicRationale,
      producerJson: input.producer,
      contentHash,
      createdAt: Date.now(),
    })
    .onConflictDoNothing()
    .returning();
  if (inserted[0]) return rowToArtifact(inserted[0]);
  const existing = await getArtifactById(id);
  if (existing) return existing;
  throw new Error(`产物持久化失败且无法回读：${id}`);
}

function rowToArtifact(row: typeof collaborationArtifacts.$inferSelect): CollaborationArtifact {
  return {
    id: row.id,
    runId: row.runId,
    learnerId: row.learnerId,
    nodeKey: row.nodeKey as RunNodeKey,
    actorKey: row.actorKey as ActorKey,
    attempt: row.attempt,
    artifactType: row.artifactType as ArtifactType,
    inputRefs: (row.inputRefsJson as string[] | null) ?? [],
    payload: (row.payloadJson as Record<string, unknown>) ?? {},
    publicRationale: row.publicRationaleJson as PublicRationale,
    producer: row.producerJson as ArtifactProducer,
    contentHash: row.contentHash,
    createdAt: row.createdAt,
  };
}

export async function getArtifactById(artifactId: string): Promise<CollaborationArtifact | null> {
  const rows = await getLearningDatabase().db
    .select().from(collaborationArtifacts)
    .where(eq(collaborationArtifacts.id, artifactId))
    .limit(1);
  return rows[0] ? rowToArtifact(rows[0]) : null;
}

/** 学习者隔离读取：learnerId 不匹配一律视为不存在 */
export async function getArtifactForLearner(learnerId: string, artifactId: string): Promise<CollaborationArtifact | null> {
  const rows = await getLearningDatabase().db
    .select().from(collaborationArtifacts)
    .where(and(eq(collaborationArtifacts.id, artifactId), eq(collaborationArtifacts.learnerId, learnerId)))
    .limit(1);
  return rows[0] ? rowToArtifact(rows[0]) : null;
}

/** 运行全量产物链：按轮次与创建顺序排列，供 trace/export/离线回放使用 */
export async function listRunArtifacts(runId: string, learnerId?: string): Promise<CollaborationArtifact[]> {
  const condition = learnerId
    ? and(eq(collaborationArtifacts.runId, runId), eq(collaborationArtifacts.learnerId, learnerId))
    : eq(collaborationArtifacts.runId, runId);
  const rows = await getLearningDatabase().db
    .select().from(collaborationArtifacts)
    .where(condition)
    .orderBy(asc(collaborationArtifacts.attempt), asc(collaborationArtifacts.createdAt), asc(collaborationArtifacts.id));
  return rows.map(rowToArtifact);
}

/** 全部产物内容散列的执行清单（升级计划 §5.1 execution manifest） */
export async function computeExecutionManifestHash(runId: string): Promise<string> {
  const artifacts = await listRunArtifacts(runId);
  return sha256(stableStringify(artifacts.map((artifact) => ({ id: artifact.id, contentHash: artifact.contentHash }))));
}

/** 把主产物引用写回节点行（节点成功前调用） */
export async function setNodePrimaryArtifact(runId: string, nodeKey: RunNodeKey, attempt: number, artifactId: string): Promise<void> {
  await getLearningDatabase().db
    .update(studyRunNodes)
    .set({ primaryArtifactId: artifactId, actorKey: NODE_ACTOR_KEY[nodeKey] })
    .where(and(
      eq(studyRunNodes.runId, runId),
      eq(studyRunNodes.nodeKey, nodeKey),
      eq(studyRunNodes.attempt, attempt),
    ));
}

/** 模型路由元数据 → producer 元数据（promptHash/settingsHash 均可离线核对） */
export function agentProducer(systemPrompt: string, settings: { model?: string; temperature?: number; maxTokens?: number }): ArtifactProducer {
  return {
    kind: 'agent',
    model: settings.model ?? null,
    promptHash: sha256(systemPrompt),
    settingsHash: sha256(stableStringify({ model: settings.model ?? null, temperature: settings.temperature ?? null, maxTokens: settings.maxTokens ?? null })),
  };
}

export const RULE_PRODUCER: ArtifactProducer = { kind: 'rule', model: null, promptHash: null, settingsHash: null };

export const TOOL_PRODUCER: ArtifactProducer = { kind: 'tool', model: null, promptHash: null, settingsHash: null };
