/**
 * IM-Training-Agent PostgreSQL 领域模型（docs/挑战杯技术开发总规.md §6.1）
 *
 * 约定：
 * - PostgreSQL 是唯一业务数据源；Redis 只做队列/锁/事件分发。
 * - 所有学习数据表必须包含 learner_id，服务层按会话推导并强制隔离。
 * - 时间列统一 epoch 毫秒（bigint）。
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
  /** 兼容旧数据库迁移；资料审核已由服务端智能策展流程负责，普通用户不使用此字段。 */
  knowledgeAdmin: boolean('knowledge_admin').notNull().default(false),
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
  /** 新来源版本；NULL 表示升级前既有知识卡或数据集说明。 */
  sourceVersionId: text('source_version_id'),
  sourcePath: text('source_path').notNull(),
  title: text('title').notNull(),
  content: text('content').notNull(),
  searchText: text('search_text').notNull(),
  locator: text('locator').notNull(),
  sectionPath: text('section_path'),
  pageStart: integer('page_start'),
  pageEnd: integer('page_end'),
  chunkType: text('chunk_type').notNull().default('text'),
  sortOrder: integer('sort_order').notNull().default(0),
  tokenCount: integer('token_count'),
  contentHash: text('content_hash'),
  enabled: boolean('enabled').notNull().default(true),
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
  index('idx_document_source_version').on(t.sourceVersionId, t.enabled),
]);

/** 受管资料的稳定身份；候选与正式来源共用一张账本。 */
export const knowledgeSources = pgTable('knowledge_sources', {
  id: text('id').primaryKey(),
  sourceType: text('source_type').notNull(),
  title: text('title').notNull(),
  shortTitle: text('short_title'),
  canonicalUrl: text('canonical_url'),
  doi: text('doi'),
  license: text('license').notNull().default('unknown'),
  trustLevel: text('trust_level').notNull().default('medium'),
  reviewStatus: text('review_status').notNull().default('candidate'),
  distributionScope: text('distribution_scope').notNull().default('local_only'),
  currentVersionId: text('current_version_id'),
  metadataJson: jsonb('metadata_json').notNull().default({}),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [
  index('idx_knowledge_sources_review').on(t.reviewStatus, t.updatedAt),
  unique('uq_knowledge_sources_url').on(t.canonicalUrl),
]);

/** 每一次内容变化都新增版本，原件和解析结果均通过本地路径及哈希定位。 */
export const knowledgeSourceVersions = pgTable('knowledge_source_versions', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull(),
  contentSha256: text('content_sha256').notNull(),
  originalPath: text('original_path').notNull(),
  extractedText: text('extracted_text'),
  extractedPath: text('extracted_path'),
  parser: text('parser').notNull(),
  parseStatus: text('parse_status').notNull(),
  qualityReport: jsonb('quality_report').notNull().default({}),
  versionStatus: text('version_status').notNull().default('candidate'),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  unique('uq_knowledge_source_version_hash').on(t.sourceId, t.contentSha256),
  index('idx_knowledge_source_versions_status').on(t.sourceId, t.versionStatus, t.createdAt),
]);

/** 导入/抓取任务的可重放执行记录，不把失败隐藏在日志中。 */
export const knowledgeIngestJobs = pgTable('knowledge_ingest_jobs', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  inputPath: text('input_path').notNull(),
  inputSha256: text('input_sha256'),
  status: text('status').notNull(),
  statsJson: jsonb('stats_json').notNull().default({}),
  errorSummary: text('error_summary'),
  createdAt: ms('created_at').notNull(),
  updatedAt: ms('updated_at').notNull(),
}, (t) => [index('idx_knowledge_ingest_jobs_status').on(t.status, t.updatedAt)]);

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
  /** 幂等键（总规 §3）：同 learner 重复提交返回既有运行 */
  idempotencyKey: text('idempotency_key'),
  requestJson: jsonb('request_json').notNull(),
  planJson: jsonb('plan_json').notNull(),
  /** 节点间传递的执行缓存（证据摘要、生成草稿、审核结果），仅用于恢复执行；
   * 不可变审计记录以 collaboration_artifacts 为唯一来源（升级计划 §4.1） */
  contextJson: jsonb('context_json'),
  status: text('status').notNull().default('queued'),
  revisionRound: integer('revision_round').notNull().default(0),
  riskLevel: text('risk_level').notNull().default('low'),
  cancelRequested: boolean('cancel_requested').notNull().default(false),
  finalAssetId: text('final_asset_id'),
  /** 运行开始时的学情快照（VACP：导出初稿画像必须取自运行起点，升级计划 G7） */
  startSnapshotId: text('start_snapshot_id'),
  /** 检索后策略修正（升级计划 §4.7）：deriveVerificationPolicy 输出 */
  verificationPolicyJson: jsonb('verification_policy_json'),
  /** 全部 artifact 内容散列的执行清单（离线完整性校验依据） */
  executionManifestHash: text('execution_manifest_hash'),
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
  /** VACP 执行者键：区分真实工作职责（升级计划 §4.3），历史行可为空 */
  actorKey: text('actor_key'),
  attempt: integer('attempt').notNull().default(1),
  status: text('status').notNull().default('pending'),
  mandatory: boolean('mandatory').notNull().default(false),
  /** 该节点成功前的主产物引用（collaboration_artifacts.id） */
  primaryArtifactId: text('primary_artifact_id'),
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

/** 苏格拉底启发式追问会话（总规 §7.4）：低置信关键知识点的多轮引导，最多 5 轮 */
export const guidanceSessions = pgTable('guidance_sessions', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  pathNodeId: text('path_node_id'),
  knowledgePointId: text('knowledge_point_id').notNull(),
  status: text('status').notNull().default('active'),
  roundCount: integer('round_count').notNull().default(0),
  /** 当前待回答的问题：首轮评价需要问题上下文，回答后更新为下一问 */
  currentQuestion: text('current_question'),
  decision: jsonb('decision'),
  createdAt: ms('created_at').notNull(),
  finishedAt: ms('finished_at'),
}, (t) => [
  check('ck_guidance_status', sql`${t.status} in ('active','finished')`),
  index('idx_guidance_sessions_learner').on(t.learnerId, t.createdAt),
]);

export const guidanceTurns = pgTable('guidance_turns', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  learnerId: text('learner_id').notNull(),
  round: integer('round').notNull(),
  question: text('question').notNull(),
  answer: text('answer').notNull(),
  evaluation: text('evaluation').notNull(),
  correct: boolean('correct').notNull(),
  bktBefore: jsonb('bkt_before').notNull(),
  bktAfter: jsonb('bkt_after').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [index('idx_guidance_turns_session').on(t.sessionId, t.round)]);

export const claims = pgTable('claims', {
  id: text('id').primaryKey(),
  resourceId: text('resource_id').notNull(),
  learnerId: text('learner_id'),
  /** 所属运行与修订轮次（升级计划 G2：按 attempt 区分初稿/修订稿 Claim） */
  runId: text('run_id'),
  attempt: integer('attempt'),
  /** 生成该轮 Claim 的草稿产物（collaboration_artifacts.id） */
  draftArtifactId: text('draft_artifact_id'),
  /** Claim 类型：数值/字段含义/方法步骤/因果判断/风险建议/非事实教学表达 */
  claimType: text('claim_type'),
  /** 同一逻辑声明跨修订轮的稳定键 */
  logicalKey: text('logical_key'),
  /** 本轮修订取代的前一轮 Claim */
  supersedesClaimId: text('supersedes_claim_id'),
  text: text('text').notNull(),
  verdict: text('verdict').notNull(),
  critique: text('critique').notNull().default(''),
  factualScore: doublePrecision('factual_score').notNull().default(0),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  index('idx_claims_resource').on(t.resourceId),
  index('idx_claims_run_attempt').on(t.runId, t.attempt),
]);

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
  /** 议题来源：rule = 确定性规则兜底，critic = 独立批评 Agent */
  source: text('source').notNull().default('rule'),
  status: text('status').notNull().default('raised'),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  check('ck_debate_issue_type', sql`${t.issueType} in ('no_evidence','conflict','out_of_scope_causality','difficulty_mismatch','counterevidence_request')`),
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
/* 8b. VACP 可验证协同协议（升级计划 §4.1、§5.1）                          */
/* ------------------------------------------------------------------ */

/**
 * 不可变协同产物：每个节点成功前先持久化主产物，修订轮产生新产物不覆盖旧产物。
 * context_json 只作执行缓存；审计、回放与离线校验以本表为唯一来源。
 */
export const collaborationArtifacts = pgTable('collaboration_artifacts', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  learnerId: text('learner_id').notNull(),
  nodeKey: text('node_key').notNull(),
  actorKey: text('actor_key').notNull(),
  attempt: integer('attempt').notNull().default(1),
  artifactType: text('artifact_type').notNull(),
  inputRefsJson: jsonb('input_refs_json').notNull().default([]),
  payloadJson: jsonb('payload_json').notNull(),
  publicRationaleJson: jsonb('public_rationale_json').notNull(),
  producerJson: jsonb('producer_json').notNull(),
  contentHash: text('content_hash').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  unique('uq_artifact_node_attempt').on(t.runId, t.nodeKey, t.attempt, t.artifactType, t.actorKey),
  index('idx_artifacts_run').on(t.runId, t.attempt, t.createdAt),
  index('idx_artifacts_learner').on(t.learnerId),
  check('ck_artifact_type', sql`${t.artifactType} in
    ('learner_snapshot','design_constraints','evidence_set','domain_brief','resource_draft',
     'claim_audit','challenge_set','adjudication','privacy_decision','publication_decision','learning_decision')`),
]);

/**
 * 学情状态快照：run_start（创建时）、generation_end（生成收尾）、feedback_update（反馈后）。
 * 导出的 initialLearnerState 必须取自 run_start 快照，不得导出时现查（升级计划 G7）。
 */
export const runStateSnapshots = pgTable('run_state_snapshots', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  learnerId: text('learner_id').notNull(),
  snapshotType: text('snapshot_type').notNull(),
  pathNodeId: text('path_node_id'),
  skillStatesJson: jsonb('skill_states_json').notNull(),
  profileSummaryJson: jsonb('profile_summary_json').notNull(),
  sourceEventId: text('source_event_id'),
  contentHash: text('content_hash').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  unique('uq_snapshot_run_type').on(t.runId, t.snapshotType),
  index('idx_snapshots_learner').on(t.learnerId, t.createdAt),
  check('ck_snapshot_type', sql`${t.snapshotType} in ('run_start','generation_end','feedback_update')`),
]);

/**
 * 反馈驱动的持久化学习决策（升级计划 里程碑 E / G12）：
 * 每次作答/反馈后的下一步动作，可追溯到触发事件、输入快照与 BKT 前后值。
 */
export const learningDecisions = pgTable('learning_decisions', {
  id: text('id').primaryKey(),
  learnerId: text('learner_id').notNull(),
  runId: text('run_id'),
  assetId: text('asset_id'),
  knowledgePointId: text('knowledge_point_id').notNull(),
  /** quiz_attempt | asset_feedback | guidance_session */
  triggerType: text('trigger_type').notNull(),
  /** 输入学情快照（run_state_snapshots.feedback_update） */
  inputSnapshotId: text('input_snapshot_id'),
  /** remediate | continue | advance | collect_more_evidence */
  decision: text('decision').notNull(),
  recommendedResourceType: text('recommended_resource_type'),
  rationaleJson: jsonb('rationale_json').notNull(),
  createdAt: ms('created_at').notNull(),
}, (t) => [
  check('ck_decision_kind', sql`${t.decision} in ('remediate','continue','advance','collect_more_evidence')`),
  index('idx_decisions_learner').on(t.learnerId, t.createdAt),
  index('idx_decisions_kp').on(t.learnerId, t.knowledgePointId, t.createdAt),
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
