/**
 * PostgreSQL 版证据检索与数据集查询（docs/挑战杯技术开发总规.md §6.1 第 5/6 组、§7.5）
 *
 * - 结构化证据：PG metro_readings / dataset_rows 精确查询（与 SQLite 版语义一致）；
 * - 文档证据：to_tsvector('simple') 全文召回，ILIKE 兜底；向量召回在运行时混合检索层接入；
 * - EvidencePack / 隐私审计事件持久化到 PG evidence_* 与 privacy_audit_events；
 * - seedMetroCatalogPg / importKnowledgeCardsPg / importCsvDatasetPg / importMetroPt3CsvPg
 *   供干净环境引导（Compose bootstrap）使用。
 */
import { createReadStream } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Pool, PoolClient } from 'pg';
import { from as copyFrom } from 'pg-copy-streams';

import { KNOWLEDGE_CARD_SOURCE_ID, chunkCardContent } from '../../src/learning/knowledge-import.js';
import { crossValidate, normalizeSearchTerms } from '../../src/learning/evidence.js';
import type { CsvDatasetSource } from '../../src/learning/tabular.js';
import type {
  DatasetSummary,
  EvidenceItem,
  EvidencePack,
  EvidenceScope,
  MetroReading,
} from '../../src/learning/types.js';

const METRO_DATASET_ID = 'metropt-3';

/* ------------------------------------------------------------------ */
/* 数据集查询（结构化证据）                                               */
/* ------------------------------------------------------------------ */

export async function getMetroSummaryPg(pool: Pool): Promise<DatasetSummary> {
  const row = (await pool.query(
    'SELECT COUNT(*) AS "rowCount", MIN(timestamp) AS "firstTimestamp", MAX(timestamp) AS "lastTimestamp" FROM metro_readings',
  )).rows[0] as { rowCount: string | number; firstTimestamp: string | null; lastTimestamp: string | null };
  const fieldCount = (await pool.query(
    'SELECT COUNT(*) AS count FROM dataset_fields WHERE dataset_id = $1', [METRO_DATASET_ID],
  )).rows[0] as { count: string | number };
  return {
    id: METRO_DATASET_ID,
    name: 'MetroPT-3 Air Compressor',
    rowCount: Number(row.rowCount),
    firstTimestamp: row.firstTimestamp,
    lastTimestamp: row.lastTimestamp,
    fieldCount: Number(fieldCount.count),
  };
}

export async function queryMetroReadingsPg(pool: Pool, limit = 5): Promise<MetroReading[]> {
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  const rows = await pool.query(
    `SELECT row_id AS "rowId", timestamp, tp2, tp3, h1, dv_pressure AS "dvPressure",
      reservoirs, oil_temperature AS "oilTemperature", motor_current AS "motorCurrent",
      comp, dv_electric AS "dvElectric", towers, mpg, lps,
      pressure_switch AS "pressureSwitch", oil_level AS "oilLevel",
      caudal_impulses AS "caudalImpulses"
     FROM metro_readings ORDER BY timestamp DESC LIMIT $1`, [boundedLimit],
  );
  return rows.rows as MetroReading[];
}

export async function getDatasetRowCountPg(pool: Pool, datasetId: string): Promise<number> {
  const row = (await pool.query('SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = $1', [datasetId])).rows[0] as { count: string | number };
  return Number(row.count);
}

export interface DatasetRowSample {
  rowId: number;
  fields: Record<string, string | number | null>;
}

/** 代表性样本：优先取标签字段命中的故障行（教学上最有展示价值），再补正常行。 */
export async function sampleDatasetRowsPg(pool: Pool, datasetId: string, limit = 3): Promise<DatasetRowSample[]> {
  const labelFields = ((await pool.query(
    `SELECT field_name AS "fieldName" FROM dataset_fields
     WHERE dataset_id = $1 AND label_role = 'label' ORDER BY field_name`, [datasetId],
  )).rows as Array<{ fieldName: string }>).map((row) => row.fieldName);
  const positives: DatasetRowSample[] = [];
  for (const field of labelFields) {
    if (positives.length >= limit) break;
    const needed = limit - positives.length;
    const known = new Set(positives.map((row) => row.rowId));
    const candidates = (await pool.query(
      `SELECT row_id AS "rowId", data_json AS "dataJson" FROM dataset_rows
       WHERE dataset_id = $1 AND data_json ->> $2 = '1'
       ORDER BY row_id LIMIT $3`, [datasetId, field, needed * 4],
    )).rows as Array<{ rowId: number; dataJson: Record<string, string | number | null> }>;
    for (const candidate of candidates) {
      if (positives.length >= limit || known.has(candidate.rowId)) continue;
      if (labelFields.some((label) => candidate.dataJson[label] === 1 || candidate.dataJson[label] === '1')) {
        positives.push({ rowId: Number(candidate.rowId), fields: candidate.dataJson });
        known.add(candidate.rowId);
      }
    }
  }
  if (positives.length < limit) {
    const known = new Set(positives.map((row) => row.rowId));
    const fallback = (await pool.query(
      `SELECT row_id AS "rowId", data_json AS "dataJson" FROM dataset_rows
       WHERE dataset_id = $1 AND row_id % 997 = 1 LIMIT $2`, [datasetId, limit],
    )).rows as Array<{ rowId: number; dataJson: Record<string, string | number | null> }>;
    for (const row of fallback) {
      if (positives.length >= limit || known.has(row.rowId)) continue;
      positives.push({ rowId: Number(row.rowId), fields: row.dataJson });
      known.add(row.rowId);
    }
  }
  return positives.slice(0, limit).sort((a, b) => a.rowId - b.rowId);
}

/* ------------------------------------------------------------------ */
/* 文档检索（全文）                                                      */
/* ------------------------------------------------------------------ */

function toTsQuery(terms: string[]): string | null {
  const cleaned = terms
    .map((term) => term.replaceAll(/[^\p{L}\p{N} ]/gu, ' ').trim().replace(/\s+/g, ' '))
    .filter((term) => term.length > 0)
    .map((term) => `'${term.replaceAll("'", '')}'`);
  if (cleaned.length === 0) return null;
  return cleaned.join(' | ');
}

interface DocumentRow {
  id: string;
  sourceId: string;
  sourcePath: string;
  locator: string;
  title: string;
  content: string;
}

async function documentRowsPg(pool: Pool, terms: string[]): Promise<DocumentRow[]> {
  if (terms.length === 0) return [];
  const tsquery = toTsQuery(terms);
  if (tsquery) {
    try {
      const rows = (await pool.query(
        `SELECT id, source_id AS "sourceId", source_path AS "sourcePath", locator, title, content
         FROM document_chunks
         WHERE to_tsvector('simple', search_text) @@ to_tsquery('simple', $1)
         ORDER BY ts_rank(to_tsvector('simple', search_text), to_tsquery('simple', $1)) DESC
         LIMIT 8`, [tsquery],
      )).rows as DocumentRow[];
      if (rows.length > 0) return rows;
    } catch {
      // tsquery 语法异常时走 ILIKE 兜底（与 SQLite 版 FTS→LIKE 回退语义一致）
    }
  }
  const likeClauses = terms.map((_, index) => `(title ILIKE $${index + 1} OR content ILIKE $${index + 1})`).join(' OR ');
  const likeParams = terms.map((term) => `%${term}%`);
  return (await pool.query(
    `SELECT id, source_id AS "sourceId", source_path AS "sourcePath", locator, title, content
     FROM document_chunks WHERE ${likeClauses} LIMIT 8`, likeParams,
  )).rows as DocumentRow[];
}

/* ------------------------------------------------------------------ */
/* 证据装配                                                             */
/* ------------------------------------------------------------------ */

function evidenceItem(item: Omit<EvidenceItem, 'id'>): EvidenceItem {
  return { id: `evidence-${randomUUID()}`, ...item };
}

async function structuredEvidencePg(pool: Pool): Promise<EvidenceItem[]> {
  const summary = await getMetroSummaryPg(pool);
  const rows = await queryMetroReadingsPg(pool, 6);
  const summaryItem = evidenceItem({
    sourceType: 'dataset',
    sourceId: 'metropt-3',
    sourceTitle: 'MetroPT-3 CSV 数据集',
    locator: 'postgres:datasets.id=metropt-3',
    content: JSON.stringify({
      dataset: summary.name,
      rowCount: summary.rowCount,
      fieldCount: summary.fieldCount,
      firstTimestamp: summary.firstTimestamp,
      lastTimestamp: summary.lastTimestamp,
    }),
    retrievalMethod: 'sql',
    relevanceScore: 0.92,
    trustLevel: 'high',
    scope: 'system',
    metadata: { queryKind: 'dataset_summary', rowCount: summary.rowCount, fieldCount: summary.fieldCount },
  });
  const rowItems = rows.map((row, index) => evidenceItem({
    sourceType: 'dataset',
    sourceId: 'metropt-3',
    sourceTitle: 'MetroPT-3 CSV 数据行',
    locator: `postgres:metro_readings.row_id=${row.rowId}`,
    content: JSON.stringify(row),
    retrievalMethod: 'sql',
    relevanceScore: Math.max(0.58, 0.86 - index * 0.04),
    trustLevel: 'high',
    scope: 'system' as EvidenceScope,
    metadata: { queryKind: 'recent_rows', rowId: row.rowId, timestamp: row.timestamp },
  }));
  return [summaryItem, ...rowItems, ...(await genericDatasetEvidencePg(pool))];
}

async function genericDatasetEvidencePg(pool: Pool): Promise<EvidenceItem[]> {
  const datasets = (await pool.query(
    `SELECT d.id, d.name, d.source_path AS "sourcePath"
     FROM datasets d JOIN dataset_rows r ON r.dataset_id = d.id
     GROUP BY d.id ORDER BY d.id`,
  )).rows as Array<{ id: string; name: string; sourcePath: string }>;
  const items: EvidenceItem[] = [];
  for (const dataset of datasets) {
    const rowCount = await getDatasetRowCountPg(pool, dataset.id);
    if (rowCount === 0) continue;
    items.push(evidenceItem({
      sourceType: 'dataset',
      sourceId: dataset.id,
      sourceTitle: `${dataset.name} 数据集`,
      locator: `postgres:datasets.id=${dataset.id}`,
      content: JSON.stringify({ dataset: dataset.name, rowCount, retrieval: '按标签抽样故障样本与正常样本' }),
      retrievalMethod: 'sql',
      relevanceScore: 0.9,
      trustLevel: 'high',
      scope: 'system',
      metadata: { queryKind: 'dataset_summary', rowCount },
    }));
    (await sampleDatasetRowsPg(pool, dataset.id, 3)).forEach((row, index) => {
      items.push(evidenceItem({
        sourceType: 'dataset',
        sourceId: dataset.id,
        sourceTitle: `${dataset.name} 代表性数据行`,
        locator: `postgres:dataset_rows.dataset_id=${dataset.id}&row_id=${row.rowId}`,
        content: JSON.stringify(row.fields),
        retrievalMethod: 'sql',
        relevanceScore: Math.max(0.6, 0.84 - index * 0.04),
        trustLevel: 'high',
        scope: 'system',
        metadata: { queryKind: 'dataset_row', rowId: row.rowId },
      }));
    });
  }
  return items;
}

async function persistEvidencePg(pool: Pool, item: EvidenceItem): Promise<void> {
  await pool.query(
    `INSERT INTO evidence_items
      (id, source_type, source_id, source_title, locator, content, retrieval_method,
       relevance_score, trust_level, source_scope, metadata_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT (id) DO UPDATE SET
       source_title = excluded.source_title, locator = excluded.locator, content = excluded.content,
       relevance_score = excluded.relevance_score, metadata_json = excluded.metadata_json`,
    [
      item.id, item.sourceType, item.sourceId, item.sourceTitle ?? null, item.locator, item.content,
      item.retrievalMethod, item.relevanceScore, item.trustLevel, item.scope ?? 'system',
      JSON.stringify(item.metadata ?? {}), Date.now(),
    ],
  );
}

async function persistPackPg(pool: Pool, pack: EvidencePack): Promise<void> {
  await pool.query(
    `INSERT INTO evidence_packs
      (id, learner_id, session_id, query, retrieval_plan_json, coverage_score,
       cross_validation_json, privacy_json, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       retrieval_plan_json = excluded.retrieval_plan_json, coverage_score = excluded.coverage_score,
       cross_validation_json = excluded.cross_validation_json, privacy_json = excluded.privacy_json`,
    [
      pack.id, pack.learnerId ?? null, pack.sessionId ?? null, pack.query,
      JSON.stringify(pack.retrievalPlan), pack.coverageScore, JSON.stringify(pack.crossValidation), JSON.stringify(pack.privacy), pack.createdAt,
    ],
  );
  for (let index = 0; index < pack.items.length; index += 1) {
    await pool.query(
      `INSERT INTO evidence_pack_items (pack_id, evidence_id, position) VALUES ($1, $2, $3)
       ON CONFLICT (pack_id, evidence_id) DO UPDATE SET position = excluded.position`,
      [pack.id, pack.items[index]!.id, index],
    );
  }
}

export interface EvidenceBuildOptions {
  learnerId?: string;
  sessionId?: string;
  temporaryReference?: { name: string; content: string } | null;
  /** DAG 检索节点按路径拆分：不传 = 双路全检（docs/挑战杯技术开发总规.md §5.2） */
  retrievalPlan?: Array<'structured' | 'document'>;
}

export class PgEvidenceService {
  constructor(private readonly pool: Pool) {}

  async getCatalog(): Promise<DatasetSummary> {
    return getMetroSummaryPg(this.pool);
  }

  async buildEvidencePack(query: string, options: EvidenceBuildOptions = {}): Promise<EvidencePack> {
    const wantStructured = !options.retrievalPlan || options.retrievalPlan.includes('structured');
    const wantDocuments = !options.retrievalPlan || options.retrievalPlan.includes('document');
    const terms = normalizeSearchTerms(query);
    const structured = wantStructured ? await structuredEvidencePg(this.pool) : [];
    const documents = wantDocuments ? (await documentRowsPg(this.pool, terms)).map((row, index) => evidenceItem({
      sourceType: 'document',
      sourceId: row.sourceId,
      sourceTitle: row.title,
      locator: `${row.sourcePath}#${row.locator}`,
      content: row.content,
      retrievalMethod: 'fts',
      relevanceScore: Math.max(0.55, 0.94 - index * 0.06),
      trustLevel: 'high',
      scope: 'system' as EvidenceScope,
      metadata: { title: row.title, termsMatched: terms.length },
    })) : [];
    const items = [...structured, ...documents];
    for (const item of items) await persistEvidencePg(this.pool, item);
    const crossValidation = crossValidate(items);
    const pack: EvidencePack = {
      id: `evidence-pack-${randomUUID()}`,
      query,
      items,
      retrievalPlan: [
        ...(wantStructured && structured.length > 0 ? ['structured' as const] : []),
        ...(wantDocuments && documents.length > 0 ? ['document' as const] : []),
      ],
      coverageScore: Math.min(1, Math.round((0.35 + Math.min(0.35, documents.length * 0.06) + Math.min(0.3, structured.length * 0.04)) * 100) / 100),
      crossValidation,
      structuredCount: structured.length,
      documentCount: documents.length,
      temporaryCount: options.temporaryReference ? 1 : 0,
      privacy: { temporaryReferenceUsed: Boolean(options.temporaryReference), retained: false },
      learnerId: options.learnerId,
      sessionId: options.sessionId,
      createdAt: Date.now(),
    };
    await persistPackPg(this.pool, pack);
    if (options.temporaryReference) {
      await this.pool.query(
        `INSERT INTO privacy_audit_events
          (id, learner_id, session_id, event_type, file_name, byte_count, content_hash, redacted_fields_json, retained, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)`,
        [
          `privacy-${randomUUID()}`,
          options.learnerId ?? null,
          options.sessionId ?? null,
          'temporary_reference_used',
          options.temporaryReference.name.slice(0, 160),
          Buffer.byteLength(options.temporaryReference.content, 'utf8'),
          createHash('sha256').update(options.temporaryReference.content).digest('hex'),
          JSON.stringify([]),
          Date.now(),
        ],
      );
    }
    return pack;
  }

  /** DAG 合并证据包复用同一持久化通道（幂等 upsert） */
  async persistEvidencePack(pack: EvidencePack): Promise<void> {
    for (const item of pack.items) await persistEvidencePg(this.pool, item);
    await persistPackPg(this.pool, pack);
  }
}

/* ------------------------------------------------------------------ */
/* 干净环境引导（Compose bootstrap）：种子目录 / 知识卡 / CSV / Metro     */
/* ------------------------------------------------------------------ */

export async function seedMetroCatalogPg(pool: Pool): Promise<void> {
  await pool.query(
    `INSERT INTO datasets (id, name, source_kind, source_path, version, license, checksum, imported_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (id) DO UPDATE SET name = excluded.name, imported_at = excluded.imported_at`,
    ['metropt-3', 'MetroPT-3 Air Compressor', 'industrial_dataset',
      'IM-Training-Agent-datasets/raw/MetroPT-3.zip::MetroPT3(AirCompressor).csv', '2020',
      'See bundled source metadata', '', Date.now()],
  );

  const fields: Array<[string, string, string, string, string]> = [
    ['timestamp', 'TEXT', '采样时间', '', 'time'],
    ['TP2', 'REAL', '压缩机压力观测量', 'bar', 'sensor'],
    ['TP3', 'REAL', '气动面板产生的压力', 'bar', 'sensor'],
    ['H1', 'REAL', '旋风分离器排放产生的压力下降', 'bar', 'sensor'],
    ['DV_pressure', 'REAL', '干燥塔排气时产生的压力下降；为零表示压缩机带载运行', 'bar', 'sensor'],
    ['Reservoirs', 'REAL', '储气罐下游压力，应接近 TP3', 'bar', 'sensor'],
    ['Oil_temperature', 'REAL', '压缩机油温', '°C', 'sensor'],
    ['Motor_current', 'REAL', '三相电机一相的电流，约 0/4/7/9A 对应不同工作状态', 'A', 'sensor'],
    ['COMP', 'REAL', '压缩机进气阀电信号', '', 'state'],
    ['DV_eletric', 'REAL', '压缩机出口阀控制信号', '', 'state'],
    ['Towers', 'REAL', '干燥塔与排湿塔的切换信号', '', 'state'],
    ['MPG', 'REAL', 'APU 压力低于约 8.2 bar 时启动带载运行的信号', '', 'state'],
    ['LPS', 'REAL', '压力低于约 7 bar 时触发的低压开关信号', '', 'state'],
    ['Pressure_switch', 'REAL', '检测干燥塔排放的电信号', '', 'state'],
    ['Oil_level', 'REAL', '油位低于预期值时触发的信号', '', 'state'],
    ['Caudal_impulses', 'REAL', '从 APU 流向储气罐的空气流量脉冲计数', '', 'sensor'],
  ];
  for (const [name, dataType, meaning, unit, role] of fields) {
    await pool.query(
      `INSERT INTO dataset_fields (id, dataset_id, field_name, data_type, meaning, unit, label_role)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET meaning = excluded.meaning, label_role = excluded.label_role`,
      [`metropt-3-field-${name}`, 'metropt-3', name, dataType, meaning, unit, role],
    );
  }

  const chunks: Array<[string, string, string, string, string]> = [
    ['metropt-3-pdf-overview', 'MetroPT-3 数据集概览', 'MetroPT-3 来自列车空气生产单元（APU）的工业空气压缩机多变量时序数据，可用于故障预测、异常解释和预测性维护训练。数据包同时包含 CSV 原始记录和本 PDF 数据说明。', 'raw/MetroPT-3.zip::Data Description_Metro.pdf', 'PDF p.1'],
    ['metropt-3-pdf-collection', 'MetroPT-3 采集方式', '数据覆盖 2020 年 2 月至 8 月，记录压力、温度、电机电流及进气阀等 15 个信号。数据说明标注为工业设备传感器记录，使用时应以实际 CSV 行数和时间戳为准。', 'raw/MetroPT-3.zip::Data Description_Metro.pdf', 'PDF p.1-p.2'],
    ['metropt-3-evidence-rule', '数据证据使用边界', '传感器异常只能支持风险判断，不能直接证明设备已经发生确定故障。生成维护建议时必须同时展示数据定位、必要的现场复核和不确定性。', 'raw/MetroPT-3.zip::Data Description_Metro.pdf', 'PDF p.3'],
    ['metropt-3-paper-source', 'MetroPT-3 研究来源', '数据说明列出 Predictive maintenance based on anomaly detection using deep learning for air production unit in the railway industry，以及 The MetroPT dataset for predictive maintenance 等相关研究来源。', 'raw/MetroPT-3.zip::Data Description_Metro.pdf', 'PDF p.1-p.2'],
  ];
  fields.slice(1).forEach(([name, , meaning, unit]) => {
    chunks.push([
      `metropt-3-field-${name.toLowerCase()}`,
      `字段说明：${name}`,
      `${name}：${meaning}${unit ? ` 单位为 ${unit}。` : '。'}字段含义必须以数据说明和查询结果为准，不允许模型凭空补全。`,
      'raw/MetroPT-3.zip::Data Description_Metro.pdf',
      'PDF p.2-p.3',
    ]);
  });
  const failureWindows: Array<[string, string, string, string]> = [
    ['metropt-3-failure-1', '故障窗口 #1', '2020-04-18 00:00 至 2020-04-18 23:59，报告为 Air leak，严重程度 High stress。', 'PDF p.3'],
    ['metropt-3-failure-2', '故障窗口 #2', '2020-05-29 23:30 至 2020-05-30 06:00，报告为 Air Leak，严重程度 High stress；记录 4 月 30 日有维护。', 'PDF p.3'],
    ['metropt-3-failure-3', '故障窗口 #3', '2020-06-05 10:00 至 2020-06-07 14:30，报告为 Air Leak，严重程度 High stress；记录 6 月 8 日有维护。', 'PDF p.3'],
    ['metropt-3-failure-4', '故障窗口 #4', '2020-07-15 14:30 至 2020-07-15 19:00，报告为 Air Leak，严重程度 High stress；记录 7 月 16 日有维护。', 'PDF p.3'],
  ];
  for (const [id, label, description, locator] of failureWindows) {
    const match = description.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) 至 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (!match) continue;
    await pool.query(
      `INSERT INTO metro_event_windows (id, dataset_id, label, start_at, end_at, source_locator)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET label = excluded.label, start_at = excluded.start_at, end_at = excluded.end_at`,
      [id, 'metropt-3', label, match[1], match[2], `raw/MetroPT-3.zip::Data Description_Metro.pdf#${locator}`],
    );
    chunks.push([id, label, description, 'raw/MetroPT-3.zip::Data Description_Metro.pdf', locator]);
  }

  await pool.query("DELETE FROM document_chunks WHERE id IN ('metropt-3-overview', 'metropt-3-field-guide')");
  for (const [id, title, content, sourcePath, locator] of chunks) {
    await upsertDocumentChunkPg(pool, { id, sourceId: 'metropt-3', sourcePath, title, content, locator, trustLevel: 'high' });
  }
}

export interface DocumentChunkSeed {
  id: string;
  sourceId: string;
  sourcePath: string;
  title: string;
  content: string;
  locator: string;
  trustLevel: string;
}

export async function upsertDocumentChunkPg(pool: Pool, chunk: DocumentChunkSeed): Promise<void> {
  await pool.query(
    `INSERT INTO document_chunks (id, source_id, source_path, title, content, search_text, locator, trust_level, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, content = excluded.content, search_text = excluded.search_text,
       locator = excluded.locator, trust_level = excluded.trust_level, embedding = NULL`,
    [chunk.id, chunk.sourceId, chunk.sourcePath, chunk.title, chunk.content,
      `${chunk.title}\n${chunk.content}`, chunk.locator, chunk.trustLevel, Date.now()],
  );
}

/** 知识卡导入（PG 版）：data/knowledge 目录是“丢弃式”知识层，幂等整体重导。 */
export async function importKnowledgeCardsPg(pool: Pool, dir?: string): Promise<{ imported: number; chunks: number }> {
  const cardDir = dir ?? path.resolve(process.cwd(), 'data', 'knowledge');
  if (!existsSync(cardDir)) return { imported: 0, chunks: 0 };
  const files = readdirSync(cardDir).filter((file) => file.toLowerCase().endsWith('.md')).sort();
  if (files.length === 0) return { imported: 0, chunks: 0 };

  interface ParsedCardMeta { id: string; title: string; source: string; locator: string; datasetId: string; trust: string; }
  interface ParsedCard { meta: ParsedCardMeta; content: string; file: string; }
  const cards: ParsedCard[] = [];
  for (const file of files) {
    const raw = readFileSync(path.join(cardDir, file), 'utf8');
    const normalized = raw.replace(/^\uFEFF/, '').trim();
    if (!normalized.startsWith('---')) continue;
    const end = normalized.indexOf('\n---', 3);
    if (end < 0) continue;
    const header = normalized.slice(3, end);
    const content = normalized.slice(end + 4).trim();
    const meta: ParsedCardMeta = {
      id: file.replace(/\.md$/i, '').toLowerCase(),
      title: '', source: '系统知识卡', locator: file, datasetId: KNOWLEDGE_CARD_SOURCE_ID, trust: 'high',
    };
    for (const line of header.split('\n')) {
      const match = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
      if (!match) continue;
      const key = match[1];
      const value = (match[2] ?? '').trim();
      if (key === 'id') meta.id = value.toLowerCase() || meta.id;
      else if (key === 'title') meta.title = value;
      else if (key === 'source') meta.source = value;
      else if (key === 'locator') meta.locator = value;
      else if (key === 'dataset' && value) meta.datasetId = value;
      else if (key === 'trust' && value) meta.trust = value;
    }
    if (meta.id && meta.title && content) cards.push({ meta, content, file });
  }

  await pool.query('DELETE FROM document_chunks WHERE source_id = $1', [KNOWLEDGE_CARD_SOURCE_ID]);
  let chunks = 0;
  for (const card of cards) {
    const parts = chunkCardContent(card.content);
    chunks += parts.length;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index]!;
      const id = parts.length === 1 ? `card-${card.meta.id}` : `card-${card.meta.id}#c${String(index + 1).padStart(2, '0')}`;
      const title = part.heading ? `${card.meta.title} · ${part.heading}` : card.meta.title;
      await upsertDocumentChunkPg(pool, {
        id,
        sourceId: card.meta.datasetId,
        sourcePath: `data/knowledge/${card.file}`,
        title: title.length > 180 ? `${title.slice(0, 179)}…` : title,
        content: part.text,
        locator: card.meta.locator,
        trustLevel: card.meta.trust,
      });
    }
  }
  return { imported: cards.length, chunks };
}

/** 声明式 CSV 数据集导入（PG 版，AI4I 等小体量数据集）：文件未变跳过，换文件自动重导。 */
export async function importCsvDatasetPg(pool: Pool, source: CsvDatasetSource): Promise<{ imported: boolean; rowCount: number }> {
  if (!existsSync(source.csvPath)) return { imported: false, rowCount: 0 };
  const csv = readFileSync(source.csvPath, 'utf8');
  const checksum = createHash('sha256').update(csv).digest('hex');

  const existing = (await pool.query('SELECT checksum FROM datasets WHERE id = $1', [source.id])).rows[0] as { checksum?: string | null } | undefined;
  const rowCountRow = (await pool.query('SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = $1', [source.id])).rows[0] as { count: string | number };
  const currentRowCount = Number(rowCountRow.count);
  if (existing?.checksum === checksum && currentRowCount > 0) return { imported: false, rowCount: currentRowCount };

  const { header, rows } = parseCsv(csv);
  if (header.length === 0 || rows.length === 0) return { imported: false, rowCount: 0 };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM dataset_rows WHERE dataset_id = $1', [source.id]);
    for (let index = 0; index < rows.length; index += 1) {
      const cells = rows[index]!;
      const record: Record<string, string | number | null> = {};
      header.forEach((name, columnIndex) => {
        const rawValue = (cells[columnIndex] ?? '').trim();
        const numberValue = inferNumber(rawValue);
        record[name] = numberValue === null ? rawValue : numberValue;
      });
      await client.query('INSERT INTO dataset_rows (dataset_id, row_id, data_json) VALUES ($1, $2, $3)', [source.id, index + 1, record]);
    }
    await client.query(
      `INSERT INTO datasets (id, name, source_kind, source_path, version, license, checksum, imported_at)
       VALUES ($1, $2, 'csv_dataset', $3, '1.0', $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET name = excluded.name, checksum = excluded.checksum, imported_at = excluded.imported_at`,
      [source.id, source.name, source.sourcePath, source.license, checksum, Date.now()],
    );
    const firstRow = rows[0];
    if (firstRow) {
      for (let columnIndex = 0; columnIndex < header.length; columnIndex += 1) {
        const name = header[columnIndex]!;
        const numeric = inferNumber((firstRow[columnIndex] ?? '').trim()) !== null;
        const labelRole = source.labelFields?.includes(name) ? 'label' : 'feature';
        const unitMatch = name.match(/\[([^\]]+)\]/);
        await client.query(
          `INSERT INTO dataset_fields (id, dataset_id, field_name, data_type, meaning, unit, label_role)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (id) DO UPDATE SET data_type = excluded.data_type, meaning = excluded.meaning, label_role = excluded.label_role`,
          [`${source.id}-field-${name}`, source.id, name, numeric ? 'REAL' : 'TEXT',
            source.fieldMeanings?.[name] ?? '数据字段', unitMatch?.[1] ?? '', labelRole],
        );
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  return { imported: true, rowCount: rows.length };
}

function inferNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** 小而美的 CSV 解析：覆盖引号、转义引号与换行（与 src/learning/tabular.ts 行为一致）。 */
function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index]!;
    if (inQuotes) {
      if (char === '"') {
        if (cleaned[index + 1] === '"') { field += '"'; index += 1; } else inQuotes = false;
      } else field += char;
      continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && cleaned[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((item) => item.trim().length > 0)) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }
  row.push(field);
  if (row.some((item) => item.trim().length > 0)) rows.push(row);
  const header = rows[0]?.map((name) => name.trim()) ?? [];
  return { header, rows: rows.slice(1) };
}

/** MetroPT-3 完整 CSV 导入（PG 版）：COPY 流式装载，仅空表时执行，1,516,948 行约 40-60 秒。 */
export async function importMetroPt3CsvPg(pool: Pool, csvPath: string): Promise<{ imported: number; skipped: boolean }> {
  const existing = (await pool.query('SELECT COUNT(*) AS count FROM metro_readings')).rows[0] as { count: string | number };
  if (Number(existing.count) > 0) return { imported: Number(existing.count), skipped: true };
  if (!existsSync(csvPath)) return { imported: 0, skipped: false };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stream = client.query(copyFrom(`
      COPY metro_readings (row_id, timestamp, tp2, tp3, h1, dv_pressure, reservoirs,
        oil_temperature, motor_current, comp, dv_electric, towers,
        mpg, lps, pressure_switch, oil_level, caudal_impulses)
      FROM STDIN WITH (FORMAT csv, HEADER true)
    `));
    await pipeline(createReadStream(csvPath, { encoding: 'utf8' }), stream);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const after = (await pool.query('SELECT COUNT(*) AS count FROM metro_readings')).rows[0] as { count: string | number };
  return { imported: Number(after.count), skipped: false };
}

export type { PoolClient };
