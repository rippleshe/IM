import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import type { SqliteDatabase } from './sqlite.js';
import type { DatasetSummary, MetroReading } from './types.js';

const METRO_DATASET_ID = 'metropt-3';

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      values.push(value.trim());
      value = '';
    } else {
      value += char;
    }
  }

  values.push(value.trim());
  return values;
}

function numeric(value: string | undefined): number | null {
  if (!value || value.toLowerCase() === 'nan') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function importMetroPt3Csv(
  db: SqliteDatabase,
  csvPath: string,
  replace = false,
): Promise<{ imported: number; skipped: boolean }> {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM metro_readings').get() as { count: number };
  if (Number(existing.count) > 0 && !replace) {
    return { imported: Number(existing.count), skipped: true };
  }

  const input = createInterface({
    input: createReadStream(csvPath, { encoding: 'utf8' }),
    crlfDelay: Infinity,
  });
  const insert = db.prepare(`
    INSERT INTO metro_readings (
      row_id, timestamp, tp2, tp3, h1, dv_pressure, reservoirs,
      oil_temperature, motor_current, comp, dv_electric, towers,
      mpg, lps, pressure_switch, oil_level, caudal_impulses
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let lineNumber = 0;
  let imported = 0;
  let offset = 1;
  db.exec('BEGIN');
  try {
    if (replace) db.exec('DELETE FROM metro_readings');
    for await (const line of input) {
      lineNumber += 1;
      if (lineNumber === 1) {
        const header = parseCsvLine(line);
        offset = header[0] === '' ? 1 : 0;
        continue;
      }
      if (!line.trim()) continue;

      const parts = parseCsvLine(line);
      const timestamp = parts[offset];
      if (!timestamp) continue;
      const rowId = Number(parts[0]) || imported + 1;
      const values = parts.slice(offset + 1, offset + 16).map(numeric);
      while (values.length < 15) values.push(null);
      insert.run(rowId, timestamp, ...values);
      imported += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  return { imported, skipped: false };
}

export function getMetroSummary(db: SqliteDatabase): DatasetSummary {
  const row = db.prepare(`
    SELECT COUNT(*) AS rowCount, MIN(timestamp) AS firstTimestamp, MAX(timestamp) AS lastTimestamp
    FROM metro_readings
  `).get() as { rowCount: number; firstTimestamp: string | null; lastTimestamp: string | null };
  const fieldCount = db.prepare(`
    SELECT COUNT(*) AS count FROM dataset_fields WHERE dataset_id = ?
  `).get(METRO_DATASET_ID) as { count: number };

  return {
    id: METRO_DATASET_ID,
    name: 'MetroPT-3 Air Compressor',
    rowCount: Number(row.rowCount),
    firstTimestamp: row.firstTimestamp,
    lastTimestamp: row.lastTimestamp,
    fieldCount: Number(fieldCount.count),
  };
}

export function queryMetroReadings(db: SqliteDatabase, limit = 5): MetroReading[] {
  const boundedLimit = Math.max(1, Math.min(limit, 20));
  const rows = db.prepare(`
    SELECT row_id AS rowId, timestamp, tp2, tp3, h1, dv_pressure AS dvPressure,
      reservoirs, oil_temperature AS oilTemperature, motor_current AS motorCurrent,
      comp, dv_electric AS dvElectric, towers, mpg, lps,
      pressure_switch AS pressureSwitch, oil_level AS oilLevel,
      caudal_impulses AS caudalImpulses
    FROM metro_readings
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(boundedLimit) as MetroReading[];
  return rows;
}

export { METRO_DATASET_ID };
