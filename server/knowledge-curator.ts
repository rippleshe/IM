import { createHash } from 'node:crypto';
import type { Pool } from 'pg';
import { reviewManagedSource } from './knowledge-governance.js';
import { getAgentExecutionSettings, multiModelClient, parseJson, refreshModelCapabilities, withTimeout } from './study-runtime.js';

type CuratorDecision = 'approved' | 'kept_temporary' | 'rejected';

export type UserReferenceCuration = {
  decision: CuratorDecision;
  reason: string;
  sourceId: string | null;
  chunksCreated: number;
  scores?: { relevance: number; quality: number; duplicateRisk: number };
};

const SENSITIVE_INPUT_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: '访问凭据', pattern: /(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/i },
  { label: '电子邮箱', pattern: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/i },
  { label: '手机号码', pattern: /(?<!\d)1[3-9]\d{9}(?!\d)/ },
  { label: '身份证号', pattern: /(?<!\d)\d{17}[\dXx](?!\d)/ },
];

function clampScore(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0;
}

function safeTitle(name: string): string {
  const stem = name.replace(/\.[^.]+$/, '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return (stem || '用户参考资料').slice(0, 180);
}

type CurationEvaluation = {
  decision: 'approved' | 'kept_temporary' | 'rejected';
  reason: string;
  scores?: { relevance: number; quality: number; duplicateRisk: number };
  shortTitle?: string;
};

type CuratorVerdict = { relevance?: unknown; quality?: unknown; duplicateRisk?: unknown; shortTitle?: unknown; reason?: unknown };

async function evaluateReference(name: string, content: string): Promise<CurationEvaluation> {
  if (content.length < 240) return { decision: 'kept_temporary', reason: '内容过短，继续作为本次任务的临时参考' };
  const sensitive = SENSITIVE_INPUT_RULES.filter((rule) => rule.pattern.test(content)).map((rule) => rule.label);
  if (sensitive.length > 0) return { decision: 'rejected', reason: `检测到${sensitive.join('、')}，不会沉淀到公共知识库` };
  let verdict: CuratorVerdict | null = null;
  try {
    const route = getAgentExecutionSettings('domain_expert', undefined, undefined);
    const limits = await refreshModelCapabilities(route.model);
    const response = await withTimeout(multiModelClient.simple({
      messages: [
        { role: 'system', content: '你是资料库策展智能体。只评估资料是否适合工业设备数据分析与故障诊断学习，不要复述原文。只返回 JSON：{"relevance":0到1,"quality":0到1,"duplicateRisk":0到1,"shortTitle":"不超过36字","reason":"不超过80字"}。相关性看是否服务该领域学习，质量看结构、可读性、来源线索，重复风险看是否像已有通用知识。' },
        { role: 'user', content: JSON.stringify({ fileName: name.slice(0, 160), excerpt: content.slice(0, 8_000) }) },
      ],
      model: route.model, temperature: 0, maxTokens: Math.min(420, limits.maxOutputTokens),
    }), 30_000, '资料评估超时');
    verdict = parseJson<CuratorVerdict>(response.text);
  } catch {
    return { decision: 'kept_temporary', reason: '资料评估服务暂不可用，正文不会被保存' };
  }
  const relevance = clampScore(verdict?.relevance);
  const quality = clampScore(verdict?.quality);
  const duplicateRisk = clampScore(verdict?.duplicateRisk);
  const scores = { relevance, quality, duplicateRisk };
  if (relevance < 0.68 || quality < 0.65 || duplicateRisk > 0.25) {
    return { decision: 'kept_temporary', reason: String(verdict?.reason || '相关性、质量或重复风险未达到入库门槛').slice(0, 120), scores };
  }
  return {
    decision: 'approved',
    reason: '资料已通过智能筛选并沉淀为可追溯知识切片',
    scores,
    shortTitle: typeof verdict?.shortTitle === 'string' && verdict.shortTitle.trim() ? verdict.shortTitle.trim().slice(0, 72) : undefined,
  };
}

/** 用户明确勾选后才调用：先做隐私阻断，再让领域智能体有限摘录评估，达标后才沉淀。 */
export async function curateUserReference(pool: Pool, reference: { name: string; content: string }, learnerId: string): Promise<UserReferenceCuration> {
  const content = reference.content.trim().slice(0, 120_000);
  const evaluation = await evaluateReference(reference.name, content);
  if (evaluation.decision !== 'approved') return { decision: evaluation.decision, reason: evaluation.reason, sourceId: null, chunksCreated: 0, ...(evaluation.scores ? { scores: evaluation.scores } : {}) };
  const scores = evaluation.scores!;
  const hash = createHash('sha256').update(content).digest('hex');
  const sourceId = `user-source-${hash.slice(0, 24)}`;
  const versionId = `user-version-${hash.slice(0, 24)}`;
  const title = safeTitle(reference.name);
  const shortTitle = evaluation.shortTitle || title.slice(0, 72);
  const now = Date.now();
  const existing = await pool.query(`SELECT s.review_status AS "reviewStatus", v.version_status AS "versionStatus" FROM knowledge_sources s JOIN knowledge_source_versions v ON v.source_id = s.id WHERE s.id = $1 AND v.id = $2`, [sourceId, versionId]);
  if (existing.rows[0]?.reviewStatus === 'approved' && existing.rows[0]?.versionStatus === 'active') return { decision: 'approved', reason: '相同内容已在知识库中', sourceId, chunksCreated: 0, scores };
  try {
    await pool.query(
      `INSERT INTO knowledge_sources (id, source_type, title, short_title, license, trust_level, review_status, distribution_scope, metadata_json, created_at, updated_at)
       VALUES ($1, 'user_reference', $2, $3, 'user_declared', 'medium', 'candidate', 'local_only', $4::jsonb, $5, $5) ON CONFLICT (id) DO NOTHING`,
      [sourceId, title, shortTitle, JSON.stringify({ uploadedBy: learnerId, curatedBy: 'knowledge_curator', scores }), now],
    );
    await pool.query(
      `INSERT INTO knowledge_source_versions (id, source_id, content_sha256, original_path, extracted_text, parser, parse_status, quality_report, version_status, created_at)
       VALUES ($1, $2, $3, $4, $5, 'user-reference-curator', 'parsed', $6::jsonb, 'candidate', $7) ON CONFLICT (source_id, content_sha256) DO NOTHING`,
      [versionId, sourceId, hash, `user-reference://${hash}`, content, JSON.stringify({ characters: content.length, curatedBy: 'knowledge_curator', scores }), now],
    );
    const result = await reviewManagedSource(pool, { sourceId, decision: 'approve', reviewerId: 'agent:knowledge-curator', shortTitle, trustLevel: 'medium' });
    return { decision: 'approved', reason: '资料已通过智能筛选并沉淀为可追溯知识切片', sourceId, chunksCreated: result.chunksCreated, scores };
  } catch {
    // 失败时不留下可被检索的正文；候选版本也一并回收，避免半成品占用知识库。
    await pool.query('DELETE FROM knowledge_source_versions WHERE id = $1', [versionId]).catch(() => undefined);
    await pool.query('DELETE FROM knowledge_sources WHERE id = $1 AND source_type = \'user_reference\'', [sourceId]).catch(() => undefined);
    return { decision: 'kept_temporary', reason: '资料沉淀未完成，正文不会被保存', sourceId: null, chunksCreated: 0, scores };
  }
}

/** 对已登记的本地候选资料执行同一策展门禁，供内部导入任务调用，不暴露给用户设置页。 */
export async function curateManagedCandidate(pool: Pool, input: { sourceId: string; title: string; content: string; summaryOnly?: boolean }): Promise<UserReferenceCuration> {
  if (input.summaryOnly) {
    return {
      decision: 'kept_temporary',
      reason: '当前只有搜索摘要，等待正文抓取和来源许可确认后再评估',
      sourceId: input.sourceId,
      chunksCreated: 0,
    };
  }
  const evaluation = await evaluateReference(input.title, input.content.trim().slice(0, 120_000));
  if (evaluation.decision === 'kept_temporary') return { decision: evaluation.decision, reason: evaluation.reason, sourceId: input.sourceId, chunksCreated: 0, ...(evaluation.scores ? { scores: evaluation.scores } : {}) };
  if (evaluation.decision === 'rejected') {
    await reviewManagedSource(pool, { sourceId: input.sourceId, decision: 'reject', reviewerId: 'agent:knowledge-curator' });
    return { decision: 'rejected', reason: evaluation.reason, sourceId: input.sourceId, chunksCreated: 0 };
  }
  const result = await reviewManagedSource(pool, { sourceId: input.sourceId, decision: 'approve', reviewerId: 'agent:knowledge-curator', shortTitle: evaluation.shortTitle, trustLevel: 'medium' });
  return { decision: 'approved', reason: evaluation.reason, sourceId: input.sourceId, chunksCreated: result.chunksCreated, scores: evaluation.scores };
}
