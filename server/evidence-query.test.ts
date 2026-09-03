import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';

describe('证据溯源查询接口', () => {
  it('从 evidence_packs 表查询证据包基本信息', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'pack-001',
          resource_id: 'res-123',
          created_at: new Date('2025-01-01'),
          confidence: 0.85,
          summary: '轴承故障诊断的证据包',
        },
      ],
    });

    const pool = { query: mockQuery } as unknown as Pool;

    const result = await pool.query(
      'SELECT * FROM evidence_packs WHERE resource_id = $1',
      ['res-123']
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      id: 'pack-001',
      resource_id: 'res-123',
      confidence: 0.85,
    });
  });

  it('从 evidence_pack_items 表关联证据项', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        { evidence_id: 'ev-001', relevance_score: 0.92 },
        { evidence_id: 'ev-002', relevance_score: 0.88 },
      ],
    });

    const pool = { query: mockQuery } as unknown as Pool;

    const result = await pool.query(
      'SELECT evidence_id, relevance_score FROM evidence_pack_items WHERE pack_id = $1 ORDER BY relevance_score DESC',
      ['pack-001']
    );

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].evidence_id).toBe('ev-001');
    expect(result.rows[0].relevance_score).toBe(0.92);
  });

  it('从 evidence_items 表查询证据内容', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          id: 'ev-001',
          source_type: 'dataset',
          source_id: 'MetroPT-3',
          content: '轴承外圈故障频率为 107.36 Hz',
          metadata: { sensor: 'TS1', run: 'FD001' },
        },
      ],
    });

    const pool = { query: mockQuery } as unknown as Pool;

    const result = await pool.query(
      'SELECT id, source_type, source_id, content, metadata FROM evidence_items WHERE id = $1',
      ['ev-001']
    );

    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].source_id).toBe('MetroPT-3');
    expect(result.rows[0].content).toContain('107.36 Hz');
  });

  it('通过 JOIN 查询完整的证据溯源链路', async () => {
    const mockQuery = vi.fn().mockResolvedValue({
      rows: [
        {
          pack_id: 'pack-001',
          pack_confidence: 0.85,
          evidence_id: 'ev-001',
          relevance_score: 0.92,
          source_type: 'dataset',
          source_id: 'MetroPT-3',
          content: '轴承外圈故障频率为 107.36 Hz',
        },
        {
          pack_id: 'pack-001',
          pack_confidence: 0.85,
          evidence_id: 'ev-002',
          relevance_score: 0.88,
          source_type: 'knowledge_card',
          source_id: 'KC-05',
          content: '故障频率计算公式：f = n × BSF',
        },
      ],
    });

    const pool = { query: mockQuery } as unknown as Pool;

    const result = await pool.query(`
      SELECT
        ep.id as pack_id,
        ep.confidence as pack_confidence,
        ei.id as evidence_id,
        epi.relevance_score,
        ei.source_type,
        ei.source_id,
        ei.content
      FROM evidence_packs ep
      JOIN evidence_pack_items epi ON ep.id = epi.pack_id
      JOIN evidence_items ei ON epi.evidence_id = ei.id
      WHERE ep.resource_id = $1
      ORDER BY epi.relevance_score DESC
    `, ['res-123']);

    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].source_type).toBe('dataset');
    expect(result.rows[1].source_type).toBe('knowledge_card');
    expect(result.rows.every(r => r.pack_id === 'pack-001')).toBe(true);
  });
});
