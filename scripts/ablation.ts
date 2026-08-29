/**
 * 消融实验（docs/挑战杯技术开发总规.md §8.2、sol 的第一份计划 §二.2）
 *
 * A1 动态 DAG 对比固定 DAG：同一任务下，三画像的动态计划（风险等级/从严裁决/质询重点）
 *    是否真实分化；固定信号（中性画像）下计划是否退化为完全一致。
 * A2 Claim 辩论裁决对比仅生成/仅一次审核：从真实运行的 claims 历史统计
 *    "初稿幻觉率（首轮 unsupported）→ 发布资源幻觉率（终轮 unsupported）"的门禁削减。
 * A3 BKT 难度校准对比固定难度：三画像技能状态下，校准难度的预计成功率是否全部落
 *    65%-80% 教学区间，固定 0.42 难度是否越界。
 *
 * 用法：pnpm ablation（需 PG 数据源与既有运行历史；A2 无历史时如实标注）
 */
import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { getLearningDatabase } from '../server/db/client.js';
import { planStudyRun, type PlannerSignals } from '../server/runs/planner.js';
import { calibrateDifficulty, SUCCESS_RATE_BAND } from '../src/learning/difficulty.js';

interface AblationReport {
  generatedAt: string;
  A1_dynamic_vs_fixed: {
    personaPlans: Array<{ persona: string; riskLevel: string; strict: boolean; challengeFocus: string[] }>;
    fixedPlans: Array<{ persona: string; riskLevel: string; strict: boolean; challengeFocus: string[] }>;
    dynamicDistinct: number;
    fixedDistinct: number;
    pass: boolean;
  };
  A2_gate_ablation: {
    runsAnalyzed: number;
    draftHallucinationRate: number | null;
    releasedHallucinationRate: number | null;
    revisedRuns: number;
    note: string;
    pass: boolean;
  };
  A3_difficulty_ablation: {
    cases: Array<{ persona: string; knowledgePointId: string; pMastery: number; calibratedExpected: number; fixedExpected: number }>;
    calibratedInBand: number;
    calibratedTotal: number;
    fixedInBand: number;
    fixedTotal: number;
    pass: boolean;
  };
}

const PERSONA_SIGNALS: Record<string, PlannerSignals> = {
  'learner-foundation': { profileUncertainty: 0.75, knowledgeRisk: 0.58, taskRisk: 0.2, evidenceCoverageHint: 'normal' },
  'learner-advanced': { profileUncertainty: 0.35, knowledgeRisk: 0.18, taskRisk: 0.1, evidenceCoverageHint: 'rich' },
  'learner-maintenance': { profileUncertainty: 0.55, knowledgeRisk: 0.32, taskRisk: 0.15, evidenceCoverageHint: 'normal' },
};
const NEUTRAL: PlannerSignals = { profileUncertainty: 0.5, knowledgeRisk: 0, taskRisk: 0, evidenceCoverageHint: 'normal' };

function planFingerprint(plan: { riskLevel: string; strict: boolean; challengeFocus: string[] }): string {
  return `${plan.riskLevel}|${plan.strict}|${[...plan.challengeFocus].sort().join(',')}`;
}

async function main(): Promise<void> {
  const database = getLearningDatabase();
  const report: AblationReport = {
    generatedAt: new Date().toISOString(),
    A1_dynamic_vs_fixed: { personaPlans: [], fixedPlans: [], dynamicDistinct: 0, fixedDistinct: 0, pass: false },
    A2_gate_ablation: {
      runsAnalyzed: 0, draftHallucinationRate: null, releasedHallucinationRate: null, revisedRuns: 0,
      note: '', pass: false,
    },
    A3_difficulty_ablation: { cases: [], calibratedInBand: 0, calibratedTotal: 0, fixedInBand: 0, fixedTotal: 0, pass: false },
  };

  // ---------- A1：动态 DAG vs 固定 DAG ----------
  const request = {
    task: '围绕 AI4I 传感器数据与机器故障判断生成学习材料',
    pathNodeId: null,
    resourceType: 'lecture' as const,
    collaborationMode: 'auto' as const,
    selectedAgentIds: [],
    temporaryReference: null,
  };
  for (const [persona, signals] of Object.entries(PERSONA_SIGNALS)) {
    const plan = planStudyRun(`ablation-${persona}`, request, signals);
    report.A1_dynamic_vs_fixed.personaPlans.push({
      persona,
      riskLevel: plan.riskLevel,
      strict: plan.strictAdjudication,
      challengeFocus: [...plan.challengeFocus],
    });
    const fixed = planStudyRun(`ablation-fixed-${persona}`, request, NEUTRAL);
    report.A1_dynamic_vs_fixed.fixedPlans.push({
      persona,
      riskLevel: fixed.riskLevel,
      strict: fixed.strictAdjudication,
      challengeFocus: [...fixed.challengeFocus],
    });
  }
  report.A1_dynamic_vs_fixed.dynamicDistinct =
    new Set(report.A1_dynamic_vs_fixed.personaPlans.map((plan) => planFingerprint(plan))).size;
  report.A1_dynamic_vs_fixed.fixedDistinct =
    new Set(report.A1_dynamic_vs_fixed.fixedPlans.map((plan) => planFingerprint(plan))).size;
  report.A1_dynamic_vs_fixed.pass =
    report.A1_dynamic_vs_fixed.dynamicDistinct >= 2 && report.A1_dynamic_vs_fixed.fixedDistinct === 1;

  // ---------- A2：门禁消融（基于真实运行历史；升级计划 G10：初稿 vs 终稿按轮次口径） ----------
  const runRows = (await database.pool.query(
    `SELECT r.id, r.final_asset_id,
       (SELECT MAX(a.round) FROM audit_decisions a WHERE a.run_id = r.id) AS max_round
     FROM study_runs r
     WHERE r.status = 'succeeded' AND r.final_asset_id IS NOT NULL
     ORDER BY r.created_at DESC LIMIT 20`,
  )).rows as Array<{ id: string; final_asset_id: string | null; max_round: number }>;
  report.A2_gate_ablation.runsAnalyzed = runRows.length;
  if (runRows.length > 0) {
    // 按轮次统计：attempt 1 = 初稿，最大 attempt = 终稿；non_factual 不入分母
    const attemptRows = (await database.pool.query(
      `SELECT resource_id AS "runId", COALESCE(attempt, 1) AS attempt,
         COUNT(*) FILTER (WHERE COALESCE(claim_type, 'risk_advice') <> 'non_factual')::int AS auditable,
         COUNT(*) FILTER (WHERE verdict = 'unsupported' AND COALESCE(claim_type, 'risk_advice') <> 'non_factual')::int AS unsupported
       FROM claims
       WHERE resource_id = ANY($1)
       GROUP BY resource_id, COALESCE(attempt, 1)
       ORDER BY resource_id, attempt`,
      [runRows.map((row) => row.id)],
    )).rows as Array<{ runId: string; attempt: number; auditable: number; unsupported: number }>;
    const rateAt = (runId: string, attempt: number): number | null => {
      const row = attemptRows.find((item) => item.runId === runId && Number(item.attempt) === attempt);
      if (!row || Number(row.auditable) === 0) return null;
      return Math.round((Number(row.unsupported) / Number(row.auditable)) * 1000) / 1000;
    };
    const draftRates = runRows.map((row) => rateAt(row.id, 1)).filter((rate): rate is number => rate !== null);
    const finalRates = runRows.map((row) => rateAt(row.id, Number(row.max_round) || 1)).filter((rate): rate is number => rate !== null);
    const mean = (values: number[]): number | null => values.length === 0 ? null : Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 1000) / 1000;
    report.A2_gate_ablation.draftHallucinationRate = mean(draftRates);
    report.A2_gate_ablation.releasedHallucinationRate = mean(finalRates);
    report.A2_gate_ablation.revisedRuns = runRows.filter((row) => Number(row.max_round) > 1).length;
    const gateGain = report.A2_gate_ablation.draftHallucinationRate !== null && report.A2_gate_ablation.releasedHallucinationRate !== null
      ? report.A2_gate_ablation.draftHallucinationRate - report.A2_gate_ablation.releasedHallucinationRate
      : null;
    report.A2_gate_ablation.note = `按轮次口径分析 ${runRows.length} 次已发布运行：初稿幻觉率 ${report.A2_gate_ablation.draftHallucinationRate === null ? 'N/A（空分母）' : `${(report.A2_gate_ablation.draftHallucinationRate * 100).toFixed(1)}%`}、终稿幻觉率 ${report.A2_gate_ablation.releasedHallucinationRate === null ? 'N/A' : `${(report.A2_gate_ablation.releasedHallucinationRate * 100).toFixed(1)}%`}、门禁净增益 ${gateGain === null ? 'N/A' : `${(gateGain * 100).toFixed(1)}%`}；修订触发 ${report.A2_gate_ablation.revisedRuns} 次。历史样本无修订时增益以故障注入 fixture 与 live 分层案例补证。`;
    report.A2_gate_ablation.pass = (report.A2_gate_ablation.releasedHallucinationRate ?? 1) < 0.05;
  } else {
    report.A2_gate_ablation.note = '暂无已发布运行历史，无法统计；请先运行 pnpm evaluate --live 或页面协同生成。';
    report.A2_gate_ablation.pass = false;
  }

  // ---------- A3：BKT 难度校准 vs 固定难度 ----------
  const states = (await database.pool.query(
    `SELECT u.login_name AS persona, s.knowledge_point_id AS kp, s.p_mastery AS mastery, s.confidence
     FROM learner_skill_states s JOIN users u ON u.id = s.learner_id
     WHERE u.login_name LIKE 'learner-%' LIMIT 60`,
  )).rows as Array<{ persona: string; kp: string; mastery: number; confidence: number }>;
  for (const state of states) {
    const calibrated = calibrateDifficulty({ pMastery: state.mastery, confidence: state.confidence, prereqReadiness: 0.6, scaffold: 'medium' });
    // 固定难度 0.42（历史硬编码）的预计成功率：按同一成功率模型反推
    const fixedDifficulty = 0.42;
    const readiness = 0.6 * state.mastery + 0.25 * 0.6 + 0.15 * state.confidence;
    const support = (1 - readiness) * 0.6 * 0.9;
    const fixedExpected = readiness + support * (1 - fixedDifficulty) - 0.2 * fixedDifficulty;
    report.A3_difficulty_ablation.cases.push({
      persona: state.persona,
      knowledgePointId: state.kp,
      pMastery: Number(state.mastery.toFixed(2)),
      calibratedExpected: Number(calibrated.expectedSuccessRate.toFixed(2)),
      fixedExpected: Number(Math.max(0, Math.min(1, fixedExpected)).toFixed(2)),
    });
  }
  const inBand = (value: number): boolean => value >= SUCCESS_RATE_BAND[0] && value <= SUCCESS_RATE_BAND[1];
  report.A3_difficulty_ablation.calibratedTotal = report.A3_difficulty_ablation.cases.length;
  report.A3_difficulty_ablation.calibratedInBand = report.A3_difficulty_ablation.cases.filter((item) => inBand(item.calibratedExpected)).length;
  report.A3_difficulty_ablation.fixedTotal = report.A3_difficulty_ablation.cases.length;
  report.A3_difficulty_ablation.fixedInBand = report.A3_difficulty_ablation.cases.filter((item) => inBand(item.fixedExpected)).length;
  report.A3_difficulty_ablation.pass =
    report.A3_difficulty_ablation.calibratedTotal > 0
    && report.A3_difficulty_ablation.calibratedInBand === report.A3_difficulty_ablation.calibratedTotal;

  // ---------- 输出 ----------
  const dir = path.join(process.cwd(), 'data');
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ablation-report-${Date.now()}.json`);
  await writeFile(file, JSON.stringify(report, null, 2), 'utf8');
  console.log(`[ablation] A1 动态 DAG 分化 ${report.A1_dynamic_vs_fixed.dynamicDistinct} 种计划（固定 ${report.A1_dynamic_vs_fixed.fixedDistinct} 种）→ ${report.A1_dynamic_vs_fixed.pass ? '✔' : '✘'}`);
  console.log(`[ablation] A2 发布资源幻觉率 ${report.A2_gate_ablation.releasedHallucinationRate ?? '—'}（分析 ${report.A2_gate_ablation.runsAnalyzed} 次运行，修订触发 ${report.A2_gate_ablation.revisedRuns} 次）→ ${report.A2_gate_ablation.pass ? '✔' : '✘'}`);
  console.log(`[ablation] A3 校准难度成功率入区间 ${report.A3_difficulty_ablation.calibratedInBand}/${report.A3_difficulty_ablation.calibratedTotal}，固定 0.42 入区间 ${report.A3_difficulty_ablation.fixedInBand}/${report.A3_difficulty_ablation.fixedTotal} → ${report.A3_difficulty_ablation.pass ? '✔' : '✘'}`);
  console.log(`[ablation] 报告：${file}`);
  const allPass = report.A1_dynamic_vs_fixed.pass && report.A2_gate_ablation.pass && report.A3_difficulty_ablation.pass;
  if (!allPass) process.exit(1);
  process.exit(0);
}

main().catch((error) => {
  console.error('[ablation] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
