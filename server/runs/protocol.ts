/**
 * 运行事件协议（docs/挑战杯技术开发总规.md §4）
 *
 * RunEvent 是学习页协同展示的唯一事件源：SSE id = run 内单调 seq，
 * 摘要只含面向用户的公开结论，不携带模型隐式思维链。
 */
import type { LearningResourceType } from '../../src/learning/types.js';

/** 六个固定职责角色（与 server/index.ts LEARNING_AGENT_IDS 对齐） */
export const LEARNING_AGENT_ROLES = [
  'learning_planning',
  'evidence_retrieval',
  'domain_expert',
  'resource_generation',
  'cross_validation',
  'privacy_compliance',
] as const;

export type LearningAgentId = (typeof LEARNING_AGENT_ROLES)[number];

/** 不可跳过的门禁节点：审核（Claim 裁决/反方质询/证据裁决）与隐私合规 */
export const MANDATORY_NODE_KEYS = [
  'audit.claims',
  'debate.challenge',
  'adjudicate.verdict',
  'privacy.compliance',
  'finalize.publish',
] as const;

export const BUSINESS_ROLES: readonly LearningAgentId[] = [
  'learning_planning',
  'evidence_retrieval',
  'domain_expert',
  'resource_generation',
];

/** 一次运行至少执行的业务角色数（总规 §5.2） */
export const MIN_BUSINESS_ROLES = 3;

/** 失败重试上限：首次 + 最多重试 2 次 */
export const NODE_RETRY_LIMIT = 2;

/** 资源修订预算：最多修订 2 次，仍不合格禁止发布（总规 §5.2） */
export const REVISION_BUDGET = 2;

export interface TemporaryReference {
  name: string;
  content: string;
}

export interface StudyRunRequest {
  task: string;
  pathNodeId: string | null;
  resourceType: LearningResourceType;
  collaborationMode: 'auto' | 'custom';
  /** custom 模式的真实约束；门禁角色不受其影响 */
  selectedAgentIds: LearningAgentId[];
  temporaryReference?: TemporaryReference | null;
}

export type RunNodeKey =
  | 'assess.learner'
  | 'retrieve.structured'
  | 'retrieve.document'
  | 'analyze.domain'
  | 'generate.resource'
  | 'audit.claims'
  | 'debate.challenge'
  | 'adjudicate.verdict'
  | 'privacy.compliance'
  | 'finalize.publish';

export interface RunNodeSpec {
  key: RunNodeKey;
  role: LearningAgentId;
  title: string;
  dependsOn: RunNodeKey[];
  mandatory: boolean;
  /** 失败最多重试 2 次（首次执行 + 2 次重试） */
  retryLimit: number;
  timeoutMs: number;
}

export type RunRiskLevel = 'low' | 'medium' | 'high';

export interface StudyRunPlan {
  runId: string;
  nodes: RunNodeSpec[];
  /** mandatory 节点键集合，展示与校验用 */
  gates: RunNodeKey[];
  riskLevel: RunRiskLevel;
  revisionBudget: number;
  /** 裁决从严：partial 也视为不通过（知识风险高时开启） */
  strictAdjudication: boolean;
  /** 反方质询重点（画像不确定度高时加入难度适配议题） */
  challengeFocus: Array<'no_evidence' | 'conflict' | 'out_of_scope_causality' | 'difficulty_mismatch'>;
}

export type RunEventType =
  | 'run.accepted'
  | 'node.started'
  | 'node.progress'
  | 'node.succeeded'
  | 'node.failed'
  | 'node.retrying'
  | 'run.revision'
  | 'run.cancelled'
  | 'run.succeeded'
  | 'run.failed';

export interface RunEvent {
  /** run 内单调递增，SSE 的 id 与 Last-Event-ID 续传依据 */
  seq: number;
  runId: string;
  nodeKey: RunNodeKey | null;
  type: RunEventType;
  /** 面向用户的公开摘要，不含思维链 */
  summary: string;
  payload?: Record<string, unknown>;
  /** ISO 时间戳 */
  createdAt: string;
}

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export const NODE_TITLES: Record<RunNodeKey, string> = {
  'assess.learner': '学情建模',
  'retrieve.structured': '结构化证据检索',
  'retrieve.document': '文档证据检索',
  'analyze.domain': '领域分析',
  'generate.resource': '资源生成',
  'audit.claims': 'Claim 逐条审核',
  'debate.challenge': '反方质询',
  'adjudicate.verdict': '证据裁决',
  'privacy.compliance': '隐私合规',
  'finalize.publish': '发布收尾',
};

export const ROLE_LABELS: Record<LearningAgentId, string> = {
  learning_planning: '学情与路径智能体',
  evidence_retrieval: '知识检索智能体',
  domain_expert: '领域诊断智能体',
  resource_generation: '资源生成智能体',
  cross_validation: '交叉验证与审核智能体',
  privacy_compliance: '合规与隐私智能体',
};

/** SSE 帧编码：id=seq 供 Last-Event-ID 续传（总规 §4.4） */
export function formatSseEvent(event: RunEvent): string {
  const data = JSON.stringify({
    runId: event.runId,
    nodeKey: event.nodeKey,
    summary: event.summary,
    payload: event.payload ?? null,
    createdAt: event.createdAt,
  });
  return `id: ${event.seq}\nevent: ${event.type}\ndata: ${data}\n\n`;
}
