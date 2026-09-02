import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { fileURLToPath } from 'url';

import {
  LEARNING_AGENT_IDS,
  discoverProviderModels,
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
  refreshModelCapabilities,
  saveRuntimeModelConfig,
  saveRuntimeWorkbenchSettings,
  withTimeout,
} from './study-runtime.js';
import type { ProviderConfig } from '../src/models/config.js';
import type { LearningAgentId, ThinkingDepth } from './study-runtime.js';


import express from 'express';
import cors from 'cors';

const app = express();
const allowedOrigins = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);
const localWebOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;
app.use(cors((req, callback) => {
  const origin = req.header('origin');
  let sameHost = false;
  if (origin) {
    try {
      const parsed = new URL(origin);
      sameHost = (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname === req.hostname;
    } catch {
      sameHost = false;
    }
  }
  callback(null, {
    origin: !origin || allowedOrigins.has(origin) || localWebOrigin.test(origin) || sameHost,
    credentials: true,
  });
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')));

import { importMetroPt3CsvPg } from './db/pg-evidence.js';
import { fallbackPathGraph, generateInitialPathGraph } from './initial-path.js';
import { LEARNING_ASSISTANT_SYSTEM, RESOURCE_QA_SYSTEM } from './prompts.js';
import { dataSource, evidenceService, learningStore, identityStore } from './study-context.js';
import { packConversationContext } from './conversation-context.js';
import { assetAttemptStats, latestBktUpdate, listDecisions, prereqGapFor, recordLearningDecision } from './decision-service.js';
import { getLearningDatabase } from './db/client.js';
import { generateProfileSnapshot } from './profile-snapshot.js';
import { buildProfileInsights } from './profile-insights.js';
import { AVATAR_IMAGE_MAX_CHARS } from '../src/learning/identity.js';
import type { AuthenticatedLearner, OnboardingInput } from '../src/learning/identity.js';
import type { LearningPathEdgeView, LearningPathRevisionInput, LearnerProfileView } from '../src/learning/store.js';
import type { ResourceDocument } from '../src/learning/types.js';

const AUTH_COOKIE_NAME = 'im_training_agent_auth';

function resourceToMarkdown(resource: ResourceDocument): string {
  const lines = [`# ${resource.title}`, '', `- 类型：${resource.type}`, `- 难度：${Math.round(resource.difficulty * 100)}%`, '', '## 学习目标', ...resource.learningObjectives.map((item) => `- ${item}`), ''];
  for (const block of resource.blocks) {
    if (block.type === 'evidence') continue;
    if (block.type === 'heading') lines.push(`## ${String(block.content)}`, '');
    else if (block.type === 'list' || block.type === 'checklist') {
      const items = Array.isArray(block.content) ? block.content : [block.content];
      lines.push(...items.map((item) => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`), '');
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

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * PPT 资源使用可被 PowerPoint 直接打开的 HTML 演示稿导出。
 * 每个 heading 作为一页，后续正文/列表归入该页；没有 heading 时按内容块分组。
 */
function resourceToPresentation(resource: ResourceDocument): string {
  const slides: Array<{ title: string; body: string[] }> = [];
  let current: { title: string; body: string[] } | null = null;
  const start = (title: string) => {
    current = { title: title || resource.title, body: [] };
    slides.push(current);
  };
  start(resource.title);
  for (const block of resource.blocks) {
    if (block.type === 'evidence') continue;
    if (block.type === 'heading') {
      start(String(block.content));
      continue;
    }
    if (!current) start(resource.title);
    if (block.type === 'list' || block.type === 'checklist') {
      const items = Array.isArray(block.content) ? block.content : [block.content];
      current!.body.push(...items.map((item) => `• ${typeof item === 'string' ? item : JSON.stringify(item)}`));
    } else if (block.type === 'code') {
      const content = block.content as { caption?: string; code?: string };
      if (content.caption) current!.body.push(content.caption);
      if (content.code) current!.body.push(content.code);
    } else if (typeof block.content === 'string') current!.body.push(block.content);
  }
  if (slides.length > 1 && slides[0]?.body.length === 0) slides.shift();
  const htmlSlides = slides.map((slide, index) => `<section class="slide"><div class="slide-number">${index + 1} / ${slides.length}</div><h1>${escapeHtml(slide.title)}</h1><div class="body">${slide.body.map((line) => `<p>${escapeHtml(line)}</p>`).join('')}</div></section>`).join('\n');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(resource.title)}</title><style>body{margin:0;background:#e9edf2;font-family:"Microsoft YaHei","Segoe UI",sans-serif}.slide{box-sizing:border-box;width:1280px;height:720px;margin:28px auto;padding:76px 92px;background:#fff;color:#18212b;page-break-after:always;position:relative}.slide h1{font-size:42px;line-height:1.25;border-bottom:4px solid #2563eb;padding-bottom:20px;margin:0 0 34px}.body{font-size:25px;line-height:1.65}.body p{margin:0 0 16px;white-space:pre-wrap}.slide-number{position:absolute;right:92px;top:30px;color:#64748b;font-size:16px}@media print{body{background:#fff}.slide{margin:0}}</style></head><body>${htmlSlides}</body></html>`;
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

function writeSse(res: express.Response, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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
    reply: typeof source['reply'] === 'string' && source['reply'].trim() ? source['reply'].trim().slice(0, 1_200) : '我已读取你的问题，会结合当前路径和学习记录继续处理。',
    revision,
  };
}

type PublicPathAgentMessage = {
  agentId: LearningAgentId;
  agentName: string;
  producer: 'llm' | 'rule' | 'mixed';
  content: string;
};

async function respondToLearningConversation(
  learnerId: string,
  prompt: string,
  onToken?: (chunk: string) => void | Promise<void>,
  onAgentMessage?: (message: PublicPathAgentMessage) => void | Promise<void>,
): Promise<{
  assistant: LearningAssistantOutput;
  pathChanged: boolean;
  profile: LearnerProfileView;
  activities: Array<{ agentId: LearningAgentId; name: string; action: string }>;
}> {
  const graph = await learningStore.getPathGraph(learnerId);
  const onboarding = await identityStore.getOnboarding(learnerId);
  const evidencePack = await evidenceService.buildEvidencePack(prompt, { learnerId });
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  const activities: Array<{ agentId: LearningAgentId; name: string; action: string }> = [
    { agentId: 'learning_planning', name: '学习规划助手', action: '读取当前学习情况、路径节点和你的请求，定位需要调整的学习目标' },
    { agentId: 'evidence_retrieval', name: '资料检索助手', action: `从数据和资料中找到 ${evidencePack.items.length} 条依据，并保留来源位置` },
  ];
  const publishAgentMessage = async (message: PublicPathAgentMessage) => {
    await onAgentMessage?.(message);
  };
  await publishAgentMessage({
    agentId: 'learning_planning',
    agentName: '学习规划助手',
    producer: 'mixed',
    content: `本次调整聚焦于“${prompt.slice(0, 120)}${prompt.length > 120 ? '…' : ''}”。当前路径有 ${graph.nodes.length} 个节点，我会结合学习记录检查目标节点、学习状态和前置关系。`,
  });
  const evidenceTitles = evidencePack.items.slice(0, 2).map((item) => item.sourceTitle).filter(Boolean);
  await publishAgentMessage({
    agentId: 'evidence_retrieval',
    agentName: '资料检索助手',
    producer: 'mixed',
    content: evidencePack.items.length > 0
      ? `找到 ${evidencePack.items.length} 条可引用依据${evidenceTitles.length ? `，包括“${evidenceTitles.join('”和“')}”` : ''}；来源位置已保留，只把与本次调整直接相关的证据交给规划助手。`
      : '暂未找到与本次调整直接相关的可引用依据，后续会按现有路径和学习记录保守处理。',
  });
  const pathMessages = [
    { role: 'system' as const, content: LEARNING_ASSISTANT_SYSTEM },
    {
      role: 'user' as const,
      content: JSON.stringify({
        request: prompt,
        learner: onboarding,
        currentPath: graph,
        evidence: evidencePack.items.slice(0, 4).map((item) => ({ title: item.sourceTitle, locator: item.locator, content: item.content.slice(0, 700) })),
      }),
    },
  ];
  // 路径调整只需要一份面向用户的结论和小型 revision JSON；沿用全局“最大”
  // 推理输出会把简单更新拖到数十秒，且不会增加路径决策质量。
  const pathMaxTokens = Math.min(route.thinking.maxTokens, 4_500);
  let streamedReply = '';
  let tokenChain = Promise.resolve();
  const emitReplyDelta = (value: string) => {
    if (!onToken || value.length <= streamedReply.length) return;
    const delta = value.slice(streamedReply.length);
    streamedReply = value;
    // SSE 写入需要保持顺序；模型 SDK 的 onChunk 是同步回调，因此用这一条
    // promise 链把异步响应写入串行化，而不增加新的事件或状态通道。
    tokenChain = tokenChain.then(() => Promise.resolve(onToken(delta)));
  };
  const invokePathAssistant = async (model: string | undefined): Promise<LearningAssistantOutput> => {
    let modelText = '';
    const response = await withTimeout(multiModelClient.streamText({
      messages: pathMessages,
      model,
      temperature: route.thinking.temperature,
      maxTokens: pathMaxTokens,
      onChunk: (chunk) => {
        modelText += chunk;
        // 路径模型的协议是 { reply, revision }。仅从已收到的 reply 字符串中
        // 解出可见文本；revision 始终等到完整 JSON 通过解析后才会应用。
        const match = modelText.match(/"reply"\s*:\s*"((?:\\.|[^"\\])*)/s);
        if (!match) return;
        try {
          emitReplyDelta(JSON.parse(`"${match[1]}"`) as string);
        } catch {
          // chunk 可能刚好停在转义符或 Unicode 转义中，等待下一个片段即可。
        }
      },
    }), 90_000, '协同回答超时');
    const finalText = response.text.trim() || modelText.trim();
    if (!finalText) throw new Error('模型未返回可见答复');
    const parsed = parseJson<unknown>(finalText);
    if (!parsed || typeof parsed !== 'object' || typeof (parsed as Record<string, unknown>)['reply'] !== 'string') {
      throw new Error('模型返回内容不是有效的路径答复');
    }
    const output = normalizeLearningAssistantOutput(parsed);
    // 兼容不支持服务端流的模型：其最终答复仍会被真实模型调用返回，
    // 这里只补发一次完整可见结果，不伪造逐字打字效果。
    emitReplyDelta(output.reply);
    await tokenChain;
    return output;
  };
  let assistant: LearningAssistantOutput = {
    reply: '模型服务暂时不可用，当前路径没有被修改。请检查设置中的模型服务后重试。',
    revision: {},
  };
  try {
    assistant = await invokePathAssistant(route.model);
  } catch (error) {
    const fallbackModel = modelRegistry.listModels().find((candidate) => candidate.id !== route.model && Boolean(modelRegistry.getProvider(candidate.provider)?.apiKey));
    if (streamedReply) {
      console.warn(`[learning/chat] 路径答复在输出后中断：${error instanceof Error ? error.message : String(error)}`);
      assistant = { reply: streamedReply, revision: {} };
    } else if (fallbackModel) {
      console.warn(`[learning/chat] 主模型路径答复失败，尝试备用模型 ${fallbackModel.id}：${error instanceof Error ? error.message : String(error)}`);
    }
    if (!streamedReply) {
      try {
        if (!fallbackModel) throw error;
        assistant = await invokePathAssistant(fallbackModel.id);
      } catch (fallbackError) {
        console.warn(`[learning/chat] 路径答复备用模型也失败：${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`);
        assistant = { reply: '模型服务暂时不可用，当前路径没有被修改。请检查设置中的模型服务后重试。', revision: {} };
      }
    }
  }
  const result = await learningStore.applyPathRevision(learnerId, assistant.revision ?? {});
  activities.push({ agentId: 'cross_validation', name: '内容检查助手', action: result.changed ? '检查新增节点是否重复、前置关系是否成立，并写入路径' : '检查节点重复、依赖关系和现有路径后，确认无需改动' });
  await publishAgentMessage({
    agentId: 'cross_validation',
    agentName: '内容检查助手',
    producer: 'rule',
    content: result.changed
      ? `已检查节点重复、前置关系和路径连通性，并写入本次有依据的路径变更（新增 ${assistant.revision?.addNodes?.length ?? 0} 个节点，更新 ${assistant.revision?.updateNodes?.length ?? 0} 个节点）。`
      : '已检查节点重复、前置关系和路径连通性；本次没有足够依据修改路径，现有学习路径保持不变。',
  });
  const profile = result.changed
    ? await withTimeout(generateProfileSnapshot(learnerId, route.model, route.thinking), 8_000, '画像更新超时').then((snapshot) => snapshot.profile).catch(() => learningStore.getProfile(learnerId))
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
  res.json({ success: true, user: await serializeLearner(user) });
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
  res.json({ success: true, user: await serializeLearner(user) });
});

app.use('/api/learning', async (req, res, next) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
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

app.delete('/api/learning/chat', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const surface = req.query['surface'];
  if (surface !== 'path' && surface !== 'study' && surface !== 'resource_qa') {
    res.status(400).json({ success: false, error: '请选择要清除的对话记录' });
    return;
  }
  const deleted = await learningStore.clearChatMessages(learner.id, surface);
  res.json({ success: true, deleted });
});

app.post('/api/learning/chat', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ success: false, error: '请输入问题或路径调整请求' });
    return;
  }
  const wantsStream = String(req.headers.accept ?? '').includes('text/event-stream');
  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
  }
  const heartbeat = wantsStream ? setInterval(() => res.write(': ping\n\n'), 15_000) : null;
  const userMessage = await learningStore.saveChatMessage(learner.id, 'user', content);
  const pathAgentMessages: Array<Awaited<ReturnType<typeof learningStore.saveChatMessage>>> = [];
  const onToken = wantsStream ? (chunk: string) => {
    writeSse(res, 'token', { text: chunk });
  } : undefined;
  const onAgentMessage = async (message: PublicPathAgentMessage) => {
    const saved = await learningStore.saveChatMessage(learner.id, 'assistant', message.content, {
      surface: 'path',
      kind: 'agent',
      agentId: message.agentId,
      agentName: message.agentName,
      producer: message.producer,
    });
    pathAgentMessages.push(saved);
    if (wantsStream) writeSse(res, 'agent_message', { ...message, id: saved.id, createdAt: saved.createdAt });
  };
  const outcome = await respondToLearningConversation(learner.id, content, onToken, onAgentMessage);
  const assistantMessage = await learningStore.saveChatMessage(learner.id, 'assistant', outcome.assistant.reply, {
    activities: outcome.activities,
    pathChanged: outcome.pathChanged,
    agentMessagesPersisted: true,
  });
  const payload = {
    success: true,
    userMessage,
    agentMessages: pathAgentMessages,
    assistantMessage,
    pathChanged: outcome.pathChanged,
    path: await learningStore.getPathGraph(learner.id),
    profile: outcome.profile,
  };
  if (wantsStream) {
    writeSse(res, 'final', payload);
    if (heartbeat) clearInterval(heartbeat);
    res.end();
  } else {
    res.json(payload);
  }
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
      profile = (await withTimeout(
        generateProfileSnapshot(learner.id, defaultRoute.model, defaultRoute.thinking),
        8_000,
        '首次画像生成超时',
      )).profile;
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
  res.json({ success: true, profile: await learningStore.getProfile(learner.id) });
});

/** 里程碑 E：最近反馈驱动的下一步学习决策（只返回本 learner） */
app.get('/api/learning/decisions', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
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

app.patch('/api/learning/assets/:assetId', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const title = typeof req.body?.title === 'string' ? req.body.title : undefined;
  const tags = Array.isArray(req.body?.tags)
    ? req.body.tags.filter((tag: unknown): tag is string => typeof tag === 'string')
    : undefined;
  if (title === undefined && tags === undefined) {
    res.status(400).json({ success: false, error: '没有可更新的资源信息' });
    return;
  }
  const asset = await learningStore.updateAssetMetadata(learner.id, req.params.assetId, { title, tags });
  if (!asset) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  res.json({ success: true, asset });
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
  const selfAssessed = typeof req.body?.selfAssessed === 'boolean' ? req.body.selfAssessed : undefined;
  if (!questionId || !answerId) {
    res.status(400).json({ success: false, error: '请先完成作答再提交' });
    return;
  }
  try {
    const result = await learningStore.submitQuizAttempt(learner.id, req.params.assetId, questionId, answerId, durationMs, { selfAssessed });
    // 里程碑 E（G12）：作答 → BKT 前后值 → 持久化下一步学习决策
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

app.use('/api/settings', async (req, res, next) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  next();
});

app.get('/api/settings', async (_req, res) => {
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  await refreshModelCapabilities(route.model);
  res.json(getSettingsPayload());
});

/** 设置页主动探测：只有拿到模型真实响应才算“已连接”。 */
function readableModelServiceError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/超时|timeout|ETIMEDOUT/i.test(message)) return '模型服务响应超时，请稍后重试或检查服务状态';
  if (/未返回可见正文/i.test(message)) return '模型服务已响应，但没有返回可见内容；请检查模型是否支持对话接口';
  if (/fetch|ECONN|ENOTFOUND|network|socket/i.test(message)) return '无法连接模型服务，请检查接口地址和网络';
  return fallback;
}

app.post('/api/settings/model-connection', async (_req, res) => {
  const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
  if (!route.model) {
    res.status(400).json({ success: false, error: '当前没有可用的已配置模型' });
    return;
  }
  try {
    await refreshModelCapabilities(route.model, true);
    const response = await withTimeout(multiModelClient.simple({
      messages: [{ role: 'user', content: '请只回复 OK' }],
      model: route.model,
      temperature: 0,
      // 推理模型可能先输出隐藏推理；8 token 足以连通却不足以得到可见正文。
      maxTokens: 256,
    }), 20_000, '模型连接超时');
    if (!response.text.trim()) throw new Error('模型未返回可见正文');
    res.json({ success: true, provider: response.provider, model: response.model });
  } catch (error) {
    res.status(502).json({ success: false, error: readableModelServiceError(error, '模型调用失败，请检查 API Key、接口地址、模型名和账户额度') });
  }
});

/** 添加服务时从兼容接口读取真实模型目录；能力参数只在服务端使用。 */
app.post('/api/settings/provider-models', async (req, res) => {
  const body = req.body ?? {};
  const providerId = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : '';
  const submittedApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const existing = mergeModelConfig().providers.find((provider) => provider.id === providerId);
  const apiKey = submittedApiKey || existing?.apiKey || '';
  if (!/^https?:\/\//i.test(baseURL) || !apiKey) {
    res.status(400).json({ success: false, error: '请先填写接口地址和 API Key' });
    return;
  }
  try {
    const models = await discoverProviderModels({ baseURL, apiKey, headers: existing?.headers });
    res.json({
      success: true,
      models: models.map((model) => ({ id: model.id, displayName: model.displayName })),
    });
  } catch (error) {
    res.status(502).json({ success: false, error: readableModelServiceError(error, '未能读取模型目录，请检查接口地址、密钥或服务商是否支持模型列表接口') });
  }
});

app.get('/api/settings/data-privacy', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const [profile, path, assets, studyMessages, qaMessages, evidence, auditEvents] = await Promise.all([
    learningStore.getProfile(learner.id),
    learningStore.getPathGraph(learner.id),
    learningStore.listAssets(learner.id),
    learningStore.listChatMessages(learner.id, 200, 'study'),
    learningStore.listChatMessages(learner.id, 200, 'resource_qa'),
    learningStore.listEvidence(learner.id, 50),
    learningStore.listPrivacyAuditEvents(learner.id, 30),
  ]);
  res.json({
    success: true,
    source: {
      kind: dataSource,
      label: 'PostgreSQL',
      detail: '当前运行数据源：PostgreSQL 16 + pgvector',
    },
    records: {
      assets: assets.length,
      pathNodes: path.nodes.length,
      studyMessages: studyMessages.length,
      resourceQaMessages: qaMessages.length,
      evidenceItems: evidence.length,
      auditEvents: auditEvents.length,
      profileEvidence: profile.evidenceCount,
    },
    retention: {
      temporaryReference: '默认任务结束即丢弃；明确同意且智能策展通过后才沉淀',
      sharedKnowledge: '系统只读资料',
      audit: '仅保留文件名、大小、哈希与脱敏字段数量',
    },
  });
});

app.get('/api/settings/export', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const payload = {
    exportedAt: new Date().toISOString(),
    dataSource,
    learner: await identityStore.getById(learner.id),
    onboarding: await identityStore.getOnboarding(learner.id),
    profile: await learningStore.getProfile(learner.id),
    path: await learningStore.getPathGraph(learner.id),
    assets: await learningStore.listAssets(learner.id),
    conversations: {
      path: await learningStore.listChatMessages(learner.id, 200, 'path'),
      study: await learningStore.listChatMessages(learner.id, 200, 'study'),
      resourceQa: await learningStore.listChatMessages(learner.id, 200, 'resource_qa'),
    },
    evidence: await learningStore.listEvidence(learner.id, 50),
  };
  const fileName = `im-training-agent-data-${learner.loginName}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="learning-data.json"; filename*=UTF-8''${encodeURIComponent(fileName)}`);
  res.send(JSON.stringify(payload, null, 2));
});

app.post('/api/settings/providers', async (req, res) => {
  const body = req.body ?? {};
  const submittedId = typeof body.id === 'string' ? body.id.trim().toLowerCase() : '';
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const baseURL = typeof body.baseURL === 'string' ? body.baseURL.trim() : '';
  const modelId = typeof body.modelId === 'string' ? body.modelId.trim() : '';
  const modelDisplayName = typeof body.modelDisplayName === 'string' ? body.modelDisplayName.trim() : '';
  const submittedApiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';

  if (!displayName || !/^https?:\/\//i.test(baseURL) || !modelId || (submittedId && !/^[a-z0-9][a-z0-9_-]*$/.test(submittedId))) {
    res.status(400).json({ success: false, error: '请填写有效的服务名称、接口地址和模型' });
    return;
  }

  const merged = mergeModelConfig();
  const normalizedBaseURL = baseURL.replace(/\/+$/, '').toLowerCase();
  const existingByURL = merged.providers.find((provider) => provider.baseURL.replace(/\/+$/, '').toLowerCase() === normalizedBaseURL);
  let generatedId = 'model-service';
  try {
    generatedId = new URL(baseURL).hostname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || generatedId;
  } catch {
    // URL 已由上面的格式校验拦截；这里保留稳定兜底。
  }
  let id = submittedId || existingByURL?.id || generatedId;
  if (!submittedId && !existingByURL) {
    let suffix = 2;
    while (merged.providers.some((provider) => provider.id === id && provider.baseURL.replace(/\/+$/, '').toLowerCase() !== normalizedBaseURL)) {
      id = `${generatedId}-${suffix}`;
      suffix += 1;
    }
  }
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
  let discoveredModel: Awaited<ReturnType<typeof discoverProviderModels>>[number] | undefined;
  try {
    discoveredModel = (await discoverProviderModels(provider)).find((item) => item.id === modelId);
  } catch {
    // 兼容服务可以不实现 /models；保留手工模型 ID，并在真实调用时验证。
  }
  const model = {
    id: modelId,
    provider: id,
    displayName: modelDisplayName || discoveredModel?.displayName || modelId,
    complexity: 'medium' as const,
    specialties: ['chat', 'general', 'reasoning', 'analysis', 'writing'],
    ...(discoveredModel?.contextWindow ? { contextWindow: discoveredModel.contextWindow } : {}),
    ...(discoveredModel?.maxOutputTokens ? { maxOutputTokens: discoveredModel.maxOutputTokens } : {}),
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
  await refreshModelCapabilities(modelId, true);
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
  await refreshModelCapabilities(modelId, true);
  res.json(getSettingsPayload());
});

app.get('/api/settings/privacy-audit', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const limit = typeof req.query['limit'] === 'string' ? Number(req.query['limit']) : 8;
  res.json({ success: true, events: await learningStore.listPrivacyAuditEvents(learner.id, Number.isFinite(limit) ? limit : 8) });
});

app.delete('/api/settings/privacy-audit', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const deleted = await learningStore.clearPrivacyAuditEvents(learner.id);
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

/** 可选 Web 补全服务的公开状态；不暴露任何密钥，也不要求服务必须已启动。 */
app.get('/api/learning/web-search/status', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, webSearch: evidenceService.getWebSearchStatus() });
});

app.get('/api/learning/assets', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, learnerId: learner.id, assets: await learningStore.listAssets(learner.id) });
});

app.get('/api/learning/resource-qa', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, messages: await learningStore.listChatMessages(learner.id, 80, 'resource_qa') });
});

app.post('/api/learning/resource-qa', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const question = typeof req.body?.question === 'string' ? req.body.question.trim().slice(0, 3_000) : '';
  const scope = req.body?.scope === 'library' ? 'library' : 'resource';
  const requestedAssetId = typeof req.body?.assetId === 'string' ? req.body.assetId : '';
  if (!question) {
    res.status(400).json({ success: false, error: '请输入想问的问题' });
    return;
  }
  const assets = await learningStore.listAssets(learner.id);
  const selectedAsset = scope === 'resource' && requestedAssetId ? assets.find((asset) => asset.id === requestedAssetId) : undefined;
  if (requestedAssetId && !selectedAsset) {
    res.status(404).json({ success: false, error: '未找到要提问的资源' });
    return;
  }
  const userMessage = await learningStore.saveChatMessage(learner.id, 'user', question, { surface: 'resource_qa', assetId: selectedAsset?.id ?? null, scope });
  const route = getAgentExecutionSettings('domain_expert', undefined, undefined);
  const limits = await refreshModelCapabilities(route.model);
  const history = packConversationContext((await learningStore.listChatMessages(learner.id, 200, 'resource_qa')).map((item) => ({
    role: item.role,
    content: item.content,
  })), { contextWindow: limits.contextWindow, reservedTokens: limits.maxOutputTokens + 36_000 });
  // 选中资源优先、限制注入长度：保证上下文聚焦且不超窗
  const orderedAssets = selectedAsset
    ? [selectedAsset, ...assets.filter((asset) => asset.id !== selectedAsset.id)]
    : assets;
  const resourceContext = orderedAssets.slice(0, 12).map((asset) => ({
    id: asset.id,
    title: asset.title,
    type: asset.type,
    learningObjectives: asset.learningObjectives,
    content: asset.blocks.slice(0, 30)
      .map((block) => typeof block.content === 'string' ? block.content : JSON.stringify(block.content))
      .join('\n')
      .slice(0, asset.id === selectedAsset?.id ? 6_000 : 1_800),
  }));
  const wantsStream = String(req.headers.accept ?? '').includes('text/event-stream');
  if (wantsStream) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    writeSse(res, 'status', { text: scope === 'library' ? `正在检索整个资源库（${assets.length} 份资源）…` : `正在聚焦《${selectedAsset?.title ?? '当前资源'}》…` });
  }
  const heartbeat = wantsStream ? setInterval(() => res.write(': ping\n\n'), 15_000) : null;
  let answer = '';
  try {
    const response = await withTimeout(multiModelClient.chat({
      messages: [
        { role: 'system', content: RESOURCE_QA_SYSTEM },
        { role: 'user', content: JSON.stringify({ question, selectedResourceId: selectedAsset?.id ?? null, resources: resourceContext, recentConversation: history }) },
      ],
      model: route.model,
      temperature: Math.min(route.thinking.temperature, 0.35),
      maxTokens: Math.min(route.thinking.maxTokens, 4_000),
      stream: wantsStream,
      onStreamChunk: wantsStream ? (chunk) => writeSse(res, 'token', { text: chunk }) : undefined,
    }), 90_000, '资源问答超时');
    answer = response.text.trim();
  } catch {
    answer = '暂时无法连接问答服务。你的问题已保留，稍后可以继续提问。';
  }
  if (!answer) answer = '现有资源中暂时没有足够依据回答这个问题。';
  const assistantMessage = await learningStore.saveChatMessage(learner.id, 'assistant', answer, { surface: 'resource_qa', assetId: selectedAsset?.id ?? null, scope });
  const payload = { success: true, userMessage, assistantMessage, scope };
  if (wantsStream) {
    writeSse(res, 'final', payload);
    if (heartbeat) clearInterval(heartbeat);
    res.end();
  } else {
    res.json(payload);
  }
});

app.get('/api/learning/profile', async (req, res) => {
  const learner = await requireLearner(req, res);
  if (!learner) return;
  const profile = (await generateProfileSnapshot(learner.id)).profile;
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
    const result = await withTimeout((async () => {
      const snapshot = await generateProfileSnapshot(learner.id, getRequestedModel(req.body?.model), thinking);
      const insights = await buildProfileInsights(learner.id);
      return { ...snapshot, profile: { ...snapshot.profile, ...insights } };
    })(), 8_000, '学习画像生成超时');
    res.json({ success: true, ...result });
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
  const format = req.query['format'] === 'json' ? 'json' : req.query['format'] === 'txt' ? 'txt' : req.query['format'] === 'ppt' ? 'ppt' : 'md';
  const safeName = resource.title.replace(/[\\/:*?"<>|]/g, '-').slice(0, 80) || 'learning-resource';
  const fileName = `${safeName}.${format}`;
  const disposition = `attachment; filename="learning-resource.${format}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', disposition);
    res.send(JSON.stringify(resource, null, 2));
    return;
  }
  if (format === 'ppt') {
    res.setHeader('Content-Type', 'application/vnd.ms-powerpoint; charset=utf-8');
    res.setHeader('Content-Disposition', disposition);
    res.send(resourceToPresentation(resource));
    return;
  }
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Content-Disposition', disposition);
  res.send(format === 'md' ? resourceToMarkdown(resource) : resourceToMarkdown(resource).replace(/^#+\s?/gm, '').replace(/`/g, ''));
});

const PORT = process.env['PORT'] || 3001;

async function startServer(): Promise<void> {
  const metroCsvPath = path.resolve(
    process.env['IM_TRAINING_AGENT_METROPT_CSV']
      || path.join(process.cwd(), 'data', 'datasets', 'metropt', 'MetroPT3(AirCompressor).csv'),
  );
  // 空表且有官方 CSV 时流式导入；已有数据则复用 PostgreSQL 既有内容。
  const result = await importMetroPt3CsvPg(getLearningDatabase().pool, metroCsvPath);
  if (result.skipped) console.log(`MetroPT-3 时序数据已就绪：${result.imported.toLocaleString()} 行（复用 PostgreSQL 既有数据）`);
  else if (result.imported > 0) console.log(`MetroPT-3 时序数据已导入 PostgreSQL：${result.imported.toLocaleString()} 行`);
  else console.log('MetroPT-3 完整时序数据尚未安装；需要时运行 pnpm data:metropt。');
  app.listen(PORT, () => {
    console.log(`\n🚀 IM-Training-Agent 服务已启动：http://localhost:${PORT}`);
    console.log('📚 学习产品 API 已就绪');
  });
}

startServer().catch((error) => {
  console.error('IM-Training-Agent 服务启动失败：', error);
  process.exit(1);
});
