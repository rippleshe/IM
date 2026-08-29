import dotenv from 'dotenv';
dotenv.config();

import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  AUTO_ASSET_TYPES,
  LEARNING_AGENT_IDS,
  getAgentExecutionSettings,
  getRequestedModel,
  getSettingsPayload,
  getThinkingSettings,
  mergeModelConfig,
  modelRegistry,
  multiModelClient,
  parseJson,
  runtimeModelConfig,
  runtimeWorkbenchSettings,
  saveRuntimeModelConfig,
  saveRuntimeWorkbenchSettings,
  withTimeout,
} from './study-runtime.js';
import type { ProviderConfig } from '../src/models/config.js';
import type { AutoAssetType, LearningAgentId, ThinkingDepth } from './study-runtime.js';


import express from 'express';
import cors from 'cors';

const app = express();
const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
app.use(cors({
  origin(origin, callback) {
    callback(null, !origin || allowedOrigins.has(origin));
  },
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

import { importMetroPt3Csv } from '../src/learning/metropt3.js';
import { importMetroPt3CsvPg } from './db/pg-evidence.js';
import { fallbackPathGraph, generateInitialPathGraph } from './initial-path.js';
import { dataSource, evidenceService, learningStore, identityStore, datasetDb } from './study-context.js';
import { assetAttemptStats, latestBktUpdate, listDecisions, prereqGapFor, recordLearningDecision } from './decision-service.js';
import { getLearningDatabase } from './db/client.js';
import { generateProfileSnapshot } from './profile-snapshot.js';
import { buildProfileInsights } from './profile-insights.js';
import { AVATAR_IMAGE_MAX_CHARS } from '../src/learning/identity.js';
import type { AuthenticatedLearner, OnboardingInput } from '../src/learning/identity.js';
import type { LearningPathEdgeView, LearningPathRevisionInput, LearningStore } from '../src/learning/store.js';
import type { ResourceDocument } from '../src/learning/types.js';

const AUTH_COOKIE_NAME = 'im_training_agent_auth';

function resourceToMarkdown(resource: ResourceDocument): string {
  const lines = [`# ${resource.title}`, '', `- 类型：${resource.type}`, `- 难度：${Math.round(resource.difficulty * 100)}%`, '', '## 学习目标', ...resource.learningObjectives.map((item) => `- ${item}`), ''];
  for (const block of resource.blocks) {
    if (block.type === 'heading') lines.push(`## ${String(block.content)}`, '');
    else if (block.type === 'list' || block.type === 'checklist') {
      const items = Array.isArray(block.content) ? block.content : [block.content];
      lines.push(...items.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`), '');
    } else if (block.type === 'evidence') {
      const content = block.content as { label?: string; locator?: string; summary?: string };
      lines.push(`> ${content.label ?? '证据'}：${content.locator ?? ''}`, '', String(content.summary ?? ''), '');
    } else if (block.type === 'code') {
      const content = block.content as { language?: string; caption?: string; code?: string };
      lines.push(content.caption ? `**${content.caption}**` : '', `\`\`\`${content.language ?? ''}`, String(content.code ?? ''), '```', '');
    } else if (block.type === 'table') {
      const content = block.content as { caption?: string; columns?: string[]; rows?: Array<Array<string | number | null>>; sources?: string[] };
      if (Array.isArray(content.columns) && Array.isArray(content.rows)) {
        if (content.caption) lines.push(`**${content.caption}**`, '');
        lines.push(`| ${content.columns.join(' | ')} |`, `| ${content.columns.map(() => '---').join(' | ')} |`);
        content.rows.forEach((row) => lines.push(`| ${row.map((cell) => (cell === null ? '—' : String(cell))).join(' | ')} |`));
        if (content.sources?.length) lines.push('', `> 来源：${content.sources.join('；')}`);
        lines.push('');
      }
    } else {
      lines.push(typeof block.content === 'string' ? block.content : `\`\`\`json\n${JSON.stringify(block.content, null, 2)}\n\`\`\``, '');
    }
  }
  return lines.join('\n');
}

function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  const prefix = `${name}=`;
  return header.split(';').map((value) => value.trim()).find((value) => value.startsWith(prefix))?.slice(prefix.length);
}

async function getRequestLearner(req: express.Request): Promise<AuthenticatedLearner | null> {
  return await identityStore.getSessionUser(readCookie(req.headers.cookie, AUTH_COOKIE_NAME));
}

function setAuthCookie(res: express.Response, token: string, expiresAt: number): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearAuthCookie(res: express.Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    path: '/',
  });
}

async function requireLearner(req: express.Request, res: express.Response): Promise<AuthenticatedLearner | null> {
  const learner = await getRequestLearner(req);
  if (!learner) {
    res.status(401).json({ success: false, error: '请先登录' });
    return null;
  }
  return learner;
}

type GeneratedPathGraph = import('./initial-path.js').GeneratedPathGraph;

type LearningAssistantOutput = {
  reply: string;
  revision?: LearningPathRevisionInput;
};

function normalizeLearningAssistantOutput(value: unknown): LearningAssistantOutput {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawRevision = source['revision'] && typeof source['revision'] === 'object' ? source['revision'] as Record<string, unknown> : {};
  const normalizeNodes = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const node = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      knowledgePointId: String(node['knowledgePointId'] || '').trim(),
      title: String(node['title'] || '').trim(),
      description: String(node['description'] || '').trim(),
    };
  }).filter((node) => node.knowledgePointId && node.title && node.description).slice(0, 8) : [];
  const normalizeUpdates = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const node = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      knowledgePointId: String(node['knowledgePointId'] || '').trim(),
      title: typeof node['title'] === 'string' ? node['title'].trim() : undefined,
      description: typeof node['description'] === 'string' ? node['description'].trim() : undefined,
    };
  }).filter((node) => node.knowledgePointId).slice(0, 8) : [];
  const normalizeEdges = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const edge = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      fromKnowledgePointId: String(edge['fromKnowledgePointId'] || '').trim(),
      toKnowledgePointId: String(edge['toKnowledgePointId'] || '').trim(),
      relation: ['prerequisite', 'branch', 'application', 'review'].includes(String(edge['relation']))
        ? String(edge['relation']) as LearningPathEdgeView['relation'] : 'branch' as const,
    };
  }).filter((edge) => edge.fromKnowledgePointId && edge.toKnowledgePointId).slice(0, 12) : [];
  const revision: LearningPathRevisionInput = {
    addNodes: normalizeNodes(rawRevision['addNodes']),
    updateNodes: normalizeUpdates(rawRevision['updateNodes']),
    addEdges: normalizeEdges(rawRevision['addEdges']),
  };
  return {
    reply: typeof source['reply'] === 'string' && source['reply'].trim() ? source['reply'].trim().slice(0, 1_200) : '我已读取你的问题，并会依据当前路径与学习证据继续协同。',
    revision,
  };
}

async function respondToLearningConversation(learnerId: string, prompt: string): Promise<{
  assistant: LearningAssistantOutput;
  pathChanged: boolean;
  profile: ReturnType<LearningStore['getProfile']>;
  activities: Array<{ agentId: LearningAgentId; name: string; action: string }>;
}> {
  const graph = await learningStore.getPathGraph(learnerId);
  const onboarding = await identityStore.getOnboarding(learnerId);
  const evidencePack = await evidenceService.buildEvidencePack(prompt, { learnerId });
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  const activities: Array<{ agentId: LearningAgentId; name: string; action: string }> = [
    { agentId: 'learning_planning', name: '学情与路径智能体', action: '结合画像和当前路径理解你的请求' },
    { agentId: 'evidence_retrieval', name: '知识检索智能体', action: `检索到 ${evidencePack.items.length} 条可用证据` },
  ];
  let assistant: LearningAssistantOutput;
  try {
    const response = await withTimeout(multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: '你是工业设备数据诊断训练的学情与路径智能体。仅输出 JSON：reply（面向学习者的简洁中文回复）和 revision（可选）。revision 只能含 addNodes、updateNodes、addEdges。节点字段：knowledgePointId（英文短 ID）、title、description；边字段：fromKnowledgePointId、toKnowledgePointId、relation（prerequisite|branch|application|review）。当用户明确希望调整、补充、细分学习路径时才给 revision；不要修改用户的学完或掌握状态，不要删除已有节点。普通知识问答可用已提供证据回答，并明确不确定性。',
        },
        {
          role: 'user',
          content: JSON.stringify({
            request: prompt,
            learner: onboarding,
            currentPath: graph,
            evidence: evidencePack.items.slice(0, 4).map((item) => ({ title: item.sourceTitle, locator: item.locator, content: item.content.slice(0, 700) })),
          }),
        },
      ],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(route.thinking.maxTokens, 3_000),
    }), 15_000, '协同回答超时');
    assistant = normalizeLearningAssistantOutput(parseJson<unknown>(response.text));
  } catch (error) {
    assistant = { reply: '暂时无法连接协同模型；当前路径没有被修改。你可以稍后重试。', revision: {} };
  }
  const result = await learningStore.applyPathRevision(learnerId, assistant.revision ?? {});
  activities.push({ agentId: 'cross_validation', name: '交叉验证智能体', action: result.changed ? '已检查新增节点与依赖关系，并写入路径' : '已核对当前路径，无需改动' });
  const profile = result.changed
    ? await withTimeout(generateProfileSnapshot(learnerId, route.model, route.thinking), 8_000, '画像更新超时').catch(() => learningStore.getProfile(learnerId))
    : await learningStore.getProfile(learnerId);
  return { assistant, pathChanged: result.changed, profile, activities };
}
/** 身份响应统一附加 diagnosticCompleted：前端据此决定是否强制进入 12 题诊断（总规 §3、§4 产品闭环） */
async function serializeLearner(user: AuthenticatedLearner | null): Promise<AuthenticatedLearner | null> {
  if (!user) return null;
  const latest = await learningStore.getLatestDiagnosticSession(user.id);
  return { ...user, diagnosticCompleted: Boolean(latest) };
}

app.get('/api/auth/me', async (req, res) => {
  res.json({ success: true, user: await serializeLearner(await getRequestLearner(req)) });
});

app.patch('/api/auth/avatar', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const user = await identityStore.updateAvatar(learner.id, typeof req.body?.avatarKey === 'string' ? req.body.avatarKey : '');
  if (!user) {
    res.status(404).json({ success: false, error: '未找到当前用户' });
    return;
  }
  res.json({ success: true, user });
});

/** 用户自传头像：请求体 { image: dataURL | null }，服务端校验类型与大小上限。 */
app.patch('/api/auth/avatar-image', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const raw = req.body?.image;
  if (raw !== null && (typeof raw !== 'string' || !raw.startsWith('data:image/'))) {
    res.status(400).json({ success: false, error: '头像必须是图片 data URL 或 null' });
    return;
  }
  if (raw && raw.length > AVATAR_IMAGE_MAX_CHARS) {
    res.status(413).json({ success: false, error: '头像图片过大，请换一张小一些的图片' });
    return;
  }
  const user = await identityStore.updateAvatarImage(learner.id, raw === null ? null : raw);
  if (!user) {
    res.status(404).json({ success: false, error: '未找到当前用户' });
    return;
  }
  res.json({ success: true, user });
});

app.use('/api/learning', (req, res, next) => {
  if (!requireLearner(req, res)) return;
  next();
});

app.get('/api/learning/chat', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const surface = req.query['surface'] === 'study' ? 'study' : 'path';
  res.json({
    success: true,
    messages: await learningStore.listChatMessages(learner.id, 80, surface),
  });
});

app.post('/api/learning/chat', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ success: false, error: '请输入问题或路径调整请求' });
    return;
  }
  const userMessage = await learningStore.saveChatMessage(learner.id, 'user', content);
  const outcome = await respondToLearningConversation(learner.id, content);
  const assistantMessage = await learningStore.saveChatMessage(learner.id, 'assistant', outcome.assistant.reply, {
    activities: outcome.activities,
    pathChanged: outcome.pathChanged,
  });
  res.json({
    success: true,
    userMessage,
    assistantMessage,
    pathChanged: outcome.pathChanged,
    path: await learningStore.getPathGraph(learner.id),
    profile: outcome.profile,
  });
});

// ---------- StudyRun：BullMQ 动态 DAG + SSE 事件流（docs/挑战杯技术开发总规.md §4） ----------
import { createRunsRouter } from "./runs/routes.js";
app.use("/api/learning/runs", createRunsRouter(requireLearner));

// ---------- 苏格拉底启发式追问（总规 §7.4）：低置信关键知识点多轮引导 ----------
import { startGuidanceSession, answerGuidanceSession } from './guidance-service.js';

app.post('/api/learning/guidance/sessions', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const pathNodeId = typeof req.body?.pathNodeId === 'string' && req.body.pathNodeId ? req.body.pathNodeId : null;
  try {
    const session = await startGuidanceSession(learner.id, pathNodeId);
    res.status(201).json({ success: true, ...session });
  } catch (error) {
    console.error('[guidance] 创建会话失败：', error);
    res.status(500).json({ success: false, error: '追问会话创建失败，请稍后重试' });
  }
});

app.post('/api/learning/guidance/sessions/:sessionId/answers', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const answer = typeof req.body?.answer === 'string' ? req.body.answer.trim() : '';
  if (!answer) {
    res.status(400).json({ success: false, error: '请先写下你的回答' });
    return;
  }
  try {
    const outcome = await answerGuidanceSession(learner.id, req.params.sessionId, answer);
    if (!outcome) {
      res.status(404).json({ success: false, error: '未找到该追问会话' });
      return;
    }
    res.json({ success: true, ...outcome });
  } catch (error) {
    console.error('[guidance] 提交回答失败：', error);
    res.status(500).json({ success: false, error: '回答提交失败，请稍后重试' });
  }
});

// ---------- 初始诊断（总规 §7.3）：12 题固定题集，作答驱动 BKT 初始状态 ----------
import { DIAGNOSTIC_QUESTIONS, scoreDiagnostic } from '../src/learning/diagnostic.js';

app.get('/api/learning/diagnostic', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  // 答案与解析不下发，判分只发生在服务端
  res.json({
    success: true,
    questions: DIAGNOSTIC_QUESTIONS.map((question) => ({
      id: question.id, code: question.code, dimension: question.dimension,
      level: question.level, prompt: question.prompt, options: question.options,
    })),
    latest: await learningStore.getLatestDiagnosticSession(learner.id),
  });
});

app.post('/api/learning/diagnostic-attempts', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const answers = Array.isArray(req.body?.answers) ? req.body.answers : [];
  if (answers.length === 0) {
    res.status(400).json({ success: false, error: '请提交诊断作答' });
    return;
  }
  const result = scoreDiagnostic(answers as Array<{ questionId: string; answerId: string; durationMs?: number }>);
  if (result.total === 0) {
    res.status(400).json({ success: false, error: '作答未匹配任何诊断题' });
    return;
  }
  for (const observation of result.byKnowledgePoint) {
    await learningStore.applySkillObservation(learner.id, observation.knowledgePointId, observation.correct, 'diagnostic');
  }
  const sessionId = await learningStore.saveDiagnosticSession(
    learner.id,
    result,
    result.items.map((item) => ({
      questionId: item.question.id, answerId: item.answerId,
      correct: item.correct, durationMs: item.durationMs,
    })),
  );
  res.json({
    success: true,
    sessionId,
    total: result.total,
    correct: result.correct,
    byDimension: result.byDimension,
    review: result.items.map((item) => ({
      questionId: item.question.id, prompt: item.question.prompt,
      yourAnswer: item.answerId, correctAnswer: item.question.answerId,
      correct: item.correct, explanation: item.question.explanation,
    })),
    profile: await learningStore.getProfile(learner.id),
  });
});
app.post('/api/auth/register', async (req, res) => {
  try {
    const user = await identityStore.register({
      loginName: typeof req.body?.loginName === 'string' ? req.body.loginName : '',
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : '',
      password: typeof req.body?.password === 'string' ? req.body.password : '',
    });
    const session = await identityStore.createSession(user.id);
    setAuthCookie(res, session.token, session.expiresAt);
    res.status(201).json({ success: true, user: { ...user, diagnosticCompleted: false } });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const user = await identityStore.authenticate(
    typeof req.body?.loginName === 'string' ? req.body.loginName : '',
    typeof req.body?.password === 'string' ? req.body.password : '',
  );
  if (!user) {
    res.status(401).json({ success: false, error: '账号或密码不正确' });
    return;
  }
  const session = await identityStore.createSession(user.id);
  setAuthCookie(res, session.token, session.expiresAt);
  res.json({ success: true, user: await serializeLearner(user) });
});

app.post('/api/auth/logout', async (req, res) => {
  await identityStore.revokeSession(readCookie(req.headers.cookie, AUTH_COOKIE_NAME));
  clearAuthCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/onboarding', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  try {
    const input: OnboardingInput = {
      role: typeof req.body?.role === 'string' ? req.body.role : '',
      programmingFoundation: typeof req.body?.programmingFoundation === 'string' ? req.body.programmingFoundation : '',
      goal: typeof req.body?.goal === 'string' ? req.body.goal : '',
      weeklyHours: typeof req.body?.weeklyHours === 'number' ? req.body.weeklyHours : null,
      selfDescription: typeof req.body?.selfDescription === 'string' ? req.body.selfDescription : '',
    };
    const onboarding = await identityStore.saveOnboarding(learner.id, input);
    await learningStore.recordLearningEvent(learner.id, 'onboarding_completed', {
      role: onboarding.role,
      programmingFoundation: onboarding.programmingFoundation,
      goal: onboarding.goal,
      weeklyHours: onboarding.weeklyHours,
    });
    const defaultRoute = getAgentExecutionSettings('learning_planning', undefined, undefined);
    let pathGraph: GeneratedPathGraph;
    try {
      pathGraph = await withTimeout(
        generateInitialPathGraph(onboarding, defaultRoute.model, defaultRoute.thinking),
        12_000,
        '首次路径生成超时',
      );
    } catch (error) {
      console.warn('Initial path generation fell back:', error instanceof Error ? error.message : String(error));
      pathGraph = fallbackPathGraph(onboarding.goal);
    }
    const path = await learningStore.replacePathGraph(learner.id, pathGraph.nodes, pathGraph.edges);
    let profile;
    try {
      profile = await withTimeout(
        generateProfileSnapshot(learner.id, defaultRoute.model, defaultRoute.thinking),
        8_000,
        '首次画像生成超时',
      );
    } catch (error) {
      console.warn('Initial profile generation skipped:', error instanceof Error ? error.message : String(error));
      profile = await learningStore.getProfile(learner.id);
    }
    res.json({ success: true, user: { ...learner, onboardingCompleted: true, diagnosticCompleted: false }, onboarding, path, profile });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/path-graph', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, path: await learningStore.getPathGraph(learner.id) });
});

app.patch('/api/learning/path-graph/nodes/:nodeId', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const userStatus = ['not_started', 'learning', 'completed'].includes(req.body?.userStatus)
    ? req.body.userStatus as 'not_started' | 'learning' | 'completed'
    : undefined;
  const mastered = typeof req.body?.mastered === 'boolean' ? req.body.mastered : undefined;
  if (userStatus === undefined && mastered === undefined) {
    res.status(400).json({ success: false, error: '没有可更新的节点状态' });
    return;
  }
  const node = await learningStore.setPathNodeStatus(learner.id, req.params.nodeId, { userStatus, mastered });
  if (!node) {
    res.status(404).json({ success: false, error: '未找到该路径节点' });
    return;
  }
  res.json({ success: true, node });
});

app.post('/api/learning/assets/:assetId/feedback', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const isOwnAsset = (await learningStore.listAssets(learner.id)).some((asset) => asset.id === req.params.assetId);
  if (!isOwnAsset) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  await learningStore.saveAssetFeedback(learner.id, req.params.assetId, {
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : undefined,
    mastered: typeof req.body?.mastered === 'boolean' ? req.body.mastered : undefined,
    masteryLevel: ['high', 'medium', 'low'].includes(req.body?.masteryLevel) ? req.body.masteryLevel : req.body?.masteryLevel === null ? null : undefined,
    difficultyRating: typeof req.body?.difficultyRating === 'number' ? req.body.difficultyRating : undefined,
    userRating: typeof req.body?.userRating === 'number' ? req.body.userRating : undefined,
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  // 里程碑 E（G12）：掌握/难度反馈 → 持久化下一步学习决策
  const asset = await learningStore.getAsset(learner.id, req.params.assetId);
  const knowledgePointId = asset?.knowledgePointIds?.[0] ?? '';
  const masteryLevel = ['high', 'medium', 'low'].includes(req.body?.masteryLevel) ? req.body.masteryLevel as 'high' | 'medium' | 'low' : null;
  if (knowledgePointId && masteryLevel) {
    const state = await learningStore.getSkillState(learner.id, knowledgePointId);
    if (dataSource === 'postgres') {
      await recordLearningDecision({
        learnerId: learner.id,
        knowledgePointId,
        triggerType: 'asset_feedback',
        assetId: req.params.assetId,
        bktBefore: { pMastery: state?.pMastery ?? 0.15, confidence: state?.confidence ?? 0.1 },
        bktAfter: { pMastery: state?.pMastery ?? 0.15, confidence: state?.confidence ?? 0.1 },
        masteryFeedback: masteryLevel,
        difficultyRating: typeof req.body?.difficultyRating === 'number' ? req.body.difficultyRating : null,
        resourceDifficulty: asset?.difficulty ?? null,
        expectedSuccessRate: asset?.difficultyCalibration?.expectedSuccessRate ?? null,
        prereqGap: await prereqGapFor(learner.id, knowledgePointId),
      });
    }
  }
  res.json({ success: true, profile: await learningStore.getProfile(learner.id) });
});

/** 里程碑 E：最近反馈驱动的下一步学习决策（只返回本 learner） */
app.get('/api/learning/decisions', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  if (dataSource !== 'postgres') {
    res.json({ success: true, decisions: [] });
    return;
  }
  const limit = Number.parseInt(String(req.query['limit'] ?? ''), 10);
  res.json({ success: true, decisions: await listDecisions(learner.id, Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 20) });
});

app.get('/api/learning/assets/:assetId/reader', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const asset = await learningStore.getAsset(learner.id, req.params.assetId);
  if (!asset) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  res.json({
    success: true,
    asset,
    feedback: await learningStore.getAssetFeedback(learner.id, asset.id),
    pageNotes: await learningStore.listAssetPageNotes(learner.id, asset.id),
    quizAttempts: asset.type === 'tiered_quiz' ? await learningStore.listQuizAttempts(learner.id, asset.id) : [],
  });
});

app.put('/api/learning/assets/:assetId/pages/:pageKey/note', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  if (!await learningStore.getAsset(learner.id, req.params.assetId)) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const note = await learningStore.saveAssetPageNote(learner.id, req.params.assetId, req.params.pageKey, content);
  res.json({ success: true, note });
});

app.post('/api/learning/assets/:assetId/quiz-attempts', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId : '';
  const answerId = typeof req.body?.answerId === 'string' ? req.body.answerId : '';
  const durationMs = typeof req.body?.durationMs === 'number' ? req.body.durationMs : 0;
  if (!questionId || !answerId) {
    res.status(400).json({ success: false, error: '请选择一个答案后再提交' });
    return;
  }
  try {
    const result = await learningStore.submitQuizAttempt(learner.id, req.params.assetId, questionId, answerId, durationMs);
    // 里程碑 E（G12）：作答 → BKT 前后值 → 持久化下一步学习决策
    if (dataSource === 'postgres') {
      const knowledgePointId = result.question && 'knowledgePointId' in result.question
        ? String((result.question as { knowledgePointId?: unknown }).knowledgePointId ?? '')
        : '';
      const asset = await learningStore.getAsset(learner.id, req.params.assetId);
      const kp = knowledgePointId || asset?.knowledgePointIds?.[0] || 'industrial-diagnosis-foundation';
      const [bktUpdate, stats] = await Promise.all([
        latestBktUpdate(learner.id, kp),
        assetAttemptStats(learner.id, req.params.assetId),
      ]);
      const state = await learningStore.getSkillState(learner.id, kp);
      await recordLearningDecision({
        learnerId: learner.id,
        knowledgePointId: kp,
        triggerType: 'quiz_attempt',
        assetId: req.params.assetId,
        bktBefore: bktUpdate?.before ?? { pMastery: state?.pMastery ?? 0.15, confidence: state?.confidence ?? 0.1 },
        bktAfter: bktUpdate?.after ?? { pMastery: state?.pMastery ?? 0.15, confidence: state?.confidence ?? 0.1 },
        attemptCount: stats.attemptCount,
        correctCount: stats.correctCount,
        difficultyRating: null,
        resourceDifficulty: asset?.difficulty ?? null,
        expectedSuccessRate: asset?.difficultyCalibration?.expectedSuccessRate ?? null,
        prereqGap: await prereqGapFor(learner.id, kp),
      });
    }
    res.json({ success: true, ...result, profile: await learningStore.getProfile(learner.id) });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : '提交答案失败' });
  }
});

app.delete('/api/learning/assets/:assetId', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const deleted = await learningStore.deleteAsset(learner.id, req.params.assetId);
  if (!deleted) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  res.json({ success: true, profile: await learningStore.getProfile(learner.id) });
});

app.get('/api/learning/catalog', async (_req, res) => {
  try {
    res.json({ success: true, dataset: await evidenceService.getCatalog() });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.use('/api/settings', (req, res, next) => {
  if (!requireLearner(req, res)) return;
  next();
});

app.get('/api/settings', async (_req, res) => {
  res.json(getSettingsPayload());
});

app.post('/api/settings/providers', async (req, res) => {
  const body = req.body ?? {};
  const id = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : '';
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const modelDisplayName = typeof body.modelDisplayName === 'string' ? body.modelDisplayName.trim() : modelId;
  const submittedApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

  if (!/^[a-z0-9][a-z0-9_-]*$/.test(id) || !displayName || !/^https?:\/\//i.test(baseURL) || !modelId) {
    res.status(400).json({ success: false, error: '请填写有效的服务 ID、名称、接口地址和模型 ID' });
    return;
  }

  const merged = mergeModelConfig();
  const existingProvider = merged.providers.find((provider) => provider.id === id);
  const storedProvider = runtimeModelConfig.providers.find((provider) => provider.id === id);
  const apiKey = submittedApiKey || storedProvider?.apiKey || existingProvider?.apiKey || '';
  if (!apiKey) {
    res.status(400).json({ success: false, error: '新增模型服务必须填写 API Key' });
    return;
  }

  const provider: ProviderConfig = {
    id,
    displayName,
    baseURL,
    apiKey,
    isDefault: existingProvider?.isDefault,
  };
  const model = {
    id: modelId,
    provider: id,
    displayName: modelDisplayName || modelId,
    complexity: 'medium' as const,
    specialties: ['chat', 'general', 'reasoning', 'analysis', 'writing'],
  };

  const providerIndex = runtimeModelConfig.providers.findIndex((item) => item.id === id);
  if (providerIndex >= 0) runtimeModelConfig.providers[providerIndex] = provider;
  else runtimeModelConfig.providers.push(provider);
  const modelIndex = runtimeModelConfig.models.findIndex((item) => item.id === modelId);
  if (modelIndex >= 0) runtimeModelConfig.models[modelIndex] = model;
  else runtimeModelConfig.models.push(model);

  saveRuntimeModelConfig();
  modelRegistry.registerProvider(provider);
  modelRegistry.registerModel(model);
  res.json(getSettingsPayload());
});

app.post('/api/settings/agent-routing', async (req, res) => {
  const submitted = req.body?.agentRouting;
  if (!submitted || typeof submitted !== 'object') {
    res.status(400).json({ success: false, error: '协同编排格式无效' });
    return;
  }
  const config = mergeModelConfig();
  const providerMap = new Map(config.providers.map((provider) => [provider.id, provider]));
  for (const agentId of LEARNING_AGENT_IDS) {
    const route = submitted[agentId];
    const modelId = typeof route?.modelId === 'string' ? route.modelId.trim() : '';
    const thinkingDepth = route?.thinkingDepth;
    if (!['inherit', 'low', 'medium', 'high', 'max'].includes(thinkingDepth)) {
      res.status(400).json({ success: false, error: `${agentId} 的思考深度无效` });
      return;
    }
    if (modelId) {
      const model = config.models.find((item) => item.id === modelId);
      if (!model || !providerMap.get(model.provider)?.apiKey) {
        res.status(400).json({ success: false, error: `${agentId} 选择的模型当前不可用` });
        return;
      }
    }
    runtimeWorkbenchSettings.agentRouting[agentId] = { modelId, thinkingDepth };
  }
  saveRuntimeWorkbenchSettings();
  res.json(getSettingsPayload());
});

app.post('/api/settings/default-execution', async (req, res) => {
  const modelId = typeof req.body?.modelId === 'string' ? req.body.modelId.trim() : '';
  const thinkingDepth = req.body?.thinkingDepth;
  if (!['low', 'medium', 'high', 'max'].includes(thinkingDepth)) {
    res.status(400).json({ success: false, error: '默认思考深度无效' });
    return;
  }
  const config = mergeModelConfig();
  const providerMap = new Map(config.providers.map((provider) => [provider.id, provider]));
  const model = config.models.find((item) => item.id === modelId);
  if (!model || !providerMap.get(model.provider)?.apiKey) {
    res.status(400).json({ success: false, error: '默认模型当前不可用' });
    return;
  }
  runtimeWorkbenchSettings.defaultModelId = modelId;
  runtimeWorkbenchSettings.defaultThinkingDepth = thinkingDepth as ThinkingDepth;
  saveRuntimeWorkbenchSettings();
  res.json(getSettingsPayload());
});

app.post('/api/settings/asset-policy', async (req, res) => {
  const submitted = req.body?.autoAssetTypes;
  if (!Array.isArray(submitted)) {
    res.status(400).json({ success: false, error: '学习资产设置无效' });
    return;
  }
  const selected = submitted.filter((type): type is AutoAssetType => AUTO_ASSET_TYPES.includes(type as AutoAssetType));
  if (selected.length === 0) {
    res.status(400).json({ success: false, error: '请至少保留一类自动生成的学习资产' });
    return;
  }
  runtimeWorkbenchSettings.autoAssetTypes = Array.from(new Set(selected));
  saveRuntimeWorkbenchSettings();
  res.json(getSettingsPayload());
});

app.get('/api/settings/privacy-audit', async (req, res) => {
  const limit = typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : 8;
  res.json({ success: true, events: await learningStore.listPrivacyAuditEvents(Number.isFinite(limit) ? limit : 8) });
});

app.delete('/api/settings/privacy-audit', async (_req, res) => {
  const deleted = await learningStore.clearPrivacyAuditEvents();
  res.json({ success: true, deleted });
});

app.post('/api/learning/evidence', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }
  try {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    res.json({ success: true, evidencePack: await evidenceService.buildEvidencePack(query, { learnerId: learner.id, sessionId }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/assets', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, learnerId: learner.id, assets: await learningStore.listAssets(learner.id) });
});

app.get('/api/learning/profile', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const profile = await learningStore.getProfile(learner.id);
  const insights = await buildProfileInsights(learner.id);
  res.json({ success: true, profile: { ...profile, ...insights } });
});

/** BKT 更新审计（总规 §7.1）：每次状态变更的前后值与触发事件，可回溯 */
app.get('/api/learning/bkt-updates', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const limit = Math.max(1, Math.min(Number(req.query['limit']) || 30, 100));
  const result = await getLearningDatabase().pool.query(
    `SELECT id, knowledge_point_id AS "knowledgePointId", trigger_type AS "triggerType",
       before, after, created_at AS "createdAt"
     FROM bkt_updates WHERE learner_id = $1 ORDER BY created_at DESC LIMIT $2`, [learner.id, limit],
  );
  res.json({ success: true, updates: result.rows });
});

app.post('/api/learning/profile/regenerate', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  try {
    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const profile = await withTimeout(generateProfileSnapshot(learner.id, getRequestedModel(req.body?.model), thinking), 8_000, '学习画像生成超时');
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/evidence', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const limit = typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : 20;
  res.json({ success: true, evidence: await learningStore.listEvidence(learner.id, Number.isFinite(limit) ? limit : 20) });
});

app.get('/api/learning/assets/:assetId/export', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const resource = await learningStore.getAsset(learner.id, req.params.assetId);
  if (!resource) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  const format = req.query['format'] === 'json' ? 'json' : req.query['format'] === 'txt' ? 'txt' : 'md';
  const safeName = resource.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'learning-resource';
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.json"`);
    res.send(JSON.stringify(resource, null, 2));
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${format}"`);
  res.send(format === 'md' ? resourceToMarkdown(resource) : resourceToMarkdown(resource).replace(/^#+\s?/gm, '').replace(/`/g, ''));
});

const PORT = process.env['PORT'] || 3001;

async function startServer(): Promise<void> {
  const metroCsvPath = path.resolve(
    process.env['IM_TRAINING_AGENT_METROPT_CSV']
      || path.join(process.cwd(), 'data', 'datasets', 'metropt', 'MetroPT3(AirCompressor).csv'),
  );
  if (dataSource === 'postgres') {
    // PG 数据源：空表且有官方 CSV 时流式导入；已有数据（迁移或历史导入）则跳过
    const result = await importMetroPt3CsvPg(getLearningDatabase().pool, metroCsvPath);
    if (result.skipped) console.log(`MetroPT-3 时序数据已就绪：${result.imported.toLocaleString()} 行（复用 PostgreSQL 既有数据）`);
    else if (result.imported > 0) console.log(`MetroPT-3 时序数据已导入 PostgreSQL：${result.imported.toLocaleString()} 行`);
    else console.log('MetroPT-3 完整时序数据尚未安装；需要时运行 pnpm data:metropt。');
  } else if (datasetDb && existsSync(metroCsvPath)) {
    const result = await importMetroPt3Csv(datasetDb, metroCsvPath);
    console.log(`MetroPT-3 时序数据已就绪：${result.imported.toLocaleString()} 行${result.skipped ? '（复用已有数据库）' : ''}`);
  } else {
    console.log('MetroPT-3 完整时序数据尚未安装；需要时运行 pnpm data:metropt。');
  }
  app.listen(PORT, () => {
    console.log(`\n🚀 IM-Training-Agent 服务已启动：http://localhost:${PORT}`);
    console.log('📚 学习产品 API 已就绪');
  });
}

startServer().catch((error) => {
  console.error('IM-Training-Agent 服务启动失败：', error);
  process.exit(1);
});
