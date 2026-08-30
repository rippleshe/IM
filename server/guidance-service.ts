/**
 * 苏格拉底追问会话编排（docs/挑战杯技术开发总规.md §7.4、sol 的第一份计划 §3 接口契约）
 * - 会话与轮次落 guidance_sessions / guidance_turns（PostgreSQL），无内存态、可恢复；
 * - 提问与评价由 learning_planning 角色的 LLM 生成，失败回退确定性模板（src/learning/socratic.ts）；
 * - 每轮回答驱动 BKT 更新（applySkillObservation），终止后输出“生成资源 / 更新路径建议”决策。
 */
import { randomUUID } from 'node:crypto';
import { eq, and } from 'drizzle-orm';

import { learningStore } from './study-context.js';
import { getLearningDatabase } from './db/client.js';
import { guidanceSessions, guidanceTurns } from './db/schema.js';
import { getAgentExecutionSettings, multiModelClient, parseJson, withTimeout } from './study-runtime.js';
import {
  fallbackEvaluation,
  fallbackQuestion,
  selectSocraticTarget,
  shouldContinueSocratic,
  SOCRATIC_MAX_ROUNDS,
  type SocraticEvaluation,
} from '../src/learning/socratic.js';
import { normalizeKnowledgePointId, type LearningPathGraphView } from '../src/learning/store.js';
import { SOCRATIC_EVALUATION_SYSTEM, SOCRATIC_QUESTION_SYSTEM } from './prompts.js';

const KP_LABEL_FALLBACK = '该知识点';

export interface GuidanceQuestionView {
  round: number;
  question: string;
}

export interface GuidanceSessionView {
  sessionId: string;
  knowledgePointId: string;
  label: string;
  status: 'active' | 'finished';
  roundCount: number;
  maxRounds: number;
  question: GuidanceQuestionView | null;
  decision: Record<string, unknown> | null;
}

export interface GuidanceAnswerOutcome {
  sessionId: string;
  status: 'active' | 'finished';
  round: number;
  evaluation: SocraticEvaluation;
  bkt: { before: { pMastery: number; confidence: number }; after: { pMastery: number; confidence: number } };
  next: { type: 'question'; question: GuidanceQuestionView } | { type: 'finished'; decision: Record<string, unknown> };
}

function labelOf(knowledgePointId: string): string {
  const labels: Record<string, string> = {
    'python-basics': 'Python 基础',
    'python-control': 'Python 控制流',
    'python-data-structures': 'Python 数据结构',
    'pandas-reading': 'pandas 读数',
    'pandas-filter': 'pandas 筛选',
    'data-cleaning': '数据清洗',
    'statistics-basics': '统计基础',
    'time-series-basics': '时序分析基础',
    'evidence-boundary': '证据边界',
    'anomaly-threshold': '阈值与异常判断',
    'ai4i-overview': 'AI4I 数据集',
    'ai4i-failure-modes': '故障机理',
    'industrial-diagnosis-foundation': '设备诊断入门',
  };
  return labels[knowledgePointId] ?? knowledgePointId;
}

/** 关键度：目标节点 1，前置闭包 0.7，同一技能家族 0.4 */
function criticalityOf(graph: LearningPathGraphView, nodeId: string | null, knowledgePointId: string): number {
  if (!nodeId) return 0.4;
  const node = graph.nodes.find((item) => item.id === nodeId);
  if (!node) return 0.4;
  if (node.knowledgePointId === knowledgePointId) return 1;
  const inPrereqClosure = graph.edges.some((edge) => edge.toNodeId === nodeId
    && graph.nodes.find((item) => item.id === edge.fromNodeId)?.knowledgePointId === knowledgePointId);
  return inPrereqClosure ? 0.7 : 0.4;
}

async function askQuestion(
  knowledgePointId: string,
  round: number,
  evidenceDigest: string,
  history: Array<{ question: string; evaluation: string }>,
): Promise<string> {
  const label = labelOf(knowledgePointId);
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  try {
    const response = await withTimeout(multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: SOCRATIC_QUESTION_SYSTEM,
        },
        {
          role: 'user',
          content: JSON.stringify({
            knowledgePoint: label,
            round,
            maxRounds: SOCRATIC_MAX_ROUNDS,
            evidence: evidenceDigest.slice(0, 700),
            history,
          }),
        },
      ],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(route.thinking.maxTokens, 2_400),
    }), 60_000, '追问生成超时');
    const parsed = parseJson<{ question?: unknown }>(response.text) ?? {};
    if (typeof parsed.question === 'string' && parsed.question.trim()) return parsed.question.trim().slice(0, 160);
    console.warn('[guidance] 追问生成返回无法解析：', response.text.slice(0, 160));
  } catch (error) {
    console.warn('[guidance] 追问生成失败，回退模板：', error instanceof Error ? error.message : String(error));
  }
  return fallbackQuestion(label, round);
}

async function evaluateAnswer(
  knowledgePointId: string,
  question: string,
  answer: string,
): Promise<SocraticEvaluation> {
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  try {
    const response = await withTimeout(multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: SOCRATIC_EVALUATION_SYSTEM,
        },
        { role: 'user', content: JSON.stringify({ question, answer: answer.slice(0, 2000), knowledgePoint: labelOf(knowledgePointId) }) },
      ],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(route.thinking.maxTokens, 2_400),
    }), 60_000, '回答评价超时');
    const parsed = parseJson<{ verdict?: unknown; comment?: unknown }>(response.text) ?? {};
    const verdict = ['correct', 'partial', 'incorrect'].includes(String(parsed.verdict))
      ? String(parsed.verdict) as SocraticEvaluation['verdict']
      : null;
    if (verdict) {
      return { verdict, comment: typeof parsed.comment === 'string' && parsed.comment.trim() ? parsed.comment.trim().slice(0, 160) : '已记录本轮回答。' };
    }
  } catch { /* 回退确定性评价 */ }
  return fallbackEvaluation(answer);
}

/** 创建会话：按路径节点与 BKT 置信度选题，返回首题（总规 §3 接口契约） */
export async function startGuidanceSession(learnerId: string, pathNodeId: string | null): Promise<GuidanceSessionView> {
  const graph = await learningStore.getPathGraph(learnerId);
  const skills = await learningStore.getSkillStates(learnerId);
  const candidates = skills.map((state) => ({
    knowledgePointId: state.knowledgePointId,
    criticality: criticalityOf(graph, pathNodeId, state.knowledgePointId),
    confidence: state.confidence,
    pMastery: state.pMastery,
  }));
  // 无任何技能状态时以目标节点自身知识点兜底
  const target = selectSocraticTarget(candidates) ?? (() => {
    const node = graph.nodes.find((item) => item.id === pathNodeId) ?? graph.nodes[0];
    const knowledgePointId = normalizeKnowledgePointId(node?.knowledgePointId ?? '') || 'industrial-diagnosis-foundation';
    return { knowledgePointId, criticality: 1, confidence: 0.1, pMastery: 0.15, priority: 0.9 };
  })();

  const sessionId = `guidance-${randomUUID()}`;
  const now = Date.now();
  await getLearningDatabase().db.insert(guidanceSessions).values({
    id: sessionId,
    learnerId,
    pathNodeId: pathNodeId ?? null,
    knowledgePointId: target.knowledgePointId,
    status: 'active',
    roundCount: 0,
    createdAt: now,
  });

  const pack = await learningStore.listEvidence(learnerId, 4);
  const evidenceDigest = pack.map((item) => `${item.sourceTitle}：${item.content.slice(0, 160)}`).join('\n');
  const question = await askQuestion(target.knowledgePointId, 1, evidenceDigest, []);
  // 首轮问题落库：answerGuidanceSession 评价需要问题上下文
  await getLearningDatabase().db.update(guidanceSessions)
    .set({ currentQuestion: question })
    .where(eq(guidanceSessions.id, sessionId));

  return {
    sessionId,
    knowledgePointId: target.knowledgePointId,
    label: labelOf(target.knowledgePointId) || KP_LABEL_FALLBACK,
    status: 'active',
    roundCount: 0,
    maxRounds: SOCRATIC_MAX_ROUNDS,
    question: { round: 1, question },
    decision: null,
  };
}

/** 提交回答：公开评价 → BKT 更新 → 下一题或终态决策 */
export async function answerGuidanceSession(learnerId: string, sessionId: string, answer: string): Promise<GuidanceAnswerOutcome | null> {
  const database = getLearningDatabase();
  const sessionRows = await database.db.select().from(guidanceSessions)
    .where(and(eq(guidanceSessions.id, sessionId), eq(guidanceSessions.learnerId, learnerId)))
    .limit(1);
  const sessionRow = sessionRows[0];
  if (!sessionRow) return null;
  if (sessionRow.status === 'finished') {
    return {
      sessionId,
      status: 'finished',
      round: sessionRow.roundCount,
      evaluation: { verdict: 'partial', comment: '会话已结束。' },
      bkt: {
        before: { pMastery: 0, confidence: 0 },
        after: { pMastery: 0, confidence: 0 },
      },
      next: { type: 'finished', decision: (sessionRow.decision as Record<string, unknown>) ?? {} },
    };
  }

  const round = sessionRow.roundCount + 1;
  const previousTurns = await database.db.select().from(guidanceTurns)
    .where(eq(guidanceTurns.sessionId, sessionId));
  const lastTurn = previousTurns.sort((a, b) => a.round - b.round).at(-1);
  // 当前问题优先取会话持久化的 currentQuestion（首轮评价必须有上下文）
  const questionText = sessionRow.currentQuestion ?? lastTurn?.question ?? '';

  const evaluation = await evaluateAnswer(sessionRow.knowledgePointId, questionText, answer);
  const bktBefore = await learningStore.getSkillState(learnerId, sessionRow.knowledgePointId);
  const bktAfter = await learningStore.applySkillObservation(
    learnerId, sessionRow.knowledgePointId, evaluation.verdict === 'correct', `socratic_round_${round}`,
  );
  await database.db.insert(guidanceTurns).values({
    id: `guidance-turn-${randomUUID()}`,
    sessionId,
    learnerId,
    round,
    question: questionText,
    answer: answer.trim().slice(0, 2000),
    evaluation: JSON.stringify(evaluation),
    correct: evaluation.verdict === 'correct',
    bktBefore: bktBefore ?? { pMastery: 0, confidence: 0 },
    bktAfter,
    createdAt: Date.now(),
  });

  const continueSession = shouldContinueSocratic(round, bktAfter.confidence);
  if (continueSession) {
    const history = previousTurns.map((turn) => ({
      question: turn.question,
      evaluation: turn.evaluation,
    }));
    // 后续轮同样携带证据摘要，保证问题中的事实表述有依据
    const evidencePack = await learningStore.listEvidence(learnerId, 4);
    const evidenceDigest = evidencePack.map((item) => `${item.sourceTitle}：${item.content.slice(0, 160)}`).join('\n');
    const nextQuestion = await askQuestion(sessionRow.knowledgePointId, round + 1, evidenceDigest, history);
    await database.db.update(guidanceSessions)
      .set({ roundCount: round, currentQuestion: nextQuestion })
      .where(eq(guidanceSessions.id, sessionId));
    return {
      sessionId,
      status: 'active',
      round,
      evaluation,
      bkt: {
        before: { pMastery: Number((bktBefore?.pMastery ?? 0).toFixed(3)), confidence: Number((bktBefore?.confidence ?? 0).toFixed(3)) },
        after: { pMastery: Number(bktAfter.pMastery.toFixed(3)), confidence: Number(bktAfter.confidence.toFixed(3)) },
      },
      next: { type: 'question', question: { round: round + 1, question: nextQuestion } },
    };
  }

  // 终态：达到置信度 → 建议生成进阶资源；轮次用尽 → 建议补强资源
  const confident = bktAfter.confidence >= 0.8;
  const decision = {
    type: confident ? 'generate_resource' : 'reinforce_resource',
    knowledgePointId: sessionRow.knowledgePointId,
    label: labelOf(sessionRow.knowledgePointId),
    reason: confident
      ? `经 ${round} 轮追问，置信度达到 ${(bktAfter.confidence * 100).toFixed(0)}%，可以进入资源学习或进阶挑战`
      : `已完成 ${round} 轮追问，置信度 ${(bktAfter.confidence * 100).toFixed(0)}%，建议生成补强讲义或分层习题`,
    suggestedResourceType: confident ? 'challenge_task' : 'lecture',
    rounds: round,
  };
  await database.db.update(guidanceSessions)
    .set({ roundCount: round, status: 'finished', decision, finishedAt: Date.now() })
    .where(eq(guidanceSessions.id, sessionId));
  await learningStore.recordLearningEvent(learnerId, 'socratic_session_finished', {
    sessionId, knowledgePointId: sessionRow.knowledgePointId, rounds: round, confident,
  });
  return {
    sessionId,
    status: 'finished',
    round,
    evaluation,
    bkt: {
      before: { pMastery: Number((bktBefore?.pMastery ?? 0).toFixed(3)), confidence: Number((bktBefore?.confidence ?? 0).toFixed(3)) },
      after: { pMastery: Number(bktAfter.pMastery.toFixed(3)), confidence: Number(bktAfter.confidence.toFixed(3)) },
    },
    next: { type: 'finished', decision },
  };
}
