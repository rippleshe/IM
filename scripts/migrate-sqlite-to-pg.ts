/**
 * 幂等 SQLite → PostgreSQL 迁移程序（docs/挑战杯技术开发总规.md §6.3）
 *
 * 用法：
 *   pnpm migrate:sqlite-to-pg --dry-run            # 只读源库，输出各表指纹与行数，不写目标
 *   pnpm migrate:sqlite-to-pg                      # 执行迁移（表级事务、分批 COPY、行数校验、报告）
 *   pnpm migrate:sqlite-to-pg --force              # 指纹变化时清空目标表重导
 *   pnpm migrate:sqlite-to-pg --cutover            # 全部校验通过后标记切换运行数据源
 *
 * 保证：
 * - 源库只读打开，迁移全程不写 SQLite；
 * - 指纹（行数 + max(rowid)）未变即跳过，幂等可重入；
 * - 每表一个事务：COPY 分批写入 → 行数校验 → migration_state 落账 → 提交；失败回滚并以非零码退出；
 * - metro_readings 额外校验时间边界；源 CSV 存在时校验 SHA256；
 * - 迁移报告写入 data/migration-report-<ts>.json。
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { DatabaseSync } from 'node:sqlite';
import { Client } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

type SqliteRow = Record<string, unknown>;

const BATCH_SIZE = 5000;
const LEARNING_DB = process.env['IM_TRAINING_AGENT_LEARNING_DB']
  ?? path.join(process.cwd(), '.im-training-agent', 'learning.sqlite');
const DATASET_DB = process.env['IM_TRAINING_AGENT_DATASET_DB']
  ?? path.join(process.cwd(), '.im-training-agent', 'datasets.sqlite');

/* ----------------------------- 列映射定义 ----------------------------- */

type ColumnType = 'text' | 'int' | 'real' | 'bool' | 'json';

interface ColumnMapping {
  /** SQLite 源列名；null 表示目标派生列（COPY 列表中省略，走默认值或 postCopySql） */
  source: string | null;
  /** PostgreSQL 目标列名 */
  target: string;
  type: ColumnType;
  /** 派生取值（source 为 null 时必须提供） */
  derive?: (row: SqliteRow, now: number) => unknown;
}

interface TableMapping {
  table: string;
  sourceFile: 'learning' | 'datasets';
  columns: ColumnMapping[];
  /** COPY 后在目标库执行的修正 SQL（如 claims.learner_id 回填） */
  postCopySql?: string;
  /** 额外的时间边界校验（metro_readings） */
  timestampColumn?: string;
}

const t = (source: string, target = source, type: ColumnType = 'text'): ColumnMapping => ({ source, target, type });
const derived = (target: string, derive: ColumnMapping['derive']): ColumnMapping => ({ source: null, target, type: 'text', derive });

const TABLES: TableMapping[] = [
  // ---- learning.sqlite：身份与会话 ----
  {
    table: 'users', sourceFile: 'learning',
    columns: [t('id'), t('login_name'), t('display_name'), t('avatar_key'), t('password_hash'), t('password_salt'),
      t('onboarding_completed', 'onboarding_completed', 'bool'), t('created_at', 'created_at', 'int'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'auth_sessions', sourceFile: 'learning',
    columns: [t('id'), t('user_id'), t('token_hash'), t('expires_at', 'expires_at', 'int'), t('created_at', 'created_at', 'int'), t('last_seen_at', 'last_seen_at', 'int')],
  },
  {
    table: 'learner_onboarding', sourceFile: 'learning',
    columns: [t('learner_id'), t('role'), t('programming_foundation'), t('goal'), t('weekly_hours', 'weekly_hours', 'real'),
      t('self_description'), t('created_at', 'created_at', 'int'), t('updated_at', 'updated_at', 'int')],
  },
  // ---- learning.sqlite：画像、知识状态与路径 ----
  {
    table: 'learner_profile_snapshots', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('summary'), t('keywords_json', 'keywords_json', 'json'), t('radar_json', 'radar_json', 'json'), t('generated_at', 'generated_at', 'int')],
  },
  {
    table: 'learner_skill_states', sourceFile: 'learning',
    // 源表 mastery/confidence 平移为 BKT 初始状态；p_guess/p_slip/p_learn/evidence_source 走目标默认值
    columns: [t('learner_id'), t('knowledge_point_id'), t('mastery', 'p_mastery', 'real'), t('confidence', 'confidence', 'real'),
      t('attempt_count', 'attempt_count', 'int'), t('correct_count', 'correct_count', 'int'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'learning_path_items', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('knowledge_point_id'), t('title'), t('status'), t('priority', 'priority', 'int'),
      t('reason'), t('completion_criteria'), t('recommended_resource_type'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'learning_path_nodes', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('knowledge_point_id'), t('title'), t('description'), t('user_status'),
      t('mastered', 'mastered', 'bool'), t('sort_order', 'sort_order', 'int'), t('created_at', 'created_at', 'int'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'learning_path_edges', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('from_node_id'), t('to_node_id'), t('relation'), t('created_at', 'created_at', 'int')],
  },
  // ---- learning.sqlite：资源与反馈 ----
  {
    table: 'learning_assets', sourceFile: 'learning',
    // difficulty / difficulty_calibration 源表没有，置 NULL，由 §7.2 难度校准增量回填
    columns: [t('id'), t('learner_id'), t('session_id'), t('type'), t('title'), t('content_json', 'content_json', 'json'),
      t('audit_status'), t('evidence_ids_json', 'evidence_ids_json', 'json'), t('created_at', 'created_at', 'int')],
  },
  {
    table: 'learning_asset_feedback', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('asset_id'), t('completed', 'completed', 'bool'), t('mastered', 'mastered', 'bool'),
      t('mastery_level'), t('difficulty_rating', 'difficulty_rating', 'int'), t('user_rating', 'user_rating', 'int'),
      t('note'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'learning_asset_page_notes', sourceFile: 'learning',
    columns: [t('learner_id'), t('asset_id'), t('page_key'), t('content'), t('updated_at', 'updated_at', 'int')],
  },
  {
    table: 'learning_quiz_attempts', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('asset_id'), t('question_id'), t('answer_json', 'answer_json', 'json'),
      t('correct', 'correct', 'bool'), t('duration_ms', 'duration_ms', 'int'), t('created_at', 'created_at', 'int')],
  },
  {
    table: 'learning_chat_messages', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('role'), t('content'), t('metadata_json', 'metadata_json', 'json'), t('created_at', 'created_at', 'int')],
  },
  {
    table: 'learning_events', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('event_type'), t('payload_json', 'payload_json', 'json'), t('created_at', 'created_at', 'int')],
  },
  // ---- learning.sqlite：EvidencePack 与隐私 ----
  {
    table: 'evidence_items', sourceFile: 'learning',
    columns: [t('id'), t('source_type'), t('source_id'), t('source_title'), t('locator'), t('content'), t('retrieval_method'),
      t('relevance_score', 'relevance_score', 'real'), t('trust_level'), t('source_scope'), t('metadata_json', 'metadata_json', 'json'),
      t('created_at', 'created_at', 'int')],
  },
  {
    table: 'evidence_packs', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('session_id'), t('query'), t('retrieval_plan_json', 'retrieval_plan_json', 'json'),
      t('coverage_score', 'coverage_score', 'real'), t('cross_validation_json', 'cross_validation_json', 'json'),
      t('privacy_json', 'privacy_json', 'json'), t('created_at', 'created_at', 'int')],
  },
  {
    table: 'evidence_pack_items', sourceFile: 'learning',
    columns: [t('pack_id'), t('evidence_id'), t('position', 'position', 'int')],
  },
  {
    table: 'privacy_audit_events', sourceFile: 'learning',
    columns: [t('id'), t('learner_id'), t('session_id'), t('event_type'), t('file_name'), t('byte_count', 'byte_count', 'int'),
      t('content_hash'), t('redacted_fields_json', 'redacted_fields_json', 'json'), t('retained', 'retained', 'bool'),
      t('created_at', 'created_at', 'int')],
  },
  // ---- learning.sqlite：声明图 ----
  {
    table: 'claims', sourceFile: 'learning',
    columns: [t('id'), t('resource_id'), t('text'), t('verdict'), t('critique'), t('factual_score', 'factual_score', 'real'),
      derived('created_at', (_row, now) => now)],
    postCopySql: 'UPDATE claims c SET learner_id = a.learner_id FROM learning_assets a WHERE c.resource_id = a.id AND c.learner_id IS NULL',
  },
  {
    table: 'claim_evidence', sourceFile: 'learning',
    columns: [t('claim_id'), t('evidence_id'), t('support_level')],
  },
  // ---- datasets.sqlite：领域知识与向量 ----
  {
    table: 'datasets', sourceFile: 'datasets',
    columns: [t('id'), t('name'), t('source_kind'), t('source_path'), t('version'), t('license'), t('checksum'), t('imported_at', 'imported_at', 'int')],
  },
  {
    table: 'dataset_fields', sourceFile: 'datasets',
    columns: [t('id'), t('dataset_id'), t('field_name'), t('data_type'), t('meaning'), t('unit'), t('label_role')],
  },
  {
    table: 'metro_readings', sourceFile: 'datasets', timestampColumn: 'timestamp',
    columns: [t('row_id', 'row_id', 'int'), t('timestamp'), t('tp2', 'tp2', 'real'), t('tp3', 'tp3', 'real'), t('h1', 'h1', 'real'),
      t('dv_pressure', 'dv_pressure', 'real'), t('reservoirs', 'reservoirs', 'real'), t('oil_temperature', 'oil_temperature', 'real'),
      t('motor_current', 'motor_current', 'real'), t('comp', 'comp', 'real'), t('dv_electric', 'dv_electric', 'real'),
      t('towers', 'towers', 'real'), t('mpg', 'mpg', 'real'), t('lps', 'lps', 'real'), t('pressure_switch', 'pressure_switch', 'real'),
      t('oil_level', 'oil_level', 'real'), t('caudal_impulses', 'caudal_impulses', 'real')],
  },
  {
    table: 'metro_event_windows', sourceFile: 'datasets',
    columns: [t('id'), t('dataset_id'), t('label'), t('start_at'), t('end_at'), t('source_locator')],
  },
  {
    table: 'dataset_rows', sourceFile: 'datasets',
    columns: [t('dataset_id'), t('row_id', 'row_id', 'int'), t('data_json', 'data_json', 'json')],
  },
  {
    table: 'document_chunks', sourceFile: 'datasets',
    columns: [t('id'), t('source_id'), t('source_path'), t('title'), t('content'),
      derived('search_text', (row) => `${String(row['title'] ?? '')}\n${String(row['content'] ?? '')}`),
      t('locator'), t('trust_level'),
      derived('created_at', (_row, now) => now)],
    // embedding 置 NULL，由 text-embedding-v4 嵌入任务增量回填（总规 §7.5）
  },
];

/* ----------------------------- 工具函数 ----------------------------- */

function formatValue(value: unknown, type: ColumnType, column: string): string {
  if (value === null || value === undefined) return '\\N';
  switch (type) {
    case 'bool': return value ? 'true' : 'false';
    case 'int': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`列 ${column} 期望整数，得到 ${String(value)}`);
      return String(Math.round(n));
    }
    case 'real': {
      const n = Number(value);
      if (!Number.isFinite(n)) throw new Error(`列 ${column} 期望数值，得到 ${String(value)}`);
      return String(n);
    }
    case 'json': {
      const s = typeof value === 'string' ? value : JSON.stringify(value);
      JSON.parse(s); // 非法 JSON 在写入前失败，避免目标库 jsonb 解析报错
      return s;
    }
    default: return String(value);
  }
}

function escapeCopyText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\t/g, '\\t')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

function openSourceDb(file: string): DatabaseSync {
  return new DatabaseSync(file, { readOnly: true });
}

function fingerprint(db: DatabaseSync, table: string): { count: number; maxRowId: number; text: string } {
  const row = db.prepare(`SELECT COUNT(*) AS cnt, COALESCE(MAX(rowid), 0) AS maxrid FROM "${table}"`).get() as Record<string, unknown>;
  const count = Number(row['cnt']);
  const maxRowId = Number(row['maxrid']);
  return { count, maxRowId, text: `${count}:${maxRowId}` };
}

function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/* ----------------------------- 主流程 ----------------------------- */

interface TableReport {
  table: string;
  action: 'copied' | 'skipped' | 'forced';
  sourceCount: number;
  targetCount: number;
  fingerprint: string;
  durationMs: number;
  verified: boolean;
  error?: string;
}

interface MigrationReport {
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  success: boolean;
  tables: TableReport[];
  metroBoundary?: { source: [string, string] | null; target: [string, string] | null; verified: boolean };
  csvChecksum?: { file: string; expected: string | null; actual: string | null; verified: boolean; note: string };
  reportFile?: string;
}

function parseArgs(argv: string[]): { dryRun: boolean; force: boolean; cutover: boolean } {
  return {
    dryRun: argv.includes('--dry-run'),
    force: argv.includes('--force'),
    cutover: argv.includes('--cutover'),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const report: MigrationReport = { startedAt: startedAt.toISOString(), finishedAt: '', dryRun: args.dryRun, success: false, tables: [] };

  if (!existsSync(LEARNING_DB) || !existsSync(DATASET_DB)) {
    console.error(`[migrate] 源库不存在：${LEARNING_DB} / ${DATASET_DB}`);
    process.exit(2);
  }
  const learningDb = openSourceDb(LEARNING_DB);
  const datasetDb = openSourceDb(DATASET_DB);
  const sourceDbs = { learning: learningDb, datasets: datasetDb };
  console.log('[migrate] 源库已只读打开');

  if (args.dryRun) {
    console.log('[migrate] --dry-run：只输出指纹，不连接 PostgreSQL');
    for (const mapping of TABLES) {
      const fp = fingerprint(sourceDbs[mapping.sourceFile], mapping.table);
      console.log(`  ${mapping.sourceFile}/${mapping.table}: rows=${fp.count} fp=${fp.text}`);
    }
    const metro = sourceDbs.datasets.prepare('SELECT MIN("timestamp") AS lo, MAX("timestamp") AS hi FROM metro_readings').get() as Record<string, unknown>;
    console.log(`  metro_readings 时间边界: ${String(metro['lo'])} ~ ${String(metro['hi'])}`);
    learningDb.close();
    datasetDb.close();
    return;
  }

  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    console.error('[migrate] 缺少 DATABASE_URL（见 .env.example）');
    process.exit(2);
  }
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const stateCheck = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.migration_state') IS NOT NULL AS exists",
  );
  if (!stateCheck.rows[0]?.exists) {
    console.error('[migrate] 目标库尚未初始化：请先 `docker compose up -d postgres redis` 并执行 `pnpm db:migrate`');
    await client.end();
    process.exit(2);
  }

  if (args.cutover) {
    const pending = await client.query<{ table_name: string }>(
      'SELECT table_name FROM migration_state WHERE verified = false AND table_name <> \'__cutover__\'',
    );
    if (pending.rows.length > 0) {
      console.error(`[migrate] 以下表未通过校验，禁止切换：${pending.rows.map((r) => r.table_name).join(', ')}`);
      await client.end();
      process.exit(1);
    }
    await client.query(
      `INSERT INTO migration_state (table_name, source_file, source_fingerprint, row_count, verified, migrated_at)
       VALUES ('__cutover__', 'all', $1, 0, true, $2)
       ON CONFLICT (table_name) DO UPDATE SET source_fingerprint = EXCLUDED.source_fingerprint, migrated_at = EXCLUDED.migrated_at, verified = true`,
      [`cutover:${startedAt.getTime()}`, startedAt.getTime()],
    );
    console.log('[migrate] ✔ 切换标记已写入：运行时数据源切换为 PostgreSQL（DATABASE_URL），SQLite 仅作备份保留');
    await client.end();
    learningDb.close();
    datasetDb.close();
    return;
  }

  const now = startedAt.getTime();

  for (const mapping of TABLES) {
    const started = Date.now();
    const source = sourceDbs[mapping.sourceFile];
    let entry: TableReport;
    try {
      const fp = fingerprint(source, mapping.table);
      const stateRow = await client.query<{ source_fingerprint: string; verified: boolean }>(
        'SELECT source_fingerprint, verified FROM migration_state WHERE table_name = $1',
        [mapping.table],
      );
      const existing = stateRow.rows[0];

      if (existing && existing.source_fingerprint === fp.text && existing.verified) {
        const targetCount = await targetCountOf(client, mapping.table);
        entry = { table: mapping.table, action: 'skipped', sourceCount: fp.count, targetCount, fingerprint: fp.text, durationMs: Date.now() - started, verified: true };
        console.log(`[migrate] = ${mapping.table}: 指纹未变，跳过（${fp.count} 行）`);
        report.tables.push(entry);
        continue;
      }

      const mustForce = existing !== undefined && existing.source_fingerprint !== fp.text;
      if (mustForce && !args.force) {
        throw new Error(`目标表已有旧数据且源指纹变化（${existing.source_fingerprint} → ${fp.text}），确认无风险后加 --force 重导`);
      }

      await client.query('BEGIN');
      if (mustForce) await client.query(`TRUNCATE TABLE "${mapping.table}"`);
      await copyTable(client, source, mapping, now);
      const targetCount = await targetCountOf(client, mapping.table);
      if (targetCount !== fp.count) {
        throw new Error(`行数校验失败：源 ${fp.count} ≠ 目标 ${targetCount}`);
      }
      if (mapping.postCopySql) await client.query(mapping.postCopySql);
      await client.query(
        `INSERT INTO migration_state (table_name, source_file, source_fingerprint, row_count, verified, migrated_at)
         VALUES ($1, $2, $3, $4, true, $5)
         ON CONFLICT (table_name) DO UPDATE SET source_fingerprint = EXCLUDED.source_fingerprint, row_count = EXCLUDED.row_count, verified = true, migrated_at = EXCLUDED.migrated_at`,
        [mapping.table, mapping.sourceFile, fp.text, fp.count, Date.now()],
      );
      await client.query('COMMIT');
      entry = { table: mapping.table, action: mustForce ? 'forced' : 'copied', sourceCount: fp.count, targetCount, fingerprint: fp.text, durationMs: Date.now() - started, verified: true };
      console.log(`[migrate] ✔ ${mapping.table}: ${fp.count} 行已迁入并校验（${entry.durationMs} ms）`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      try { await client.query('ROLLBACK'); } catch { /* 事务可能未开启 */ }
      entry = { table: mapping.table, action: 'copied', sourceCount: -1, targetCount: -1, fingerprint: '', durationMs: Date.now() - started, verified: false, error: message };
      report.tables.push(entry);
      report.finishedAt = new Date().toISOString();
      report.success = false;
      await writeReport(report);
      console.error(`[migrate] ✘ ${mapping.table} 迁移失败：${message}`);
      console.error('[migrate] 已回滚该表事务，进程以非零码退出；修复后重新运行即可从断点续迁');
      await client.end();
      learningDb.close();
      datasetDb.close();
      process.exit(1);
    }
    report.tables.push(entry);
  }

  // ---- metro_readings 时间边界校验 ----
  const metroMapping = TABLES.find((item) => item.table === 'metro_readings');
  if (metroMapping?.timestampColumn) {
    const src = datasetDb.prepare(`SELECT MIN("${metroMapping.timestampColumn}") AS lo, MAX("${metroMapping.timestampColumn}") AS hi FROM metro_readings`).get() as Record<string, unknown>;
    const dst = await client.query<{ lo: string | null; hi: string | null }>(`SELECT MIN("${metroMapping.timestampColumn}") AS lo, MAX("${metroMapping.timestampColumn}") AS hi FROM metro_readings`);
    const sourceBoundary: [string, string] = [String(src['lo']), String(src['hi'])];
    const targetBoundary: [string, string] = [String(dst.rows[0]?.lo ?? 'null'), String(dst.rows[0]?.hi ?? 'null')];
    const verified = sourceBoundary[0] === targetBoundary[0] && sourceBoundary[1] === targetBoundary[1];
    report.metroBoundary = { source: sourceBoundary, target: targetBoundary, verified };
    console.log(`[migrate] metro_readings 时间边界 ${verified ? '一致' : '不一致'}：源 ${sourceBoundary.join('~')} / 目标 ${targetBoundary.join('~')}`);
    if (!verified) {
      report.finishedAt = new Date().toISOString();
      report.success = false;
      await writeReport(report);
      console.error('[migrate] 时间边界校验未通过，进程以非零码退出');
      await client.end();
      learningDb.close();
      datasetDb.close();
      process.exit(1);
    }
  }

  // ---- 源 CSV SHA256 校验（存在时才校验；不存在则在报告中明确标注数据准备状态） ----
  const metroDataset = datasetDb.prepare("SELECT source_path, checksum FROM datasets WHERE id LIKE '%metro%' OR name LIKE '%Metro%' LIMIT 1").get() as Record<string, unknown> | undefined;
  if (metroDataset) {
    const csvPath = String(metroDataset['source_path'] ?? '');
    const expected = metroDataset['checksum'] ? String(metroDataset['checksum']) : null;
    const fileExists = csvPath && existsSync(csvPath);
    const actual = fileExists ? await sha256File(csvPath) : null;
    const verified = Boolean(expected && actual && expected.toLowerCase() === actual.toLowerCase());
    report.csvChecksum = {
      file: csvPath,
      expected,
      actual,
      verified,
      note: fileExists
        ? (verified ? 'SHA256 与登记值一致' : 'SHA256 与登记值不一致，请确认数据完整性')
        : '原始 CSV 不在本机（干净环境）。请运行 pnpm data:metropt 完成官方下载与校验后再迁移；系统不会生成伪时序数据。',
    };
    console.log(`[migrate] 源 CSV：${report.csvChecksum.note}`);
  }

  report.finishedAt = new Date().toISOString();
  report.success = true;
  await writeReport(report);
  console.log('[migrate] ✔ 全部表迁移并校验通过。验收后执行 `pnpm migrate:sqlite-to-pg --cutover` 标记切换运行数据源');
  await client.end();
  learningDb.close();
  datasetDb.close();
}

async function targetCountOf(client: Client, table: string): Promise<number> {
  const result = await client.query<{ count: string }>(`SELECT COUNT(*) AS count FROM "${table}"`);
  return Number(result.rows[0]?.count ?? '0');
}

/** 分批读取源表并 COPY 进目标表；返回写入行数 */
async function copyTable(client: Client, source: DatabaseSync, mapping: TableMapping, now: number): Promise<number> {
  const copyColumns = mapping.columns.filter((column) => column.source !== null || column.derive);
  const columnList = copyColumns.map((column) => `"${column.target}"`).join(', ');
  const copySql = `COPY "${mapping.table}" (${columnList}) FROM STDIN WITH (FORMAT text)`;
  const stream = client.query(copyFrom(copySql));

  const selectColumns = ['rowid AS __rid', ...new Set(mapping.columns.map((c) => c.source).filter((s): s is string => s !== null).map((c) => `"${c}"`))];
  const selectSql = `SELECT ${selectColumns.join(', ')} FROM "${mapping.table}" WHERE rowid > ? ORDER BY rowid LIMIT ?`;

  let lastRowId = 0;
  let written = 0;
  const statement = source.prepare(selectSql);

  const rows: AsyncGenerator<string> = (async function* generate() {
    for (;;) {
      const batch = statement.all(lastRowId, BATCH_SIZE) as Array<Record<string, unknown>>;
      if (batch.length === 0) break;
      for (const row of batch) {
        lastRowId = Number(row['__rid']);
        const fields = copyColumns.map((column) => {
          const raw = column.source !== null ? row[column.source] : column.derive?.(row, now) ?? null;
          return escapeCopyText(formatValue(raw, column.type, column.target));
        });
        yield `${fields.join('\t')}\n`;
        written += 1;
      }
      if (batch.length < BATCH_SIZE) break;
    }
  })();

  await pipeline(Readable.from(rows), stream);
  return written;
}

async function writeReport(report: MigrationReport): Promise<void> {
  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `migration-report-${Date.now()}.json`);
  await writeFile(file, JSON.stringify({ ...report, reportFile: file }, null, 2), 'utf8');
  console.log(`[migrate] 迁移报告：${file}`);
}

main().catch((error) => {
  console.error('[migrate] 未预期的失败：', error);
  process.exit(2);
});
