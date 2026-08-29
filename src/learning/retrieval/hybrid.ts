/**
 * 混合检索排序（docs/挑战杯技术开发总规.md §7.5）
 * 纯函数：RRF（Reciprocal Rank Fusion）合并多路召回，score = Σ 1/(60 + rank)。
 * 数据库查询与嵌入调用在 server/db/pg-retrieval.ts，本模块保持可单测的纯排序逻辑。
 */

export const RRF_K = 60;

export interface RankedList {
  id: string;
  rank: number;
}

export interface RrfMergedItem {
  id: string;
  score: number;
  /** 各路命中的排名（调试与展示用） */
  ranks: Array<{ source: string; rank: number }>;
}

export function rrfMerge(rankings: Record<string, RankedList[]>, topN = 8): RrfMergedItem[] {
  const scores = new Map<string, { score: number; ranks: Array<{ source: string; rank: number }> }>();
  for (const [source, entries] of Object.entries(rankings)) {
    entries.forEach((entry) => {
      const current = scores.get(entry.id) ?? { score: 0, ranks: [] };
      current.score += 1 / (RRF_K + entry.rank);
      current.ranks.push({ source, rank: entry.rank });
      scores.set(entry.id, current);
    });
  }
  return [...scores.entries()]
    .map(([id, value]) => ({ id, score: value.score, ranks: value.ranks }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}
