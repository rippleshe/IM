import { describe, expect, it, vi } from 'vitest';
import type { Pool, PoolClient } from 'pg';
import type { SearxngSearchResult } from './search/searxng.js';
import { canonicalizeWebUrl, persistWebSearchCandidates } from './knowledge-web.js';

describe('Web 候选来源账本', () => {
  it('规范化 URL 时移除片段、默认端口和追踪参数', () => {
    expect(canonicalizeWebUrl('HTTPS://Example.com:443/a//?utm_source=x&b=2&a=1#section'))
      .toBe('https://example.com/a?a=1&b=2');
    expect(canonicalizeWebUrl('file:///tmp/secret.txt')).toBeNull();
    expect(canonicalizeWebUrl('https://user:pass@example.com/a')).toBeNull();
  });

  it('最多登记前三个不同 URL，并写入候选版本而不生成正式切片', async () => {
    const clientQuery = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT id FROM knowledge_sources')) return { rows: [{ id: `source-for-${String(params?.[0])}` }], rowCount: 1 };
      if (sql.startsWith('INSERT INTO knowledge_source_versions')) return { rows: [], rowCount: 1 };
      return { rows: [], rowCount: 1 };
    });
    const client = { query: clientQuery, release: vi.fn() } as unknown as PoolClient;
    const pool = { connect: vi.fn().mockResolvedValue(client) } as unknown as Pool;
    const resultItem = (url: string, title: string): SearxngSearchResult => ({ title, url, content: '这是一段足够长的搜索摘要，用于验证候选来源写入路径，同时包含来源、方法和适用范围等信息。', engines: ['bing'] });

    const outcome = await persistWebSearchCandidates(pool, {
      query: '工业设备轴承诊断方法',
      results: [
        resultItem('https://example.com/a?utm_source=one', '资料 A'),
        resultItem('https://example.com/a#same', '资料 A 重复'),
        resultItem('https://example.com/b', '资料 B'),
        resultItem('ftp://example.com/c', '无效链接'),
        resultItem('https://example.com/c', '资料 C'),
      ],
    });

    expect(outcome).toEqual({ sourcesUpserted: 3, versionsAdded: 3, skipped: 2 });
    expect(clientQuery).toHaveBeenCalledWith('BEGIN');
    expect(clientQuery).toHaveBeenCalledWith('COMMIT');
    expect(clientQuery.mock.calls.filter(([sql]) => sql.startsWith('INSERT INTO knowledge_source_versions'))).toHaveLength(3);
    expect(clientQuery.mock.calls.some(([sql]) => sql.includes('document_chunks'))).toBe(false);
  });
});
