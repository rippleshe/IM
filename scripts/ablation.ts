/**
 * 消融实验（docs/挑战杯技术开发总规.md §8.2）
 *
 * A1 动态 DAG 对比固定 DAG：同一任务下，三画像的动态计划（风险等级/从严裁决/质询重点）
 *    是否真实分化；固定信号（中性画像）下计划是否退化为完全一致。
 * A2 Claim 辩论裁决对比仅生成/仅一次审核：从固定、带 SHA-256 的真实运行导出统计
 *    "初稿幻觉率（首轮 unsupported）→ 发布资源幻觉率（终轮 unsupported）"的门禁削减。
 * A3 BKT 难度校准对比固定难度：三画像技能状态下，校准难度的预计成功率是否全部落
 *    65%-80% 教学区间，固定 0.42 难度是否越界。
 *
 * 用法：pnpm ablation（纯离线；固定队列见 data/evaluation/live-run-cohort.json）
 */
import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { planStudyRun, type PlannerSignals } from '../server/runs/planner.js';
import { replayExport, type ExportPayloadLike } from '../server/runs/metrics.js';
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

type CohortManifest = {
  id: string;
  runs: Array<{ persona: string; file: string; sha256: string; runId: string }>;
};

type CohortRun = {
  persona: string;
  payload: ExportPayloadLike & {
    initialLearnerState?: { skillStates?: Array<{ knowledgePointId: string; pMastery: number; confidence: number }> };
  };
  replay: ReturnType<typeof replayExport>;
};

function planFingerprint(plan: { riskLevel: string; strict: boolean; challengeFocus: string[] }): string {
  return `${plan.riskLevel}|${plan.strict}|${[...plan.challengeFocus].sort().join(',')}`;
}

async function loadFrozenCohort(): Promise<{ id: string; runs: CohortRun[] }> {
  const manifestPath = path.join(process.cwd(), 'data', 'evaluation', 'live-run-cohort.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as CohortManifest;
  if (!manifest.id || !Array.isArray(manifest.runs) || manifest.runs.length < 3) {
    throw new Error('固定真实运行队列无效：至少需要三种学习画像');
  }
  const runs = await Promise.all(manifest.runs.map(async (entry): Promise<CohortRun> => {
    const body = await readFile(path.join(process.cwd(), entry.file), 'utf8');
    const actualHash = createHash('sha256').update(body).digest('hex');
    if (actualHash !== entry.sha256.toLowerCase()) throw new Error(`固定队列散列不一致：${entry.file}`);
    const payload = JSON.parse(body) as CohortRun['payload'];
    if (payload.run.id !== entry.runId) throw new Error(`固定队列运行标识不一致：${entry.file}`);
    const replay = replayExport(payload);
    if (!replay.passed) throw new Error(`固定队列离线回放失败：${entry.file}（${replay.differences.join('；')}）`);
    return { persona: entry.persona, payload, replay };
  }));
  return { id: manifest.id, runs };
}

async function main(): Promise<void> {
  const cohort = await loadFrozenCohort();
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

  // ---------- A2：门禁消融（固定真实运行队列；按 Claim 数量加权） ----------
  report.A2_gate_ablation.runsAnalyzed = cohort.runs.length;
  const stages = cohort.runs.map((run) => ({ first: run.replay.attempts[0]!, last: run.replay.attempts.at(-1)! }));
  const weightedRate = (key: 'first' | 'last'): number | null => {
    const auditable = stages.reduce((sum, stage) => sum + stage[key].auditableClaims, 0);
    if (auditable === 0) return null;
    const unsupported = stages.reduce((sum, stage) => sum + stage[key].unsupportedClaims, 0);
    return Math.round((unsupported / auditable) * 1000) / 1000;
  };
  report.A2_gate_ablation.draftHallucinationRate = weightedRate('first');
  report.A2_gate_ablation.releasedHallucinationRate = weightedRate('last');
  report.A2_gate_ablation.revisedRuns = cohort.runs.filter((run) => run.replay.attempts.length > 1).length;
  const gateGain = report.A2_gate_ablation.draftHallucinationRate !== null && report.A2_gate_ablation.releasedHallucinationRate !== null
    ? report.A2_gate_ablation.draftHallucinationRate - report.A2_gate_ablation.releasedHallucinationRate
    : null;
  report.A2_gate_ablation.note = `固定队列 ${cohort.id}：${cohort.runs.length} 个三画像真实运行均已通过散列校验和离线回放；按 Claim 数量加权，初稿幻觉率 ${report.A2_gate_ablation.draftHallucinationRate === null ? 'N/A' : `${(report.A2_gate_ablation.draftHallucinationRate * 100).toFixed(1)}%`}、终稿幻觉率 ${report.A2_gate_ablation.releasedHallucinationRate === null ? 'N/A' : `${(report.A2_gate_ablation.releasedHallucinationRate * 100).toFixed(1)}%`}、门禁净增益 ${gateGain === null ? 'N/A' : `${(gateGain * 100).toFixed(1)}%`}；${report.A2_gate_ablation.revisedRuns} 次触发修订。`;
  report.A2_gate_ablation.pass = (report.A2_gate_ablation.releasedHallucinationRate ?? 1) < 0.05;

  // ---------- A3：BKT 难度校准 vs 固定难度 ----------
  const states = cohort.runs.flatMap((run) => (run.payload.initialLearnerState?.skillStates ?? []).map((state) => ({
    persona: run.persona, kp: state.knowledgePointId, mastery: state.pMastery, confidence: state.confidence,
  })));
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
