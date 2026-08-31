import { describe, expect, it } from 'vitest';
import { crossValidate } from './evidence-rules.js';
import type { EvidenceItem } from './types.js';

function evidence(sourceType: EvidenceItem['sourceType'], id: string): EvidenceItem {
  return {
    id,
    sourceType,
    sourceId: id,
    sourceTitle: id,
    locator: sourceType === 'web_search' ? `https://example.com/${id}` : `source:${id}`,
    content: '可回溯的证据摘要',
    retrievalMethod: sourceType === 'web_search' ? 'web' : sourceType === 'dataset' ? 'sql' : 'fts',
    relevanceScore: 0.8,
    trustLevel: sourceType === 'web_search' ? 'low' : 'high',
    scope: sourceType === 'web_search' ? 'web_search' : 'system',
  };
}

describe('EvidencePack 网络补全证据', () => {
  it('将 SearXNG 摘要单独标识，且不会冒充本地文档交叉验证', () => {
    const result = crossValidate([
      evidence('dataset', 'dataset-1'),
      evidence('web_search', 'web-1'),
    ]);
    expect(result.status).toBe('needs_review');
    expect(result.checks.find((check) => check.id === 'web-search-source')?.status).toBe('passed');
    expect(result.checks.find((check) => check.id === 'source-agreement')?.status).toBe('review');
    expect(result.notes.join('')).toContain('网络搜索');
  });

  it('未调用网络补全时保留原有四项评分逻辑', () => {
    const result = crossValidate([evidence('dataset', 'dataset-1'), evidence('document', 'document-1')]);
    expect(result.status).toBe('corroborated');
    expect(result.score).toBe(0.76);
  });
});
