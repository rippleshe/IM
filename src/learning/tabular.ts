import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import type { SqliteDatabase } from './sqlite.js';

export interface CsvDatasetSource {
  id: string;
  name: string;
  /** 项目内的 CSV 文件路径（相对仓库根或绝对路径）。 */
  csvPath: string;
  /** 证据定位里展示的来源路径。 */
  sourcePath: string;
  license: string;
  /** 字段中文说明；未给出的字段自动写成“数据字段”。 */
  fieldMeanings?: Record<string, string>;
  /** 作为故障/结果标签的字段，检索时会优先抽取正样本作为代表性数据。 */
  labelFields?: string[];
}

interface ParsedCsv {
  header: string[];
  rows: string[][];
}

// 小而美的 CSV 解析：覆盖引号、转义引号与换行；本项目的数据集都是小体量 CSV。
function parseCsv(text: string): ParsedCsv {
  const cleaned = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let index = 0; index < cleaned.length; index += 1) {
    const char = cleaned[index];
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

function inferNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// 数据集以“声明式来源 + 文件校验和”接入：文件没变就跳过，换文件即自动重新导入。
export function importCsvDataset(datasetDb: SqliteDatabase, source: CsvDatasetSource): { imported: boolean; rowCount: number } {
  if (!existsSync(source.csvPath)) return { imported: false, rowCount: 0 };
  const csv = readFileSync(source.csvPath, 'utf8');
  const checksum = createHash('sha256').update(csv).digest('hex');
  const existing = datasetDb.prepare('SELECT checksum FROM datasets WHERE id = ?').get(source.id) as { checksum?: string | null } | undefined;
  const rowCount = Number((datasetDb.prepare('SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = ?').get(source.id) as { count: number }).count);
  if (existing?.checksum === checksum && rowCount > 0) return { imported: false, rowCount };

  const { header, rows } = parseCsv(csv);
  if (header.length === 0 || rows.length === 0) return { imported: false, rowCount: 0 };

  const insertRow = datasetDb.prepare('INSERT OR REPLACE INTO dataset_rows (dataset_id, row_id, data_json) VALUES (?, ?, ?)');
  datasetDb.exec('BEGIN');
  try {
    datasetDb.prepare('DELETE FROM dataset_rows WHERE dataset_id = ?').run(source.id);
    rows.forEach((cells, index) => {
      const record: Record<string, string | number | null> = {};
      header.forEach((name, columnIndex) => {
        const rawValue = (cells[columnIndex] ?? '').trim();
        const numberValue = inferNumber(rawValue);
        record[name] = numberValue === null ? rawValue : numberValue;
      });
      insertRow.run(source.id, index + 1, JSON.stringify(record));
    });
    datasetDb.prepare('COMMIT').run();
  } catch (error) {
    datasetDb.prepare('ROLLBACK').run();
    throw error;
  }

  datasetDb.prepare(`
    INSERT OR REPLACE INTO datasets (id, name, source_kind, source_path, version, license, checksum, imported_at)
    VALUES (?, ?, 'csv_dataset', ?, '1.0', ?, ?, ?)
  `).run(source.id, source.name, source.sourcePath, source.license, checksum, Date.now());

  const insertField = datasetDb.prepare(`
    INSERT OR REPLACE INTO dataset_fields (id, dataset_id, field_name, data_type, meaning, unit, label_role)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const firstRow = rows[0];
  if (!firstRow) return { imported: true, rowCount: rows.length };
  header.forEach((name, columnIndex) => {
    const numeric = inferNumber((firstRow[columnIndex] ?? '').trim()) !== null;
    const labelRole = source.labelFields?.includes(name) ? 'label' : 'feature';
    const unitMatch = name.match(/\[([^\]]+)\]/);
    insertField.run(
      `${source.id}-field-${name}`,
      source.id,
      name,
      numeric ? 'REAL' : 'TEXT',
      source.fieldMeanings?.[name] ?? '数据字段',
      unitMatch?.[1] ?? '',
      labelRole,
    );
  });
  return { imported: true, rowCount: rows.length };
}

export interface DatasetRowSample {
  rowId: number;
  fields: Record<string, string | number | null>;
}

// 代表性样本：优先取标签字段命中的故障行（教学上最有展示价值），再补一行正常行。
export function sampleDatasetRows(datasetDb: SqliteDatabase, datasetId: string, limit = 3): DatasetRowSample[] {
  const labelFields = (datasetDb.prepare(`
    SELECT field_name AS fieldName FROM dataset_fields
    WHERE dataset_id = ? AND label_role = 'label' ORDER BY field_name
  `).all(datasetId) as Array<{ fieldName: string }>).map((row) => row.fieldName);
  const positives: DatasetRowSample[] = [];
  for (const field of labelFields) {
    if (positives.length >= limit) break;
    const needed = limit - positives.length;
    const known = new Set(positives.map((row) => row.rowId));
    const candidates = datasetDb.prepare(`
      SELECT row_id AS rowId, data_json AS dataJson FROM dataset_rows
      WHERE dataset_id = ? AND CAST(json_extract(data_json, '$."${field.replaceAll('"', '')}"') AS TEXT) = '1'
      ORDER BY row_id LIMIT ?
    `).all(datasetId, needed * 4) as Array<{ rowId: number; dataJson: string }>;
    for (const candidate of candidates) {
      if (positives.length >= limit || known.has(candidate.rowId)) continue;
      let fields: Record<string, string | number | null>;
      try { fields = JSON.parse(candidate.dataJson) as Record<string, string | number | null>; } catch { continue; }
      if (labelFields.some((label) => fields[label] === 1 || fields[label] === '1')) {
        positives.push({ rowId: Number(candidate.rowId), fields });
        known.add(candidate.rowId);
      }
    }
  }
  if (positives.length < limit) {
    const known = new Set(positives.map((row) => row.rowId));
    const fallback = datasetDb.prepare(`
      SELECT row_id AS rowId, data_json AS dataJson FROM dataset_rows
      WHERE dataset_id = ? AND row_id % 997 = 1 LIMIT ?
    `).all(datasetId, limit) as Array<{ rowId: number; dataJson: string }>;
    for (const row of fallback) {
      if (positives.length >= limit || known.has(row.rowId)) continue;
      try { positives.push({ rowId: Number(row.rowId), fields: JSON.parse(row.dataJson) as Record<string, string | number | null> }); } catch { /* 跳过损坏行 */ }
    }
  }
  return positives.slice(0, limit).sort((a, b) => a.rowId - b.rowId);
}

export function getDatasetRowCount(datasetDb: SqliteDatabase, datasetId: string): number {
  return Number((datasetDb.prepare('SELECT COUNT(*) AS count FROM dataset_rows WHERE dataset_id = ?').get(datasetId) as { count: number }).count);
}
