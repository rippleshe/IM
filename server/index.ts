import dotenv from 'dotenv';
dotenv.config();

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
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
  resolveResourcePublication,
  runtimeWorkbenchSettings,
  saveRuntimeModelConfig,
  saveRuntimeWorkbenchSettings,
  withTimeout,
} from './study-runtime.js';
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
import { evidenceService, learningStore, identityStore, datasetDb } from './study-context.js';
import type { AuthenticatedLearner, OnboardingInput } from '../src/learning/identity.js';
import type { LearningPathEdgeView, LearningPathNodeView, LearningPathRevisionInput } from '../src/learning/store.js';
import { buildLlmResourceDocument, buildResourceDraft } from '../src/learning/resource-builder.js';
import { auditResource } from '../src/learning/audit.js';
import type { LearningResourceType, ResourceDocument } from '../src/learning/types.js';

const AUTH_COOKIE_NAME = 'im_training_agent_auth';
const LEARNING_RESOURCE_TYPES: LearningResourceType[] = ['lecture', 'tiered_quiz', 'practice_guide', 'concept_map', 'review_cards', 'challenge_task'];

function isLearningResourceType(value: unknown): value is LearningResourceType {
  return typeof value === 'string' && LEARNING_RESOURCE_TYPES.includes(value as LearningResourceType);
}

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

function getRequestLearner(req: express.Request): AuthenticatedLearner | null {
  return identityStore.getSessionUser(readCookie(req.headers.cookie, AUTH_COOKIE_NAME));
}

function setAuthCookie(res: express.Response, token: string, expiresAt: number): void {
  res.cookie(AUTH_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires: new Date(expiresAt),
    path: '/',
  });
}

function clearAuthCookie(res: express.Response): void {
  res.clearCookie(AUTH_COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}

function requireLearner(req: express.Request, res: express.Response): AuthenticatedLearner | null {
  const learner = getRequestLearner(req);
  if (!learner) {
    res.status(401).json({ success: false, error: '请先登录' });
    return null;
  }
  return learner;
}

type GeneratedPathItem = {
  knowledgePointId: string;
  title: string;
  status: 'active' | 'pending' | 'completed';
  priority: number;
  reason: string;
  completionCriteria: string;
  recommendedResourceType: string;
};

type GeneratedPathGraph = {
  nodes: Array<{ knowledgePointId: string; title: string; description: string; sortOrder: number }>;
  edges: Array<{ fromKnowledgePointId: string; toKnowledgePointId: string; relation: LearningPathEdgeView['relation'] }>;
};


function fallbackPath(goal: string): GeneratedPathItem[] {
  const shortGoal = goal.replace(/\s+/g, ' ').trim().slice(0, 48) || '当前学习目标';
  return [
    { knowledgePointId: 'goal-understanding', title: `明确“${shortGoal}”的核心概念`, status: 'active', priority: 1, reason: '先建立概念边界和可验证目标', completionCriteria: '能用自己的话解释核心概念，并指出一个例子', recommendedResourceType: 'lecture' },
    { knowledgePointId: 'goal-evidence', title: '用数据或实例验证理解', status: 'pending', priority: 2, reason: '把概念转成可观察、可检查的证据', completionCriteria: '完成一组基础练习并说明判断依据', recommendedResourceType: 'tiered_quiz' },
    { knowledgePointId: 'goal-application', title: '完成一次迁移应用', status: 'pending', priority: 3, reason: '检验能否把知识用于新问题', completionCriteria: '提交一个完整应用方案并标注不确定性', recommendedResourceType: 'practice_guide' },
    { knowledgePointId: 'goal-review', title: '复盘结果并调整下一步', status: 'pending', priority: 4, reason: '根据学习证据决定是否补充前置知识', completionCriteria: '总结错误原因并确定下一项任务', recommendedResourceType: 'concept_map' },
  ];
}

function normalizePathItems(value: unknown, goal: string): GeneratedPathItem[] {
  const list = Array.isArray(value) ? value : [];
  const items = list.map((raw, index) => {
    const item = raw as Record<string, unknown>;
    const status = item.status === 'completed' || item.status === 'active' ? item.status : 'pending';
    const recommendedResourceType = ['lecture', 'tiered_quiz', 'practice_guide', 'concept_map'].includes(String(item.recommendedResourceType))
      ? String(item.recommendedResourceType)
      : 'lecture';
    return {
      knowledgePointId: String(item.knowledgePointId || item.knowledge_point_id || `goal-${index + 1}`),
      title: String(item.title || `学习任务 ${index + 1}`),
      status,
      priority: Number(item.priority) || index + 1,
      reason: String(item.reason || '由当前学习目标生成'),
      completionCriteria: String(item.completionCriteria || item.completion_criteria || '完成任务并提交可验证结果'),
      recommendedResourceType,
    } satisfies GeneratedPathItem;
  }).filter((item) => item.title.trim());
  return items.length >= 2 ? items.slice(0, 8) : fallbackPath(goal);
}

async function generateLearningPath(goal: string, model: string | undefined, thinking: { temperature: number; maxTokens: number }): Promise<GeneratedPathItem[]> {
  const response = await multiModelClient.simple({
    messages: [
      {
        role: 'system',
        content: '你是学习路径规划器。只输出 JSON 数组，不要 Markdown。每个元素必须包含 knowledgePointId、title、status、priority、reason、completionCriteria、recommendedResourceType。status 只能是 active、pending、completed；recommendedResourceType 只能是 lecture、tiered_quiz、practice_guide、concept_map。生成 3 到 6 个可执行学习任务，第一项必须是 active。',
      },
      { role: 'user', content: `学习目标：${goal}` },
    ],
    model,
    temperature: thinking.temperature,
    maxTokens: Math.min(thinking.maxTokens, 4096),
  });
  const parsed = parseJson<unknown>(response.text);
  return normalizePathItems(parsed, goal);
}

function fallbackPathGraph(goal: string): GeneratedPathGraph {
  const subject = goal.replace(/\s+/g, ' ').trim().slice(0, 42) || '工业设备数据诊断工具开发';
  return {
    nodes: [
      { knowledgePointId: 'diagnosis-goal', title: '明确诊断目标与数据边界', description: `把“${subject}”拆成可观察的设备问题、输入变量和输出结论。`, sortOrder: 1 },
      { knowledgePointId: 'python-foundation', title: 'Python 编程基础', description: '掌握变量、函数、条件和循环，能读懂并修改基础分析代码。', sortOrder: 2 },
      { knowledgePointId: 'data-structures', title: 'Python 数据结构', description: '理解列表、字典和表格数据，为处理传感器记录建立代码直觉。', sortOrder: 3 },
      { knowledgePointId: 'csv-dataframe', title: 'CSV 与 DataFrame', description: '能读取、筛选和检查设备数据表，识别字段、缺失值和数据类型。', sortOrder: 4 },
      { knowledgePointId: 'data-cleaning', title: '数据清洗与时间字段', description: '处理缺失、重复、异常格式和时间索引，形成可分析的数据集。', sortOrder: 5 },
      { knowledgePointId: 'sensor-semantics', title: '理解传感器变量与工况', description: '结合设备背景理解压力、电流、温度和状态字段的含义与关系。', sortOrder: 6 },
      { knowledgePointId: 'visualization', title: '运行趋势可视化', description: '使用图表观察变量变化、工况切换和可能的异常窗口。', sortOrder: 7 },
      { knowledgePointId: 'statistics', title: '统计描述与相关性', description: '使用均值、波动、分布和相关性描述设备运行状态。', sortOrder: 8 },
      { knowledgePointId: 'time-series', title: '时间序列分析', description: '理解时间依赖、滑动窗口和趋势变化，为预测与异常识别做准备。', sortOrder: 9 },
      { knowledgePointId: 'reproducible-query', title: 'SQL 与可复现分析', description: '用查询和固定分析步骤形成可以复查的诊断证据。', sortOrder: 10 },
      { knowledgePointId: 'anomaly-detection', title: '异常检测与阈值判断', description: '根据统计特征和运行区间识别异常，并说明判断依据和局限。', sortOrder: 11 },
      { knowledgePointId: 'feature-engineering', title: '诊断特征构造', description: '从原始传感器记录构造窗口、变化率和聚合特征。', sortOrder: 12 },
      { knowledgePointId: 'diagnostic-reasoning', title: '设备诊断逻辑', description: '把数据证据组织成故障线索、置信度和下一步检查建议。', sortOrder: 13 },
      { knowledgePointId: 'diagnostic-report', title: '诊断报告与结果表达', description: '用图表、结论、证据和不确定性完成清晰的诊断报告。', sortOrder: 14 },
      { knowledgePointId: 'diagnostic-tool', title: '完成可运行的诊断工具', description: '整合数据读取、分析、诊断和报告输出，完成一次综合验证。', sortOrder: 15 },
    ],
    edges: [
      { fromKnowledgePointId: 'diagnosis-goal', toKnowledgePointId: 'python-foundation', relation: 'prerequisite' },
      { fromKnowledgePointId: 'python-foundation', toKnowledgePointId: 'data-structures', relation: 'prerequisite' },
      { fromKnowledgePointId: 'diagnosis-goal', toKnowledgePointId: 'csv-dataframe', relation: 'branch' },
      { fromKnowledgePointId: 'csv-dataframe', toKnowledgePointId: 'data-cleaning', relation: 'prerequisite' },
      { fromKnowledgePointId: 'data-cleaning', toKnowledgePointId: 'sensor-semantics', relation: 'prerequisite' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'visualization', relation: 'branch' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'statistics', relation: 'branch' },
      { fromKnowledgePointId: 'statistics', toKnowledgePointId: 'time-series', relation: 'prerequisite' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'reproducible-query', relation: 'branch' },
      { fromKnowledgePointId: 'visualization', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'time-series', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'reproducible-query', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'anomaly-detection', toKnowledgePointId: 'feature-engineering', relation: 'prerequisite' },
      { fromKnowledgePointId: 'feature-engineering', toKnowledgePointId: 'diagnostic-reasoning', relation: 'application' },
      { fromKnowledgePointId: 'diagnostic-reasoning', toKnowledgePointId: 'diagnostic-report', relation: 'application' },
      { fromKnowledgePointId: 'diagnostic-report', toKnowledgePointId: 'diagnostic-tool', relation: 'application' },
    ],
  };
}

function normalizePathGraph(value: unknown, goal: string): GeneratedPathGraph {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawNodes = Array.isArray(source.nodes) ? source.nodes : [];
  const nodes = rawNodes.map((raw, index) => {
    const node = raw as Record<string, unknown>;
    return {
      knowledgePointId: String(node.knowledgePointId || node.knowledge_point_id || `node-${index + 1}`).trim(),
      title: String(node.title || '').trim(),
      description: String(node.description || node.reason || '').trim(),
      sortOrder: Number(node.sortOrder || node.sort_order) || index + 1,
    };
  }).filter((node) => node.knowledgePointId && node.title).slice(0, 18);
  const knownIds = new Set(nodes.map((node) => node.knowledgePointId));
  const rawEdges = Array.isArray(source.edges) ? source.edges : [];
  const edges = rawEdges.map((raw) => {
    const edge = raw as Record<string, unknown>;
    const relation = ['prerequisite', 'branch', 'application', 'review'].includes(String(edge.relation))
      ? String(edge.relation) as LearningPathEdgeView['relation']
      : 'branch';
    return {
      fromKnowledgePointId: String(edge.fromKnowledgePointId || edge.from || edge.from_knowledge_point_id || '').trim(),
      toKnowledgePointId: String(edge.toKnowledgePointId || edge.to || edge.to_knowledge_point_id || '').trim(),
      relation,
    };
  }).filter((edge) => knownIds.has(edge.fromKnowledgePointId) && knownIds.has(edge.toKnowledgePointId) && edge.fromKnowledgePointId !== edge.toKnowledgePointId);
  return nodes.length >= 10 && edges.length >= 9 ? { nodes, edges } : fallbackPathGraph(goal);
}

async function generateInitialPathGraph(input: OnboardingInput, model: string | undefined, thinking: { temperature: number; maxTokens: number }): Promise<GeneratedPathGraph> {
  const response = await multiModelClient.simple({
    messages: [
      {
        role: 'system',
        content: '你是工业设备数据预测与诊断训练的学习路径规划智能体。只输出一个 JSON 对象，不要 Markdown。对象必须只有 nodes 和 edges。nodes 输出 12 到 18 个可执行知识节点，每项必须含 knowledgePointId（稳定英文短 ID）、title、description、sortOrder；description 要说明学习者在该节点要学会什么，粒度控制在一次 30 到 120 分钟学习活动。edges 是节点连接，每项必须含 fromKnowledgePointId、toKnowledgePointId、relation；relation 只能是 prerequisite、branch、application、review。路径必须是有根的知识树/有向无环图，至少包含 3 条并行分支和 2 个汇合应用节点，不能写成“第一章、第二章”的线性目录，也不能把 Agent、检索、审核、资源生成写成学习节点。默认覆盖但要根据学习者基础调整：Python 编程与环境、CSV/DataFrame 与数据清洗、时间字段与传感器变量、可视化、统计基础、时间序列、特征工程、异常检测/预测、SQL 或可复现分析、诊断逻辑、报告或工具实现、综合验证。目标必须落到工业设备数据的预测或诊断任务上；允许分支并行，但每个分支都要能通过边汇合到综合任务。不要将任何节点标为完成，不要凭空声称学习者已经掌握内容。',
      },
      { role: 'user', content: JSON.stringify(input) },
    ],
    model,
    temperature: thinking.temperature,
    maxTokens: Math.min(thinking.maxTokens, 4096),
  });
  return normalizePathGraph(parseJson<unknown>(response.text), input.goal);
}

async function generateProfileSnapshot(learnerId: string, model: string | undefined, thinking: { temperature: number; maxTokens: number }) {
  const current = learningStore.getProfile(learnerId);
  const onboarding = identityStore.getOnboarding(learnerId);
  const response = await multiModelClient.simple({
    messages: [
      {
        role: 'system',
        content: '你是学习画像总结器。只输出 JSON 对象，不要 Markdown。字段必须是 summary（不超过80字）、keywords（3到6个短词）、radar（3到5项，每项含 name、score 0到1、reason）。只能根据提供的统计与技能证据描述，不得虚构能力。',
      },
      { role: 'user', content: JSON.stringify({ initialProfile: onboarding, metrics: { assetsCount: current.assetsCount, todayAssetsCount: current.todayAssetsCount, completedAssetsCount: current.completedAssetsCount, masteredAssetsCount: current.masteredAssetsCount, evidenceCount: current.evidenceCount, studyMinutes: current.studyMinutes, accuracy: current.accuracy }, skills: current.skills }) },
    ],
    model,
    temperature: thinking.temperature,
    maxTokens: Math.min(thinking.maxTokens, 2048),
  });
  const parsed = parseJson<{ summary?: unknown; keywords?: unknown; radar?: unknown }>(response.text) || {};
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean).slice(0, 6) : [];
  const radar = Array.isArray(parsed.radar) ? parsed.radar.map((raw) => {
    const item = raw as Record<string, unknown>;
    return { name: String(item.name || '学习维度'), score: Math.max(0, Math.min(1, Number(item.score) || 0)), reason: String(item.reason || '') };
  }).filter((item) => item.name).slice(0, 5) : [];
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 160) : current.summary;
  learningStore.saveProfileSnapshot(learnerId, { summary, keywords, radar });
  return learningStore.getProfile(learnerId);
}

type LearningAssistantOutput = {
  reply: string;
  revision?: LearningPathRevisionInput;
};

function normalizeLearningAssistantOutput(value: unknown): LearningAssistantOutput {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawRevision = source.revision && typeof source.revision === 'object' ? source.revision as Record<string, unknown> : {};
  const normalizeNodes = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const node = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      knowledgePointId: String(node.knowledgePointId || '').trim(),
      title: String(node.title || '').trim(),
      description: String(node.description || '').trim(),
    };
  }).filter((node) => node.knowledgePointId && node.title && node.description).slice(0, 8) : [];
  const normalizeUpdates = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const node = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      knowledgePointId: String(node.knowledgePointId || '').trim(),
      title: typeof node.title === 'string' ? node.title.trim() : undefined,
      description: typeof node.description === 'string' ? node.description.trim() : undefined,
    };
  }).filter((node) => node.knowledgePointId).slice(0, 8) : [];
  const normalizeEdges = (raw: unknown) => Array.isArray(raw) ? raw.map((item) => {
    const edge = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return {
      fromKnowledgePointId: String(edge.fromKnowledgePointId || '').trim(),
      toKnowledgePointId: String(edge.toKnowledgePointId || '').trim(),
      relation: ['prerequisite', 'branch', 'application', 'review'].includes(String(edge.relation))
        ? String(edge.relation) as LearningPathEdgeView['relation'] : 'branch' as const,
    };
  }).filter((edge) => edge.fromKnowledgePointId && edge.toKnowledgePointId).slice(0, 12) : [];
  const revision: LearningPathRevisionInput = {
    addNodes: normalizeNodes(rawRevision.addNodes),
    updateNodes: normalizeUpdates(rawRevision.updateNodes),
    addEdges: normalizeEdges(rawRevision.addEdges),
  };
  return {
    reply: typeof source.reply === 'string' && source.reply.trim() ? source.reply.trim().slice(0, 1_200) : '我已读取你的问题，并会依据当前路径与学习证据继续协同。',
    revision,
  };
}

async function respondToLearningConversation(learnerId: string, prompt: string): Promise<{
  assistant: LearningAssistantOutput;
  pathChanged: boolean;
  profile: ReturnType<LearningStore['getProfile']>;
  activities: Array<{ agentId: LearningAgentId; name: string; action: string }>;
}> {
  const graph = learningStore.getPathGraph(learnerId);
  const onboarding = identityStore.getOnboarding(learnerId);
  const evidencePack = evidenceService.buildEvidencePack(prompt, { learnerId });
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
  const result = learningStore.applyPathRevision(learnerId, assistant.revision ?? {});
  activities.push({ agentId: 'cross_validation', name: '交叉验证智能体', action: result.changed ? '已检查新增节点与依赖关系，并写入路径' : '已核对当前路径，无需改动' });
  const profile = result.changed
    ? await withTimeout(generateProfileSnapshot(learnerId, route.model, route.thinking), 8_000, '画像更新超时').catch(() => learningStore.getProfile(learnerId))
    : learningStore.getProfile(learnerId);
  return { assistant, pathChanged: result.changed, profile, activities };
}
app.get('/api/auth/me', (req, res) => {
  res.json({ success: true, user: getRequestLearner(req) });
});

app.patch('/api/auth/avatar', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const user = identityStore.updateAvatar(learner.id, typeof req.body?.avatarKey === 'string' ? req.body.avatarKey : '');
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

app.get('/api/learning/chat', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const surface = req.query.surface === 'study' ? 'study' : 'path';
  res.json({
    success: true,
    messages: learningStore.listChatMessages(learner.id, 80, surface),
  });
});

app.post('/api/learning/chat', async (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
  if (!content) {
    res.status(400).json({ success: false, error: '请输入问题或路径调整请求' });
    return;
  }
  const userMessage = learningStore.saveChatMessage(learner.id, 'user', content);
  const outcome = await respondToLearningConversation(learner.id, content);
  const assistantMessage = learningStore.saveChatMessage(learner.id, 'assistant', outcome.assistant.reply, {
    activities: outcome.activities,
    pathChanged: outcome.pathChanged,
  });
  res.json({
    success: true,
    userMessage,
    assistantMessage,
    pathChanged: outcome.pathChanged,
    path: learningStore.getPathGraph(learner.id),
    profile: outcome.profile,
  });
});

// ---------- StudyRun：BullMQ 动态 DAG + SSE 事件流（docs/挑战杯技术开发总规.md §4） ----------
import { createRunsRouter } from "./runs/routes.js";
app.use("/api/learning/runs", createRunsRouter(requireLearner));

// ---------- 初始诊断（总规 §7.3）：12 题固定题集，作答驱动 BKT 初始状态 ----------
import { DIAGNOSTIC_QUESTIONS, scoreDiagnostic } from '../src/learning/diagnostic.js';

app.get('/api/learning/diagnostic', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  // 答案与解析不下发，判分只发生在服务端
  res.json({
    success: true,
    questions: DIAGNOSTIC_QUESTIONS.map((question) => ({
      id: question.id, code: question.code, dimension: question.dimension,
      level: question.level, prompt: question.prompt, options: question.options,
    })),
    latest: learningStore.getLatestDiagnosticSession(learner.id),
  });
});

app.post('/api/learning/diagnostic-attempts', (req, res) => {
  const learner = requireLearner(req, res);
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
    learningStore.applySkillObservation(learner.id, observation.knowledgePointId, observation.correct, 'diagnostic');
  }
  const sessionId = learningStore.saveDiagnosticSession(
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
    profile: learningStore.getProfile(learner.id),
  });
});
app.post('/api/auth/register', (req, res) => {
  try {
    const user = identityStore.register({
      loginName: typeof req.body?.loginName === 'string' ? req.body.loginName : '',
      displayName: typeof req.body?.displayName === 'string' ? req.body.displayName : '',
      password: typeof req.body?.password === 'string' ? req.body.password : '',
    });
    const session = identityStore.createSession(user.id);
    setAuthCookie(res, session.token, session.expiresAt);
    res.status(201).json({ success: true, user });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/auth/login', (req, res) => {
  const user = identityStore.authenticate(
    typeof req.body?.loginName === 'string' ? req.body.loginName : '',
    typeof req.body?.password === 'string' ? req.body.password : '',
  );
  if (!user) {
    res.status(401).json({ success: false, error: '账号或密码不正确' });
    return;
  }
  const session = identityStore.createSession(user.id);
  setAuthCookie(res, session.token, session.expiresAt);
  res.json({ success: true, user });
});

app.post('/api/auth/logout', (req, res) => {
  identityStore.revokeSession(readCookie(req.headers.cookie, AUTH_COOKIE_NAME));
  clearAuthCookie(res);
  res.json({ success: true });
});

app.post('/api/auth/onboarding', async (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  try {
    const input: OnboardingInput = {
      role: typeof req.body?.role === 'string' ? req.body.role : '',
      programmingFoundation: typeof req.body?.programmingFoundation === 'string' ? req.body.programmingFoundation : '',
      goal: typeof req.body?.goal === 'string' ? req.body.goal : '',
      weeklyHours: typeof req.body?.weeklyHours === 'number' ? req.body.weeklyHours : null,
      selfDescription: typeof req.body?.selfDescription === 'string' ? req.body.selfDescription : '',
    };
    const onboarding = identityStore.saveOnboarding(learner.id, input);
    learningStore.recordLearningEvent(learner.id, 'onboarding_completed', {
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
    const path = learningStore.replacePathGraph(learner.id, pathGraph.nodes, pathGraph.edges);
    let profile;
    try {
      profile = await withTimeout(
        generateProfileSnapshot(learner.id, defaultRoute.model, defaultRoute.thinking),
        8_000,
        '首次画像生成超时',
      );
    } catch (error) {
      console.warn('Initial profile generation skipped:', error instanceof Error ? error.message : String(error));
      profile = learningStore.getProfile(learner.id);
    }
    res.json({ success: true, user: { ...learner, onboardingCompleted: true }, onboarding, path, profile });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/path-graph', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, path: learningStore.getPathGraph(learner.id) });
});

app.patch('/api/learning/path-graph/nodes/:nodeId', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const userStatus = ['not_started', 'learning', 'completed'].includes(req.body?.userStatus)
    ? req.body.userStatus as 'not_started' | 'learning' | 'completed'
    : undefined;
  const mastered = typeof req.body?.mastered === 'boolean' ? req.body.mastered : undefined;
  if (userStatus === undefined && mastered === undefined) {
    res.status(400).json({ success: false, error: '没有可更新的节点状态' });
    return;
  }
  const node = learningStore.setPathNodeStatus(learner.id, req.params.nodeId, { userStatus, mastered });
  if (!node) {
    res.status(404).json({ success: false, error: '未找到该路径节点' });
    return;
  }
  res.json({ success: true, node });
});

app.post('/api/learning/assets/:assetId/feedback', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const isOwnAsset = learningStore.listAssets(learner.id).some((asset) => asset.id === req.params.assetId);
  if (!isOwnAsset) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  learningStore.saveAssetFeedback(learner.id, req.params.assetId, {
    completed: typeof req.body?.completed === 'boolean' ? req.body.completed : undefined,
    mastered: typeof req.body?.mastered === 'boolean' ? req.body.mastered : undefined,
    masteryLevel: ['high', 'medium', 'low'].includes(req.body?.masteryLevel) ? req.body.masteryLevel : req.body?.masteryLevel === null ? null : undefined,
    difficultyRating: typeof req.body?.difficultyRating === 'number' ? req.body.difficultyRating : undefined,
    userRating: typeof req.body?.userRating === 'number' ? req.body.userRating : undefined,
    note: typeof req.body?.note === 'string' ? req.body.note : undefined,
  });
  res.json({ success: true, profile: learningStore.getProfile(learner.id) });
});

app.get('/api/learning/assets/:assetId/reader', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const asset = learningStore.getAsset(learner.id, req.params.assetId);
  if (!asset) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  res.json({
    success: true,
    asset,
    feedback: learningStore.getAssetFeedback(learner.id, asset.id),
    pageNotes: learningStore.listAssetPageNotes(learner.id, asset.id),
    quizAttempts: asset.type === 'tiered_quiz' ? learningStore.listQuizAttempts(learner.id, asset.id) : [],
  });
});

app.put('/api/learning/assets/:assetId/pages/:pageKey/note', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  if (!learningStore.getAsset(learner.id, req.params.assetId)) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  const content = typeof req.body?.content === 'string' ? req.body.content : '';
  const note = learningStore.saveAssetPageNote(learner.id, req.params.assetId, req.params.pageKey, content);
  res.json({ success: true, note });
});

app.post('/api/learning/assets/:assetId/quiz-attempts', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const questionId = typeof req.body?.questionId === 'string' ? req.body.questionId : '';
  const answerId = typeof req.body?.answerId === 'string' ? req.body.answerId : '';
  const durationMs = typeof req.body?.durationMs === 'number' ? req.body.durationMs : 0;
  if (!questionId || !answerId) {
    res.status(400).json({ success: false, error: '请选择一个答案后再提交' });
    return;
  }
  try {
    const result = learningStore.submitQuizAttempt(learner.id, req.params.assetId, questionId, answerId, durationMs);
    res.json({ success: true, ...result, profile: learningStore.getProfile(learner.id) });
  } catch (error) {
    res.status(400).json({ success: false, error: error instanceof Error ? error.message : '提交答案失败' });
  }
});

app.delete('/api/learning/assets/:assetId', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const deleted = learningStore.deleteAsset(learner.id, req.params.assetId);
  if (!deleted) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  res.json({ success: true, profile: learningStore.getProfile(learner.id) });
});

app.get('/api/learning/catalog', (_req, res) => {
  try {
    res.json({ success: true, dataset: evidenceService.getCatalog() });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.use('/api/settings', (req, res, next) => {
  if (!requireLearner(req, res)) return;
  next();
});

app.get('/api/settings', (_req, res) => {
  res.json(getSettingsPayload());
});

app.post('/api/settings/providers', (req, res) => {
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

app.post('/api/settings/agent-routing', (req, res) => {
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

app.post('/api/settings/default-execution', (req, res) => {
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

app.post('/api/settings/asset-policy', (req, res) => {
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

app.get('/api/settings/privacy-audit', (req, res) => {
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 8;
  res.json({ success: true, events: learningStore.listPrivacyAuditEvents(Number.isFinite(limit) ? limit : 8) });
});

app.delete('/api/settings/privacy-audit', (_req, res) => {
  const deleted = learningStore.clearPrivacyAuditEvents();
  res.json({ success: true, deleted });
});

app.post('/api/learning/evidence', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  if (!query) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }
  try {
    const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
    res.json({ success: true, evidencePack: evidenceService.buildEvidencePack(query, { learnerId: learner.id, sessionId }) });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/assets', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, learnerId: learner.id, assets: learningStore.listAssets(learner.id) });
});

app.get('/api/learning/path', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, learnerId: learner.id, path: learningStore.getPath(learner.id) });
});

app.get('/api/learning/profile', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  res.json({ success: true, profile: learningStore.getProfile(learner.id) });
});

app.post('/api/learning/profile/regenerate', async (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  try {
    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const profile = await withTimeout(generateProfileSnapshot(learner.id, getRequestedModel(req.body?.model), thinking), 8_000, '学习画像生成超时');
    res.json({ success: true, profile });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/evidence', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  res.json({ success: true, evidence: learningStore.listEvidence(learner.id, Number.isFinite(limit) ? limit : 20) });
});

app.post('/api/learning/context/sync', async (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const goal = typeof req.body?.goal === 'string' ? req.body.goal.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
  const temporaryReference = req.body?.temporaryReference && typeof req.body.temporaryReference === 'object'
    ? {
        name: typeof req.body.temporaryReference.name === 'string' ? req.body.temporaryReference.name : '临时参考资料',
        content: typeof req.body.temporaryReference.content === 'string' ? req.body.temporaryReference.content.slice(0, 120_000) : '',
      }
    : undefined;
  if (!goal) {
    res.status(400).json({ success: false, error: 'goal is required' });
    return;
  }
  try {
    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const model = getRequestedModel(req.body?.model);
    const evidencePack = evidenceService.buildEvidencePack(goal, { learnerId: learner.id, sessionId, temporaryReference });
    let pathItems: GeneratedPathItem[];
    try {
      pathItems = await generateLearningPath(goal, model, thinking);
    } catch (error) {
      console.warn('Learning path generation fell back:', error instanceof Error ? error.message : String(error));
      pathItems = fallbackPath(goal);
    }
    const path = learningStore.replacePath(learner.id, pathItems);
    learningStore.recordLearningEvent(learner.id, 'learning_task', { goal, sessionId, evidenceCount: evidencePack.items.length });

    const assets = runtimeWorkbenchSettings.autoAssetTypes
      .map((type) => {
        const activeKnowledgePointId = pathItems.find((item) => item.status === 'active')?.knowledgePointId ?? pathItems[0]?.knowledgePointId;
        const resource = buildResourceDraft(sessionId ?? `training-${Date.now()}`, goal, type, evidencePack, activeKnowledgePointId);
        const audit = auditResource(resource, evidencePack);
        const publication = resolveResourcePublication(audit.summary.status);
        const auditedResource = {
          ...resource,
          evidencePackId: evidencePack.id,
          auditSummary: audit.summary,
          auditStatus: publication.auditStatus,
        };
        learningStore.saveResourceAudit(auditedResource.id, audit.claims);
        return { resource: auditedResource, persist: publication.persist };
      })
      .filter((result) => result.persist)
      .map((result) => result.resource);
    assets.forEach((resource) => learningStore.saveAsset(learner.id, sessionId, resource));

    res.json({ success: true, path, assets, profile: learningStore.getProfile(learner.id), evidencePack });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post('/api/learning/resources/generate', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';
  const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : undefined;
  const knowledgePointId = typeof req.body?.knowledgePointId === 'string' ? req.body.knowledgePointId : undefined;
  const type: LearningResourceType = isLearningResourceType(req.body?.type) ? req.body.type : 'lecture';
  if (!query) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }
  try {
    const evidencePack = evidenceService.buildEvidencePack(query, { learnerId: learner.id, sessionId });
    const resource = buildResourceDraft(sessionId ?? `training-${Date.now()}`, query, type, evidencePack, knowledgePointId);
    const audit = auditResource(resource, evidencePack);
    const publication = resolveResourcePublication(audit.summary.status);
    const auditedResource = {
      ...resource,
      evidencePackId: evidencePack.id,
      auditSummary: audit.summary,
      auditStatus: publication.auditStatus,
    };
    learningStore.saveResourceAudit(auditedResource.id, audit.claims);
    if (publication.persist) learningStore.saveAsset(learner.id, sessionId, auditedResource);
    res.json({ success: true, resource: auditedResource, evidencePack, audit });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.get('/api/learning/assets/:assetId/export', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const resource = learningStore.getAsset(learner.id, req.params.assetId);
  if (!resource) {
    res.status(404).json({ success: false, error: '未找到该学习资产' });
    return;
  }
  const format = req.query.format === 'json' ? 'json' : req.query.format === 'txt' ? 'txt' : 'md';
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

const PORT = process.env.PORT || 3001;

async function startServer(): Promise<void> {
  const metroCsvPath = path.resolve(
    process.env.IM_TRAINING_AGENT_METROPT_CSV
      || path.join(process.cwd(), 'data', 'datasets', 'metropt', 'MetroPT3(AirCompressor).csv'),
  );
  if (existsSync(metroCsvPath)) {
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
