/**
 * 知识库充实管线：抓取权威公开文档 → 主内容抽取 → Markdown 化 → 清洗 → 落盘 data/knowledge/*.md。
 * 卡片写盘后调用 importKnowledgeCards 统一按章节切块入库，并全量重建 FTS。
 *
 * 数据来源均为允许公开引用的官方文档（BSD/PSF 许可）与 UCI 公开数据集 API：
 *   pandas 6 篇（10min/indexing/groupby/missing_data/timeseries/window）
 *   matplotlib 3 篇（pyplot 教程/快速上手/直方图）
 *   Python 官方教程 3 篇（控制流/数据结构/异常）
 *   scikit-learn 1 篇（孤立森林等离群检测）
 *   UCI API 2 个（AI4I-2020、MetroPT-3）
 *
 * 用法：pnpm exec tsx scripts/ingest-docs.ts [--only id1,id2] [--force]
 *   --only  只处理指定 id 的源；--force 忽略 .cache 缓存强制重新抓取。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'node-html-parser';
import { NodeHtmlMarkdown } from 'node-html-markdown';

import { getDatasetDatabasePath, openSqlite } from '../src/learning/sqlite.js';
import { rebuildDocumentFts } from '../src/learning/evidence.js';
import { importKnowledgeCards } from '../src/learning/knowledge-import.js';

interface HtmlSource {
  kind: 'html';
  id: string;
  title: string;
  url: string;
  source: string;
}

interface UciSource {
  kind: 'uci';
  id: string;
  title: string;
  uciId: number;
}

type DocSource = HtmlSource | UciSource;

const SOURCES: DocSource[] = [
  { kind: 'html', id: 'docs-pandas-10min', title: 'pandas 官方文档 · 10 minutes to pandas（快速入门）', url: 'https://pandas.pydata.org/docs/user_guide/10min.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/10min.html)' },
  { kind: 'html', id: 'docs-pandas-indexing', title: 'pandas 官方文档 · Indexing and selecting data（索引与选择）', url: 'https://pandas.pydata.org/docs/user_guide/indexing.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/indexing.html)' },
  { kind: 'html', id: 'docs-pandas-groupby', title: 'pandas 官方文档 · Group by（分组聚合）', url: 'https://pandas.pydata.org/docs/user_guide/groupby.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/groupby.html)' },
  { kind: 'html', id: 'docs-pandas-missing', title: 'pandas 官方文档 · Working with missing data（缺失数据处理）', url: 'https://pandas.pydata.org/docs/user_guide/missing_data.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/missing_data.html)' },
  { kind: 'html', id: 'docs-pandas-timeseries', title: 'pandas 官方文档 · Time series / date functionality（时间序列）', url: 'https://pandas.pydata.org/docs/user_guide/timeseries.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/timeseries.html)' },
  { kind: 'html', id: 'docs-pandas-window', title: 'pandas 官方文档 · Windowing operations（滑动窗口）', url: 'https://pandas.pydata.org/docs/user_guide/window.html', source: 'pandas 官方文档，BSD 许可 (https://pandas.pydata.org/docs/user_guide/window.html)' },
  { kind: 'html', id: 'docs-mpl-pyplot', title: 'matplotlib 官方教程 · Pyplot tutorial（绘图基础）', url: 'https://matplotlib.org/stable/tutorials/pyplot.html', source: 'matplotlib 官方文档，Matplotlib 许可 (https://matplotlib.org/stable/tutorials/pyplot.html)' },
  { kind: 'html', id: 'docs-mpl-quickstart', title: 'matplotlib 官方教程 · Quick start guide（快速上手）', url: 'https://matplotlib.org/stable/users/explain/quick_start.html', source: 'matplotlib 官方文档，Matplotlib 许可 (https://matplotlib.org/stable/users/explain/quick_start.html)' },
  { kind: 'html', id: 'docs-mpl-histogram', title: 'matplotlib 官方示例 · Histogram（直方图）', url: 'https://matplotlib.org/stable/gallery/statistics/hist.html', source: 'matplotlib 官方文档，Matplotlib 许可 (https://matplotlib.org/stable/gallery/statistics/hist.html)' },
  { kind: 'html', id: 'docs-python-controlflow', title: 'Python 官方教程 · More Control Flow Tools（控制流与函数）', url: 'https://docs.python.org/3/tutorial/controlflow.html', source: 'Python 官方文档，PSF 许可 (https://docs.python.org/3/tutorial/controlflow.html)' },
  { kind: 'html', id: 'docs-python-datastructures', title: 'Python 官方教程 · Data Structures（数据结构）', url: 'https://docs.python.org/3/tutorial/datastructures.html', source: 'Python 官方文档，PSF 许可 (https://docs.python.org/3/tutorial/datastructures.html)' },
  { kind: 'html', id: 'docs-python-errors', title: 'Python 官方教程 · Errors and Exceptions（异常处理）', url: 'https://docs.python.org/3/tutorial/errors.html', source: 'Python 官方文档，PSF 许可 (https://docs.python.org/3/tutorial/errors.html)' },
  { kind: 'html', id: 'docs-sklearn-outlier', title: 'scikit-learn 用户指南 · Outlier Detection（含孤立森林 IsolationForest）', url: 'https://scikit-learn.org/stable/modules/outlier_detection.html', source: 'scikit-learn 官方文档，BSD 许可 (https://scikit-learn.org/stable/modules/outlier_detection.html)' },
  { kind: 'uci', id: 'dataset-ai4i2020', title: 'UCI 公开数据集 · AI4I 2020 Predictive Maintenance（压缩机/刀具预测性维护）', uciId: 601 },
  { kind: 'uci', id: 'dataset-metropt3', title: 'UCI 公开数据集 · MetroPT-3（地铁压缩机 APU 运行与故障数据）', uciId: 791 },
];

const CARD_DIR = path.resolve(process.cwd(), 'data', 'knowledge');
const CACHE_DIR = path.join(CARD_DIR, '.cache');
const FETCH_HEADERS = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36', 'Accept-Language': 'en' };
// 主内容候选选择器（Sphinx 系官方文档兼容），按顺序取第一个命中的。
const MAIN_SELECTORS = ['div[role="main"]', 'main.content', 'article[role="main"]', 'main', 'article', 'div.body'];
const STRIP_SELECTORS = ['script', 'style', 'noscript', 'svg', 'iframe', 'form', '.headerlink', '.editthispage', '.rst-footer-buttons'];
const JUNK_LINES = new Set(['skip to main content', 'back to top', 'previous page', 'next page', 'edit this page', 'show source', '© copyright 2026, zcode']);

interface UciDatasetResponse {
  status: number;
  data: {
    uci_id: number;
    name: string;
    repository_url: string | null;
    abstract: string | null;
    area: string | null;
    tasks: string[];
    characteristics: string[];
    num_instances: number | null;
    num_features: number | null;
    feature_types: string[] | null;
    has_missing_values: string;
    year_of_dataset_creation: number | null;
    last_updated: string | null;
    dataset_doi: string | null;
    creators: string[];
    intro_paper: { title: string; authors: string; venue: string | null; year: number | null; URL: string | null } | null;
    variables: Array<{ name: string; role: string | null; type: string | null; description: string | null; units: string | null }> | null;
  };
}

async function fetchWithRetry(url: string, attempt = 0): Promise<string> {
  try {
    let response = await fetch(url, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    let body = await response.text();
    // 某些文档站用 <meta http-equiv="refresh"> 跳转（fetch 不跟随），手动跟一次。
    const metaTarget = body.match(/<meta\s+http-equiv="refresh"\s+content="\d+;\s*url=([^"]+)"/i)?.[1];
    if (metaTarget) {
      const next = new URL(metaTarget, response.url || url).toString();
      response = await fetch(next, { headers: FETCH_HEADERS, signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (!response.ok) throw new Error(`HTTP ${response.status} (meta-refresh → ${next})`);
      body = await response.text();
    }
    return body;
  } catch (error) {
    if (attempt >= 2) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_500 * (attempt + 1)));
    return fetchWithRetry(url, attempt + 1);
  }
}

// 围栏感知的逐行清洗：删除图片链接与 [text](url) 链接语法（保留 text），代码块内容不动。
function cleanMarkdown(markdown: string): string {
  const imagePattern = /!\[[^\]]*\]\([^)]*\)/g;
  const linkPattern = /\[([^\]]+)\]\([^)]*\)/g;
  const lines: string[] = [];
  let inFence = false;
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    if (line.trimStart().startsWith('```')) {
      inFence = !inFence;
      lines.push(line.trimEnd());
      continue;
    }
    if (inFence) {
      lines.push(line.trimEnd());
      continue;
    }
    const cleaned = line
      .replace(imagePattern, '')
      .replace(linkPattern, '$1')
      .replace(/\s+$/, '');
    const bare = cleaned.trim().toLowerCase();
    if (JUNK_LINES.has(bare)) continue;
    lines.push(cleaned);
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractMainMarkdown(html: string): string {
  const root = parse(html);
  for (const selector of STRIP_SELECTORS) {
    root.querySelectorAll(selector).forEach((element) => element.remove());
  }
  let main = null;
  for (const selector of MAIN_SELECTORS) {
    main = root.querySelector(selector);
    if (main) break;
  }
  const target = main ?? root;
  const markdown = NodeHtmlMarkdown.translate(target.outerHTML ?? '', { codeBlockStyle: 'fenced' });
  return cleanMarkdown(markdown);
}

function uciCard(source: UciSource, payload: UciDatasetResponse): string {
  const data = payload.data;
  const lines: string[] = [];
  if (data.abstract) lines.push(`## 数据集简介`, data.abstract.trim(), '');
  const facts: string[] = [];
  if (data.area) facts.push(`领域：${data.area}`);
  if (data.tasks.length) facts.push(`任务类型：${data.tasks.join('、')}`);
  if (data.characteristics.length) facts.push(`数据形态：${data.characteristics.join('、')}`);
  if (data.num_instances != null) facts.push(`实例数：${data.num_instances.toLocaleString('en-US')}`);
  if (data.num_features != null) facts.push(`特征数：${data.num_features}`);
  if (data.feature_types?.length) facts.push(`特征类型：${data.feature_types.join('、')}`);
  facts.push(`缺失值：${data.has_missing_values === 'no' ? '无' : `有（${data.has_missing_values}）`}`);
  if (data.year_of_dataset_creation) facts.push(`创建年份：${data.year_of_dataset_creation}`);
  if (data.last_updated) facts.push(`最近更新：${data.last_updated}`);
  lines.push(`## 数据集基本特征`, ...facts.map((fact) => `- ${fact}`), '');
  const variables = data.variables ?? [];
  if (variables.length > 0) {
    lines.push('## 字段说明', '| 字段 | 角色 | 类型 | 说明 |', '| --- | --- | --- | --- |');
    for (const variable of variables) {
      const description = (variable.description ?? '').replaceAll('|', '\\|');
      const units = variable.units ? `（单位 ${variable.units}）` : '';
      lines.push(`| ${variable.name} | ${variable.role ?? '-'} | ${variable.type ?? '-'} | ${description}${units} |`);
    }
    lines.push('');
  }
  if (data.intro_paper) {
    const paper = data.intro_paper;
    lines.push(
      '## 引用论文',
      `${paper.authors}. ${paper.title}${paper.venue ? `. ${paper.venue}` : ''}${paper.year ? `, ${paper.year}` : ''}.`,
      paper.URL ? `论文链接：${paper.URL}` : '',
      '',
    );
  }
  lines.push(
    '## 使用边界',
    '- 本卡片是数据集官方描述的摘录，用于让学习代理理解数据来源与字段含义。',
    '- 引用本数据集时须标注 UCI Machine Learning Repository 与官方 DOI。',
    data.dataset_doi ? `- 官方 DOI：${data.dataset_doi}` : '',
  );
  const sourceLine = data.repository_url
    ? `UCI Machine Learning Repository (${data.repository_url})${data.dataset_doi ? `，DOI ${data.dataset_doi}` : ''}`
    : 'UCI Machine Learning Repository';
  return frontmatter(source, sourceLine) + lines.filter((line) => line !== undefined).join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function frontmatter(source: DocSource, sourceLine: string): string {
  const url = source.kind === 'html' ? source.url : '';
  return ['---', `id: ${source.id}`, `title: ${source.title}`, `source: ${sourceLine}`, url ? `locator: ${url}` : `locator: ${sourceLine}`, 'trust: high', '---', ''].join('\n');
}

function parseArgs(): { only: Set<string>; force: boolean } {
  const args = process.argv.slice(2);
  const only = new Set<string>();
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--only') {
      for (const id of (args[index + 1] ?? '').split(',').map((item) => item.trim()).filter(Boolean)) only.add(id);
      index += 1;
    } else if (args[index] === '--force') {
      force = true;
    }
  }
  return { only, force };
}

async function main(): Promise<void> {
  const { only, force } = parseArgs();
  mkdirSync(CACHE_DIR, { recursive: true });
  const results: Array<{ id: string; ok: boolean; detail: string }> = [];

  for (const source of SOURCES) {
    if (only.size > 0 && !only.has(source.id)) continue;
    const cachePath = path.join(CACHE_DIR, `${source.id}.${source.kind === 'html' ? 'html' : 'json'}`);
    try {
      let raw: string;
      if (!force && existsSync(cachePath)) {
        raw = readFileSync(cachePath, 'utf8');
      } else {
        const url = source.kind === 'html' ? source.url : `https://archive.ics.uci.edu/api/dataset?id=${source.uciId}`;
        raw = await fetchWithRetry(url);
        writeFileSync(cachePath, raw, 'utf8');
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
      let card: string;
      if (source.kind === 'html') {
        const markdown = extractMainMarkdown(raw);
        if (markdown.length < 2_000) throw new Error(`主内容过短（${markdown.length} 字符），疑似页面结构变化`);
        card = frontmatter(source, source.source) + markdown + '\n';
      } else {
        card = uciCard(source, JSON.parse(raw) as UciDatasetResponse);
      }
      writeFileSync(path.join(CARD_DIR, `${source.id}.md`), card, 'utf8');
      results.push({ id: source.id, ok: true, detail: `${card.length} 字符` });
    } catch (error) {
      results.push({ id: source.id, ok: false, detail: error instanceof Error ? error.message : String(error) });
    }
  }

  if (results.every((result) => !result.ok)) {
    console.error('全部来源抓取失败，中止导入。');
    for (const result of results) console.error(`  ✗ ${result.id}: ${result.detail}`);
    process.exit(1);
  }

  // 落盘后统一切块入库并重建 FTS（与 server/study-context.ts 启动逻辑一致）。
  const datasetDb = openSqlite(getDatasetDatabasePath());
  const imported = importKnowledgeCards(datasetDb);
  rebuildDocumentFts(datasetDb);
  const total = datasetDb.prepare('SELECT COUNT(*) AS n FROM document_chunks').get() as { n: number };

  console.log('\n== 抓取结果 ==');
  for (const result of results) {
    console.log(`  ${result.ok ? '✓' : '✗'} ${result.id}: ${result.detail}`);
  }
  console.log(`\n知识卡 ${imported.imported} 张 → 切片 ${imported.chunks} 条；document_chunks 总数 ${total.n}。`);
  const probes = ['rolling', 'histogram', 'groupby', 'isolation forest', 'resample', 'missing data'];
  for (const probe of probes) {
    const hit = datasetDb
      .prepare('SELECT COUNT(*) AS n FROM document_chunks WHERE title LIKE ? OR content LIKE ?')
      .get(`%${probe}%`, `%${probe}%`) as { n: number };
    console.log(`  检索探针 "${probe}": 命中 ${hit.n} 个切片`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
