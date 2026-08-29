/**
 * 评测器（docs/挑战杯技术开发总规.md §8.2）
 * 离线模式（默认）：结构化校验 60 案例 + 难度适配推演 + 证据覆盖检索，无需 LLM，秒级完成；
 * --live 模式：对 --limit 个案例执行完整运行（需 api+worker 在跑），输出幻觉率全量指标。
 * 结果落 evaluation_results，报告写 data/evaluation-report-<ts>.json；阈值不达标退出码 1。
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'path';
import { sql } from 'drizzle-orm';
import {
  PERSONA_PRIORS,
  buildEvaluationCases,
  coverageRate,
  difficultyMatches,
  hallucinationRate,
  type EvaluationCase,
} from '../src/learning/evaluation.js';
import { calibrateDifficulty } from '../src/learning/difficulty.js';
import type { ScaffoldStrength } from '../src/learning/difficulty.js';
import { dataSource, datasetDb } from '../server/study-context.js';
import { getLearningDatabase } from '../server/db/client.js';
import { evaluationCases, evaluationResults } from '../server/db/schema.js';

const THRESHOLDS = { hallucinationRate: 0.05, difficultyAccuracy: 0.85, coverage: 0.9 };

function scaffoldOfType(type: EvaluationCase['resourceType']): ScaffoldStrength {
  if (type === 'tiered_quiz') return 'medium';
  if (type === 'challenge_task') return 'low';
  return 'high';
}

/** 黄金知识点 → 知识库检索关键词 */
const KP_KEYWORDS: Record<string, string[]> = {
  'pandas-reading': ['read_csv', 'DataFrame', 'pandas', 'CSV'],
  'ai4i-overview': ['AI4I', 'Machine failure', '预测性维护'],
  'ai4i-failure-modes': ['TWF', 'HDF', 'PWF', 'OSF', '刀具磨损', '散热'],
  'statistics-basics': ['均值', '中位数', '分布', '分位'],
  'evidence-boundary': ['风险判断', '现场复核', '不确定性', '证据'],
  'time-series-basics': ['滑动', '窗口', '趋势', '时序', '采样'],
  'anomaly-threshold': ['阈值', '异常', '告警', '分位数'],
  'data-cleaning': ['缺失', '清洗', '插值', 'NaN'],
  'python-basics': ['Python', 'type(', '循环', '变量'],
};

/**
 * 黄金知识点证据覆盖（离线指标）：每个必备知识点按关键词对知识库做包含检查。
 * 说明：不走 FTS——'simple' 分词无法切分连续中文，单词命中率会失真；覆盖检查的语义就是
 * "知识库中是否存在讲解该知识点的卡片"，LIKE 包含检查是它的忠实实现。
 */
async function supportedKnowledgePoints(caseItem: EvaluationCase): Promise<string[]> {
  const hit = async (keyword: string): Promise<boolean> => {
    if (dataSource === 'postgres') {
      const { pool } = getLearningDatabase();
      const row = (await pool.query(
        'SELECT COUNT(*)::int AS n FROM document_chunks WHERE title ILIKE $1 OR content ILIKE $1',
        [`%${keyword}%`],
      )).rows[0] as { n: number };
      return Number(row.n) > 0;
    }
    const row = datasetDb!.prepare(
      'SELECT COUNT(*) AS n FROM document_chunks WHERE title LIKE ? OR content LIKE ?',
    ).get(`%${keyword}%`, `%${keyword}%`) as { n?: number } | undefined;
    return Number(row?.n ?? 0) > 0;
  };
  const supported: string[] = [];
  for (const kp of caseItem.requiredKnowledgePoints) {
    for (const keyword of KP_KEYWORDS[kp] ?? [kp]) {
      if (await hit(keyword)) {
        supported.push(kp);
        break;
      }
    }
  }
  return supported;
}

interface CaseResult {
  caseId: string;
  difficultyMatch: boolean;
  coverage: number;
  hallucinationRate: number | null;
  passed: boolean;
  detail: Record<string, unknown>;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const limitIndex = args.indexOf('--limit');
  const limit = limitIndex >= 0 ? Number(args[limitIndex + 1]) || Infinity : Infinity;
  const live = args.includes('--live');
  const strideIndex = args.indexOf('--stride');
  const stride = strideIndex >= 0 ? Number(args[strideIndex + 1]) || 1 : 1;

  const cases = buildEvaluationCases();
  console.log(`[evaluate] 案例总数 ${cases.length}（三画像各 ${cases.length / 3}）`);
  if (cases.length !== 60) {
    console.error('[evaluate] 案例数不为 60，评测集定义有误');
    process.exit(2);
  }

  const results: CaseResult[] = [];
  const selected = cases.slice(0, limit === Infinity ? cases.length : limit);
  // --stride N：每 N 个案例取 1 个，分层覆盖三画像与六类资源（live 模式用）
  const selectedStratified = stride > 1 ? selected.filter((_, index) => index % stride === 0) : selected;
  for (const caseItem of selectedStratified) {
    const prior = PERSONA_PRIORS[caseItem.persona];
    const calibration = calibrateDifficulty({
      pMastery: prior.pMastery, confidence: prior.confidence,
      prereqReadiness: prior.prereqReadiness, scaffold: scaffoldOfType(caseItem.resourceType),
    });
    const match = difficultyMatches(calibration, caseItem.targetDifficultyRange);
    const supported = await supportedKnowledgePoints(caseItem);
    const coverage = coverageRate(supported, caseItem.requiredKnowledgePoints);
    const result: CaseResult = {
      caseId: caseItem.id,
      difficultyMatch: match,
      coverage: Math.round(coverage * 1000) / 1000,
      hallucinationRate: null,
      passed: match && coverage >= THRESHOLDS.coverage,
      detail: {
        targetDifficulty: calibration.targetDifficulty,
        expectedSuccessRate: calibration.expectedSuccessRate,
        targetRange: caseItem.targetDifficultyRange,
        supportedKnowledgePoints: supported,
        mode: live ? 'live' : 'offline',
      },
    };
    if (live) {
      // live 模式：创建真实运行并等待终态，取 Claim 裁决结果计算幻觉率与证据边覆盖率
      const liveResult = await runLiveCase(caseItem);
      result.hallucinationRate = liveResult?.hallucinationRate ?? null;
      if (liveResult?.coverage !== null && liveResult?.coverage !== undefined) {
        result.coverage = liveResult.coverage;
        result.detail['coverageSource'] = 'evidence_edge';
      } else {
        result.detail['coverageSource'] = 'knowledge_base_keyword';
      }
      result.detail['runId'] = liveResult?.runId ?? null;
    }
    results.push(result);
    console.log(`[evaluate] ${result.passed ? '✔' : '✘'} ${caseItem.id} 难度${match ? '匹配' : '未匹配'} 覆盖 ${(coverage * 100).toFixed(0)}%${result.hallucinationRate !== null ? ` 幻觉率 ${(result.hallucinationRate * 100).toFixed(1)}%` : ''}`);
  }

  const difficultyAccuracy = results.filter((item) => item.difficultyMatch).length / results.length;
  const meanCoverage = results.reduce((sum, item) => sum + item.coverage, 0) / results.length;
  const hallucinationValues = results.map((item) => item.hallucinationRate).filter((value): value is number => value !== null);
  const meanHallucination = hallucinationValues.length > 0
    ? hallucinationValues.reduce((sum, value) => sum + value, 0) / hallucinationValues.length
    : null;

  const summary = {
    startedAt: new Date().toISOString(),
    mode: live ? 'live' : 'offline',
    // 如实区分（升级计划 §F）：离线规则结果 / 本次 live 结果；未跑全量 live 时报告必须写明
    resultScope: live
      ? (results.length >= 60 ? 'full_live_60' : `stratified_live_${results.length} + offline_full_60`)
      : 'offline_rule_60',
    cases: results.length,
    metrics: {
      difficultyAccuracy: Math.round(difficultyAccuracy * 1000) / 1000,
      coverage: Math.round(meanCoverage * 1000) / 1000,
      hallucinationRate: meanHallucination === null ? null : Math.round(meanHallucination * 1000) / 1000,
    },
    thresholds: THRESHOLDS,
    thresholdCheck: {
      difficulty: difficultyAccuracy >= THRESHOLDS.difficultyAccuracy,
      coverage: meanCoverage >= THRESHOLDS.coverage,
      hallucination: meanHallucination === null ? null : meanHallucination < THRESHOLDS.hallucinationRate,
    },
  };

  // 落库：案例登记 + 结果
  const database = getLearningDatabase();
  await database.db.insert(evaluationCases).values(cases.map((caseItem) => ({
    id: caseItem.id,
    code: caseItem.code,
    persona: caseItem.persona,
    domain: caseItem.domain,
    taskLevel: caseItem.taskLevel,
    resourceType: caseItem.resourceType,
    task: caseItem.task,
    requiredKnowledgePoints: caseItem.requiredKnowledgePoints,
    targetDifficultyRange: caseItem.targetDifficultyRange,
    allowedEvidenceScope: caseItem.allowedEvidenceScope,
    expectedStructure: caseItem.expectedStructure,
  }))).onConflictDoNothing();
  await database.db.insert(evaluationResults).values(results.map((result) => ({
    id: `eval-result-${result.caseId}-${Date.now()}`,
    caseId: result.caseId,
    runId: (result.detail['runId'] as string | null) ?? null,
    metrics: {
      difficultyMatch: result.difficultyMatch,
      coverage: result.coverage,
      hallucinationRate: result.hallucinationRate,
    },
    passed: result.passed,
    detail: result.detail,
    createdAt: Date.now(),
  })));

  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const reportFile = path.join(dir, `evaluation-report-${Date.now()}.json`);
  await writeFile(reportFile, JSON.stringify({ ...summary, results }, null, 2), 'utf8');
  console.log('[evaluate] 汇总：', JSON.stringify(summary.metrics));
  console.log(`[evaluate] 报告：${reportFile}`);
  const failed = Object.entries(summary.thresholdCheck).filter(([, ok]) => ok === false);
  if (failed.length > 0) {
    console.error(`[evaluate] ✘ 阈值未达标：${failed.map(([key]) => key).join('、')}；不得标记开发完成（总规 §8.2）`);
    process.exit(1);
  }
  console.log('[evaluate] ✔ 全部已测指标达标');
  process.exit(0);
}

interface LiveRunResult { runId: string; hallucinationRate: number | null; coverage: number | null }

/**
 * 核心知识覆盖率官方口径（升级计划 §F）：有有效 evidence edge 支持的必备知识点 / 黄金必备知识点。
 * 判定：资源中绑定该知识点的块，其证据引用至少一条被 supported Claim 使用——
 * 不是"资源文本包含关键词"（修 G9）。
 */
async function liveRunCoverage(runId: string, requiredKnowledgePoints: string[]): Promise<number | null> {
  const database = getLearningDatabase();
  const assetRow = (await database.pool.query(
    `SELECT content_json AS "contentJson" FROM learning_assets WHERE id = (SELECT final_asset_id FROM study_runs WHERE id = $1)`,
    [runId],
  )).rows[0] as { contentJson: { blocks?: Array<{ knowledgePointIds?: string[]; evidenceIds?: string[] }> } } | undefined;
  const blocks = assetRow?.contentJson?.blocks ?? [];
  const evidenceVerdicts = (await database.pool.query(
    `SELECT ce.evidence_id AS "evidenceId", c.verdict
     FROM claim_evidence ce JOIN claims c ON c.id = ce.claim_id
     WHERE c.resource_id = $1 AND c.verdict = 'supported'`,
    [runId],
  )).rows as Array<{ evidenceId: string; verdict: string }>;
  const supportedEvidence = new Set(evidenceVerdicts.map((row) => row.evidenceId));
  if (requiredKnowledgePoints.length === 0) return null;
  let hit = 0;
  for (const kp of requiredKnowledgePoints) {
    const covered = blocks.some((block) =>
      Array.isArray(block.knowledgePointIds) && block.knowledgePointIds.includes(kp)
      && Array.isArray(block.evidenceIds) && block.evidenceIds.some((evidenceId) => supportedEvidence.has(evidenceId)));
    if (covered) hit += 1;
  }
  return Math.round((hit / requiredKnowledgePoints.length) * 1000) / 1000;
}

/** live 模式走真实链路：POST /api/learning/runs → 轮询终态 → 读 claims 计算幻觉率与证据边覆盖率 */
async function runLiveCase(caseItem: EvaluationCase): Promise<LiveRunResult | null> {
  const apiBase = process.env['EVALUATE_API_BASE'] ?? 'http://localhost:3001';
  // 演示账号登录（demo:seed 已建）
  const password = process.env['IM_TRAINING_AGENT_DEMO_PASSWORD'];
  if (!password) {
    console.error('[evaluate] --live 需要 IM_TRAINING_AGENT_DEMO_PASSWORD 与 pnpm demo:seed');
    return null;
  }
  const login = await fetch(`${apiBase}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginName: caseItem.persona, password }),
  });
  const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
  if (!cookie) {
    console.error(`[evaluate] ${caseItem.persona} 登录失败，请先 pnpm demo:seed`);
    return null;
  }
  const create = await fetch(`${apiBase}/api/learning/runs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', cookie },
    body: JSON.stringify({ task: caseItem.task, pathNodeId: null, resourceType: caseItem.resourceType, collaborationMode: 'auto', selectedAgentIds: [] }),
  });
  const created = await create.json() as { runId?: string };
  if (!created.runId) return null;
  const runId = created.runId;
  for (let waited = 0; waited < 240; waited += 5) {
    await new Promise((resolve) => setTimeout(resolve, 5_000));
    const snapshot = await fetch(`${apiBase}/api/learning/runs/${runId}`, { headers: { cookie } });
    const data = await snapshot.json() as { run?: { status?: string } };
    if (data.run?.status === 'succeeded' || data.run?.status === 'failed' || data.run?.status === 'cancelled') break;
  }
  const claimsRows = await databaseClaimsForRun(runId);
  const coverage = await liveRunCoverage(runId, caseItem.requiredKnowledgePoints);
  return { runId, hallucinationRate: hallucinationRate(claimsRows), coverage };
}

async function databaseClaimsForRun(runId: string): Promise<Array<{ verdict: string; claimType: string | null }>> {
  const database = getLearningDatabase();
  const result = await database.db.execute(sql`SELECT verdict, claim_type AS "claimType" FROM claims WHERE resource_id = ${runId}`);
  return result.rows as Array<{ verdict: string; claimType: string | null }>;
}

main().catch((error) => {
  console.error('[evaluate] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
