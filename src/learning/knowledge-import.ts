import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type { SqliteDatabase } from './sqlite.js';

export const KNOWLEDGE_CARD_SOURCE_ID = 'knowledge-cards';

/** 单个切片的目标上限；超过则按段落边界继续拆，代码围栏块保证不从中截断。 */
const MAX_CHUNK_CHARS = 1200;
/** 低于该长度的切片并入前一切片，避免标题级碎片污染检索。 */
const MIN_CHUNK_CHARS = 160;

interface KnowledgeCardMeta {
  id: string;
  title: string;
  source: string;
  locator: string;
  datasetId: string;
  trust: string;
}

// 知识卡采用极简 frontmatter：id/title/source/locator/trust，正文即卡片内容，方便随时增删替换。
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
    trust: 'high',
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
    else if (key === 'trust' && value) meta.trust = value;
  }
  if (!meta.id || !meta.title || !content) return null;
  return { meta, content };
}

// 以空行分段的块级元素列表；``` 围栏内的内容整体视作一个块，绝不从代码中间切开。
function toBlocks(lines: string[]): string[] {
  const blocks: string[] = [];
  let buffer: string[] = [];
  let inFence = false;
  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) blocks.push(text);
    buffer = [];
  };
  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      buffer.push(line);
      if (!inFence) flush();
      continue;
    }
    if (!inFence && line.trim() === '') {
      flush();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return blocks;
}

// 把块按 MAX_CHUNK_CHARS 装箱；超长单块按行硬拆（仍保持行完整性）。
function packBlocks(blocks: string[]): string[] {
  const packed: string[] = [];
  let buffer = '';
  const pushLinePacked = (block: string) => {
    let part = '';
    for (const line of block.split('\n')) {
      const next = part ? `${part}\n${line}` : line;
      if (next.length > MAX_CHUNK_CHARS && part) {
        packed.push(part);
        part = line;
      } else {
        part = next;
      }
    }
    if (part) packed.push(part);
  };
  for (const block of blocks) {
    const candidate = buffer ? `${buffer}\n\n${block}` : block;
    if (candidate.length <= MAX_CHUNK_CHARS) {
      buffer = candidate;
      continue;
    }
    if (buffer) packed.push(buffer);
    if (block.length > MAX_CHUNK_CHARS) {
      pushLinePacked(block);
      buffer = '';
    } else {
      buffer = block;
    }
  }
  if (buffer) packed.push(buffer);
  return packed;
}

/**
 * 把一篇 Markdown 卡片切成检索友好的切片：
 * 先按 `## ` 二级标题分节，再把节内段落装箱到目标长度，最后合并过小的碎片。
 * 返回 [{ heading: 节标题, text: 切片正文 }]，heading 为空表示卡片导语。
 */
export function chunkCardContent(content: string): Array<{ heading: string; text: string }> {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  const sections: Array<{ heading: string; lines: string[] }> = [{ heading: '', lines: [] }];
  for (const line of normalized.split('\n')) {
    const matched = line.match(/^##\s+(.+)$/)?.[1];
    if (matched) sections.push({ heading: matched.trim(), lines: [] });
    else sections[sections.length - 1]?.lines.push(line);
  }
  const chunks: Array<{ heading: string; text: string }> = [];
  for (const section of sections) {
    for (const text of packBlocks(toBlocks(section.lines))) {
      chunks.push({ heading: section.heading, text });
    }
  }
  const merged: Array<{ heading: string; text: string }> = [];
  for (const chunk of chunks) {
    const previous = merged[merged.length - 1];
    if (previous && chunk.text.length < MIN_CHUNK_CHARS) {
      previous.text = `${previous.text}\n\n${chunk.text}`;
      continue;
    }
    merged.push({ heading: chunk.heading, text: chunk.text });
  }
  return merged.filter((chunk) => chunk.text.length >= 40);
}

function chunkTitle(cardTitle: string, heading: string): string {
  const title = heading ? `${cardTitle} · ${heading}` : cardTitle;
  return title.length > 180 ? `${title.slice(0, 179)}…` : title;
}

// data/knowledge 目录是“丢弃式”知识层：放进去即入库参与检索，删掉即失效。
// 一张卡片按章节切成多个 document_chunks（id 形如 card-xxx#c01），导入整体幂等。
export function importKnowledgeCards(datasetDb: SqliteDatabase, dir?: string): { imported: number; chunks: number } {
  const cardDir = dir ?? path.resolve(process.cwd(), 'data', 'knowledge');
  if (!existsSync(cardDir)) return { imported: 0, chunks: 0 };
  const files = readdirSync(cardDir).filter((file) => file.toLowerCase().endsWith('.md')).sort();
  if (files.length === 0) return { imported: 0, chunks: 0 };

  datasetDb.prepare('DELETE FROM document_chunks WHERE source_id = ?').run(KNOWLEDGE_CARD_SOURCE_ID);
  const insert = datasetDb.prepare(`
    INSERT OR REPLACE INTO document_chunks (id, source_id, source_path, title, content, locator, trust_level)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  let imported = 0;
  let chunks = 0;
  for (const file of files) {
    const card = parseCard(file, readFileSync(path.join(cardDir, file), 'utf8'));
    if (!card) continue;
    const parts = chunkCardContent(card.content);
    parts.forEach((part, index) => {
      const id = parts.length === 1
        ? `card-${card.meta.id}`
        : `card-${card.meta.id}#c${String(index + 1).padStart(2, '0')}`;
      insert.run(id, card.meta.datasetId, `data/knowledge/${file}`, chunkTitle(card.meta.title, part.heading), part.text, card.meta.locator, card.meta.trust);
    });
    imported += 1;
    chunks += parts.length;
  }
  return { imported, chunks };
}
