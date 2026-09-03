/**
 * 苏格拉底式引导对话服务（基于 src/learning/socratic.ts）
 * 用于习题答错后的启发式追问，不直接给答案，而是引导学习者自主发现
 */
import { randomUUID } from 'node:crypto';
import {
  fallbackEvaluation,
  fallbackQuestion,
  selectSocraticTarget,
  shouldContinueSocratic,
  type SocraticEvaluation,
  type SocraticTargetInput
} from '../src/learning/socratic.js';
import { multiModelClient, getAgentExecutionSettings, withTimeout, refreshModelCapabilities } from './study-runtime.js';
import type { EvidencePack } from '../src/learning/types.js';

export interface SocraticSession {
  id: string;
  learnerId: string;
  targetKnowledgePointId: string;
  targetLabel: string;
  round: number;
  confidence: number;
  history: Array<{
    round: number;
    question: string;
    answer: string;
    evaluation: SocraticEvaluation;
    timestamp: number;
  }>;
  createdAt: number;
  updatedAt: number;
}

const activeSessions = new Map<string, SocraticSession>();

/**
 * 基于当前学习路径选择最需要追问的知识点
 */
export function selectSocraticTargetFromPath(
  pathNodes: Array<{ id: string; knowledgePointId: string; title: string; bktParams?: { pMastery: number; confidence: number }; recommendation?: string; userStatus?: string }>
): { knowledgePointId: string; label: string; confidence: number } | null {
  const candidates: SocraticTargetInput[] = pathNodes
    .filter((node) => node.userStatus !== 'completed')
    .map((node) => ({
      knowledgePointId: node.knowledgePointId,
      criticality: node.recommendation === 'critical' ? 1.0 : node.recommendation === 'important' ? 0.7 : 0.4,
      confidence: node.bktParams?.confidence ?? 0.5,
      pMastery: node.bktParams?.pMastery ?? 0.5,
    }));

  const target = selectSocraticTarget(candidates);
  if (!target) return null;

  const node = pathNodes.find((n) => n.knowledgePointId === target.knowledgePointId);
  return node ? { knowledgePointId: target.knowledgePointId, label: node.title, confidence: target.confidence } : null;
}

/**
 * 开始新的苏格拉底对话会话
 */
export function startSocraticSession(
  learnerId: string,
  knowledgePointId: string,
  label: string,
  initialConfidence: number
): SocraticSession {
  const session: SocraticSession = {
    id: randomUUID(),
    learnerId,
    targetKnowledgePointId: knowledgePointId,
    targetLabel: label,
    round: 0,
    confidence: initialConfidence,
    history: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  activeSessions.set(session.id, session);
  return session;
}

/**
 * 获取活跃会话
 */
export function getSocraticSession(sessionId: string): SocraticSession | null {
  return activeSessions.get(sessionId) ?? null;
}

/**
 * 生成下一轮追问（优先使用LLM，降级到规则模板）
 */
export async function generateSocraticQuestion(
  session: SocraticSession,
  evidencePack?: EvidencePack
): Promise<string> {
  const nextRound = session.round + 1;

  // 构建历史对话上下文
  const historyContext = session.history.length > 0
    ? session.history.map((turn) => `第${turn.round}轮\n问：${turn.question}\n答：${turn.answer}\n评价：${turn.evaluation.comment}`).join('\n\n')
    : '这是第一轮追问。';

  // 构建证据上下文
  const evidenceContext = evidencePack && evidencePack.items.length > 0
    ? `可参考的证据：\n${evidencePack.items.slice(0, 3).map((item, i) => `${i + 1}. ${item.content.slice(0, 200)}`).join('\n')}`
    : '';

  const system = `你是一位苏格拉底式导师，擅长通过追问引导学习者自主发现答案，而不是直接告诉答案。

当前目标知识点：${session.targetLabel}
当前轮次：第${nextRound}轮 / 最多5轮
学习者当前理解置信度：${Math.round(session.confidence * 100)}%

追问原则：
1. 不要直接给答案，而是引导思考
2. 问题要具体、可操作，避免抽象的"你觉得呢？"
3. 逐步缩小范围：从大方向到具体细节
4. 每轮只问一个问题，不要堆砌多个问题
5. 如果学习者卡住，给一个小提示但不揭晓答案

历史对话：
${historyContext}

${evidenceContext}

请生成下一轮追问，格式：纯文本问题，不要前缀或序号。`;

  try {
    const route = getAgentExecutionSettings('domain_expert', undefined, undefined);
    await refreshModelCapabilities(route.model);
    const response = await withTimeout(
      multiModelClient.simple({
        messages: [{ role: 'system', content: system }, { role: 'user', content: '请生成下一轮追问。' }],
        model: route.model,
        temperature: 0.8,
        maxTokens: 200,
      }),
      15_000,
      '追问生成超时'
    );
    return response.text.trim();
  } catch (error) {
    console.warn('苏格拉底追问LLM生成失败，降级到模板:', error instanceof Error ? error.message : String(error));
    return fallbackQuestion(session.targetLabel, nextRound);
  }
}

/**
 * 评估学习者的回答（优先使用LLM，降级到规则判断）
 */
export async function evaluateSocraticAnswer(
  session: SocraticSession,
  question: string,
  answer: string,
  evidencePack?: EvidencePack
): Promise<SocraticEvaluation> {
  if (!answer.trim()) {
    return { verdict: 'incorrect', comment: '还没有作答内容，请先思考后作答。' };
  }

  const system = `你是一位苏格拉底式导师的评估助手，评判学习者的回答是否抓住了关键点。

目标知识点：${session.targetLabel}
本轮问题：${question}
学习者回答：${answer}

评估标准：
- correct：回答准确且完整，已经理解核心概念
- partial：回答有一定思考，但还缺少关键要点
- incorrect：回答偏离主题或没有抓住重点

请输出JSON格式：
{
  "verdict": "correct" | "partial" | "incorrect",
  "comment": "简短评价，1-2句话，鼓励为主"
}`;

  try {
    const route = getAgentExecutionSettings('domain_expert', undefined, undefined);
    await refreshModelCapabilities(route.model);
    const response = await withTimeout(
      multiModelClient.simple({
        messages: [{ role: 'system', content: system }, { role: 'user', content: '请评估这个回答。' }],
        model: route.model,
        temperature: 0.3,
        maxTokens: 150,
      }),
      15_000,
      '回答评估超时'
    );
    const parsed = JSON.parse(response.text.trim()) as { verdict?: string; comment?: string };
    if (['correct', 'partial', 'incorrect'].includes(parsed.verdict ?? '') && typeof parsed.comment === 'string') {
      return { verdict: parsed.verdict as SocraticEvaluation['verdict'], comment: parsed.comment };
    }
    throw new Error('评估结果格式无效');
  } catch (error) {
    console.warn('苏格拉底评估LLM失败，降级到规则:', error instanceof Error ? error.message : String(error));
    return fallbackEvaluation(answer);
  }
}

/**
 * 推进苏格拉底对话到下一轮
 */
export function advanceSocraticSession(
  session: SocraticSession,
  question: string,
  answer: string,
  evaluation: SocraticEvaluation
): { shouldContinue: boolean; newConfidence: number } {
  session.round += 1;
  session.history.push({
    round: session.round,
    question,
    answer,
    evaluation,
    timestamp: Date.now(),
  });

  // 根据评估结果调整置信度
  const confidenceDelta = evaluation.verdict === 'correct' ? 0.15 : evaluation.verdict === 'partial' ? 0.08 : -0.05;
  session.confidence = Math.max(0, Math.min(1, session.confidence + confidenceDelta));
  session.updatedAt = Date.now();

  activeSessions.set(session.id, session);

  const shouldContinue = shouldContinueSocratic(session.round, session.confidence);
  return { shouldContinue, newConfidence: session.confidence };
}

/**
 * 结束苏格拉底会话
 */
export function endSocraticSession(sessionId: string): SocraticSession | null {
  const session = activeSessions.get(sessionId);
  if (session) {
    activeSessions.delete(sessionId);
  }
  return session ?? null;
}

/**
 * 清理超过1小时的过期会话
 */
export function cleanupExpiredSessions(): number {
  const now = Date.now();
  const expired: string[] = [];
  for (const [id, session] of activeSessions.entries()) {
    if (now - session.updatedAt > 3_600_000) {
      expired.push(id);
    }
  }
  expired.forEach((id) => activeSessions.delete(id));
  return expired.length;
}

// 每小时清理一次过期会话
setInterval(cleanupExpiredSessions, 3_600_000);
