import { createHash, randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

const MAX_CHUNK_CHARS = 1_200;
const MIN_CHUNK_CHARS = 120;

export type SourceReviewDecision = 'approve' | 'reject';

export type ManagedChunk = {
  content: string;
  sectionPath: string | null;
  sortOrder: number;
  tokenCount: number;
  contentHash: string;
};

function normalizedText(value: string): string {
  return value.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function splitLongBlock(value: string): string[] {
  const parts: string[] = [];
  let buffer = '';
  for (const line of value.split('\n')) {
    if (line.length > MAX_CHUNK_CHARS) {
      if (buffer) {
        parts.push(buffer);
        buffer = '';
      }
      for (let start = 0; start < line.length; start += MAX_CHUNK_CHARS) {
        parts.push(line.slice(start, start + MAX_CHUNK_CHARS));
      }
      continue;
    }
    const next = buffer ? `${buffer}\n${line}` : line;
    if (next.length > MAX_CHUNK_CHARS && buffer) {
      parts.push(buffer);
      buffer = line;
    } else buffer = next;
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

/**
 * 面向资料审核的可定位切片：保留 Markdown 层级，优先在段落边界切分。
 * 这里不做 embedding；向量回填由既有异步管道负责，避免审核操作阻塞。
 */
export function chunkManagedDocument(text: string): ManagedChunk[] {
  const sections: Array<{ path: string | null; blocks: string[] }> = [];
  const stack: string[] = [];
  let blocks: string[] = [];
  let sectionPath: string | null = null;
  const flushSection = () => {
    if (blocks.length) sections.push({ path: sectionPath, blocks });
    blocks = [];
  };
  for (const line of normalizedText(text).split('\n')) {
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (match) {
      flushSection();
      const level = match[1]!.length;
      stack.length = level - 1;
      stack[level - 1] = match[2]!.trim();
      sectionPath = stack.filter(Boolean).join(' / ') || null;
      continue;
    }
    blocks.push(line);
  }
  flushSection();

  const chunks: Array<{ content: string; sectionPath: string | null }> = [];
  for (const section of sections) {
    let buffer = '';
    for (const block of section.blocks.join('\n').split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean)) {
      const candidates = block.length > MAX_CHUNK_CHARS ? splitLongBlock(block) : [block];
      for (const candidate of candidates) {
        const next = buffer ? `${buffer}\n\n${candidate}` : candidate;
        if (next.length > MAX_CHUNK_CHARS && buffer) {
          chunks.push({ content: buffer, sectionPath: section.path });
          buffer = candidate;
        } else buffer = next;
      }
    }
    if (buffer) chunks.push({ content: buffer, sectionPath: section.path });
  }
  const merged: Array<{ content: string; sectionPath: string | null }> = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && chunk.content.length < MIN_CHUNK_CHARS && previous.sectionPath === chunk.sectionPath) {
      previous.content = `${previous.content}\n\n${chunk.content}`;
    } else merged.push(chunk);
  }
  return merged.filter((chunk) => chunk.content.length >= 40).map((chunk, index) => ({
    ...chunk,
    sortOrder: index + 1,
    tokenCount: Math.max(1, Math.ceil(chunk.content.length / 4)),
    contentHash: createHash('sha256').update(chunk.content).digest('hex'),
  }));
}

export type KnowledgeSourceListItem = {
  id: string;
  title: string;
  shortTitle: string | null;
  sourceType: string;
  reviewStatus: string;
  trustLevel: string;
  license: string;
  versionId: string;
  versionStatus: string;
  parseStatus: string;
  characters: number;
  originalEntry: string | null;
  createdAt: number;
};

export async function listManagedSources(pool: Pool, status = 'candidate'): Promise<KnowledgeSourceListItem[]> {
  const allowed = new Set(['candidate', 'approved', 'rejected']);
  const reviewStatus = allowed.has(status) ? status : 'candidate';
  const result = await pool.query(
    `SELECT s.id, s.title, s.short_title AS "shortTitle", s.source_type AS "sourceType",
      s.review_status AS "reviewStatus", s.trust_level AS "trustLevel", s.license,
      v.id AS "versionId", v.version_status AS "versionStatus", v.parse_status AS "parseStatus",
      COALESCE((v.quality_report ->> 'characters')::int, 0) AS characters,
      v.quality_report ->> 'sourceFile' AS "originalEntry", v.created_at AS "createdAt"
     FROM knowledge_sources s
     JOIN LATERAL (
       SELECT * FROM knowledge_source_versions
       WHERE source_id = s.id ORDER BY created_at DESC LIMIT 1
     ) v ON true
     WHERE s.review_status = $1
     ORDER BY v.created_at DESC, s.title ASC`,
    [reviewStatus],
  );
  return result.rows as KnowledgeSourceListItem[];
}

export async function getKnowledgeOverview(pool: Pool): Promise<{ candidates: number; approved: number; rejected: number; parsedCandidates: number; formalChunks: number }> {
  const [sources, chunks] = await Promise.all([
    pool.query(
      `SELECT review_status AS status, COUNT(*)::int AS count FROM knowledge_sources GROUP BY review_status`,
    ),
    pool.query(`SELECT COUNT(*)::int AS count FROM document_chunks WHERE source_version_id IS NOT NULL AND enabled = TRUE`),
  ]);
  const counts = new Map<string, number>(sources.rows.map((row: { status: string; count: number }) => [row.status, row.count]));
  const parsed = await pool.query(
    `SELECT COUNT(*)::int AS count FROM knowledge_sources s
      JOIN knowledge_source_versions v ON v.source_id = s.id
      WHERE s.review_status = 'candidate' AND v.version_status = 'candidate' AND v.parse_status = 'parsed'`,
  );
  return {
    candidates: counts.get('candidate') ?? 0,
    approved: counts.get('approved') ?? 0,
    rejected: counts.get('rejected') ?? 0,
    parsedCandidates: Number(parsed.rows[0]?.count ?? 0),
    formalChunks: Number(chunks.rows[0]?.count ?? 0),
  };
}

export async function reviewManagedSource(pool: Pool, input: {
  sourceId: string;
  decision: SourceReviewDecision;
  reviewerId: string;
  shortTitle?: string;
  trustLevel?: string;
}): Promise<{ chunksCreated: number; reviewStatus: 'approved' | 'rejected' }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const source = await client.query(
      `SELECT s.id, s.title, s.short_title AS "shortTitle", s.trust_level AS "trustLevel", v.id AS "versionId",
        v.extracted_text AS "extractedText", v.parse_status AS "parseStatus", v.original_path AS "originalPath"
       FROM knowledge_sources s
       JOIN LATERAL (SELECT * FROM knowledge_source_versions WHERE source_id = s.id ORDER BY created_at DESC LIMIT 1) v ON true
       WHERE s.id = $1 FOR UPDATE`,
      [input.sourceId],
    );
    const row = source.rows[0] as {
      id: string; title: string; shortTitle: string | null; trustLevel: string; versionId: string;
      extractedText: string | null; parseStatus: string; originalPath: string;
    } | undefined;
    if (!row) throw new Error('未找到该候选资料');
    const now = Date.now();
    const shortTitle = input.shortTitle?.trim().slice(0, 72) || row.shortTitle || row.title.slice(0, 72);
    const trustLevel = ['low', 'medium', 'high'].includes(input.trustLevel ?? '') ? input.trustLevel! : row.trustLevel;
    if (input.decision === 'reject') {
      await client.query(`UPDATE knowledge_source_versions SET version_status = 'rejected' WHERE id = $1`, [row.versionId]);
      await client.query(
        `UPDATE knowledge_sources SET review_status = 'rejected', short_title = $2, trust_level = $3,
          metadata_json = metadata_json || $4::jsonb, updated_at = $5 WHERE id = $1`,
        [row.id, shortTitle, trustLevel, JSON.stringify({ lastReviewedBy: input.reviewerId, lastReviewedAt: now }), now],
      );
      await client.query('COMMIT');
      return { chunksCreated: 0, reviewStatus: 'rejected' };
    }
    if (row.parseStatus !== 'parsed' || !row.extractedText?.trim()) throw new Error('该资料尚未解析成功，不能进入正式检索');
    const chunks = chunkManagedDocument(row.extractedText);
    if (chunks.length === 0) throw new Error('未能从资料中生成有效切片');
    await client.query('DELETE FROM document_chunks WHERE source_version_id = $1', [row.versionId]);
    for (const chunk of chunks) {
      await client.query(
        `INSERT INTO document_chunks
          (id, source_id, source_version_id, source_path, title, content, search_text, locator, section_path, chunk_type, sort_order, token_count, content_hash, enabled, trust_level, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'text', $10, $11, $12, TRUE, $13, $14)`,
        [
          `managed-${row.versionId}-${String(chunk.sortOrder).padStart(4, '0')}-${randomUUID().slice(0, 8)}`,
          row.id, row.versionId, row.originalPath, row.title, chunk.content,
          `${row.title}\n${chunk.sectionPath ?? ''}\n${chunk.content}`,
          chunk.sectionPath ? `§ ${chunk.sectionPath}` : '正文', chunk.sectionPath, chunk.sortOrder,
          chunk.tokenCount, chunk.contentHash, trustLevel, now,
        ],
      );
    }
    await client.query(`UPDATE knowledge_source_versions SET version_status = 'active' WHERE id = $1`, [row.versionId]);
    await client.query(
      `UPDATE knowledge_sources SET review_status = 'approved', current_version_id = $2, short_title = $3, trust_level = $4,
        metadata_json = metadata_json || $5::jsonb, updated_at = $6 WHERE id = $1`,
      [row.id, row.versionId, shortTitle, trustLevel, JSON.stringify({ lastReviewedBy: input.reviewerId, lastReviewedAt: now }), now],
    );
    await client.query('COMMIT');
    return { chunksCreated: chunks.length, reviewStatus: 'approved' };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
