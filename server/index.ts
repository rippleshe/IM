import dotenv from 'dotenv';
dotenv.config();

import OpenAI from 'openai';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- 多模型 provider 与模型配置 ----------
import {
  ModelRegistry,
  MultiModelClient,
  createDefaultModelProvidersConfig,
  loadModelProvidersConfig,
} from '../src/models/index.js';
import type { ModelProvidersConfig, ProviderConfig } from '../src/models/config.js';

const runtimeModelSettingsPath = path.resolve(process.cwd(), '.im-training-agent', 'model-settings.json');
const runtimeWorkbenchSettingsPath = path.resolve(process.cwd(), '.im-training-agent', 'workbench-settings.json');
const LEARNING_AGENT_IDS = [
  'learning_planning',
  'evidence_retrieval',
  'domain_expert',
  'resource_generation',
  'cross_validation',
  'privacy_compliance',
] as const;
type LearningAgentId = typeof LEARNING_AGENT_IDS[number];
type AgentRouteConfig = { modelId: string; thinkingDepth: 'inherit' | ThinkingDepth };
const AUTO_ASSET_TYPES = ['lecture', 'tiered_quiz', 'concept_map'] as const;
type AutoAssetType = typeof AUTO_ASSET_TYPES[number];
type RuntimeWorkbenchSettings = {
  agentRouting: Record<LearningAgentId, AgentRouteConfig>;
  defaultModelId: string;
  defaultThinkingDepth: ThinkingDepth;
  autoAssetTypes: AutoAssetType[];
};

function createDefaultWorkbenchSettings(): RuntimeWorkbenchSettings {
  return {
    agentRouting: Object.fromEntries(LEARNING_AGENT_IDS.map((id) => [id, { modelId: '', thinkingDepth: 'inherit' }])) as Record<LearningAgentId, AgentRouteConfig>,
    defaultModelId: '',
    defaultThinkingDepth: 'medium',
    autoAssetTypes: [...AUTO_ASSET_TYPES],
  };
}

function loadRuntimeWorkbenchSettings(): RuntimeWorkbenchSettings {
  const defaults = createDefaultWorkbenchSettings();
  if (!existsSync(runtimeWorkbenchSettingsPath)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(runtimeWorkbenchSettingsPath, 'utf8')) as Partial<RuntimeWorkbenchSettings>;
    const source = parsed.agentRouting ?? {};
    for (const id of LEARNING_AGENT_IDS) {
      const route = source[id];
      if (route && typeof route.modelId === 'string' && ['inherit', 'low', 'medium', 'high', 'max'].includes(route.thinkingDepth)) {
        defaults.agentRouting[id] = { modelId: route.modelId, thinkingDepth: route.thinkingDepth };
      }
    }
    if (typeof parsed.defaultModelId === 'string') defaults.defaultModelId = parsed.defaultModelId;
    if (['low', 'medium', 'high', 'max'].includes(parsed.defaultThinkingDepth ?? '')) {
      defaults.defaultThinkingDepth = parsed.defaultThinkingDepth as ThinkingDepth;
    }
    if (Array.isArray(parsed.autoAssetTypes)) {
      const selected = parsed.autoAssetTypes.filter((type): type is AutoAssetType => AUTO_ASSET_TYPES.includes(type as AutoAssetType));
      if (selected.length > 0) defaults.autoAssetTypes = selected;
    }
  } catch {
    // Fall back to safe local defaults when the optional settings file is malformed.
  }
  return defaults;
}

const runtimeWorkbenchSettings = loadRuntimeWorkbenchSettings();

function saveRuntimeWorkbenchSettings(): void {
  mkdirSync(path.dirname(runtimeWorkbenchSettingsPath), { recursive: true });
  writeFileSync(runtimeWorkbenchSettingsPath, JSON.stringify(runtimeWorkbenchSettings, null, 2), 'utf8');
}

function loadBaseModelConfig(): ModelProvidersConfig {
  let config: ModelProvidersConfig | undefined;
  try {
    config = loadModelProvidersConfig({
      defaultPaths: [
        path.resolve(process.cwd(), 'models.config.ts'),
        path.resolve(process.cwd(), 'models.config.json'),
        path.resolve(__dirname, 'models.config.ts'),
      ],
    });
  } catch {
    // Fall back to the built-in configuration when the optional file is unavailable.
  }
  return config ?? createDefaultModelProvidersConfig();
}

function loadRuntimeModelConfig(): ModelProvidersConfig {
  if (!existsSync(runtimeModelSettingsPath)) return { providers: [], models: [] };
  try {
    const parsed = JSON.parse(readFileSync(runtimeModelSettingsPath, 'utf8')) as Partial<ModelProvidersConfig>;
    return {
      providers: Array.isArray(parsed.providers) ? parsed.providers : [],
      models: Array.isArray(parsed.models) ? parsed.models : [],
    };
  } catch {
    return { providers: [], models: [] };
  }
}

const baseModelConfig = loadBaseModelConfig();
const runtimeModelConfig = loadRuntimeModelConfig();

function mergeModelConfig(): ModelProvidersConfig {
  const providers = new Map(baseModelConfig.providers.map((provider) => [provider.id, provider]));
  for (const provider of runtimeModelConfig.providers) providers.set(provider.id, provider);
  const models = new Map(baseModelConfig.models.map((model) => [model.id, model]));
  for (const model of runtimeModelConfig.models) models.set(model.id, model);
  return { providers: Array.from(providers.values()), models: Array.from(models.values()) };
}

function saveRuntimeModelConfig(): void {
  mkdirSync(path.dirname(runtimeModelSettingsPath), { recursive: true });
  writeFileSync(runtimeModelSettingsPath, JSON.stringify(runtimeModelConfig, null, 2), 'utf8');
}

function buildModelRegistry(): ModelRegistry {
  const registry = new ModelRegistry();
  const config = mergeModelConfig();

  for (const provider of config.providers) {
    if (!provider.apiKey) continue;
    registry.registerProvider(provider);
  }

  for (const model of config.models) {
    registry.registerModel(model);
  }

  return registry;
}

const modelRegistry = buildModelRegistry();
const multiModelClient = new MultiModelClient({
  registry: modelRegistry,
  defaultStrategy: 'complexity',
});

function getPrimaryModelRuntime() {
  const provider = modelRegistry.getDefaultProvider();
  const model = provider
    ? modelRegistry.listModels(provider.id)[0]
    : modelRegistry.listModels()[0];

  return {
    provider: provider?.id ?? 'dashscope',
    apiKey: provider?.apiKey ?? process.env.DASHSCOPE_API_KEY ?? '',
    baseURL: provider?.baseURL ?? process.env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: model?.id ?? process.env.QWEN_MODEL ?? 'qwen-plus',
  };
}

function getPrimaryAgentModel() {
  const primary = getPrimaryModelRuntime();
  return { provider: primary.provider, model: primary.model, modelId: primary.model };
}

type ThinkingDepth = 'low' | 'medium' | 'high' | 'max';

function getThinkingSettings(value: unknown): { temperature: number; maxTokens: number } {
  switch (value) {
    case 'low': return { temperature: 0.7, maxTokens: 2048 };
    case 'high': return { temperature: 0.3, maxTokens: 6144 };
    case 'max': return { temperature: 0.2, maxTokens: 8192 };
    default: return { temperature: 0.45, maxTokens: 4096 };
  }
}

function getRequestedModel(value: unknown): string | undefined {
  const model = typeof value === 'string' ? value.trim() : '';
  return model && modelRegistry.hasModel(model) ? model : undefined;
}

function getAgentExecutionSettings(agentId: string, requestedModel: string | undefined, requestedDepth: unknown) {
  const route = (LEARNING_AGENT_IDS as readonly string[]).includes(agentId)
    ? runtimeWorkbenchSettings.agentRouting[agentId as LearningAgentId]
    : undefined;
  const defaultModel = getRequestedModel(runtimeWorkbenchSettings.defaultModelId)
    ?? requestedModel
    ?? getRequestedModel(getPrimaryModelRuntime().model);
  const model = getRequestedModel(route?.modelId) ?? defaultModel;
  const thinkingDepth = route?.thinkingDepth && route.thinkingDepth !== 'inherit'
    ? route.thinkingDepth
    : runtimeWorkbenchSettings.defaultThinkingDepth ?? requestedDepth;
  return { model, thinking: getThinkingSettings(thinkingDepth) };
}

function getClusterRoleRouting(requestedModel: string | undefined, requestedDepth: unknown) {
  const roleMap: Record<string, LearningAgentId> = {
    planner: 'learning_planning',
    strategist: 'learning_planning',
    researcher: 'evidence_retrieval',
    analyst: 'domain_expert',
    coder: 'domain_expert',
    writer: 'resource_generation',
    critic: 'cross_validation',
    reviewer: 'cross_validation',
    compliance: 'privacy_compliance',
  };
  return Object.fromEntries(Object.entries(roleMap).map(([taskType, agentId]) => {
    const route = getAgentExecutionSettings(agentId, requestedModel, requestedDepth);
    return [taskType, { model: route.model, temperature: route.thinking.temperature, maxTokens: route.thinking.maxTokens }];
  }));
}

function getSettingsPayload() {
  const config = mergeModelConfig();
  const providerMap = new Map(config.providers.map((provider) => [provider.id, provider]));
  const primary = getPrimaryModelRuntime();
  const activeModel = getRequestedModel(runtimeWorkbenchSettings.defaultModelId) ?? primary.model;
  return {
    success: true,
    activeModel,
    defaultThinkingDepth: runtimeWorkbenchSettings.defaultThinkingDepth,
    providers: config.providers.map((provider) => ({
      id: provider.id,
      displayName: provider.displayName,
      baseURL: provider.baseURL,
      isDefault: Boolean(provider.isDefault),
      apiKeyConfigured: Boolean(provider.apiKey),
      models: config.models
        .filter((model) => model.provider === provider.id)
        .map((model) => ({ id: model.id, displayName: model.displayName })),
    })),
    models: config.models
      .filter((model) => Boolean(providerMap.get(model.provider)?.apiKey))
      .map((model) => ({
        id: model.id,
        displayName: model.displayName,
        provider: model.provider,
        providerDisplayName: providerMap.get(model.provider)?.displayName ?? model.provider,
    })),
    agentRouting: runtimeWorkbenchSettings.agentRouting,
    autoAssetTypes: runtimeWorkbenchSettings.autoAssetTypes,
    privacy: {
      uploadPolicy: 'session_only' as const,
      uploadContentRetained: false as const,
      learnerDataScope: 'local' as const,
    },
  };
}

function resolveResourcePublication(auditStatus: string): { auditStatus: 'passed' | 'manual_review_required'; persist: boolean } {
  if (auditStatus === 'corroborated') return { auditStatus: 'passed', persist: true };
  return { auditStatus: 'manual_review_required', persist: false };
}

import express from 'express';
import cors from 'cors';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import { v4 as uuidv4 } from 'uuid';

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

const server = createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

import {
  Agent,
  AgentConfig,
  AgentExecutor,
  AgentContext,
  SessionId,
  TaskId,
  SequentialHandoffs,
  ParallelProcessing,
  ExpertTeam,
  Orchestrator,
  Memory,
  SharedMemory,
} from '../src/index.js';
import { DeepPlanner, DeepPlan, SubTask } from '../src/orchestration/deep-planner.js';
import { AgentCluster, ClusterEvent, ClusterExecutionResult, AgentClusterProgress } from '../src/orchestration/agent-cluster.js';
import { LLMAgentCollaboration } from '../src/collaboration/llm-collaboration.js';
import { DynamicWorkflow } from '../src/workflow/index.js';
import type { WorkflowEvent, WorkflowResult } from '../src/workflow/types.js';
import {
  FileSessionStore,
  getDefaultSessionDataDir,
  type PersistedSessionPlan,
  type PersistedSessionResult,
  type PersistedWorkflowResult,
} from './session-store.js';
import { openSqlite, getDatasetDatabasePath, getLearningDatabasePath, initializeDatasetDatabase, initializeLearningDatabase } from '../src/learning/sqlite.js';
import { EvidenceService, seedMetroCatalog } from '../src/learning/evidence.js';
import { IdentityStore, type AuthenticatedLearner, type OnboardingInput } from '../src/learning/identity.js';
import { LearningStore, type LearningPathEdgeView, type LearningPathRevisionInput } from '../src/learning/store.js';
import { buildResourceDraft } from '../src/learning/resource-builder.js';
import { auditResource } from '../src/learning/audit.js';
import type { LearningResourceType, ResourceDocument } from '../src/learning/types.js';

interface ActiveSession {
  id: string;
  agents: Map<string, Agent>;
  memory: Memory;
  sharedMemory: SharedMemory;
  orchestrator?: Orchestrator;
  ws?: WebSocket;
  cluster?: AgentCluster;
  currentPlan?: DeepPlan;
  executionResult?: ClusterExecutionResult;
  workflow?: DynamicWorkflow;
  workflowResult?: WorkflowResult;
}

const sessions = new Map<string, ActiveSession>();

function createActiveSession(sessionId: string): ActiveSession {
  const session: ActiveSession = {
    id: sessionId,
    agents: new Map(),
    memory: new Memory({ maxShortTermEntries: 100 }),
    sharedMemory: new SharedMemory(),
  };
  sessions.set(sessionId, session);
  return session;
}

const sessionStore = new FileSessionStore(getDefaultSessionDataDir());
const learningDb = openSqlite(getLearningDatabasePath());
const datasetDb = openSqlite(getDatasetDatabasePath());
initializeLearningDatabase(learningDb);
initializeDatasetDatabase(datasetDb);
seedMetroCatalog(datasetDb);
const evidenceService = new EvidenceService(datasetDb, learningDb);
const learningStore = new LearningStore(learningDb);
const identityStore = new IdentityStore(learningDb);

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

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    const objectStart = text.indexOf('{');
    const arrayStart = text.indexOf('[');
    const start = objectStart >= 0 && (arrayStart < 0 || objectStart < arrayStart) ? objectStart : arrayStart;
    const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
    if (start < 0 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)) as T; } catch { return null; }
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

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
const RUNNING_SESSION_TIMEOUT_MS = Number(
  process.env.IM_TRAINING_AGENT_RUNNING_SESSION_TIMEOUT_MS ||
    process.env.PI_MULTI_AGENT_RUNNING_SESSION_TIMEOUT_MS ||
    10 * 60 * 1000
);
const STALE_RUNNING_SESSION_ERROR = '执行长时间无进展，已自动结束';

function toPersistedPlan(plan: DeepPlan): PersistedSessionPlan {
  return {
    id: plan.id,
    goal: plan.goal,
    subTaskCount: plan.subTasks.length,
    collaborationMode: plan.collaborationMode,
    communicationStructure: plan.communicationStructure,
    executionStrategy: plan.executionStrategy,
    subTasks: plan.subTasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      assignedAgentName: task.assignedAgentName,
      assignedAgentType: task.assignedAgentType,
      assignedAgentPrompt: task.assignedAgentPrompt,
      dependencies: task.dependencies,
      priority: task.priority,
      tools: task.tools,
      expectedOutput: task.expectedOutput,
    })),
    successCriteria: plan.successCriteria,
    qualityThresholds: plan.qualityThresholds,
  };
}

function toPersistedClusterResult(result: ClusterExecutionResult): PersistedSessionResult {
  return {
    success: result.success,
    finalOutput: result.finalOutput,
    totalExecutionTime: result.totalExecutionTime,
    totalTokensUsed: result.totalTokensUsed,
    evaluationScore: result.evaluationScore,
    iterations: result.iterations,
    progress: result.progress.map((item) => ({
      taskId: item.taskId,
      status: item.status,
      progress: item.progress,
      outputLength: item.outputLength,
      error: item.error,
    })),
  };
}

function toPersistedWorkflowResult(result: WorkflowResult): PersistedWorkflowResult {
  return {
    success: result.success,
    output: result.output,
    totalTokens: result.totalTokens,
    totalExecutionTime: result.totalExecutionTime,
    snapshot: result.snapshot,
  };
}

async function markPersistedSessionFailed(sessionId: string, error: unknown): Promise<void> {
  try {
    await sessionStore.patchSession(sessionId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    });
  } catch {
    // Avoid hiding the original API error behind a persistence failure.
  }
}

async function expireStaleRunningSessions(): Promise<void> {
  await sessionStore.expireStaleRunningSessions({
    timeoutMs: RUNNING_SESSION_TIMEOUT_MS,
    error: STALE_RUNNING_SESSION_ERROR,
  });
}

function isExecutionActive(sessionId: string): boolean {
  const persisted = sessionStore.getSession(sessionId);
  return Boolean(sessions.has(sessionId) && persisted?.status === 'running');
}

function createModelExecutor(sessionId: string): AgentExecutor {
  const client = multiModelClient;
  return {
    async execute(prompt: string, context: AgentContext): Promise<{ text: string }> {
      const agentName = (context.metadata?.['agentName'] as string) || 'Agent';

      if (session.ws?.readyState === WebSocket.OPEN) {
        session.ws.send(
          JSON.stringify({
            type: 'agent_thinking',
            agentId: context.metadata?.['agentId'],
            agentName,
            taskId: context.taskId,
          })
        );
      }

      try {
        const response = await client.simple({
          messages: [
            {
              role: 'system',
              content: `你是${agentName}。请用中文回答，提供详细、专业、有数据支撑的分析。输出至少2000字。`,
            },
            { role: 'user', content: prompt },
          ],
          temperature: 0.7,
          maxTokens: 4096,
        });

        const text = response.text;

        if (session.ws?.readyState === WebSocket.OPEN) {
          session.ws.send(
            JSON.stringify({
              type: 'agent_response',
              agentId: context.metadata?.['agentId'],
              agentName,
              taskId: context.taskId,
              text,
              tokenUsage: response.usage
                ? { prompt: response.usage.promptTokens, completion: response.usage.completionTokens, total: response.usage.totalTokens }
                : undefined,
            })
          );
        }

        return { text };
      } catch (error: any) {
        if (session.ws?.readyState === WebSocket.OPEN) {
          session.ws.send(
            JSON.stringify({
              type: 'agent_error',
              agentId: context.metadata?.['agentId'],
              agentName,
              error: error.message,
            })
          );
        }
        throw error;
      }
    },
  };
}

const AGENT_TEMPLATES: Record<
  string,
  { name: string; description: string; systemPrompt: string; capabilities: string[] }
> = {
  researcher: {
    name: '市场研究员',
    description: '负责市场调研、信息收集和趋势分析',
    systemPrompt:
      '你是资深市场研究员，擅长收集市场数据、分析竞争对手、识别市场趋势。请用数据支撑你的分析，回答简洁专业。',
    capabilities: ['research', 'analysis', 'market-intelligence'],
  },
  analyst: {
    name: '数据分析专家',
    description: '负责数据分析、统计和可视化建议',
    systemPrompt:
      '你是数据分析专家，擅长市场份额分析、用户画像分析、ROI计算。请用具体数字和百分比说明。',
    capabilities: ['data-analysis', 'statistics', 'visualization'],
  },
  writer: {
    name: '报告撰写专家',
    description: '负责整合信息、撰写专业报告',
    systemPrompt:
      '你是专业报告撰写专家，擅长整合多方信息，撰写结构清晰、逻辑严密的报告。',
    capabilities: ['writing', 'editing', 'summarization'],
  },
  critic: {
    name: '质量审核专家',
    description: '负责审核内容质量、提出改进建议',
    systemPrompt:
      '你是严谨的质量审核专家，擅长评估内容的完整性、准确性和逻辑性，并提出具体改进建议。',
    capabilities: ['review', 'quality-assurance', 'feedback'],
  },
  coder: {
    name: '技术工程师',
    description: '负责技术实现和代码开发',
    systemPrompt:
      '你是资深技术工程师，擅长系统设计、代码开发和架构优化。请给出具体的技术方案。',
    capabilities: ['coding', 'architecture', 'technical-design'],
  },
  strategist: {
    name: '战略顾问',
    description: '负责战略规划和决策建议',
    systemPrompt:
      '你是经验丰富的战略顾问，擅长战略规划、竞争分析和投资建议。请给出有深度的战略洞察。',
    capabilities: ['strategy', 'planning', 'decision-making'],
  },
};

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

app.get('/api/learning/chat', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const surface = req.query.surface === 'study' ? 'study' : 'path';
  res.json({ success: true, messages: learningStore.listChatMessages(learner.id, 80, surface) });
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

app.post('/api/learning/study/chat', (req, res) => {
  const learner = requireLearner(req, res);
  if (!learner) return;
  const content = typeof req.body?.content === 'string' ? req.body.content.trim().slice(0, 12_000) : '';
  const pathNodeId = typeof req.body?.pathNodeId === 'string' ? req.body.pathNodeId : '';
  const resourceType: LearningResourceType = isLearningResourceType(req.body?.resourceType) ? req.body.resourceType : 'lecture';
  const collaborationPreference = req.body?.collaborationPreference === 'custom' ? 'custom' : 'auto';
  const selectedAgentIds = Array.isArray(req.body?.selectedAgentIds)
    ? req.body.selectedAgentIds.filter((id: unknown): id is LearningAgentId => typeof id === 'string' && (LEARNING_AGENT_IDS as readonly string[]).includes(id))
    : [];
  const temporaryReference = req.body?.temporaryReference && typeof req.body.temporaryReference === 'object'
    ? {
        name: typeof req.body.temporaryReference.name === 'string' ? req.body.temporaryReference.name : '临时参考资料',
        content: typeof req.body.temporaryReference.content === 'string' ? req.body.temporaryReference.content.slice(0, 120_000) : '',
      }
    : undefined;
  if (!content) {
    res.status(400).json({ success: false, error: '请输入要生成的学习资源或问题' });
    return;
  }
  const pathNode = learningStore.getPathGraph(learner.id).nodes.find((node) => node.id === pathNodeId);
  const userMessage = learningStore.saveChatMessage(learner.id, 'user', content, {
    surface: 'study', pathNodeId: pathNode?.id ?? null, resourceType,
  });
  try {
    const evidencePack = evidenceService.buildEvidencePack(content, { learnerId: learner.id, sessionId: `study-${Date.now()}`, temporaryReference });
    const requestedAgents = collaborationPreference === 'custom' && selectedAgentIds.length > 0
      ? selectedAgentIds
      : ['learning_planning', 'evidence_retrieval', 'domain_expert'] as LearningAgentId[];
    const optionalAgents = Array.from(new Set<LearningAgentId>([
      ...requestedAgents,
      'resource_generation',
      'cross_validation',
      'privacy_compliance',
    ]));
    const activities = [
      {
        agentId: 'orchestrator', name: '协同总控 Agent', action: collaborationPreference === 'custom' ? '按你的角色偏好编排本次任务' : '分析目标并自动编排本次协同',
        status: 'completed', tools: [
          { name: '任务编排', detail: pathNode ? `关联路径节点：${pathNode.title}` : '按当前学习目标创建任务' },
          { name: 'DAG 调度', detail: collaborationPreference === 'custom' ? '遵循指定角色，按依赖关系调度' : '根据目标与风险自动选择串行或并行阶段' },
          { name: '发布门禁', detail: '资源生成后必须经过 Claim 审核、交叉验证与隐私检查' },
        ],
      },
      ...(optionalAgents.includes('learning_planning') ? [{ agentId: 'learning_planning', name: '学情与路径智能体', action: '读取当前画像和学习路径，确定资源粒度', status: 'completed', tools: [{ name: '学习状态读取', detail: pathNode ? `当前节点：${pathNode.title}` : '未指定路径节点' }] }] : []),
      ...(optionalAgents.includes('evidence_retrieval') ? [{ agentId: 'evidence_retrieval', name: '知识检索与溯源 Agent', action: `整理 ${evidencePack.items.length} 条可用依据`, status: 'completed', tools: evidencePack.retrievalPlan.map((method) => ({ name: method === 'structured' ? 'SQLite 数据查询' : 'FTS5 文档检索', detail: method === 'structured' ? '查询字段和时间窗口' : '定位领域资料片段' })) }] : []),
      ...(optionalAgents.includes('domain_expert') ? [{ agentId: 'domain_expert', name: '领域诊断 Agent', action: '核对设备字段语义与诊断边界', status: 'completed', tools: [{ name: '字段语义核对', detail: '避免将异常数据直接写成确定故障' }] }] : []),
    ];
    const resource = buildResourceDraft(`study-${Date.now()}`, content, resourceType, evidencePack);
    const audit = auditResource(resource, evidencePack);
    const publication = resolveResourcePublication(audit.summary.status);
    const auditedResource = { ...resource, evidencePackId: evidencePack.id, auditSummary: audit.summary, auditStatus: publication.auditStatus };
    learningStore.saveResourceAudit(auditedResource.id, audit.claims);
    if (publication.persist) learningStore.saveAsset(learner.id, undefined, auditedResource);
    if (optionalAgents.includes('resource_generation')) activities.push({ agentId: 'resource_generation', name: '个性化资源生成 Agent', action: `生成${resource.title}`, status: 'completed', tools: [{ name: '资源模板', detail: `按 ${resourceType} 契约组织内容` }] });
    if (optionalAgents.includes('cross_validation')) activities.push({ agentId: 'cross_validation', name: '辩论交叉验证 Agent', action: audit.summary.status === 'corroborated' ? '交叉验证通过' : '标记需要复核的内容', status: 'completed', tools: [{ name: 'Claim 审核', detail: `${audit.claims.length} 条声明已核对` }] });
    if (optionalAgents.includes('privacy_compliance')) activities.push({ agentId: 'privacy_compliance', name: '合规与隐私 Agent', action: temporaryReference ? '临时资料仅用于本次任务，未写入知识库' : '确认本次任务未使用临时资料', status: 'completed', tools: [{ name: '资料边界检查', detail: temporaryReference ? '会话结束后不保留原文' : '无上传资料' }] });
    const assistantMessage = learningStore.saveChatMessage(learner.id, 'assistant', publication.persist
      ? `已完成${resource.title}，并通过发布检查，已保存到学习资产。`
      : `已生成${resource.title}，但审核发现需要复核的内容，暂未作为已审核资产发布。`, {
      surface: 'study', pathNodeId: pathNode?.id ?? null, resourceType, activities,
      asset: { id: auditedResource.id, title: auditedResource.title, type: auditedResource.type, auditStatus: auditedResource.auditStatus, persisted: publication.persist },
      evidence: { count: evidencePack.items.length, score: evidencePack.coverageScore, crossValidation: audit.summary.status },
    });
    learningStore.recordLearningEvent(learner.id, 'study_resource_generated', { pathNodeId: pathNode?.id ?? null, resourceId: auditedResource.id, resourceType, persisted: publication.persist, evidenceCount: evidencePack.items.length });
    res.json({ success: true, userMessage, assistantMessage, asset: auditedResource, evidencePack, activities });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
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

app.get('/api/sessions', async (_req, res) => {
  await expireStaleRunningSessions();
  res.json({ sessions: sessionStore.listSessions() });
});

app.post('/api/sessions', async (_req, res) => {
  const sessionId = uuidv4();
  const now = Date.now();
  createActiveSession(sessionId);
  await sessionStore.saveSession({
    id: sessionId,
    createdAt: now,
    updatedAt: now,
    status: 'idle',
  });
  res.json({ sessionId, message: 'Session created' });
});

app.get('/api/sessions/:sessionId', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);

  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  res.json({
    session: persisted || {
      id: sessionId,
      status: 'idle',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    active: isExecutionActive(sessionId),
  });
});

app.post('/api/analyze-complexity', async (req, res) => {
  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    const response = await multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: `You are a task complexity analyzer for a multi-agent system. Analyze the given task and return a JSON object with these fields:
- "level": one of "simple", "medium", "complex", "deep"
- "agentCount": recommended number of agents (1 for simple, 2-3 for medium, 4-6 for complex, 7-10 for deep)
- "mode": recommended collaboration mode ("direct", "sequential", "parallel", "expert_team", "deep")
- "reasoning": brief explanation of the complexity assessment

Rules:
- Simple greetings, single questions, basic calculations → "simple" (1 agent, "direct")
- Tasks requiring 2-3 steps, basic analysis, short writing → "medium" (2-3 agents, "sequential" or "parallel")
- Multi-domain analysis, comparative studies, medium-length reports → "complex" (4-6 agents, "expert_team")
- Comprehensive research, deep analysis, long-form reports (10000+ words) → "deep" (7-10 agents, "deep")

Return ONLY the JSON object, no other text.`,
        },
        { role: 'user', content: task },
      ],
      temperature: 0.3,
      maxTokens: 500,
    });

    const content = response.text;
    let analysis;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : { level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Default to simple' };
    } catch {
      analysis = { level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Failed to parse analysis' };
    }

    const validLevels = ['simple', 'medium', 'complex', 'deep'];
    const validModes = ['direct', 'sequential', 'parallel', 'expert_team', 'deep'];
    if (!validLevels.includes(analysis.level)) analysis.level = 'simple';
    if (!validModes.includes(analysis.mode)) analysis.mode = 'direct';
    if (typeof analysis.agentCount !== 'number' || analysis.agentCount < 1) analysis.agentCount = 1;
    if (!analysis.reasoning) analysis.reasoning = 'Auto-assessed';

    res.json(analysis);
  } catch (error: any) {
    console.error('Complexity analysis error:', error.message);
    res.json({ level: 'simple', agentCount: 1, mode: 'direct', reasoning: 'Fallback: analysis failed' });
  }
});

app.post('/api/chat', async (req, res) => {
  const { message } = req.body;
  if (!message) {
    res.status(400).json({ error: 'message is required' });
    return;
  }

  try {
    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const response = await multiModelClient.simple({
      messages: [
        { role: 'system', content: 'You are a helpful AI assistant. Respond concisely and accurately.' },
        { role: 'user', content: message },
      ],
      model: getRequestedModel(req.body?.model),
      temperature: thinking.temperature,
      maxTokens: thinking.maxTokens,
    });

    const output = response.text;
    const tokens = response.usage?.totalTokens ?? 0;

    res.json({ output, tokens, success: true });
  } catch (error: any) {
    console.error('Chat error:', error.message);
    res.status(500).json({ error: error.message || 'Chat failed' });
  }
});

app.get('/api/learning/catalog', (_req, res) => {
  try {
    res.json({ success: true, dataset: evidenceService.getCatalog() });
  } catch (error) {
    res.status(500).json({ success: false, error: error instanceof Error ? error.message : String(error) });
  }
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
  const limit = typeof req.query.limit === 'string' ? Number(req.query.limit) : 20;
  res.json({ success: true, evidence: learningStore.listEvidence(Number.isFinite(limit) ? limit : 20) });
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
        const resource = buildResourceDraft(sessionId ?? `training-${Date.now()}`, goal, type, evidencePack);
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
  const type: LearningResourceType = isLearningResourceType(req.body?.type) ? req.body.type : 'lecture';
  if (!query) {
    res.status(400).json({ success: false, error: 'query is required' });
    return;
  }
  try {
    const evidencePack = evidenceService.buildEvidencePack(query, { learnerId: learner.id, sessionId });
    const resource = buildResourceDraft(sessionId ?? `training-${Date.now()}`, query, type, evidencePack);
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

app.post('/api/clarify', async (req, res) => {
  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    const response = await multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: `You are a task clarification analyzer for a multi-agent AI system. Your job is to determine if the user's task needs clarification before execution.

Analyze the task and return a JSON object with these fields:
- "needsClarification": boolean - whether the task needs user input before proceeding
- "reason": string - brief explanation of why clarification is/isn't needed
- "clarification": if needsClarification is true, provide an object with:
  - "taskId": unique string ID
  - "stepId": "clarify-1"
  - "status": "WAITING_INPUT"
  - "uiSchema": object describing the form to show the user
  - "contextHint": string explaining why we need this info
  - "defaultValues": object with any pre-filled values from context

The uiSchema must follow this structure:
{
  "type": "form" | "confirm-card" | "selection-list",
  "title": string,
  "description": string,
  "fields": array of field objects,
  "actions": array of action button objects
}

Each field object:
{
  "key": string (unique identifier),
  "label": string (display label),
  "type": "text" | "number" | "date" | "select" | "textarea",
  "required": boolean,
  "placeholder": string (optional),
  "options": array of {label, value} (only for select type)
}

Each action button:
{
  "key": string,
  "label": string,
  "variant": "primary" | "secondary" | "danger",
  "submit": boolean
}

Rules:
- Simple greetings, clear single questions, well-defined tasks → needsClarification: false
- Vague tasks like "帮我写个报告" → needsClarification: true, ask about topic, scope, format
- Research tasks without specific domain → ask about industry, region, time period
- Writing tasks without style/tone specified → ask about audience, tone, length
- Tasks with ambiguous scope → ask about depth, format, focus areas
- Keep fields minimal (2-5 fields max), only ask for truly missing critical info
- Always include a "submit" action button with variant "primary"
- For selection-list type, use select fields with options

Return ONLY valid JSON, no other text.`,
        },
        { role: 'user', content: task },
      ],
      temperature: 0.3,
      maxTokens: 1500,
    });

    const content = response.text;
    let result;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      result = jsonMatch ? JSON.parse(jsonMatch[0]) : { needsClarification: false, reason: 'Parse failed' };
    } catch {
      result = { needsClarification: false, reason: 'Parse failed' };
    }

    res.json(result);
  } catch (error: any) {
    console.error('Clarify error:', error.message);
    res.json({ needsClarification: false, reason: 'Clarification analysis failed' });
  }
});

app.post('/api/sessions/:sessionId/agents', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { template, customName, customPrompt, customCapabilities } = req.body;

  let config: AgentConfig;
  let capabilities: string[];

  if (template && AGENT_TEMPLATES[template]) {
    const tmpl = AGENT_TEMPLATES[template];
    config = {
      name: tmpl.name,
      description: tmpl.description,
      systemPrompt: tmpl.systemPrompt,
      model: getPrimaryAgentModel(),
    };
    capabilities = tmpl.capabilities;
  } else if (customName) {
    config = {
      name: customName,
      description: customPrompt || `自定义Agent: ${customName}`,
      systemPrompt: customPrompt || `你是${customName}，一个专业的AI助手。`,
      model: getPrimaryAgentModel(),
    };
    capabilities = customCapabilities || ['general'];
  } else {
    res.status(400).json({ error: 'Must provide template or customName' });
    return;
  }

  const executor = createModelExecutor(sessionId);
  const agent = new Agent(config, executor);
  session.agents.set(agent.id, agent);

  res.json({
    agent: {
      id: agent.id,
      name: agent.name,
      description: agent.description,
      capabilities,
      state: agent.getState(),
    },
  });
});

app.post('/api/sessions/:sessionId/agents/auto-generate', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    const planningResponse = await multiModelClient.simple({
      messages: [
        {
          role: 'system',
          content: `你是一个多Agent系统的任务规划师。根据用户任务，分析需要哪些Agent来协作完成。
请以JSON格式返回，格式如下：
{
  "agents": [
    {
      "name": "Agent名称",
      "role": "Agent角色描述",
      "systemPrompt": "Agent的系统提示词",
      "capabilities": ["能力1", "能力2"],
      "reason": "为什么需要这个Agent"
    }
  ],
  "collaborationMode": "sequential|parallel|expert_team",
  "executionPlan": "执行计划描述"
}

要求：
1. 根据任务复杂度生成2-5个Agent
2. 每个Agent有明确的职责分工
3. 选择最合适的协作模式
4. 只返回JSON，不要其他内容`,
        },
        { role: 'user', content: `任务：${task}` },
      ],
      temperature: 0.5,
      maxTokens: 2048,
    });

    const planText = planningResponse.text;
    const jsonMatch = planText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: 'Failed to parse agent plan' });
      return;
    }

    const plan = JSON.parse(jsonMatch[0]);
    const executor = createModelExecutor(sessionId);
    const createdAgents: any[] = [];

    for (const agentDef of plan.agents) {
      const config: AgentConfig = {
        name: agentDef.name,
        description: agentDef.role,
        systemPrompt: agentDef.systemPrompt,
        model: getPrimaryAgentModel(),
      };

      const agent = new Agent(config, executor);
      session.agents.set(agent.id, agent);
      createdAgents.push({
        id: agent.id,
        name: agent.name,
        description: agent.description,
        capabilities: agentDef.capabilities,
        reason: agentDef.reason,
        state: agent.getState(),
      });

      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(
          JSON.stringify({
            type: 'agent_created',
            agent: {
              id: agent.id,
              name: agent.name,
              description: agent.description,
              capabilities: agentDef.capabilities,
              reason: agentDef.reason,
              state: agent.getState(),
            },
          })
        );
      }
    }

    res.json({
      agents: createdAgents,
      collaborationMode: plan.collaborationMode,
      executionPlan: plan.executionPlan,
    });
  } catch (error: any) {
    console.error('Deep plan error:', error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/sessions/:sessionId/deep-plan', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, targetWordCount, maxAgents } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_started',
        task,
      }));
    }

    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const selectedModel = getRequestedModel(req.body?.model);
    const planningRoute = getAgentExecutionSettings('learning_planning', selectedModel, req.body?.thinkingDepth);
    const planner = new DeepPlanner({ registry: modelRegistry, model: planningRoute.model, temperature: planningRoute.thinking.temperature });
    const plan = await planner.createDeepPlan(task, {
      targetWordCount: targetWordCount || 30000,
      maxAgents: maxAgents || 10,
      depth: 2,
    });

    session.currentPlan = plan;
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_completed',
        plan: {
          id: plan.id,
          goal: plan.goal,
          subTaskCount: plan.subTasks.length,
          collaborationMode: plan.collaborationMode,
          communicationStructure: plan.communicationStructure,
          executionStrategy: plan.executionStrategy,
          subTasks: plan.subTasks.map((t) => ({
            id: t.id,
            title: t.title,
            assignedAgentName: t.assignedAgentName,
            assignedAgentType: t.assignedAgentType,
            dependencies: t.dependencies,
            priority: t.priority,
            tools: t.tools,
            expectedOutput: t.expectedOutput,
          })),
          successCriteria: plan.successCriteria,
          qualityThresholds: plan.qualityThresholds,
        },
      }));
    }

    res.json({
      plan: {
        id: plan.id,
        goal: plan.goal,
        subTaskCount: plan.subTasks.length,
        collaborationMode: plan.collaborationMode,
        communicationStructure: plan.communicationStructure,
        executionStrategy: plan.executionStrategy,
        subTasks: plan.subTasks.map((t) => ({
          id: t.id,
          title: t.title,
          description: t.description,
          assignedAgentName: t.assignedAgentName,
          assignedAgentType: t.assignedAgentType,
          assignedAgentPrompt: t.assignedAgentPrompt,
          dependencies: t.dependencies,
          priority: t.priority,
          tools: t.tools,
          expectedOutput: t.expectedOutput,
        })),
        successCriteria: plan.successCriteria,
        qualityThresholds: plan.qualityThresholds,
      },
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'planning_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/cluster-execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, targetWordCount, maxAgents, maxIterations } = req.body;
  if (!task) {
    res.status(400).json({ error: 'Task description required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      error: undefined,
    });

    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const selectedModel = getRequestedModel(req.body?.model);
    const planningRoute = getAgentExecutionSettings('learning_planning', selectedModel, req.body?.thinkingDepth);

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_started',
        task,
      }));
    }

    const planner = new DeepPlanner({ registry: modelRegistry, model: planningRoute.model, temperature: planningRoute.thinking.temperature });
    const plan = await planner.createDeepPlan(task, {
      targetWordCount: targetWordCount || 30000,
      maxAgents: maxAgents || 10,
      depth: 2,
    });

    session.currentPlan = plan;
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'plan_created',
        plan: {
          id: plan.id,
          goal: plan.goal,
          subTaskCount: plan.subTasks.length,
          collaborationMode: plan.collaborationMode,
          subTasks: plan.subTasks.map((t) => ({
            id: t.id,
            title: t.title,
            assignedAgentName: t.assignedAgentName,
            assignedAgentType: t.assignedAgentType,
            dependencies: t.dependencies,
            priority: t.priority,
            tools: t.tools,
          })),
        },
      }));
    }

    const defaultProvider = modelRegistry.getDefaultProvider();
    const apiKey = defaultProvider?.apiKey ?? '';
    const baseURL = defaultProvider?.baseURL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    const cluster = new AgentCluster({
      registry: modelRegistry,
      apiKey,
      baseURL,
      model: selectedModel,
      temperature: thinking.temperature,
      roleRouting: getClusterRoleRouting(selectedModel, req.body?.thinkingDepth),
    }, sessionId);
    session.cluster = cluster;

    cluster.onEvent((event: ClusterEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'cluster_event',
          eventType: event.type,
          taskId: event.taskId,
          agentName: event.agentName,
          data: event.data,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await cluster.executePlan(plan, maxIterations || 3);
    session.executionResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'deep',
      task,
      plan: toPersistedPlan(plan),
      result: toPersistedClusterResult(result),
      error: result.success ? undefined : 'Cluster execution failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_completed',
        result: {
          success: result.success,
          totalExecutionTime: result.totalExecutionTime,
          totalTokensUsed: result.totalTokensUsed,
          evaluationScore: result.evaluationScore,
          iterations: result.iterations,
          finalOutputLength: result.finalOutput.length,
        },
      }));
    }

    res.json({
      success: result.success,
      totalExecutionTime: result.totalExecutionTime,
      totalTokensUsed: result.totalTokensUsed,
      evaluationScore: result.evaluationScore,
      iterations: result.iterations,
      finalOutput: result.finalOutput,
      progress: result.progress,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'cluster_execution_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/cluster-progress', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session) {
    if (persisted?.result?.progress) {
      res.json({ progress: persisted.result.progress });
      return;
    }
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const progress = session.cluster?.getProgress() || [];
  res.json({ progress });
});

app.get('/api/sessions/:sessionId/result', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const persistedResult = persisted?.result;
  res.json({
    result: session.executionResult ? {
      success: session.executionResult.success,
      finalOutput: session.executionResult.finalOutput,
      totalExecutionTime: session.executionResult.totalExecutionTime,
      totalTokensUsed: session.executionResult.totalTokensUsed,
      evaluationScore: session.executionResult.evaluationScore,
      iterations: session.executionResult.iterations,
      progress: session.executionResult.progress,
    } : persistedResult ? {
      success: persistedResult.success,
      finalOutput: persistedResult.finalOutput,
      totalExecutionTime: persistedResult.totalExecutionTime,
      totalTokensUsed: persistedResult.totalTokensUsed,
      evaluationScore: persistedResult.evaluationScore,
      iterations: persistedResult.iterations,
      progress: persistedResult.progress,
    } : null,
    session: persisted || null,
  });
});

app.post('/api/sessions/:sessionId/execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, mode, agentIds } = req.body;

  const agents: Agent[] = [];
  if (agentIds && agentIds.length > 0) {
    for (const id of agentIds) {
      const agent = session.agents.get(id);
      if (agent) agents.push(agent);
    }
  } else {
    session.agents.forEach((agent) => agents.push(agent));
  }

  if (agents.length === 0) {
    res.status(400).json({ error: 'No agents available' });
    return;
  }

  const context: AgentContext = {
    sessionId: sessionId as SessionId,
    taskId: uuidv4() as TaskId,
    depth: 0,
    iteration: 0,
    startTime: Date.now(),
    metadata: {},
  };

  try {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_start',
          task,
          mode: mode || 'sequential',
          agentCount: agents.length,
        })
      );
    }

    let result: any;

    switch (mode) {
      case 'parallel': {
        const workflow = new ParallelProcessing(agents, context);
        result = await workflow.execute(task);
        break;
      }
      case 'expert_team': {
        const capabilities = agents.map(
          (_, i) => `capability_${i}`
        );
        const team = new ExpertTeam(agents, context, capabilities);
        result = await team.execute(task);
        break;
      }
      case 'orchestrator': {
        const orchestrator = new Orchestrator({
          maxConcurrentTasks: 3,
          enableAutoRecovery: true,
        });
        agents.forEach((agent) => orchestrator.registerAgent(agent));
        const results = await orchestrator.executeGoal(task);
        result = { success: results.every((r) => r.success), results, executionTime: Date.now() - context.startTime };
        break;
      }
      default: {
        const workflow = new SequentialHandoffs(agents, context);
        result = await workflow.execute(task);
      }
    }

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_complete',
          success: result.success,
          executionTime: result.executionTime,
          resultCount: result.results?.length || 0,
        })
      );
    }

    res.json({
      success: result.success,
      executionTime: result.executionTime,
      results: result.results?.map((r: any) => ({
        success: r.success,
        data: r.data,
        executionTime: r.executionTime,
        agentId: r.agentId,
      })),
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(
        JSON.stringify({
          type: 'execution_error',
          error: error.message,
        })
      );
    }
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/agents', (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const agents: any[] = [];
  session.agents.forEach((agent) => {
    agents.push({
      id: agent.id,
      name: agent.name,
      description: agent.description,
      state: agent.getState(),
      stats: agent.getStats(),
    });
  });

  res.json({ agents });
});

app.get('/api/agent-templates', (_req, res) => {
  res.json({ templates: AGENT_TEMPLATES });
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '', `http://localhost`);
  const sessionId = url.searchParams.get('sessionId');

  if (!sessionId) {
    ws.close(4001, 'sessionId required');
    return;
  }

  let session = sessions.get(sessionId);
  if (!session && sessionStore.getSession(sessionId)) {
    session = createActiveSession(sessionId);
  }
  if (!session) {
    ws.close(4002, 'Session not found');
    return;
  }

  session.ws = ws;

  ws.send(
    JSON.stringify({
      type: 'connected',
      sessionId,
      message: 'WebSocket connected',
    })
  );

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
    } catch {
      // ignore
    }
  });

  ws.on('close', () => {
    if (session.ws === ws) {
      session.ws = undefined;
    }
  });
});

const PORT = process.env.PORT || 3001;

app.post('/api/sessions/:sessionId/collaborate', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { mode, task, agents: agentSpecs } = req.body;
  if (!mode || !task) {
    res.status(400).json({ error: 'mode and task are required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode,
      task,
      error: undefined,
    });

    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const selectedModel = getRequestedModel(req.body?.model);
    const collaboration = new LLMAgentCollaboration({ registry: modelRegistry, model: selectedModel, temperature: thinking.temperature, maxTokens: thinking.maxTokens });
    const agents = (agentSpecs || []).map((a: any, i: number) => {
      const id = a.id || `agent_${i}`;
      const route = getAgentExecutionSettings(id, selectedModel, req.body?.thinkingDepth);
      return {
        id,
        name: a.name || `Agent ${i + 1}`,
        type: a.type || 'general',
        systemPrompt: a.systemPrompt || a.prompt || `你是一个专业的AI助手。`,
        tools: a.tools || [],
        specialty: a.specialty,
        model: route.model,
        temperature: route.thinking.temperature,
        maxTokens: route.thinking.maxTokens,
      };
    });

    let result;

    switch (mode) {
      case 'sequential':
        result = await collaboration.executeSequential(agents, task);
        break;
      case 'parallel':
        result = await collaboration.executeParallel(agents, task);
        break;
      case 'debate':
        result = await collaboration.executeDebate(agents, task, 3);
        break;
      case 'hierarchical':
        if (agents.length < 2) {
          res.status(400).json({ error: 'Hierarchical mode requires at least 2 agents (1 supervisor + 1 subordinate)' });
          return;
        }
        result = await collaboration.executeHierarchical(agents[0]!, agents.slice(1), task);
        break;
      case 'expert_team':
        result = await collaboration.executeExpertTeam(
          agents.map((a: any) => ({ ...a, specialty: a.specialty || a.type || 'general' })),
          task
        );
        break;
      case 'critic_reviewer':
        if (agents.length < 2) {
          res.status(400).json({ error: 'Critic-Reviewer mode requires at least 2 agents (1 creator + 1 critic)' });
          return;
        }
        result = await collaboration.executeCriticReviewer(agents[0]!, agents[1]!, task, 2);
        break;
      default:
        res.status(400).json({ error: `Unknown mode: ${mode}. Available: sequential, parallel, debate, hierarchical, expert_team, critic_reviewer` });
        return;
    }

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'collaboration_completed',
        mode,
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          iterations: result.iterations,
          finalOutputLength: result.finalOutput.length,
        },
      }));
    }

    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode,
      task,
      result: {
        success: result.success,
        finalOutput: result.finalOutput || '',
        totalExecutionTime: result.totalExecutionTime || 0,
        totalTokensUsed: result.totalTokens || 0,
        evaluationScore: 0,
        iterations: result.iterations || 1,
        progress: [],
      },
      error: result.success ? undefined : 'Collaboration failed',
    });

    res.json(result);
  } catch (error: any) {
    console.error(`Collaboration error (${mode}):`, error.message);
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

app.post('/api/sessions/:sessionId/workflow-execute', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { task, tokenBudget, maxConcurrentAgents, args } = req.body;
  if (!task) {
    res.status(400).json({ error: 'task is required' });
    return;
  }

  try {
    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'workflow',
      task,
      error: undefined,
    });

    const primaryModel = getPrimaryModelRuntime();
    const thinking = getThinkingSettings(req.body?.thinkingDepth);
    const selectedModel = getRequestedModel(req.body?.model);
    const workflow = new DynamicWorkflow({
      apiKey: primaryModel.apiKey,
      baseURL: primaryModel.baseURL,
      model: selectedModel ?? primaryModel.model,
      temperature: thinking.temperature,
      tokenBudget: tokenBudget || 200000,
      maxConcurrentAgents: maxConcurrentAgents || 5,
    });
    session.workflow = workflow;

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_started',
        task,
      }));
    }

    workflow.onEvent((event: WorkflowEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'workflow_event',
          eventType: event.type,
          data: event,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await workflow.run(task, args);
    session.workflowResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'workflow',
      task,
      workflowResult: toPersistedWorkflowResult(result),
      error: result.success ? undefined : 'Workflow failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_completed',
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          snapshot: result.snapshot,
        },
      }));
    }

    res.json({
      success: result.success,
      output: result.output,
      totalTokens: result.totalTokens,
      totalExecutionTime: result.totalExecutionTime,
      snapshot: result.snapshot,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/sessions/:sessionId/workflow-run-script', async (req, res) => {
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  if (!session) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  const { script, args } = req.body;
  if (!script) {
    res.status(400).json({ error: 'script is required' });
    return;
  }

  try {
    const primaryModel = getPrimaryModelRuntime();
    const workflow = session.workflow || new DynamicWorkflow({
      apiKey: primaryModel.apiKey,
      baseURL: primaryModel.baseURL,
      model: primaryModel.model,
      tokenBudget: 200000,
      maxConcurrentAgents: 5,
    });
    session.workflow = workflow;

    const validation = await workflow.validateScript(script);
    if (!validation.valid) {
      res.status(400).json({ error: `Invalid script: ${validation.error}` });
      return;
    }
    const workflowTask = validation.meta?.name || 'custom_script';

    await sessionStore.patchSession(sessionId, {
      status: 'running',
      mode: 'workflow',
      task: workflowTask,
      error: undefined,
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_started',
        task: workflowTask,
      }));
    }

    workflow.onEvent((event: WorkflowEvent) => {
      void sessionStore.patchSession(sessionId, { status: 'running' }).catch(() => {});
      if (session.ws && session.ws.readyState === WebSocket.OPEN) {
        session.ws.send(JSON.stringify({
          type: 'workflow_event',
          eventType: event.type,
          data: event,
          timestamp: event.timestamp,
        }));
      }
    });

    const result = await workflow.executeScript(script, args);
    session.workflowResult = result;
    await sessionStore.patchSession(sessionId, {
      status: result.success ? 'completed' : 'failed',
      mode: 'workflow',
      task: workflowTask,
      workflowResult: toPersistedWorkflowResult(result),
      error: result.success ? undefined : 'Workflow failed',
    });

    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_completed',
        result: {
          success: result.success,
          totalTokens: result.totalTokens,
          totalExecutionTime: result.totalExecutionTime,
          snapshot: result.snapshot,
        },
      }));
    }

    res.json({
      success: result.success,
      output: result.output,
      totalTokens: result.totalTokens,
      totalExecutionTime: result.totalExecutionTime,
      snapshot: result.snapshot,
      meta: validation.meta,
    });
  } catch (error: any) {
    if (session.ws && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify({
        type: 'workflow_error',
        error: error.message,
      }));
    }
    await markPersistedSessionFailed(sessionId, error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/sessions/:sessionId/workflow-result', async (req, res) => {
  await expireStaleRunningSessions();
  const { sessionId } = req.params;
  const session = sessions.get(sessionId);
  const persisted = sessionStore.getSession(sessionId);
  if (!session && !persisted) {
    res.status(404).json({ error: 'Session not found' });
    return;
  }

  if (!session?.workflowResult && !persisted?.workflowResult) {
    res.json({ hasResult: false });
    return;
  }

  const result = session?.workflowResult || persisted?.workflowResult;
  res.json({
    hasResult: true,
    success: result?.success,
    output: result?.output,
    totalTokens: result?.totalTokens,
    totalExecutionTime: result?.totalExecutionTime,
    snapshot: result?.snapshot,
    session: persisted || null,
  });
});

async function startServer(): Promise<void> {
  await sessionStore.load();
  await Promise.all(
    sessionStore
      .listSessions()
      .filter((session) => session.status === 'running')
      .map((session) =>
        sessionStore.patchSession(session.id, {
          status: 'failed',
          error: 'Server restarted before execution completed',
        })
      )
  );
  server.listen(PORT, () => {
  console.log(`\n🚀 IM-Training-Agent 服务已启动：http://localhost:${PORT}`);
  console.log(`📡 WebSocket endpoint: ws://localhost:${PORT}/ws`);
  console.log(`\nAPI 接口：`);
  console.log(`  GET    /api/sessions                        - List persisted sessions`);
  console.log(`  POST   /api/sessions                        - Create session`);
  console.log(`  GET    /api/sessions/:id                    - Get persisted session`);
  console.log(`  POST   /api/sessions/:id/agents              - Create agent`);
  console.log(`  POST   /api/sessions/:id/agents/auto-generate - Auto-generate agents`);
  console.log(`  POST   /api/sessions/:id/deep-plan           - Deep plan with LLM`);
  console.log(`  POST   /api/sessions/:id/cluster-execute     - Cluster execute (deep)`);
  console.log(`  GET    /api/sessions/:id/cluster-progress     - Get cluster progress`);
  console.log(`  GET    /api/sessions/:id/result              - Get execution result`);
  console.log(`  POST   /api/sessions/:id/execute             - Execute task (simple)`);
  console.log(`  GET    /api/sessions/:id/agents              - List agents`);
  console.log(`  GET    /api/agent-templates                  - List templates`);
  console.log(`  POST   /api/sessions/:id/workflow-execute     - Dynamic workflow (auto-generate script)`);
  console.log(`  POST   /api/sessions/:id/workflow-run-script  - Dynamic workflow (custom script)`);
  console.log(`  GET    /api/sessions/:id/workflow-result      - Get workflow result`);
  console.log(``);
  });
}

startServer().catch((error) => {
  console.error('IM-Training-Agent 服务启动失败：', error);
  process.exit(1);
});
