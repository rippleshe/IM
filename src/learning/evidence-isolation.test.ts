import { describe, expect, it } from 'vitest';
import { initializeLearningDatabase, openSqlite } from './sqlite.js';
import { LearningStore } from './store.js';

function insertEvidencePack(learnerId: string, suffix: string): void {
  const db = testDb;
  db.prepare(`
    INSERT INTO evidence_items
      (id, source_type, source_id, source_title, locator, content, retrieval_method,
       relevance_score, trust_level, source_scope, metadata_json, created_at)
    VALUES (?, 'document', ?, ?, ?, ?, 'fts', 0.9, 'high', 'system', '{}', ?)
  `).run(`evidence-${suffix}`, `source-${suffix}`, `资料 ${suffix}`, `PDF p.${suffix}`, `内容 ${suffix}`, Date.now());
  db.prepare(`
    INSERT INTO evidence_packs
      (id, learner_id, session_id, query, retrieval_plan_json, coverage_score,
       cross_validation_json, privacy_json, created_at)
    VALUES (?, ?, NULL, ?, '["document"]', 0.8, '{}', '{}', ?)
  `).run(`pack-${suffix}`, learnerId, `查询 ${suffix}`, Date.now());
  db.prepare('INSERT INTO evidence_pack_items (pack_id, evidence_id, position) VALUES (?, ?, 0)')
    .run(`pack-${suffix}`, `evidence-${suffix}`);
}

const testDb = openSqlite(':memory:');
initializeLearningDatabase(testDb);

describe('LearningStore evidence isolation', () => {
  it('only returns evidence packs owned by the requested learner', () => {
    insertEvidencePack('learner-a', 'a');
    insertEvidencePack('learner-b', 'b');
    const store = new LearningStore(testDb);

    expect(store.listEvidence('learner-a')).toMatchObject([
      { id: 'evidence-a', packId: 'pack-a', packQuery: '查询 a' },
    ]);
    expect(store.listEvidence('learner-b')).toMatchObject([
      { id: 'evidence-b', packId: 'pack-b', packQuery: '查询 b' },
    ]);
  });
});
