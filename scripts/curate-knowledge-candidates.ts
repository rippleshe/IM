/**
 * 内部知识策展任务：让服务端智能体处理已登记的候选资料。
 * 普通学习者不会看到此任务，也不会被要求承担资料审核职责。
 */
import 'dotenv/config';

import { getLearningDatabase } from '../server/db/client.js';
import { curateManagedCandidate } from '../server/knowledge-curator.js';

async function main(): Promise<void> {
  const { pool } = getLearningDatabase();
  try {
    const rows = (await pool.query(
      `SELECT s.id AS "sourceId", s.title, s.source_type AS "sourceType",
          v.extracted_text AS "content", v.quality_report AS "qualityReport"
       FROM knowledge_sources s
       JOIN LATERAL (
         SELECT extracted_text, quality_report, version_status FROM knowledge_source_versions
         WHERE source_id = s.id ORDER BY created_at DESC LIMIT 1
       ) v ON true
       WHERE s.review_status IN ('candidate', 'approved')
         AND v.version_status = 'candidate' AND v.extracted_text IS NOT NULL
       ORDER BY s.created_at ASC`,
    )).rows as Array<{ sourceId: string; title: string; sourceType: string; content: string; qualityReport: Record<string, unknown> }>;
    const results = [];
    for (const row of rows) {
      const result = await curateManagedCandidate(pool, {
        sourceId: row.sourceId,
        title: row.title,
        content: row.content,
        summaryOnly: row.sourceType === 'web_search' && row.qualityReport?.['summaryOnly'] === true,
      });
      const { sourceId: _curatedSourceId, ...curation } = result;
      results.push({ sourceId: row.sourceId, title: row.title, ...curation });
      console.log(`[knowledge:curate] ${row.title} → ${result.decision}（${result.reason}）`);
    }
    console.log(JSON.stringify({ processed: results.length, approved: results.filter((item) => item.decision === 'approved').length, rejected: results.filter((item) => item.decision === 'rejected').length, keptTemporary: results.filter((item) => item.decision === 'kept_temporary').length }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[knowledge:curate] 策展失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
