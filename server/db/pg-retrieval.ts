/**
 * 运行时混合检索（docs/挑战杯技术开发总规.md §7.5）：PG 全文 + pgvector 双路召回，RRF 合并 top-8。
 * 嵌入失败自动降级为纯 FTS，并把降级原因随 EvidencePack.hybrid 上报（executor 写入 Run 事件）。
 */
import { rrfMerge } from '../../src/learning/retrieval/hybrid.js';
import type { HybridRetrievalInfo } from '../../src/learning/types.js';
import type { Pool } from 'pg';

export type { HybridRetrievalInfo };

export interface HybridDocumentRow {
  id: string;
  sourceId: string;
  sourcePath: string;
  locator: string;
  title: string;
  content: string;
  /** 该行的主要召回路：仅向量命中时为 vector，其余 fts */
  via: 'fts' | 'vector';
}

export interface HybridDocumentResult {
  rows: HybridDocumentRow[];
  hybrid: HybridRetrievalInfo;
}

/** 查询向量：DashScope text-embedding-v4，1024 维；任何失败返回 null（不阻塞生成） */
export async function embedQuery(text: string): Promise<number[] | null> {
  const apiKey = process.env['DASHSCOPE_API_KEY'];
  if (!apiKey) return null;
  const model = process.env['EMBEDDING_MODEL'] ?? 'text-embedding-v4';
  const dimensions = Number(process.env['EMBEDDING_DIM'] ?? 1024);
  try {
    const response = await fetch(`${process.env['DASHSCOPE_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text.slice(0, 6000), dimensions, encoding_format: 'float' }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { data?: Array<{ embedding: number[] }> };
    const embedding = payload.data?.[0]?.embedding;
    if (!Array.isArray(embedding) || embedding.length !== dimensions) return null;
    return embedding;
  } catch {
    return null;
  }
}

interface ChunkRow {
  id: string;
  sourceId: string;
  sourcePath: string;
  locator: string;
  title: string;
  content: string;
}

function toHybridRow(row: ChunkRow, via: 'fts' | 'vector'): HybridDocumentRow {
  return { id: row.id, sourceId: row.sourceId, sourcePath: row.sourcePath, locator: row.locator, title: row.title, content: row.content, via };
}

export async function hybridDocumentRowsPg(
  pool: Pool,
  tsquery: string | null,
  query: string,
  topN = 8,
): Promise<HybridDocumentResult> {
  const info: HybridRetrievalInfo = { vectorUsed: false, degraded: false, ftsCandidates: 0, vectorCandidates: 0 };
  const rankings: Record<string, Array<{ id: string; rank: number }>> = {};
  const rowsById = new Map<string, ChunkRow>();

  // 全文路：tsvector 召回 top-20（简单配置 + 检索别名桥接中文）
  if (tsquery) {
    try {
      const ftsRows = (await pool.query(
        `SELECT id, source_id AS "sourceId", source_path AS "sourcePath", locator, title, content
         FROM document_chunks
         WHERE to_tsvector('simple', search_text) @@ to_tsquery('simple', $1)
         ORDER BY ts_rank(to_tsvector('simple', search_text), to_tsquery('simple', $1)) DESC
         LIMIT 20`, [tsquery],
      )).rows as ChunkRow[];
      info.ftsCandidates = ftsRows.length;
      rankings['fts'] = ftsRows.map((row, index) => ({ id: row.id, rank: index + 1 }));
      ftsRows.forEach((row) => rowsById.set(row.id, row));
    } catch {
      // tsquery 语法异常：全文路空，由 ILIKE 兜底
    }
  }

  // 向量路：pgvector cosine 召回 top-20（仅当存在查询向量且库内有向量）
  const embedding = await embedQuery(query);
  if (embedding) {
    const vectorLiteral = JSON.stringify(embedding);
    try {
      const vectorRows = (await pool.query(
        `SELECT id, source_id AS "sourceId", source_path AS "sourcePath", locator, title, content
         FROM document_chunks
         WHERE embedding IS NOT NULL
         ORDER BY embedding <=> $1::vector
         LIMIT 20`, [vectorLiteral],
      )).rows as ChunkRow[];
      info.vectorCandidates = vectorRows.length;
      if (vectorRows.length > 0) {
        info.vectorUsed = true;
        rankings['vector'] = vectorRows.map((row, index) => ({ id: row.id, rank: index + 1 }));
        vectorRows.forEach((row) => rowsById.set(row.id, row));
      } else {
        // 库内没有任何向量：向量路不可用，按降级如实上报
        info.reason = 'no_embeddings';
        info.degraded = true;
      }
    } catch {
      info.reason = 'vector_query_failed';
    }
  } else {
    info.reason = 'embed_failed';
    info.degraded = true;
  }

  // 双路皆空：ILIKE 兜底（与 SQLite 版 FTS→LIKE 回退语义一致）
  if (Object.keys(rankings).length === 0) {
    const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1).slice(0, 6);
    if (terms.length === 0) return { rows: [], hybrid: info };
    const likeClauses = terms.map((_, index) => `(title ILIKE $${index + 1} OR content ILIKE $${index + 1})`).join(' OR ');
    const likeRows = (await pool.query(
      `SELECT id, source_id AS "sourceId", source_path AS "sourcePath", locator, title, content
       FROM document_chunks WHERE ${likeClauses} LIMIT ${topN}`, terms,
    )).rows as ChunkRow[];
    return { rows: likeRows.map((row) => toHybridRow(row, 'fts')), hybrid: { ...info, degraded: true } };
  }

  const merged = rrfMerge(rankings, topN);
  const rows: HybridDocumentRow[] = [];
  for (const item of merged) {
    const row = rowsById.get(item.id);
    if (!row) continue;
    const onlyVector = item.ranks.every((hit) => hit.source === 'vector');
    rows.push(toHybridRow(row, onlyVector ? 'vector' : 'fts'));
  }
  return { rows, hybrid: info };
}
