/**
 * 三账号差异化种子（docs/挑战杯技术开发总规.md §8.1）
 * 幂等：按 login_name upsert；演示密码只从 IM_TRAINING_AGENT_DEMO_PASSWORD 注入。
 * 用法：pnpm demo:seed
 */
import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DIAGNOSTIC_QUESTIONS, scoreDiagnostic } from '../src/learning/diagnostic.js';
import { identityStore, learningStore } from '../server/study-context.js';
import { getAgentExecutionSettings, withTimeout } from '../server/study-runtime.js';
import { fallbackPathGraph, generateInitialPathGraph, type GeneratedPathGraph } from '../server/initial-path.js';
import { generateProfileSnapshot } from '../server/profile-snapshot.js';

/** 种子画像兜底：LLM 不可用时按建档信息与诊断成绩生成确定的描述与雷达。 */
function fallbackProfileSnapshot(learnerId: string, persona: PersonaSeed, correct: number, total: number): void {
  const accuracy = correct / total;
  const summary = `${persona.onboarding.selfDescription} 当前学习目标是“${persona.onboarding.goal}”。诊断测评 ${correct}/${total} 正确，基础维度评估基于作答记录生成，后续学习证据会持续修正画像。`;
  const keywords = [persona.onboarding.goal.slice(0, 12), ...Object.keys(persona.accuracyByDimension)].slice(0, 5);
  const radar = [
    { name: '代码理解', score: Math.max(0.05, Math.min(0.95, persona.accuracyByDimension['python'] ?? 0.5)) },
    { name: '数据处理', score: Math.max(0.05, Math.min(0.95, persona.accuracyByDimension['data_processing'] ?? 0.5)) },
    { name: '统计基础', score: Math.max(0.05, Math.min(0.95, persona.accuracyByDimension['statistics'] ?? 0.5)) },
    { name: '时序分析', score: Math.max(0.05, Math.min(0.95, persona.accuracyByDimension['time_series'] ?? 0.5)) },
    { name: '设备诊断', score: Math.max(0.05, Math.min(0.95, persona.accuracyByDimension['device_diagnosis'] ?? 0.5)) },
  ];
  void accuracy;
  learningStore.saveProfileSnapshot(learnerId, { summary, keywords, radar });
}

interface PersonaSeed {
  loginName: 'learner-foundation' | 'learner-advanced' | 'learner-maintenance';
  displayName: string;
  onboarding: { role: string; programmingFoundation: string; goal: string; weeklyHours: number | null; selfDescription: string };
  /** 诊断作答模式：按维度正确率确定性生成，驱动差异化 BKT 初始状态 */
  accuracyByDimension: Record<string, number>;
}

const PERSONAS: PersonaSeed[] = [
  {
    loginName: 'learner-foundation',
    displayName: '基础学习者（中职机电）',
    onboarding: {
      role: 'vocational_mechatronics',
      programmingFoundation: 'zero',
      goal: '看懂数据并完成基础诊断',
      weeklyHours: 6,
      selfDescription: '中职机电专业毕业，Python 零基础，希望能看懂设备数据并完成基础诊断判断。',
    },
    accuracyByDimension: { python: 0.2, data_processing: 0.15, statistics: 0.35, time_series: 0.1, device_diagnosis: 0.4 },
  },
  {
    loginName: 'learner-advanced',
    displayName: '进阶学习者（自动化本科）',
    onboarding: {
      role: 'automation_undergraduate',
      programmingFoundation: 'intermediate',
      goal: '时序异常检测与算法比较',
      weeklyHours: 10,
      selfDescription: '自动化专业本科，会 MATLAB 和基础 Python，做过课程项目，想做时序异常检测与算法比较。',
    },
    accuracyByDimension: { python: 0.85, data_processing: 0.8, statistics: 0.75, time_series: 0.65, device_diagnosis: 0.6 },
  },
  {
    loginName: 'learner-maintenance',
    displayName: '在职运维（转岗）',
    onboarding: {
      role: 'field_maintenance',
      programmingFoundation: 'beginner',
      goal: '形成可执行的诊断报告',
      weeklyHours: 4,
      selfDescription: '企业在职设备运维转岗，每周学习时间有限，熟悉现场但对数据分析不熟，目标形成可执行的诊断报告。',
    },
    accuracyByDimension: { python: 0.4, data_processing: 0.45, statistics: 0.6, time_series: 0.5, device_diagnosis: 0.85 },
  },
];

function deterministicAnswers(accuracyByDimension: Record<string, number>) {
  // 以题目 code 的稳定哈希决定该题"分给谁"，再按维度正确率阈值判对错 —— 完全确定性、可复现
  const answers: Array<{ questionId: string; answerId: string; durationMs: number }> = [];
  for (const question of DIAGNOSTIC_QUESTIONS) {
    let hash = 0;
    for (const ch of question.code) hash = (hash * 31 + ch.charCodeAt(0)) % 997;
    const draw = hash / 997;
    const correct = draw < (accuracyByDimension[question.dimension] ?? 0.5);
    answers.push({
      questionId: question.id,
      answerId: correct ? question.answerId : question.options.find((option) => option.id !== question.answerId)!.id,
      durationMs: 8_000 + hash * 20,
    });
  }
  return answers;
}

async function main(): Promise<void> {
  const password = process.env['IM_TRAINING_AGENT_DEMO_PASSWORD'];
  if (!password) {
    console.error('[demo:seed] 缺少 IM_TRAINING_AGENT_DEMO_PASSWORD：演示密码只能由环境注入，不提交仓库（总规 §8.1）');
    process.exit(2);
  }
  if (!existsSync(path.join(process.cwd(), '.im-training-agent', 'learning.sqlite'))) {
    console.error('[demo:seed] 学习数据库不存在：请先启动 pnpm server 完成初始化');
    process.exit(2);
  }

  for (const persona of PERSONAS) {
    let learnerId: string;
    const existing = lookupByLoginName(persona.loginName);
    if (existing) {
      learnerId = existing;
      identityStore.resetPassword(learnerId, password);
      console.log(`[demo:seed] = ${persona.loginName} 已存在，密码已同步为当前 IM_TRAINING_AGENT_DEMO_PASSWORD（幂等）`);
    } else {
      const user = identityStore.register({ loginName: persona.loginName, displayName: persona.displayName, password });
      learnerId = user.id;
      console.log(`[demo:seed] ✔ ${persona.loginName} 注册成功`);
    }
    identityStore.saveOnboarding(learnerId, persona.onboarding);

    const answers = deterministicAnswers(persona.accuracyByDimension);
    const result = scoreDiagnostic(answers);
    for (const observation of result.byKnowledgePoint) {
      learningStore.applySkillObservation(learnerId, observation.knowledgePointId, observation.correct, 'diagnostic_seed');
    }
    learningStore.saveDiagnosticSession(
      learnerId, result,
      result.items.map((item) => ({ questionId: item.question.id, answerId: item.answerId, correct: item.correct, durationMs: item.durationMs })),
    );
    console.log(`[demo:seed]   诊断 ${result.correct}/${result.total} 正确，BKT 初始状态与路径先验已写入`);

    // 种子阶段直接生成差异化路径：评委登录即见完整知识树，不必现场等待建档
    const defaultRoute = getAgentExecutionSettings('learning_planning', undefined, undefined);
    let pathGraph: GeneratedPathGraph;
    try {
      pathGraph = await withTimeout(
        generateInitialPathGraph(persona.onboarding, defaultRoute.model, defaultRoute.thinking),
        90_000,
        '种子路径生成超时',
      );
    } catch (error) {
      console.warn(`[demo:seed]   路径 LLM 生成回退为内置知识树（${error instanceof Error ? error.message : String(error)}）`);
      pathGraph = fallbackPathGraph(persona.onboarding.goal);
    }
    learningStore.replacePathGraph(learnerId, pathGraph.nodes, pathGraph.edges);
    console.log(`[demo:seed]   路径已生成：${pathGraph.nodes.length} 节点 / ${pathGraph.edges.length} 边`);

    // 画像快照：LLM 总结（60 秒预算）失败则用建档+诊断数据确定性兜底，保证画像弹窗有描述与关键词
    try {
      await withTimeout(
        generateProfileSnapshot(learnerId, defaultRoute.model, defaultRoute.thinking),
        60_000,
        '种子画像生成超时',
      );
    } catch (error) {
      console.warn(`[demo:seed]   画像 LLM 生成回退为确定性画像（${error instanceof Error ? error.message : String(error)}）`);
      fallbackProfileSnapshot(learnerId, persona, result.correct, result.total);
    }
    console.log('[demo:seed]   画像描述与关键词已写入');
  }
  console.log('[demo:seed] ✔ 三个差异化账号就绪：路径已预生成，评委登录即见差异化知识树');
  process.exit(0);
}

function lookupByLoginName(loginName: string): string | null {
  // IdentityStore 未暴露按登录名查询；这里经其实例的原始连接做只读查询
  const db = (identityStore as unknown as { db: { prepare: (sql: string) => { get: (...params: unknown[]) => unknown } } }).db;
  const row = db.prepare('SELECT id FROM users WHERE login_name = ?').get(loginName) as { id?: string } | undefined;
  return row?.id ?? null;
}

main().catch((error) => {
  console.error('[demo:seed] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
