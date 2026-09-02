/**
 * SearXNG 结果的受限候选账本。
 *
 * 搜索摘要只证明“有一个可能相关的网页”，不等于可引用正文。这里仅保存
 * 标题、规范化 URL 和短摘要，状态固定为 candidate，交给后续正文抓取与
 * knowledge-curator；任何候选入库失败都不应影响当前 EvidencePack。
 */
import { createHash } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import type { SearxngSearchResult } from './search/searxng.js';

const MAX_CANDIDATES_PER_SEARCH = 3;
const MAX_SUMMARY_CHARS = 2_400;

export type WebCandidatePersistenceResult = {
  sourcesUpserted: number;
  versionsAdded: number;
  skipped: number;
};

/** 规范化网页身份，去掉片段和常见追踪参数，但保留业务查询参数。 */
export function canonicalizeWebUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username || url.password) return null;
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' && url.port === '80') || (url.protocol === 'https:' && url.port === '443')) url.port = '';
    const tracking = /^(utm_[a-z_]+|gclid|fbclid|msclkid|mc_cid|mc_eid)$/i;
    for (const key of [...url.searchParams.keys()]) {
      if (tracking.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname.replace(/\/{2,}/g, '/').replace(/\/$/, '') || '/';
    return url.toString();
  } catch {
    return null;
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function shortTitle(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 72) || '网络资料候选';
}

function summaryOf(result: SearxngSearchResult): string {
  return `${result.title}\n\n${result.content}`.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS);
}

/**
 * 将本次 Web 补全的前几个结果登记为候选来源。
 * 事务只覆盖候选账本，不会写入 document_chunks，也不会降低既有来源状态。
 */
export async function persistWebSearchCandidates(
  pool: Pool,
  input: { query: string; results: SearxngSearchResult[] },
): Promise<WebCandidatePersistenceResult> {
  const unique = new Map<string, SearxngSearchResult>();
  for (const result of input.results) {
    const canonicalUrl = canonicalizeWebUrl(result.url);
    if (!canonicalUrl || !result.title.trim() || !result.content.trim()) continue;
    if (!unique.has(canonicalUrl)) unique.set(canonicalUrl, { ...result, url: canonicalUrl });
    if (unique.size >= MAX_CANDIDATES_PER_SEARCH) break;
  }
  if (unique.size === 0) return { sourcesUpserted: 0, versionsAdded: 0, skipped: input.results.length };

  const client: PoolClient = await pool.connect();
  let sourcesUpserted = 0;
  let versionsAdded = 0;
  try {
    await client.query('BEGIN');
    const queryHash = digest(input.query.trim().slice(0, 500));
    for (const [canonicalUrl, result] of unique) {
      const summary = summaryOf(result);
      if (summary.length < 40) continue;
      const urlHash = digest(canonicalUrl);
      const contentHash = digest(summary);
      const sourceId = `web-source-${urlHash.slice(0, 24)}`;
      const now = Date.now();
      const metadata = {
        provider: 'searxng',
        discovery: 'web_search',
        queryHash,
        summaryOnly: true,
        characters: summary.length,
        nonWhitespaceCharacters: summary.replace(/\s/g, '').length,
        parser: 'searxng-summary',
        engines: result.engines.slice(0, 4),
        ...(result.publishedDate ? { publishedDate: result.publishedDate } : {}),
        discoveredAt: now,
      };
      await client.query(
        `INSERT INTO knowledge_sources
          (id, source_type, title, short_title, canonical_url, license, trust_level, review_status, distribution_scope, metadata_json, created_at, updated_at)
         VALUES ($1, 'web_search', $2, $3, $4, 'unknown', 'low', 'candidate', 'local_only', $5::jsonb, $6, $6)
         ON CONFLICT (canonical_url) DO UPDATE SET
           updated_at = excluded.updated_at,
           metadata_json = knowledge_sources.metadata_json || excluded.metadata_json`,
        [sourceId, result.title.slice(0, 180), shortTitle(result.title), canonicalUrl, JSON.stringify(metadata), now],
      );
      sourcesUpserted += 1;
      const sourceRow = await client.query<{ id: string }>('SELECT id FROM knowledge_sources WHERE canonical_url = $1', [canonicalUrl]);
      const persistedSourceId = sourceRow.rows[0]?.id;
      if (!persistedSourceId) continue;
      // 版本主键必须同时绑定来源；不同网页可能返回完全相同的摘要。
      const versionId = `web-version-${digest(`${persistedSourceId}:${contentHash}`).slice(0, 24)}`;
      const versionResult = await client.query(
        `INSERT INTO knowledge_source_versions
          (id, source_id, content_sha256, original_path, extracted_text, parser, parse_status, quality_report, version_status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'searxng-summary', 'parsed', $6::jsonb, 'candidate', $7)
         ON CONFLICT (source_id, content_sha256) DO NOTHING`,
        [versionId, persistedSourceId, contentHash, canonicalUrl, summary, JSON.stringify(metadata), now],
      );
      versionsAdded += versionResult.rowCount ?? 0;
    }
    await client.query('COMMIT');
    return { sourcesUpserted, versionsAdded, skipped: input.results.length - unique.size };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
