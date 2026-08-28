import { createHash, randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';
import { getMetroSummary, queryMetroReadings } from './metropt3.js';
import { getDatasetRowCount, sampleDatasetRows } from './tabular.js';
import type {
  CrossValidationResult,
  DatasetSummary,
  EvidenceItem,
  EvidencePack,
  EvidenceScope,
} from './types.js';

const TERM_ALIASES: Record<string, string[]> = {
  '压缩机': ['compressor', 'air production unit', 'apu'],
  '故障': ['failure', 'fault', 'anomaly'],
  '异常': ['anomaly', 'abnormal'],
  '泄漏': ['air leak', 'leak'],
  '传感器': ['sensor', 'signal'],
  '字段': ['attribute', 'feature', 'field'],
  '压力': ['pressure', 'tp2', 'tp3'],
  '油温': ['oil temperature', 'temperature'],
  '电流': ['motor current', 'current'],
  '阀': ['valve', 'dv pressure', 'intake valve'],
  '低压': ['low pressure', 'lps'],
  '维护': ['maintenance', 'predictive maintenance'],
  '预测': ['prediction', 'predictive maintenance'],
  '数据': ['dataset', 'data'],
  '编程': ['python', 'code'],
  '代码': ['python', 'code'],
  '清洗': ['data cleaning', 'pandas'],
  '分析': ['pandas', 'analysis'],
  '统计': ['statistics', 'describe'],
  '可视化': ['matplotlib', 'visualization'],
  '扭矩': ['torque'],
  '转速': ['rotational speed'],
  // 官方文档语料（pandas/matplotlib/python/scikit-learn）检索别名：中文提问 → 英文文档词。
  '直方图': ['histogram', 'hist'],
  '箱线图': ['boxplot', 'box'],
  '绘图': ['matplotlib', 'plot', 'pyplot'],
  '画图': ['matplotlib', 'plot', 'pyplot'],
  '图': ['matplotlib', 'plot'],
  '时间序列': ['time series', 'timeseries', 'datetime'],
  '重采样': ['resample', 'resampling', 'period'],
  '滑动窗口': ['rolling', 'window', 'moving'],
  '滚动': ['rolling', 'window'],
  '窗口': ['window', 'rolling'],
  '缺失值': ['missing data', 'missing', 'nan'],
  '缺失': ['missing data', 'dropna', 'fillna'],
  '分组': ['groupby', 'group'],
  '聚合': ['groupby', 'aggregate', 'agg'],
  '索引': ['indexing', 'index', 'loc', 'iloc'],
  '筛选': ['indexing', 'selection', 'loc', 'iloc'],
  '选择': ['indexing', 'selection'],
  '均值': ['mean', 'average'],
  '中位数': ['median'],
  '标准差': ['std', 'standard deviation'],
  '孤立森林': ['isolation forest', 'isolationforest'],
  '离群': ['outlier detection', 'outlier', 'novelty'],
  '异常检测': ['outlier detection', 'anomaly detection', 'isolation forest'],
  '循环': ['loop', 'for', 'while'],
  '函数': ['function', 'def'],
  '列表': ['list'],
  '字典': ['dict', 'dictionary'],
  '异常处理': ['exception', 'error handling', 'try'],
  '采样': ['resample', 'sampling'],
};

interface TemporaryReference {
  name: string;
  content: string;
}

interface EvidenceBuildOptions {
  learnerId?: string;
  sessionId?: string;
  temporaryReference?: TemporaryReference;
  /** DAG 检索节点按路径拆分：不传 = 双路全检（docs/挑战杯技术开发总规.md §5.2） */
  retrievalPlan?: Array<'structured' | 'document'>;
}

function normalizeSearchTerms(query: string): string[] {
  const knownChinese = Object.keys(TERM_ALIASES).filter((term) => query.includes(term));
  const english = Array.from(query.matchAll(/[A-Za-z][A-Za-z0-9_ -]{1,40}/g))
    .map((match) => match[0].trim())
    .filter(Boolean);
  const raw = [...knownChinese, ...english];
  const expanded = raw.flatMap((term) => [term, ...(TERM_ALIASES[term] ?? [])]);
  return Array.from(new Set(expanded.map((term) => term.trim().toLowerCase()).filter(Boolean))).slice(0, 18);
}

function persistEvidence(db: SqliteDatabase, item: EvidenceItem): void {
  db.prepare(`
    INSERT OR REPLACE INTO evidence_items
      (id, source_type, source_id, source_title, locator, content, retrieval_method,
       relevance_score, trust_level, source_scope, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.sourceType,
    item.sourceId,
    item.sourceTitle ?? null,
    item.locator,
    item.content,
    item.retrievalMethod,
    item.relevanceScore,
    item.trustLevel,
    item.scope ?? 'system',
    JSON.stringify(item.metadata ?? {}),
    Date.now(),
  );
}

function documentRows(datasetDb: SqliteDatabase, terms: string[]): Array<{ id: string; sourceId: string; sourcePath: string; locator: string; title: string; content: string }> {
  if (terms.length === 0) return [];
  const likeClauses = terms.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
  const likeParams = terms.flatMap((term) => [`%${term}%`, `%${term}%`]);
  try {
    const query = terms.map((term) => `"${term.replaceAll('"', '')}"`).join(' OR ');
    // FTS 虚表只有索引列，业务列需要回联 document_chunks；bm25 分数越低相关度越高。
    const rows = datasetDb.prepare(`
      SELECT c.id, c.source_id AS sourceId, c.source_path AS sourcePath, c.locator, c.title, c.content
      FROM document_chunks_fts f
      JOIN document_chunks c ON c.id = f.id
      WHERE document_chunks_fts MATCH ?
      ORDER BY bm25(document_chunks_fts)
      LIMIT 8
    `).all(query) as Array<{ id: string; sourceId: string; sourcePath: string; locator: string; title: string; content: string }>;
    if (rows.length > 0) return rows;
  } catch {
    // Fall through to the portable LIKE search below.
  }
  return datasetDb.prepare(`
    SELECT id, source_id AS sourceId, source_path AS sourcePath, locator, title, content
    FROM document_chunks
    WHERE ${likeClauses}
    LIMIT 8
  `).all(...likeParams) as Array<{ id: string; sourceId: string; sourcePath: string; locator: string; title: string; content: string }>;
}

function searchDocuments(datasetDb: SqliteDatabase, terms: string[]): EvidenceItem[] {
  return documentRows(datasetDb, terms).map((row, index) => ({
    id: `evidence-${randomUUID()}`,
    sourceType: 'document' as const,
    sourceId: row.sourceId,
    sourceTitle: row.title,
    locator: `${row.sourcePath}#${row.locator}`,
    content: row.content,
    retrievalMethod: 'fts' as const,
    relevanceScore: Math.max(0.55, 0.94 - index * 0.06),
    trustLevel: 'high' as const,
    scope: 'system' as EvidenceScope,
    metadata: { title: row.title, termsMatched: terms.length },
  }));
}

function genericDatasetEvidence(datasetDb: SqliteDatabase): EvidenceItem[] {
  const datasets = datasetDb.prepare(`
    SELECT d.id, d.name, d.source_path AS sourcePath
    FROM datasets d JOIN dataset_rows r ON r.dataset_id = d.id
    GROUP BY d.id ORDER BY d.id
  `).all() as Array<{ id: string; name: string; sourcePath: string }>;
  const items: EvidenceItem[] = [];
  for (const dataset of datasets) {
    const rowCount = getDatasetRowCount(datasetDb, dataset.id);
    if (rowCount === 0) continue;
    items.push({
      id: `evidence-${randomUUID()}`,
      sourceType: 'dataset',
      sourceId: dataset.id,
      sourceTitle: `${dataset.name} 数据集`,
      locator: `datasets.sqlite:datasets.id=${dataset.id}`,
      content: JSON.stringify({ dataset: dataset.name, rowCount, retrieval: '按标签抽样故障样本与正常样本' }),
      retrievalMethod: 'sql',
      relevanceScore: 0.9,
      trustLevel: 'high',
      scope: 'system',
      metadata: { queryKind: 'dataset_summary', rowCount },
    });
    sampleDatasetRows(datasetDb, dataset.id, 3).forEach((row, index) => {
      items.push({
        id: `evidence-${randomUUID()}`,
        sourceType: 'dataset',
        sourceId: dataset.id,
        sourceTitle: `${dataset.name} 代表性数据行`,
        locator: `datasets.sqlite:dataset_rows.dataset_id=${dataset.id}&row_id=${row.rowId}`,
        content: JSON.stringify(row.fields),
        retrievalMethod: 'sql',
        relevanceScore: Math.max(0.6, 0.84 - index * 0.04),
        trustLevel: 'high',
        scope: 'system',
        metadata: { queryKind: 'dataset_row', rowId: row.rowId },
      });
    });
  }
  return items;
}

function structuredEvidence(datasetDb: SqliteDatabase): EvidenceItem[] {
  const summary = getMetroSummary(datasetDb);
  const rows = queryMetroReadings(datasetDb, 6);
  const summaryItem: EvidenceItem = {
    id: `evidence-${randomUUID()}`,
    sourceType: 'dataset',
    sourceId: 'metropt-3',
    sourceTitle: 'MetroPT-3 CSV 数据集',
    locator: 'datasets.sqlite:datasets.id=metropt-3',
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
  };
  const rowItems = rows.map((row, index) => ({
    id: `evidence-${randomUUID()}`,
    sourceType: 'dataset' as const,
    sourceId: 'metropt-3',
    sourceTitle: 'MetroPT-3 CSV 数据行',
    locator: `datasets.sqlite:metro_readings.row_id=${row.rowId}`,
    content: JSON.stringify(row),
    retrievalMethod: 'sql' as const,
    relevanceScore: Math.max(0.58, 0.86 - index * 0.04),
    trustLevel: 'high' as const,
    scope: 'system' as EvidenceScope,
    metadata: { queryKind: 'recent_rows', rowId: row.rowId, timestamp: row.timestamp },
  }));
  return [summaryItem, ...rowItems, ...genericDatasetEvidence(datasetDb)];
}

export function crossValidate(items: EvidenceItem[]): CrossValidationResult {
  const structured = items.filter((item) => item.sourceType === 'dataset');
  const documents = items.filter((item) => item.sourceType === 'document');
  const locatable = items.filter((item) => item.locator.trim().length > 0);
  const checks = [
    {
      id: 'structured-source',
      label: 'CSV 结构化证据',
      status: structured.length > 0 ? 'passed' as const : 'review' as const,
      detail: structured.length > 0 ? `已查询 ${structured.length} 条结构化证据` : '没有获得可查询的数据证据',
      evidenceIds: structured.map((item) => item.id),
    },
    {
      id: 'document-source',
      label: 'PDF/领域文档证据',
      status: documents.length > 0 ? 'passed' as const : 'review' as const,
      detail: documents.length > 0 ? `已检索 ${documents.length} 条领域说明` : '没有获得可引用的领域文档证据',
      evidenceIds: documents.map((item) => item.id),
    },
    {
      id: 'source-agreement',
      label: '来源交叉验证',
      status: structured.length > 0 && documents.length > 0 ? 'passed' as const : 'review' as const,
      detail: structured.length > 0 && documents.length > 0
        ? '数据观测与领域说明均有来源，可进入审核裁判'
        : '只有单一来源，结论需要保守表达',
      evidenceIds: items.map((item) => item.id),
    },
    {
      id: 'source-locator',
      label: '来源定位完整',
      status: locatable.length === items.length && items.length > 0 ? 'passed' as const : 'failed' as const,
      detail: `${locatable.length}/${items.length} 条证据具备可回溯定位`,
      evidenceIds: locatable.map((item) => item.id),
    },
  ];
  const passed = checks.filter((check) => check.status === 'passed').length;
  const score = items.length === 0 ? 0 : Math.round(((passed / checks.length) * 0.7 + Math.min(1, items.length / 10) * 0.3) * 100) / 100;
  const status = items.length === 0
    ? 'unsupported'
    : structured.length > 0 && documents.length > 0
    ? 'corroborated'
    : 'needs_review';
  return {
    status,
    score,
    checks,
    notes: status === 'corroborated'
      ? ['结构化数据和领域文档已同时提供，生成内容仍需逐条 Claim 审核。']
      : ['当前证据来源不完整，不能把模型输出当作确定结论。'],
  };
}

function persistPack(db: SqliteDatabase, pack: EvidencePack): void {
  db.prepare(`
    INSERT OR REPLACE INTO evidence_packs
      (id, learner_id, session_id, query, retrieval_plan_json, coverage_score,
       cross_validation_json, privacy_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    pack.id,
    pack.learnerId ?? null,
    pack.sessionId ?? null,
    pack.query,
    JSON.stringify(pack.retrievalPlan),
    pack.coverageScore,
    JSON.stringify(pack.crossValidation),
    JSON.stringify(pack.privacy),
    pack.createdAt,
  );
  const insert = db.prepare('INSERT OR REPLACE INTO evidence_pack_items (pack_id, evidence_id, position) VALUES (?, ?, ?)');
  pack.items.forEach((item, index) => insert.run(pack.id, item.id, index));
}

export class EvidenceService {
  constructor(
    private readonly datasetDb: SqliteDatabase,
    private readonly learningDb: SqliteDatabase,
  ) {}

  getCatalog(): DatasetSummary {
    return getMetroSummary(this.datasetDb);
  }

  buildEvidencePack(query: string, options: EvidenceBuildOptions = {}): EvidencePack {
    const wantStructured = !options.retrievalPlan || options.retrievalPlan.includes('structured');
    const wantDocuments = !options.retrievalPlan || options.retrievalPlan.includes('document');
    const structured = wantStructured ? structuredEvidence(this.datasetDb) : [];
    const documents = wantDocuments ? searchDocuments(this.datasetDb, normalizeSearchTerms(query)) : [];
    const items = [...structured, ...documents];
    items.forEach((item) => persistEvidence(this.learningDb, item));
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
    persistPack(this.learningDb, pack);
    if (options.temporaryReference) {
      this.learningDb.prepare(`
        INSERT INTO privacy_audit_events
          (id, learner_id, session_id, event_type, file_name, byte_count, content_hash, redacted_fields_json, retained, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        `privacy-${randomUUID()}`,
        options.learnerId ?? null,
        options.sessionId ?? null,
        'temporary_reference_used',
        options.temporaryReference.name.slice(0, 160),
        Buffer.byteLength(options.temporaryReference.content, 'utf8'),
        createHash('sha256').update(options.temporaryReference.content).digest('hex'),
        JSON.stringify([]),
        0,
        Date.now(),
      );
    }
    return pack;
  }

  /** DAG 合并证据包复用同一持久化通道（INSERT OR REPLACE 幂等） */
  persistEvidencePack(pack: EvidencePack): void {
    pack.items.forEach((item) => persistEvidence(this.learningDb, item));
    persistPack(this.learningDb, pack);
  }
}

export function seedMetroCatalog(datasetDb: SqliteDatabase): void {
  const now = Date.now();
  datasetDb.prepare(`
    INSERT OR REPLACE INTO datasets
      (id, name, source_kind, source_path, version, license, checksum, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    'metropt-3',
    'MetroPT-3 Air Compressor',
    'industrial_dataset',
    'IM-Training-Agent-datasets/raw/MetroPT-3.zip::MetroPT3(AirCompressor).csv',
    '2020',
    'See bundled source metadata',
    '',
    now,
  );

  const fields = [
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
  ] as const;
  const insertField = datasetDb.prepare(`
    INSERT OR REPLACE INTO dataset_fields
      (id, dataset_id, field_name, data_type, meaning, unit, label_role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  fields.forEach(([name, dataType, meaning, unit, role]) => {
    insertField.run(`metropt-3-field-${name}`, 'metropt-3', name, dataType, meaning, unit, role);
  });

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
  const insertWindow = datasetDb.prepare(`
    INSERT OR REPLACE INTO metro_event_windows (id, dataset_id, label, start_at, end_at, source_locator)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  failureWindows.forEach(([id, label, description, locator]) => {
    const match = description.match(/(\d{4}-\d{2}-\d{2} \d{2}:\d{2}) 至 (\d{4}-\d{2}-\d{2} \d{2}:\d{2})/);
    if (match) insertWindow.run(id, 'metropt-3', label, match[1], match[2], `raw/MetroPT-3.zip::Data Description_Metro.pdf#${locator}`);
  });

  const insertChunk = datasetDb.prepare(`
    INSERT OR REPLACE INTO document_chunks
      (id, source_id, source_path, title, content, locator, trust_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  datasetDb.prepare(`DELETE FROM document_chunks WHERE id IN ('metropt-3-overview', 'metropt-3-field-guide')`).run();
  chunks.forEach(([id, title, content, sourcePath, locator]) => {
    insertChunk.run(id, 'metropt-3', sourcePath, title, content, locator, 'high');
  });
  failureWindows.forEach(([id, title, content, locator]) => {
    insertChunk.run(id, 'metropt-3', 'raw/MetroPT-3.zip::Data Description_Metro.pdf', title, content, locator, 'high');
  });
}

// FTS 全量重建放在所有文档来源（MetroPT-3 目录、知识卡）入库之后调用。
export function rebuildDocumentFts(datasetDb: SqliteDatabase): void {
  try {
    datasetDb.exec('DELETE FROM document_chunks_fts');
    datasetDb.exec(`
      INSERT INTO document_chunks_fts (id, title, content, source_path, locator)
      SELECT id, title, content, source_path, locator FROM document_chunks
    `);
  } catch {
    // FTS5 is optional; the EvidenceService has a LIKE fallback.
  }
}
