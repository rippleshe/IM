/**
 * 受管资料包导入：安全解包、保留原件、抽取文本并登记为候选来源。
 *
 * 这条命令刻意不写入 document_chunks。资料必须经过服务端智能策展门禁后，才允许
 * 进入正式检索与学习资源生成，避免把许可证未知或抽取质量差的内容直接当证据。
 */
import 'dotenv/config';

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile as execFileCallback } from 'node:child_process';

import { getLearningDatabase } from '../server/db/client.js';

const execFile = promisify(execFileCallback);
const allowedExtensions = new Set(['.pdf', '.md']);

interface ExtractedFile {
  absolutePath: string;
  relativePath: string;
}

interface SourceResult {
  file: string;
  sha256: string;
  title: string;
  kind: 'pdf' | 'markdown';
  parsed: boolean;
  created: boolean;
  characters: number;
  error?: string;
}

function sha256(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function safeArchiveEntry(entry: string): boolean {
  const normalized = entry.replaceAll('\\', '/');
  return Boolean(normalized)
    && !normalized.startsWith('/')
    && !/^[A-Za-z]:\//.test(normalized)
    && !normalized.split('/').some((part) => part === '..');
}

async function listArchiveEntries(archivePath: string): Promise<string[]> {
  const { stdout } = await execFile('tar', ['-tf', archivePath], { windowsHide: true, maxBuffer: 2 * 1024 * 1024 });
  const entries = stdout.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
  if (entries.length === 0 || entries.some((entry) => !safeArchiveEntry(entry))) {
    throw new Error('资料包包含空目录或不安全路径，已拒绝解包');
  }
  const files = entries.filter((entry) => !entry.endsWith('/'));
  if (files.some((entry) => !allowedExtensions.has(path.extname(entry).toLowerCase()))) {
    throw new Error('资料包包含不支持的文件类型，仅允许 PDF 和 Markdown');
  }
  return files;
}

async function listFiles(root: string, current = root): Promise<ExtractedFile[]> {
  const entries = await readdir(current, { withFileTypes: true });
  const found: ExtractedFile[] = [];
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      found.push(...await listFiles(root, absolutePath));
      continue;
    }
    if (!entry.isFile()) continue;
    const relativePath = path.relative(root, absolutePath);
    if (!safeArchiveEntry(relativePath) || !allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      throw new Error(`解包后发现不安全或不支持的文件：${relativePath}`);
    }
    found.push({ absolutePath, relativePath });
  }
  return found;
}

function titleFromMarkdown(text: string, fallback: string): string {
  const frontmatter = text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const frontmatterTitle = (frontmatter?.[1] ?? '').match(/^title\s*:\s*(.+)$/mi)?.[1]?.trim();
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (frontmatterTitle || heading || fallback).slice(0, 220);
}

function titleFromFilename(file: string): string {
  return path.basename(file, path.extname(file)).replaceAll('_', ' ').replaceAll('-', ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

async function extractPdfText(filePath: string): Promise<{ text: string; parser: string; error?: string }> {
  try {
    const { stdout } = await execFile('pdftotext', ['-enc', 'UTF-8', '-layout', filePath, '-'], { windowsHide: true, timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
    const text = stdout.replace(/\u0000/g, '').trim();
    return { text, parser: 'pdftotext' };
  } catch (error) {
    return { text: '', parser: 'pdftotext', error: error instanceof Error ? error.message.slice(0, 320) : 'PDF 文本抽取失败' };
  }
}

async function ensureArchiveCopy(source: string, destination: string): Promise<void> {
  if (existsSync(destination)) return;
  await copyFile(source, destination);
}

function storagePath(root: string, absolutePath: string): string {
  return path.relative(root, absolutePath).split(path.sep).join('/');
}

async function main(): Promise<void> {
  const root = process.cwd();
  const positional = process.argv.slice(2).find((value) => !value.startsWith('--'));
  const archivePath = path.resolve(root, positional ?? '资数据收集料.zip');
  if (!existsSync(archivePath)) throw new Error(`找不到资料包：${archivePath}`);
  if (path.extname(archivePath).toLowerCase() !== '.zip') throw new Error('资料包必须为 ZIP 格式');

  const archiveBuffer = await readFile(archivePath);
  const archiveSha256 = sha256(archiveBuffer);
  const archiveEntries = await listArchiveEntries(archivePath);
  const dataRoot = path.join(root, 'data', 'knowledge');
  const importsRoot = path.join(dataRoot, 'imports');
  const sourcesRoot = path.join(dataRoot, 'sources');
  const stagingRoot = path.join(dataRoot, 'staging', archiveSha256);
  await Promise.all([mkdir(importsRoot, { recursive: true }), mkdir(sourcesRoot, { recursive: true }), mkdir(path.dirname(stagingRoot), { recursive: true })]);

  const managedArchive = path.join(importsRoot, `${archiveSha256}.zip`);
  await ensureArchiveCopy(archivePath, managedArchive);

  if (!existsSync(stagingRoot)) {
    await mkdir(stagingRoot, { recursive: true });
    await execFile('tar', ['-xf', managedArchive, '-C', stagingRoot], { windowsHide: true, timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
  }
  const extractedFiles = await listFiles(stagingRoot);
  if (extractedFiles.length !== archiveEntries.length) {
    throw new Error(`解包文件数不一致：清单 ${archiveEntries.length}，实际 ${extractedFiles.length}`);
  }

  const jobId = `archive-${archiveSha256.slice(0, 24)}`;
  const { pool } = getLearningDatabase();
  const client = await pool.connect();
  const now = Date.now();
  await client.query(
    `INSERT INTO knowledge_ingest_jobs (id, kind, input_path, input_sha256, status, stats_json, created_at, updated_at)
     VALUES ($1, 'archive', $2, $3, 'running', $4::jsonb, $5, $5)
     ON CONFLICT (id) DO UPDATE SET status = 'running', stats_json = excluded.stats_json, error_summary = NULL, updated_at = excluded.updated_at`,
    [jobId, storagePath(root, managedArchive), archiveSha256, JSON.stringify({ expectedFiles: archiveEntries.length }), now],
  );

  const results: SourceResult[] = [];
  try {
    for (const file of extractedFiles.sort((a, b) => a.relativePath.localeCompare(b.relativePath))) {
      const extension = path.extname(file.absolutePath).toLowerCase();
      const content = await readFile(file.absolutePath);
      const contentSha256 = sha256(content);
      const rawPath = path.join(sourcesRoot, `${contentSha256}${extension}`);
      await ensureArchiveCopy(file.absolutePath, rawPath);
      const fallbackTitle = titleFromFilename(file.relativePath);
      let text = '';
      let title = fallbackTitle;
      let parser = 'markdown';
      let parseError: string | undefined;
      if (extension === '.md') {
        text = content.toString('utf8').replace(/^\uFEFF/, '').trim();
        title = titleFromMarkdown(text, fallbackTitle);
      } else {
        const extracted = await extractPdfText(file.absolutePath);
        text = extracted.text;
        parser = extracted.parser;
        parseError = extracted.error;
      }
      const versionId = `version-${contentSha256.slice(0, 24)}`;
      const sourceId = `source-${contentSha256.slice(0, 24)}`;
      const existingVersion = await client.query(
        'SELECT 1 FROM knowledge_source_versions WHERE source_id = $1 AND content_sha256 = $2',
        [sourceId, contentSha256],
      );
      const parsed = text.length >= 240;
      const qualityReport = {
        characters: text.length,
        nonWhitespaceCharacters: text.replace(/\s/g, '').length,
        parser,
        sourceFile: file.relativePath,
        textDensity: text.length / Math.max(1, (await stat(file.absolutePath)).size),
        requiresReview: true,
        error: parseError ?? null,
      };
      await client.query('BEGIN');
      try {
        await client.query(
          `INSERT INTO knowledge_sources (id, source_type, title, short_title, license, trust_level, review_status, distribution_scope, metadata_json, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'unknown', 'medium', 'candidate', 'local_only', $5::jsonb, $6, $6)
           ON CONFLICT (id) DO UPDATE SET title = excluded.title, short_title = excluded.short_title, updated_at = excluded.updated_at`,
          [sourceId, extension === '.pdf' ? 'local_pdf' : 'local_markdown', title, title.slice(0, 72), JSON.stringify({ archiveSha256, archivePath: storagePath(root, managedArchive), originalEntry: file.relativePath }), now],
        );
        await client.query(
          `INSERT INTO knowledge_source_versions (id, source_id, content_sha256, original_path, extracted_text, parser, parse_status, quality_report, version_status, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'candidate', $9)
           ON CONFLICT (source_id, content_sha256) DO NOTHING`,
          [versionId, sourceId, contentSha256, storagePath(root, rawPath), text || null, parser, parsed ? 'parsed' : 'failed', JSON.stringify(qualityReport), now],
        );
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
      results.push({ file: file.relativePath, sha256: contentSha256, title, kind: extension === '.pdf' ? 'pdf' : 'markdown', parsed, created: existingVersion.rowCount === 0, characters: text.length, error: parseError });
    }
    const stats = {
      expectedFiles: archiveEntries.length,
      discoveredFiles: extractedFiles.length,
      registeredSources: results.length,
      newCandidateVersions: results.filter((result) => result.created).length,
      parsedSources: results.filter((result) => result.parsed).length,
      failedSources: results.filter((result) => !result.parsed).length,
      pdf: results.filter((result) => result.kind === 'pdf').length,
      markdown: results.filter((result) => result.kind === 'markdown').length,
    };
    await client.query(
      `UPDATE knowledge_ingest_jobs SET status = 'completed', stats_json = $2::jsonb, updated_at = $3 WHERE id = $1`,
      [jobId, JSON.stringify(stats), Date.now()],
    );
    console.log(JSON.stringify({ jobId, archiveSha256, stats, results }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : '资料包导入失败';
    await client.query(
      `UPDATE knowledge_ingest_jobs SET status = 'failed', error_summary = $2, updated_at = $3 WHERE id = $1`,
      [jobId, message, Date.now()],
    );
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[knowledge:ingest] 导入失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
