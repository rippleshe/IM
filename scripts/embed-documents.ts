/**
 * 知识切片同步 + 向量回填（docs/挑战杯技术开发总规.md §7.5 混合召回的数据侧）：
 * 1. 读取 SQLite document_chunks（knowledge-cards 与 metropt-3 两个受管来源）。
 * 2. 以 sha256(正文) 为键维护 data/embeddings-cache.json 向量缓存，内容未变的切片不重复调用嵌入 API。
 * 3. 全量 upsert 到 PG document_chunks（含 search_text 与 embedding），并删除 PG 中已不存在的行。
 *
 * 用法：pnpm exec tsx scripts/embed-documents.ts [--no-embed]
 * 未配置 DASHSCOPE_API_KEY 时只同步结构化列（embedding 留空），正常退出。
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';

import { getDatasetDatabasePath, openSqlite } from '../src/learning/sqlite.js';

const MANAGED_SOURCES = ['knowledge-cards', 'metropt-3'];
const EMBED_MODEL = 'text-embedding-v4';
const EMBED_DIMENSIONS = 1024;
const BATCH_SIZE = 10;
const CACHE_PATH = path.resolve(process.cwd(), 'data', 'embeddings-cache.json');

type SqliteChunk = {
  id: string;
  source_id: string;
  source_path: string;
  title: string;
  content: string;
  locator: string;
  trust_level: string;
};

type EmbeddingCache = Record<string, number[]>;

function loadCache(): EmbeddingCache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, 'utf8')) as EmbeddingCache;
  } catch {
    return {};
  }
}

async function embedBatch(apiKey: string, texts: string[], attempt = 0): Promise<number[][]> {
  const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts, dimensions: EMBED_DIMENSIONS, encoding_format: 'float' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok && attempt < 3) {
    await new Promise((resolve) => setTimeout(resolve, 2_000 * (attempt + 1)));
    return embedBatch(apiKey, texts, attempt + 1);
  }
  if (!response.ok) throw new Error(`嵌入 API HTTP ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const payload = (await response.json()) as { data: Array<{ index: number; embedding: number[] }> };
  const ordered = [...payload.data].sort((a, b) => a.index - b.index);
  if (ordered.length !== texts.length) throw new Error(`嵌入数量不匹配：请求 ${texts.length} 返回 ${ordered.length}`);
  return ordered.map((item) => item.embedding);
}

async function main(): Promise<void> {
  const noEmbed = process.argv.includes('--no-embed');
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  const sqlite = openSqlite(getDatasetDatabasePath());
  const chunks = sqlite
    .prepare(`SELECT id, source_id, source_path, title, content, locator, trust_level FROM document_chunks WHERE source_id IN (${MANAGED_SOURCES.map(() => '?').join(',')}) ORDER BY id`)
    .all(...MANAGED_SOURCES) as unknown as SqliteChunk[];
  console.log(`SQLite 受管切片 ${chunks.length} 条（${MANAGED_SOURCES.join('、')}）`);
  if (chunks.length === 0) return;

  const pool = new Pool({ connectionString: process.env['DATABASE_URL'], max: 4 });
  try {
    // 复用 PG 里已有向量：内容哈希一致就不重新计费。
    const existing = await pool.query<{ id: string; content: string; embedding: string | null }>(
      `SELECT id, content, embedding::text AS embedding FROM document_chunks WHERE source_id = ANY($1) AND embedding IS NOT NULL`,
      [MANAGED_SOURCES],
    );
    const cache = loadCache();
    let reused = 0;
    for (const row of existing.rows) {
      const key = createHash('sha256').update(row.content).digest('hex');
      if (!cache[key] && row.embedding) {
        cache[key] = JSON.parse(row.embedding) as number[];
        reused += 1;
      }
    }

    const chunkByKey = new Map<string, SqliteChunk>();
    for (const chunk of chunks) {
      chunkByKey.set(createHash('sha256').update(chunk.content).digest('hex'), chunk);
    }
    const pending = new Map<string, string[]>();
    for (const [key, chunk] of chunkByKey) {
      if (cache[key]) continue;
      pending.set(key, pending.get(key) ?? []);
      pending.get(key)!.push(chunk.id);
    }

    if (noEmbed || !apiKey) {
      if (!noEmbed && !apiKey) console.warn('[embed] 未配置 DASHSCOPE_API_KEY，只同步结构化列，embedding 留空。');
    } else {
      console.log(`需新嵌入 ${pending.size} 组（缓存复用 ${chunks.length - pending.size} 条${reused ? `，其中来自 PG ${reused} 条` : ''}）`);
      const keys = [...pending.keys()];
      for (let offset = 0; offset < keys.length; offset += BATCH_SIZE) {
        const batchKeys = keys.slice(offset, offset + BATCH_SIZE);
        const texts = batchKeys.map((key) => {
          const chunk = chunkByKey.get(key)!;
          return `${chunk.title}\n${chunk.content}`;
        });
        const vectors = await embedBatch(apiKey, texts);
        batchKeys.forEach((key, index) => { cache[key] = vectors[index]!; });
        const done = Math.min(offset + BATCH_SIZE, keys.length);
        process.stdout.write(`\r嵌入进度 ${done}/${keys.length}`);
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      process.stdout.write('\n');
      writeFileSync(CACHE_PATH, JSON.stringify(cache), 'utf8');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM document_chunks WHERE source_id = ANY($1)`, [MANAGED_SOURCES]);
      const insert = `
        INSERT INTO document_chunks (id, source_id, source_path, title, content, search_text, locator, trust_level, embedding, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::vector, $10)
      `;
      let withVector = 0;
      for (const chunk of chunks) {
        const key = createHash('sha256').update(chunk.content).digest('hex');
        const vector = cache[key];
        if (vector) withVector += 1;
        await client.query(insert, [
          chunk.id,
          chunk.source_id,
          chunk.source_path,
          chunk.title,
          chunk.content,
          `${chunk.title}\n${chunk.content}`,
          chunk.locator,
          chunk.trust_level || 'high',
          vector ? `[${vector.join(',')}]` : null,
          Date.now(),
        ]);
      }
      await client.query('COMMIT');
      console.log(`PG document_chunks 同步完成：${chunks.length} 条（含向量 ${withVector} 条）。`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
