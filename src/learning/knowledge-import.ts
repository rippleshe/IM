import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from './sqlite.js';

export const KNOWLEDGE_CARD_SOURCE_ID = 'knowledge-cards';

interface KnowledgeCardMeta {
  id: string;
  title: string;
  source: string;
  locator: string;
  datasetId: string;
}

// 知识卡采用极简 frontmatter：id/title/source/locator，正文即卡片内容，方便随时增删替换。
function parseCard(fileName: string, raw: string): { meta: KnowledgeCardMeta; content: string } | null {
  const normalized = raw.replace(/^\uFEFF/, '').trim();
  if (!normalized.startsWith('---')) return null;
  const end = normalized.indexOf('\n---', 3);
  if (end < 0) return null;
  const header = normalized.slice(3, end);
  const content = normalized.slice(end + 4).trim();
  const meta: KnowledgeCardMeta = {
    id: fileName.replace(/\.md$/i, '').toLowerCase(),
    title: '',
    source: '系统知识卡',
    locator: fileName,
    datasetId: KNOWLEDGE_CARD_SOURCE_ID,
  };
  for (const line of header.split('\n')) {
    const match = line.match(/^([A-Za-z]+)\s*:\s*(.+)$/);
    if (!match) continue;
    const key = match[1];
    const value = (match[2] ?? '').trim();
    if (key === 'id') meta.id = value.toLowerCase() || meta.id;
    else if (key === 'title') meta.title = value;
    else if (key === 'source') meta.source = value;
    else if (key === 'locator') meta.locator = value;
    else if (key === 'dataset' && value) meta.datasetId = value;
  }
  if (!meta.id || !meta.title || !content) return null;
  return { meta, content };
}

// data/knowledge 目录是“丢弃式”知识层：放进去即入库参与检索，删掉即失效。
export function importKnowledgeCards(datasetDb: SqliteDatabase, dir?: string): { imported: number } {
  const cardDir = dir ?? path.resolve(process.cwd(), 'data', 'knowledge');
  if (!existsSync(cardDir)) return { imported: 0 };
  const files = readdirSync(cardDir).filter((file) => file.toLowerCase().endsWith('.md')).sort();
  if (files.length === 0) return { imported: 0 };

  datasetDb.prepare('DELETE FROM document_chunks WHERE source_id = ?').run(KNOWLEDGE_CARD_SOURCE_ID);
  const insert = datasetDb.prepare(`
    INSERT OR REPLACE INTO document_chunks (id, source_id, source_path, title, content, locator, trust_level)
    VALUES (?, ?, ?, ?, ?, ?, 'high')
  `);
  let imported = 0;
  for (const file of files) {
    const card = parseCard(file, readFileSync(path.join(cardDir, file), 'utf8'));
    if (!card) continue;
    insert.run(`card-${card.meta.id}`, card.meta.datasetId, `data/knowledge/${file}`, card.meta.title, card.content, card.meta.locator);
    imported += 1;
  }
  return { imported };
}
