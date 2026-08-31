/**
 * SearXNG 本地 Web 补全检索器。
 *
 * 它不是业务数据源，也不抓取网页正文：仅在库内证据不足或任务明确需要时效资料时，
 * 请求本地 SearXNG 的 JSON 摘要，并把可回溯链接交给 EvidencePack。
 */

export type WebSearchTrigger = 'local_evidence_sparse' | 'freshness_or_reference' | 'claim_review';

export interface SearxngConfig {
  enabled: boolean;
  baseUrl: string | null;
  timeoutMs: number;
  maxResults: number;
  triggerCoverage: number;
}

export interface SearxngSearchResult {
  title: string;
  url: string;
  content: string;
  engines: string[];
  publishedDate?: string;
}

export interface SearxngSearchOutcome {
  results: SearxngSearchResult[];
  reason?: 'disabled' | 'invalid_config' | 'privacy_filtered' | 'timeout' | 'network_error' | 'invalid_response' | `http_${number}`;
  redactedFields?: string[];
}

export interface WebSearchStatus {
  provider: 'searxng';
  enabled: boolean;
  baseUrl: string | null;
  timeoutMs: number;
  maxResults: number;
  triggerCoverage: number;
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:8088';
const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_RESULTS = 5;
const DEFAULT_TRIGGER_COVERAGE = 0.58;

const FRESHNESS_OR_REFERENCE_HINT = /(最新|近期|最近|当前|现行|更新|动态|新闻|标准|规范|论文|文献|指南|research|latest|current|standard|paper|literature|20(?:2[4-9]|3\d))/i;

const SENSITIVE_QUERY_RULES: Array<{ field: string; pattern: RegExp }> = [
  { field: '访问凭据', pattern: /(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/i },
  { field: '授权令牌', pattern: /bearer\s+[a-z0-9._~+\-/]+=*/i },
  { field: '电子邮箱', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i },
  { field: '手机号码', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { field: '身份证号', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/ },
];

function readBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function readBoundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function normalizeBaseUrl(value: string | undefined): string | null {
  const candidate = value?.trim() || DEFAULT_BASE_URL;
  try {
    const url = new URL(candidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    url.hash = '';
    url.search = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

/** 读取环境配置；关闭是默认值，避免未启动本地服务时产生额外网络等待。 */
export function getSearxngConfig(env: NodeJS.ProcessEnv = process.env): SearxngConfig {
  const baseUrl = normalizeBaseUrl(env['SEARXNG_BASE_URL']);
  const requested = readBoolean(env['SEARXNG_ENABLED'], false);
  return {
    enabled: requested && baseUrl !== null,
    baseUrl,
    timeoutMs: readBoundedNumber(env['SEARXNG_TIMEOUT_MS'], DEFAULT_TIMEOUT_MS, 1_000, 30_000),
    maxResults: readBoundedNumber(env['SEARXNG_MAX_RESULTS'], DEFAULT_MAX_RESULTS, 1, 10),
    triggerCoverage: Math.min(0.95, Math.max(0.1, Number(env['SEARXNG_TRIGGER_COVERAGE']) || DEFAULT_TRIGGER_COVERAGE)),
  };
}

export function getWebSearchStatus(env: NodeJS.ProcessEnv = process.env): WebSearchStatus {
  const config = getSearxngConfig(env);
  return {
    provider: 'searxng',
    enabled: config.enabled,
    baseUrl: config.enabled ? config.baseUrl : null,
    timeoutMs: config.timeoutMs,
    maxResults: config.maxResults,
    triggerCoverage: config.triggerCoverage,
  };
}

/** 网络检索只在本地材料偏少或显式需要时效/参考资料时触发。 */
export function chooseWebSearchTrigger(
  query: string,
  localItemCount: number,
  localCoverage: number,
  config: Pick<SearxngConfig, 'triggerCoverage'> = getSearxngConfig(),
): WebSearchTrigger | null {
  if (FRESHNESS_OR_REFERENCE_HINT.test(query)) return 'freshness_or_reference';
  if (localItemCount === 0 || localCoverage < config.triggerCoverage) return 'local_evidence_sparse';
  return null;
}

/** 查询中出现凭据或个人标识时，不向任何外部搜索引擎转发。 */
export function guardWebSearchQuery(query: string): { allowed: boolean; query: string; redactedFields: string[] } {
  const normalized = query.replace(/\s+/g, ' ').trim().slice(0, 500);
  const redactedFields = SENSITIVE_QUERY_RULES
    .filter((rule) => rule.pattern.test(normalized))
    .map((rule) => rule.field);
  return { allowed: normalized.length > 1 && redactedFields.length === 0, query: normalized, redactedFields };
}

function textOf(value: unknown, maximum: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, maximum);
}

function validUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function enginesOf(result: Record<string, unknown>): string[] {
  const raw = result['engines'] ?? result['engine_name'] ?? result['engine'];
  const list = Array.isArray(raw) ? raw : [raw];
  return Array.from(new Set(list.map((item) => textOf(item, 48)).filter(Boolean))).slice(0, 4);
}

function normalizeResults(payload: unknown, maximum: number): SearxngSearchResult[] | null {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as Record<string, unknown>)['results'])) return null;
  const deduped = new Map<string, SearxngSearchResult>();
  for (const raw of (payload as Record<string, unknown>)['results'] as unknown[]) {
    if (!raw || typeof raw !== 'object') continue;
    const result = raw as Record<string, unknown>;
    const url = validUrl(result['url']);
    const title = textOf(result['title'], 180);
    const content = textOf(result['content'], 1_200);
    if (!url || !title || !content || deduped.has(url)) continue;
    const publishedDate = textOf(result['publishedDate'] ?? result['published_date'], 64) || undefined;
    deduped.set(url, { title, url, content, engines: enginesOf(result), publishedDate });
    if (deduped.size >= maximum) break;
  }
  return [...deduped.values()];
}

/** 调用本机 SearXNG JSON API；任何异常均返回可解释的空结果，不影响主流程。 */
export async function searchSearxng(
  rawQuery: string,
  config: SearxngConfig = getSearxngConfig(),
): Promise<SearxngSearchOutcome> {
  if (!config.enabled) return { results: [], reason: config.baseUrl ? 'disabled' : 'invalid_config' };
  const guarded = guardWebSearchQuery(rawQuery);
  if (!guarded.allowed) return { results: [], reason: 'privacy_filtered', redactedFields: guarded.redactedFields };

  const url = new URL('/search', `${config.baseUrl}/`);
  url.searchParams.set('q', guarded.query);
  url.searchParams.set('format', 'json');
  url.searchParams.set('categories', 'general');
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('safesearch', '1');
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(config.timeoutMs),
    });
    if (!response.ok) return { results: [], reason: `http_${response.status}` };
    const results = normalizeResults(await response.json(), config.maxResults);
    return results === null ? { results: [], reason: 'invalid_response' } : { results };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    return { results: [], reason: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network_error' };
  }
}
