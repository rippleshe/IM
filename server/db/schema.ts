/**
 * IM-Training-Agent PostgreSQL 领域模型（docs/挑战杯技术开发总规.md §6.1）
 *
 * 约定：
 * - PostgreSQL 是唯一业务数据源；Redis 只做队列/锁/事件分发。
 * - 所有学习数据表必须包含 learner_id，服务层按会话推导并强制隔离。
 * - 时间列统一 epoch 毫秒（bigint，与迁移源 SQLite 的 INTEGER 毫秒一一对应）。
 * - 枚举用 text + CHECK，避免 PG 枚举类型的迁移负担。
 * - 临时上传只存哈希、大小、有效期与审计结论，正文不落库。
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  unique,
  vector,
} from 'drizzle-orm/pg-core';

const ms = (name: string) => bigint(name, { mode: 'number' });

/* ------------------------------------------------------------------ */
/* 1. 身份与会话                                                        */
/* ------------------------------------------------------------------ */

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  loginName: text('login_name').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarKey: text('avatar_key').notNull().default('graphite'),
  /** 用户自传头像（缩图 data URL）；NULL = 使用 avatarKey 色块首字母 */
  avatarImage: text('avatar_image'),
  passwordHash: text('password_hash').notNull(),
  passwordSalt: text('password_salt').notNull(),
  onboardingCompleted: boolean('onboarding_completed').notNull().default(false),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
});

export const authSessions = pgTable(
  'auth_sessions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: ms('expires_at').notNull(),
    createdAt: ms('created_at').notNull(),
    lastSeenAt: ms('last_seen_at').notNull(),
  },
  (t) => [index('idx_auth_sessions_token').on(t.tokenHash, t.expiresAt)],
);

export const learnerOnboarding = pgTable('learner_onboarding', {
  learnerId: text('learner_id').primaryKey(),
  role: text('role').notNull(),
  programmingFoundation: text('programming_foundation').notNull(),
  goal: text('goal').notNull(),
  weeklyHours: doublePrecision('weekly_hours'),
  selfDescription: text('self_description').notNull(),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
});

/* ------------------------------------------------------------------ */
/* 2. 画像与诊断                                                        */
/* ------------------------------------------------------------------ */

export const learnerProfileSnapshots = pgTable(
  'learner_profile_snapshots',
  {
    id: text('id').primaryKey(),
    learnerId: text('learner_id').notNull(),
    summary: text('summary').notNull(),
    keywordsJson: jsonb('keywords_json').notNull(),
    radarJson: jsonb('radar_json').notNull(),
    generatedAt: ms('generated_at').notNull(),
  },
  (t) => [index('idx_profile_learner').on(t.learnerId, t.generatedAt)],
);

/** 12 道初始诊断题（总规 §7.3），题集固定、代码唯一 */
export const diagnosticQuestions = pgTable('diagnostic_questions', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  dimension: text('dimension').notNull(),
  level: text('level').notNull(),
  knowledgePointId: text('knowledge_point_id').notNull(),
  prompt: text('prompt').notNull(),
  options: jsonb('options').notNull(),
  answerId: text('answer_id').notNull(),
  explanation: text('explanation').notNull(),
  evidenceRef: text('evidence_ref'),
  sortOrder: integer('sort_order').notNull(),
  active: boolean('active').notNull().default(true),
}, (t) => [
  check('ck_diag_dimension', sql`${t.dimension} in ('python','data_processing','statistics','time_series','device_diagnosis')`),
  check('ck_diag_level', sql`${t.level} in ('L1','L2','L3')`),
]);

export const diagnosticSessions = pgTable('diagnostic_sessions', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  status: text('status').notNull().default('in_progress'),
  priorSnapshot: jsonb('prior_snapshot').notNull().default({}),
  result: jsonb('result'),
  startedAt: ms('started_at').notNull(),
  completedAt: ms('completed_at'),
}, (t) => [
  check('ck_diag_session_status', sql`${t.status} in ('in_progress','completed','abandoned')`),
  index('idx_diag_sessions_learner').on(t.learnerId, t.startedAt),
]);

export const diagnosticAnswers = pgTable('diagnostic_answers', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  learnerId: text('learner_id').notNull(),
  questionId: text('question_id').notNull(),
  answerId: text('answer_id').notNull(),
  correct: boolean('correct').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  answeredAt: ms('answered_at').notNull(),
}, (t) => [index('idx_diag_answers_session').on(t.sessionId, t.questionId)]);

/* ------------------------------------------------------------------ */
/* 3. 知识状态（BKT）与路径                                              */
/* ------------------------------------------------------------------ */

/** BKT 知识状态：掌握概率、猜测率、失误率、学习转移率与置信度（总规 §7.1） */
export const learnerSkillStates = pgTable('learner_skill_states',
  {
    learnerId: text('learner_id').notNull(),
    knowledgePointId: text('knowledge_point_id').notNull(),
    pMastery: doublePrecision('p_mastery').notNull().default(0.2),
    pGuess: doublePrecision('p_guess').notNull().default(0.25),
    pSlip: doublePrecision('p_slip').notNull().default(0.1),
    pLearn: doublePrecision('p_learn').notNull().default(0.1),
    confidence: doublePrecision('confidence').notNull().default(0.1),
    attemptCount: integer('attempt_count').notNull().default(0),
    correctCount: integer('correct_count').notNull().default(0),
    evidenceSource: text('evidence_source').notNull().default('none'),
    updatedAt: ms('updated_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.learnerId, t.knowledgePointId] }),
    check('ck_skill_p_mastery', sql`${t.pMastery} >= 0 and ${t.pMastery} <= 1`),
    check('ck_skill_confidence', sql`${t.confidence} >= 0 and ${t.confidence} <= 1`),
  ],
);

/** 每次 BKT 状态变更的可审计记录（前后值 + 触发事件） */
export const bktUpdates = pgTable('bkt_updates', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  knowledgePointId: text('knowledge_point_id').notNull(),
  triggerType: text('trigger_type').notNull(),
  before: jsonb('before').notNull(),
  after: jsonb('after').notNull(),
  detail: jsonb('detail').notNull().default({}),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_bkt_updates_learner').on(t.learnerId, t.knowledgePointId, t.createdAt)]);

export const learningPathNodes = pgTable('learning_path_nodes', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  knowledgePointId: text('knowledge_point_id').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull(),
  userStatus: text('user_status').notNull().default('not_started'),
  mastered: boolean('mastered').notNull().default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [index('idx_path_nodes_learner').on(t.learnerId, t.sortOrder, t.updatedAt)]);

export const learningPathEdges = pgTable('learning_path_edges', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  fromNodeId: text('from_node_id').notNull(),
  toNodeId: text('to_node_id').notNull(),
  relation: text('relation').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  unique('uq_path_edge').on(t.learnerId, t.fromNodeId, t.toNodeId, t.relation),
  index('idx_path_edges_learner').on(t.learnerId, t.fromNodeId, t.toNodeId),
]);

/* ------------------------------------------------------------------ */
/* 4. 资源与反馈                                                        */
/* ------------------------------------------------------------------ */

export const learningAssets = pgTable('learning_assets', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  sessionId: text('session_id'),
  type: text('type').notNull(),
  title: text('title').notNull(),
  contentJson: jsonb('content_json').notNull(),
  /** 难度校准输出（总规 §7.2），替换历史硬编码 0.42 */
  difficulty: doublePrecision('difficulty'),
  difficultyCalibration: jsonb('difficulty_calibration'),
  auditStatus: text('audit_status').notNull(),
  evidenceIdsJson: jsonb('evidence_ids_json').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_assets_learner').on(t.learnerId, t.createdAt)]);

export const learningAssetFeedback = pgTable('learning_asset_feedback', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  assetId: text('asset_id').notNull(),
  completed: boolean('completed').notNull().default(false),
  mastered: boolean('mastered').notNull().default(false),
  masteryLevel: text('mastery_level'),
  difficultyRating: integer('difficulty_rating'),
  userRating: integer('user_rating'),
  note: text('note'),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [
  unique('uq_asset_feedback').on(t.learnerId, t.assetId),
  index('idx_asset_feedback_learner').on(t.learnerId, t.updatedAt),
]);

export const learningAssetPageNotes = pgTable('learning_asset_page_notes', {
  learnerId: text('learner_id').notNull(),
  assetId: text('asset_id').notNull(),
  pageKey: text('page_key').notNull(),
  content: text('content').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [
  primaryKey({ columns: [t.learnerId, t.assetId, t.pageKey] }),
  index('idx_page_notes_asset').on(t.learnerId, t.assetId, t.updatedAt),
]);

export const learningQuizAttempts = pgTable('learning_quiz_attempts', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  assetId: text('asset_id').notNull(),
  questionId: text('question_id').notNull(),
  answerJson: jsonb('answer_json').notNull(),
  correct: boolean('correct').notNull(),
  durationMs: integer('duration_ms').notNull().default(0),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_quiz_attempts_asset').on(t.learnerId, t.assetId, t.questionId, t.createdAt)]);

export const learningChatMessages = pgTable('learning_chat_messages', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_chat_messages_learner').on(t.learnerId, t.createdAt)]);

export const learningEvents = pgTable('learning_events', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  eventType: text('event_type').notNull(),
  payloadJson: jsonb('payload_json').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_events_learner').on(t.learnerId, t.createdAt)]);

/* ------------------------------------------------------------------ */
/* 5. 领域知识与向量                                                    */
/* ------------------------------------------------------------------ */

export const datasets = pgTable('datasets', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sourceKind: text('source_kind').notNull(),
  sourcePath: text('source_path').notNull(),
  version: text('version').notNull(),
  license: text('license'),
  checksum: text('checksum'),
  importedAt: ms('imported_at').notNull(),
});

export const datasetFields = pgTable('dataset_fields', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  fieldName: text('field_name').notNull(),
  dataType: text('data_type').notNull(),
  meaning: text('meaning').notNull(),
  unit: text('unit'),
  labelRole: text('label_role'),
});

export const datasetRows = pgTable('dataset_rows', {
  datasetId: text('dataset_id').notNull(),
  rowId: integer('row_id').notNull(),
  dataJson: jsonb('data_json').notNull(),
}, (t) => [primaryKey({ columns: [t.datasetId, t.rowId] })]);

export const metroReadings = pgTable('metro_readings', {
  rowId: bigint('row_id', { mode: 'number' }).primaryKey(),
  timestamp: text('timestamp').notNull(),
  tp2: doublePrecision('tp2'),
  tp3: doublePrecision('tp3'),
  h1: doublePrecision('h1'),
  dvPressure: doublePrecision('dv_pressure'),
  reservoirs: doublePrecision('reservoirs'),
  oilTemperature: doublePrecision('oil_temperature'),
  motorCurrent: doublePrecision('motor_current'),
  comp: doublePrecision('comp'),
  dvElectric: doublePrecision('dv_electric'),
  towers: doublePrecision('towers'),
  mpg: doublePrecision('mpg'),
  lps: doublePrecision('lps'),
  pressureSwitch: doublePrecision('pressure_switch'),
  oilLevel: doublePrecision('oil_level'),
  caudalImpulses: doublePrecision('caudal_impulses'),
}, (t) => [index('idx_metro_timestamp').on(t.timestamp)]);

export const metroEventWindows = pgTable('metro_event_windows', {
  id: text('id').primaryKey(),
  datasetId: text('dataset_id').notNull(),
  label: text('label').notNull(),
  startAt: text('start_at').notNull(),
  endAt: text('end_at').notNull(),
  sourceLocator: text('source_locator').notNull(),
});

/** 领域文档切片：全文检索列 + 1024 维嵌入（text-embedding-v4），混合召回见总规 §7.5 */
export const documentChunks = pgTable('document_chunks', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  sourcePath: text('source_path').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  searchText: text('search_text').notNull(),
  locator: text('locator').notNull(),
  trustLevel: text('trust_level').notNull().default('medium'),
  embedding: vector('embedding', { dimensions: 1024 }),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  index('idx_document_source').on(t.sourceId),
  index('idx_document_chunks_fts').using(
    'gin',
    sql`to_tsvector('simple', ${t.searchText})`,
  ),
  index('idx_document_chunks_embedding').using(
    'hnsw',
    t.embedding.op('vector_cosine_ops'),
  ),
]);

/* ------------------------------------------------------------------ */
/* 6. EvidencePack 与隐私审计                                            */
/* ------------------------------------------------------------------ */

export const evidenceItems = pgTable('evidence_items', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  sourceId: text('source_id').notNull(),
  sourceTitle: text('source_title'),
  locator: text('locator').notNull(),
  content: text('content').notNull(),
  retrievalMethod: text('retrieval_method').notNull(),
  relevanceScore: doublePrecision('relevance_score').notNull(),
  trustLevel: text('trust_level').notNull(),
  sourceScope: text('source_scope').notNull().default('system'),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  createdAt: ms('created_at').notNull(),
});

export const evidencePacks = pgTable('evidence_packs', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id'),
  sessionId: text('session_id'),
  query: text('query').notNull(),
  retrievalPlanJson: jsonb('retrieval_plan_json').notNull(),
  coverageScore: doublePrecision('coverage_score').notNull(),
  crossValidationJson: jsonb('cross_validation_json').notNull(),
  privacyJson: jsonb('privacy_json').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_evidence_packs_session').on(t.sessionId, t.createdAt)]);

export const evidencePackItems = pgTable('evidence_pack_items', {
  packId: text('pack_id').notNull(),
  evidenceId: text('evidence_id').notNull(),
  position: integer('position').notNull(),
}, (t) => [
  primaryKey({ columns: [t.packId, t.evidenceId] }),
  index('idx_pack_items_evidence').on(t.evidenceId),
]);

export const privacyAuditEvents = pgTable('privacy_audit_events', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id'),
  sessionId: text('session_id'),
  eventType: text('event_type').notNull(),
  fileName: text('file_name'),
  byteCount: bigint('byte_count', { mode: 'number' }),
  contentHash: text('content_hash'),
  redactedFieldsJson: jsonb('redacted_fields_json').notNull(),
  retained: boolean('retained').notNull().default(false),
  createdAt: ms('created_at').notNull(),
});

/* ------------------------------------------------------------------ */
/* 7. 运行 DAG 与事件（总规 §4）                                         */
/* ------------------------------------------------------------------ */

export const studyRuns = pgTable('study_runs', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  requestJson: jsonb('request_json').notNull(),
  planJson: jsonb('plan_json').notNull(),
  /** 节点间传递的中间产物（证据摘要、生成草稿、审核结果），支持 Worker 重启后恢复 */
  contextJson: jsonb('context_json'),
  status: text('status').notNull().default('queued'),
  revisionRound: integer('revision_round').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('low'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  finalAssetId: text('final_asset_id'),
  createdAt: ms('created_at').notNull(),
  startedAt: ms('started_at'),
  finishedAt: ms('finished_at'),
}, (t) => [
  check('ck_run_status', sql`${t.status} in ('queued','running','succeeded','failed','cancelled')`),
  index('idx_study_runs_learner').on(t.learnerId, t.createdAt),
]);

export const studyRunNodes = pgTable('study_run_nodes', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  nodeKey: text('node_key').notNull(),
  role: text('role').notNull(),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').notNull().default('pending'),
  mandatory: boolean('mandatory').notNull().default(false),
  startedAt: ms('started_at'),
  finishedAt: ms('finished_at'),
  resultSummary: text('result_summary'),
  errorMessage: text('error_message'),
}, (t) => [
  unique('uq_run_node_attempt').on(t.runId, t.nodeKey, t.attempt),
  index('idx_run_nodes_run').on(t.runId, t.status),
  check('ck_run_node_status', sql`${t.status} in ('pending','running','succeeded','failed','skipped','cancelled')`),
]);

export const runEvents = pgTable('run_events', {
  id: bigint('id', { mode: 'number' }).generatedAlwaysAsIdentity().primaryKey(),
  runId: text('run_id').notNull(),
  seq: integer('seq').notNull(),
  nodeKey: text('node_key'),
  type: text('type').notNull(),
  summary: text('summary').notNull(),
  payload: jsonb('payload'),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  unique('uq_run_event_seq').on(t.runId, t.seq),
  index('idx_run_events_run').on(t.runId, t.seq),
]);

/* ------------------------------------------------------------------ */
/* 8. 辩论与声明图（总规 §5.2 修订环）                                    */
/* ------------------------------------------------------------------ */

export const claims = pgTable('claims', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull(),
  learnerId: text('learner_id'),
  text: text('text').notNull(),
  verdict: text('verdict').notNull(),
  critique: text('critique').notNull().default(''),
  factualScore: doublePrecision('factual_score').notNull().default(0),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_claims_resource').on(t.resourceId)]);

export const claimEvidence = pgTable('claim_evidence', {
  claimId: text('claim_id').notNull(),
  evidenceId: text('evidence_id').notNull(),
  supportLevel: text('support_level').notNull(),
}, (t) => [primaryKey({ columns: [t.claimId, t.evidenceId] })]);

/** 反方质询议题：无证据 / 证据冲突 / 越界因果 / 难度不适配（总规 §1.2 D1、§5.2） */
export const debateIssues = pgTable('debate_issues', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  resourceId: text('resource_id').notNull(),
  issueType: text('issue_type').notNull(),
  targetClaimId: text('target_claim_id'),
  argument: text('argument').notNull(),
  status: text('status').notNull().default('raised'),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  check('ck_debate_issue_type', sql`${t.issueType} in ('no_evidence','conflict','out_of_scope_causality','difficulty_mismatch')`),
  check('ck_debate_issue_status', sql`${t.status} in ('raised','accepted','rejected','resolved')`),
  index('idx_debate_issues_run').on(t.runId),
]);

/** 证据裁决记录：每轮 supported / partial / conflict / unsupported 与是否放行 */
export const auditDecisions = pgTable('audit_decisions', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  resourceId: text('resource_id').notNull(),
  round: integer('round').notNull(),
  verdict: text('verdict').notNull(),
  rationale: text('rationale').notNull().default(''),
  released: boolean('released').notNull().default(false),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  check('ck_audit_verdict', sql`${t.verdict} in ('supported','partial','conflict','unsupported')`),
  index('idx_audit_decisions_run').on(t.runId, t.round),
]);

/* ------------------------------------------------------------------ */
/* 9. 评测报告（总规 §8.2）                                              */
/* ------------------------------------------------------------------ */

export const evaluationCases = pgTable('evaluation_cases', {
  id: text('id').primaryKey(),
  code: text('code').notNull().unique(),
  persona: text('persona').notNull(),
  domain: text('domain').notNull(),
  taskLevel: text('task_level').notNull(),
  resourceType: text('resource_type').notNull(),
  task: text('task').notNull(),
  requiredKnowledgePoints: jsonb('required_knowledge_points').notNull(),
  targetDifficultyRange: jsonb('target_difficulty_range').notNull(),
  allowedEvidenceScope: jsonb('allowed_evidence_scope').notNull(),
  expectedStructure: jsonb('expected_structure').notNull(),
}, (t) => [
  check('ck_eval_persona', sql`${t.persona} in ('learner-foundation','learner-advanced','learner-maintenance')`),
  check('ck_eval_task_level', sql`${t.taskLevel} in ('basic','advanced','transfer')`),
]);

export const evaluationResults = pgTable('evaluation_results', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
  runId: text('run_id'),
  metrics: jsonb('metrics').notNull(),
  passed: boolean('passed').notNull(),
  detail: jsonb('detail').notNull().default({}),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_eval_results_case').on(t.caseId, t.createdAt)]);

/* ------------------------------------------------------------------ */
/* 迁移状态（总规 §6.3 幂等迁移）                                         */
/* ------------------------------------------------------------------ */

export const migrationState = pgTable('migration_state', {
  tableName: text('table_name').primaryKey(),
  sourceFile: text('source_file').notNull(),
  sourceFingerprint: text('source_fingerprint').notNull(),
  rowCount: bigint('row_count', { mode: 'number' }).notNull(),
  verified: boolean('verified').notNull().default(false),
  migratedAt: ms('migrated_at').notNull(),
});
