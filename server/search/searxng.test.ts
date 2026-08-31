import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  chooseWebSearchTrigger,
  getSearxngConfig,
  guardWebSearchQuery,
  searchSearxng,
} from './searxng.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SearXNG 本地检索配置与触发', () => {
  it('默认关闭；显式开启后使用本地地址和受限参数', () => {
    expect(getSearxngConfig({}).enabled).toBe(false);
    const config = getSearxngConfig({
      SEARXNG_ENABLED: 'true',
      SEARXNG_BASE_URL: 'http://localhost:8088/',
      SEARXNG_MAX_RESULTS: '99',
      SEARXNG_TIMEOUT_MS: '500',
    });
    expect(config.enabled).toBe(true);
    expect(config.baseUrl).toBe('http://localhost:8088');
    expect(config.maxResults).toBe(10);
    expect(config.timeoutMs).toBe(1_000);
  });

  it('仅在本地证据不足或需要时效资料时触发', () => {
    const config = { triggerCoverage: 0.58 };
    expect(chooseWebSearchTrigger('讲解轴承振动基础', 4, 0.76, config)).toBeNull();
    expect(chooseWebSearchTrigger('讲解轴承振动基础', 0, 0.35, config)).toBe('local_evidence_sparse');
    expect(chooseWebSearchTrigger('查询最新设备诊断标准', 6, 0.9, config)).toBe('freshness_or_reference');
  });

  it('敏感查询会被隐私门禁截断，不会发往搜索服务', () => {
    const guarded = guardWebSearchQuery('用 api_key=secret-value 查询设备故障');
    expect(guarded.allowed).toBe(false);
    expect(guarded.redactedFields).toContain('访问凭据');
  });
});

describe('SearXNG JSON API 适配', () => {
  it('规范化、去重并限制本地 SearXNG 返回的摘要', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      results: [
        { title: '<b>轴承诊断</b>', url: 'https://example.com/a', content: '<p>可回溯的摘要内容</p>', engines: ['bing', 'google'] },
        { title: '重复链接', url: 'https://example.com/a', content: '不应重复' },
        { title: '无效链接', url: 'ftp://example.com/a', content: '不应采用' },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const outcome = await searchSearxng('轴承诊断方法', {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8088',
      timeoutMs: 1_000,
      maxResults: 5,
      triggerCoverage: 0.58,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(outcome.reason).toBeUndefined();
    expect(outcome.results).toEqual([{
      title: '轴承诊断',
      url: 'https://example.com/a',
      content: '可回溯的摘要内容',
      engines: ['bing', 'google'],
      publishedDate: undefined,
    }]);
    const requested = new URL(String(fetchMock.mock.calls[0]?.[0]));
    expect(requested.pathname).toBe('/search');
    expect(requested.searchParams.get('format')).toBe('json');
    expect(requested.searchParams.get('safesearch')).toBe('1');
  });

  it('服务不可用时不抛出，返回可供主流程降级的状态', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    const outcome = await searchSearxng('工业设备诊断', {
      enabled: true,
      baseUrl: 'http://127.0.0.1:8088',
      timeoutMs: 1_000,
      maxResults: 5,
      triggerCoverage: 0.58,
    });
    expect(outcome).toEqual({ results: [], reason: 'network_error' });
  });
});
