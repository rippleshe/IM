import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

interface SqliteStatement {
  run(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  close(): void;
}

function ensureColumn(db: SqliteDatabase, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

const require = createRequire(import.meta.url);
const { DatabaseSync } = require('node:sqlite') as {
  DatabaseSync: new (filePath: string) => SqliteDatabase;
};

export function openSqlite(filePath: string): SqliteDatabase {
  mkdirSync(path.dirname(filePath), { recursive: true });
  return new DatabaseSync(filePath);
}

export function getLearningDatabasePath(): string {
  return path.resolve(
    process.env['IM_TRAINING_AGENT_LEARNING_DB'] ||
      path.join(process.cwd(), '.im-training-agent', 'learning.sqlite'),
  );
}

export function getDatasetDatabasePath(): string {
  return path.resolve(
    process.env['IM_TRAINING_AGENT_DATASET_DB'] ||
      path.join(process.cwd(), '.im-training-agent', 'datasets.sqlite'),
  );
}

export function initializeLearningDatabase(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      login_name TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL,
      avatar_key TEXT NOT NULL DEFAULT 'graphite',
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      onboarding_completed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learner_onboarding (
      learner_id TEXT PRIMARY KEY,
      role TEXT NOT NULL,
      programming_foundation TEXT NOT NULL,
      goal TEXT NOT NULL,
      weekly_hours REAL,
      self_description TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_assets (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      session_id TEXT,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      content_json TEXT NOT NULL,
      audit_status TEXT NOT NULL,
      evidence_ids_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_events (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_chat_messages (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learner_skill_states (
      learner_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      mastery REAL NOT NULL DEFAULT 0.2,
      confidence REAL NOT NULL DEFAULT 0.1,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      correct_count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (learner_id, knowledge_point_id)
    );
    CREATE TABLE IF NOT EXISTS bkt_updates (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      before_json TEXT NOT NULL,
      after_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diagnostic_sessions (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'completed',
      total INTEGER NOT NULL DEFAULT 0,
      correct INTEGER NOT NULL DEFAULT 0,
      by_dimension_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS diagnostic_answers (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      learner_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_id TEXT NOT NULL,
      correct INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learner_profile_snapshots (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      keywords_json TEXT NOT NULL,
      radar_json TEXT NOT NULL,
      generated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_path_nodes (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      knowledge_point_id TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      user_status TEXT NOT NULL DEFAULT 'not_started',
      mastered INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_path_edges (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      from_node_id TEXT NOT NULL,
      to_node_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(learner_id, from_node_id, to_node_id, relation)
    );
    CREATE TABLE IF NOT EXISTS learning_asset_feedback (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      mastered INTEGER NOT NULL DEFAULT 0,
      mastery_level TEXT,
      difficulty_rating INTEGER,
      user_rating INTEGER,
      note TEXT,
      updated_at INTEGER NOT NULL,
      UNIQUE(learner_id, asset_id)
    );
    CREATE TABLE IF NOT EXISTS learning_asset_page_notes (
      learner_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      page_key TEXT NOT NULL,
      content TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (learner_id, asset_id, page_key)
    );
    CREATE TABLE IF NOT EXISTS learning_quiz_attempts (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      question_id TEXT NOT NULL,
      answer_json TEXT NOT NULL,
      correct INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_title TEXT,
      locator TEXT NOT NULL,
      content TEXT NOT NULL,
      retrieval_method TEXT NOT NULL,
      relevance_score REAL NOT NULL,
      trust_level TEXT NOT NULL,
      source_scope TEXT NOT NULL DEFAULT 'system',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_packs (
      id TEXT PRIMARY KEY,
      learner_id TEXT,
      session_id TEXT,
      query TEXT NOT NULL,
      retrieval_plan_json TEXT NOT NULL,
      coverage_score REAL NOT NULL,
      cross_validation_json TEXT NOT NULL,
      privacy_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_pack_items (
      pack_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      position INTEGER NOT NULL,
      PRIMARY KEY (pack_id, evidence_id)
    );
    CREATE TABLE IF NOT EXISTS privacy_audit_events (
      id TEXT PRIMARY KEY,
      learner_id TEXT,
      session_id TEXT,
      event_type TEXT NOT NULL,
      file_name TEXT,
      byte_count INTEGER,
      content_hash TEXT,
      redacted_fields_json TEXT NOT NULL,
      retained INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      resource_id TEXT NOT NULL,
      text TEXT NOT NULL,
      verdict TEXT NOT NULL,
      critique TEXT NOT NULL,
      factual_score REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_evidence (
      claim_id TEXT NOT NULL,
      evidence_id TEXT NOT NULL,
      support_level TEXT NOT NULL,
      PRIMARY KEY (claim_id, evidence_id)
    );
    CREATE INDEX IF NOT EXISTS idx_assets_learner ON learning_assets(learner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash, expires_at);
    CREATE INDEX IF NOT EXISTS idx_path_nodes_learner ON learning_path_nodes(learner_id, sort_order, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_path_edges_learner ON learning_path_edges(learner_id, from_node_id, to_node_id);
    CREATE INDEX IF NOT EXISTS idx_asset_feedback_learner ON learning_asset_feedback(learner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_page_notes_asset ON learning_asset_page_notes(learner_id, asset_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_quiz_attempts_asset ON learning_quiz_attempts(learner_id, asset_id, question_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_events_learner ON learning_events(learner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_learner ON learning_chat_messages(learner_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_profile_learner ON learner_profile_snapshots(learner_id, generated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evidence_packs_session ON evidence_packs(session_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pack_items_evidence ON evidence_pack_items(evidence_id);
  `);
  ensureColumn(db, 'evidence_items', 'source_title', 'TEXT');
  ensureColumn(db, 'evidence_items', 'source_scope', "TEXT NOT NULL DEFAULT 'system'");
  ensureColumn(db, 'evidence_items', 'metadata_json', "TEXT NOT NULL DEFAULT '{}'");
  ensureColumn(db, 'users', 'avatar_key', "TEXT NOT NULL DEFAULT 'graphite'");
  ensureColumn(db, 'learning_asset_feedback', 'mastery_level', 'TEXT');
  // BKT 参数列（总规 §7.1）：迁移源只有 mastery/confidence，参数走默认值
  ensureColumn(db, 'learner_skill_states', 'p_guess', 'REAL NOT NULL DEFAULT 0.25');
  ensureColumn(db, 'learner_skill_states', 'p_slip', 'REAL NOT NULL DEFAULT 0.1');
  ensureColumn(db, 'learner_skill_states', 'p_learn', 'REAL NOT NULL DEFAULT 0.1');
  ensureColumn(db, 'learner_skill_states', 'evidence_source', "TEXT NOT NULL DEFAULT 'none'");
  // 资源难度校准（总规 §7.2）：替换历史硬编码 0.42
  ensureColumn(db, 'learning_assets', 'difficulty', 'REAL');
  ensureColumn(db, 'learning_assets', 'difficulty_calibration', 'TEXT');
  ensureColumn(db, 'diagnostic_sessions', 'result_json', "TEXT NOT NULL DEFAULT '{}'");
  // 旧平铺路径表退役（学习路径唯一数据源是 learning_path_nodes/edges 图表）：启动即清理遗留
  db.exec('DROP TABLE IF EXISTS learning_path_items');
}

export function initializeDatasetDatabase(db: SqliteDatabase): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_path TEXT NOT NULL,
      version TEXT NOT NULL,
      license TEXT,
      checksum TEXT,
      imported_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dataset_fields (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      field_name TEXT NOT NULL,
      data_type TEXT NOT NULL,
      meaning TEXT NOT NULL,
      unit TEXT,
      label_role TEXT
    );
    CREATE TABLE IF NOT EXISTS metro_readings (
      row_id INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      tp2 REAL,
      tp3 REAL,
      h1 REAL,
      dv_pressure REAL,
      reservoirs REAL,
      oil_temperature REAL,
      motor_current REAL,
      comp REAL,
      dv_electric REAL,
      towers REAL,
      mpg REAL,
      lps REAL,
      pressure_switch REAL,
      oil_level REAL,
      caudal_impulses REAL
    );
    CREATE TABLE IF NOT EXISTS metro_event_windows (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      label TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      source_locator TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dataset_rows (
      dataset_id TEXT NOT NULL,
      row_id INTEGER NOT NULL,
      data_json TEXT NOT NULL,
      PRIMARY KEY (dataset_id, row_id)
    );
    CREATE TABLE IF NOT EXISTS document_chunks (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      locator TEXT NOT NULL,
      trust_level TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_metro_timestamp ON metro_readings(timestamp);
    CREATE INDEX IF NOT EXISTS idx_document_source ON document_chunks(source_id);
    CREATE INDEX IF NOT EXISTS idx_dataset_rows ON dataset_rows(dataset_id, row_id);
  `);

  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS document_chunks_fts USING fts5(
        id UNINDEXED,
        title,
        content,
        source_path UNINDEXED,
        locator UNINDEXED
      );
    `);
  } catch {
    // SQLite builds without FTS5 still work through the LIKE fallback.
  }
}

export type { SqliteDatabase, SqliteStatement };
