import dotenv from 'dotenv';
dotenv.config();

import { randomUUID } from 'node:crypto';
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

import { openSqlite, getDatasetDatabasePath, getLearningDatabasePath, initializeDatasetDatabase, initializeLearningDatabase } from '../src/learning/sqlite.js';
import { EvidenceService, rebuildDocumentFts, seedMetroCatalog } from '../src/learning/evidence.js';
import { importKnowledgeCards } from '../src/learning/knowledge-import.js';
import { importCsvDataset } from '../src/learning/tabular.js';
import { importMetroPt3Csv } from '../src/learning/metropt3.js';
import { IdentityStore, type AuthenticatedLearner, type OnboardingInput } from '../src/learning/identity.js';
import { LearningStore, type LearningPathEdgeView, type LearningPathNodeView, type LearningPathRevisionInput } from '../src/learning/store.js';
import { buildLlmResourceDocument, buildResourceDraft } from '../src/learning/resource-builder.js';
import { auditResource } from '../src/learning/audit.js';
import type { EvidencePack, LearningResourceType, ResourceDocument } from '../src/learning/types.js';

const learningDb = openSqlite(getLearningDatabasePath());
const datasetDb = openSqlite(getDatasetDatabasePath());
initializeLearningDatabase(learningDb);
initializeDatasetDatabase(datasetDb);
seedMetroCatalog(datasetDb);
importCsvDataset(datasetDb, {
  id: 'ai4i-2020',
  name: 'AI4I 2020 Predictive Maintenance',
  csvPath: path.resolve(process.cwd(), 'data', 'datasets', 'ai4i', 'ai4i_2020.csv'),
  sourcePath: 'IM-Training-Agent-datasets/raw/AI4I_2020.zip::ai4i2020.csv',
  license: 'UCI AI4I 2020（引用以官方页面为准）',
  labelFields: ['Machine failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF'],
  fieldMeanings: {
    'UDI': '样本编号',
    'Product ID': '产品编号，首字母 L/M/H 对应低/中/高质量等级',
    'Type': '产品质量等级 L/M/H',
    'Air temperature [K]': '环境温度',
    'Process temperature [K]': '工艺温度',
    'Rotational speed [rpm]': '主轴转速',
    'Torque [Nm]': '扭矩',
    'Tool wear [min]': '刀具累计磨损时间',
    'Machine failure': '机器故障总标签（1 表示本次记录发生故障）',
    'TWF': '刀具磨损故障',
    'HDF': '散热故障（温差过小或转速过低）',
    'PWF': '功率故障（转速与扭矩乘积偏离额定范围）',
    'OSF': '过应力故障（扭矩与磨损过大）',
    'RNF': '随机故障',
  },
});
importKnowledgeCards(datasetDb);
rebuildDocumentFts(datasetDb);
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
    studyRunning: surface === 'study' && activeStudyRuns.has(learner.id),
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

// ---------- 学习页多智能体协同 Run：每步真实执行，消息逐条入库，前端轮询呈现群聊 ----------
const RESOURCE_TYPE_LABELS: Record<LearningResourceType, string> = {
  lecture: '讲义', tiered_quiz: '分层习题', practice_guide: '实操指南',
  concept_map: '知识图谱', review_cards: '复习卡片', challenge_task: '挑战任务',
};

const activeStudyRuns = new Map<string, { runId: string; startedAt: number }>();

interface StudyRunInput {
  content: string;
  pathNode: LearningPathNodeView | null;
  resourceType: LearningResourceType;
  collaborationPreference: 'auto' | 'custom';
  selectedAgentIds: LearningAgentId[];
  temporaryReference?: { name: string; content: string };
}

function saveAgentBubble(learnerId: string, runId: string, agentId: string, name: string, content: string): void {
  learningStore.saveChatMessage(learnerId, 'assistant', content, {
    surface: 'study', kind: 'agent', runId, agentId, agentName: name,
  });
}

async function callStudyModel(agentId: LearningAgentId, system: string, user: string, maxTokens = 1600): Promise<string> {
  const route = getAgentExecutionSettings(agentId, undefined, undefined);
  const response = await withTimeout(
    multiModelClient.simple({
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      model: route.model,
      temperature: route.thinking.temperature,
      maxTokens: Math.min(route.thinking.maxTokens, maxTokens),
    }),
    30_000,
    '模型调用超时',
  );
  return response.text;
}

function evidenceDigest(pack: EvidencePack): unknown {
  return pack.items.slice(0, 10).map((item) => ({
    title: item.sourceTitle,
    locator: item.locator,
    content: item.content.slice(0, 240),
  }));
}

async function executeStudyRun(learner: AuthenticatedLearner, input: StudyRunInput, runId: string): Promise<void> {
  const startedAt = Date.now();
  const typeLabel = RESOURCE_TYPE_LABELS[input.resourceType];
  const nodeName = input.pathNode?.title ?? '当前学习目标';
  try {
    // 1) 证据检索（结构化 SQL + FTS 文档），后续每个智能体都以它为输入
    const evidencePack = evidenceService.buildEvidencePack(input.content, {
      learnerId: learner.id, sessionId: `study-${Date.now()}`, temporaryReference: input.temporaryReference,
    });
    const structuredItems = evidencePack.items.filter((item) => item.sourceType === 'dataset');
    const documentItems = evidencePack.items.filter((item) => item.sourceType === 'document');

    saveAgentBubble(learner.id, runId, 'orchestrator', '协同总控 Agent',
      `收到任务：为「${nodeName}」生成${typeLabel}。编排：学情定位 → 双路检索（结构化 + 文档）→ 领域核对 → 资源生成 → 审核与发布门禁${input.collaborationPreference === 'custom' ? '（遵循你指定的角色）' : ''}。开始执行。`);

    // 2) 同类智能体多实例：结构化检索与文档检索各一路，真实并行查询
    const sampleRows = structuredItems.filter((item) => item.metadata?.['queryKind'] === 'recent_rows' || item.metadata?.['queryKind'] === 'dataset_row');
    saveAgentBubble(learner.id, runId, 'evidence_retrieval', '知识检索 Agent · 结构化',
      `完成结构化检索：取回 ${structuredItems.length} 条数据证据（含 ${sampleRows.length} 行代表性样本），可回溯定位如：${structuredItems[0]?.locator ?? '无'}。`);
    saveAgentBubble(learner.id, runId, 'evidence_retrieval', '知识检索 Agent · 文档',
      documentItems.length > 0
        ? `完成文档检索：按相关度命中 ${documentItems.length} 份资料，最相关《${documentItems[0]?.sourceTitle ?? ''}》${documentItems[0]?.locator ? `（${documentItems[0].locator}）` : ''}。`
        : '文档检索未命中可用资料，将提示生成端只依赖结构化数据并保守表达。');

    // 3) 学情与路径智能体（LLM，失败回退确定性文案）
    const profile = learningStore.getProfile(learner.id);
    let analysis = '';
    let requirements: string[] = [];
    try {
      const planningRaw = await callStudyModel('learning_planning',
        '你是学习协同中的“学情与路径智能体”。只输出 JSON：{"analysis":"不超过120字的第一人称分析：你看到了什么学习状态，因此本次资源如何定位","requirements":["3到5条对本次资源的具体设计要求"]}。禁止虚构任何数据或作答记录。',
        JSON.stringify({
          node: input.pathNode ? { title: input.pathNode.title, description: input.pathNode.description, recommendation: input.pathNode.recommendation } : null,
          profile: { accuracy: profile.accuracy, studyMinutes: profile.studyMinutes, assetsCount: profile.assetsCount, skills: profile.skills.slice(0, 6) },
          task: { resourceType: typeLabel, content: input.content },
        }));
      const parsed = parseJson<{ analysis?: unknown; requirements?: unknown }>(planningRaw) ?? {};
      analysis = typeof parsed.analysis === 'string' ? parsed.analysis.slice(0, 300) : '';
      requirements = Array.isArray(parsed.requirements) ? parsed.requirements.map((item) => String(item).slice(0, 80)).filter(Boolean).slice(0, 5) : [];
    } catch { /* 走回退文案 */ }
    if (!analysis || requirements.length === 0) {
      analysis = `我先核对了你的学习状态：累计学习 ${profile.studyMinutes} 分钟，正确率 ${profile.accuracy === null || profile.accuracy === undefined ? '暂无' : `${Math.round(profile.accuracy * 100)}%`}。本次${typeLabel}围绕「${nodeName}」展开：先把概念讲准，再配合真实数据摘录。`;
      requirements = ['从学习者当前水平切入，不跳步', '引用证据中的数据并保留定位', '明确结论边界与不确定处'];
    }
    saveAgentBubble(learner.id, runId, 'learning_planning', '学情与路径智能体',
      `${analysis}\n设计要求：\n${requirements.map((item) => `- ${item}`).join('\n')}`);

    // 4) 领域诊断智能体（LLM，失败回退）
    let points: string[] = [];
    let boundaries: string[] = [];
    try {
      const domainRaw = await callStudyModel('domain_expert',
        '你是“领域诊断智能体”，负责设备数据分析领域的专业准确性。只输出 JSON：{"points":["3到5条讲解要点"],"boundaries":["2到3条必须强调的专业边界或不确定性提醒"]}。要点与边界必须能在给定证据中找到依据，禁止编造阈值或数据。',
        JSON.stringify({ task: input.content, evidence: evidenceDigest(evidencePack) }));
      const parsed = parseJson<{ points?: unknown; boundaries?: unknown }>(domainRaw) ?? {};
      points = Array.isArray(parsed.points) ? parsed.points.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 5) : [];
      boundaries = Array.isArray(parsed.boundaries) ? parsed.boundaries.map((item) => String(item).slice(0, 100)).filter(Boolean).slice(0, 3) : [];
    } catch { /* 走回退文案 */ }
    if (points.length === 0) {
      points = ['先解释关键字段含义与观察方法', '用证据中的数据示例说明判断依据'];
      boundaries = ['数据异常只支持风险判断，不等于确定故障', '结论需保留现场复核建议'];
    }
    saveAgentBubble(learner.id, runId, 'domain_expert', '领域诊断智能体',
      `讲解要点：\n${points.map((item) => `- ${item}`).join('\n')}\n专业边界：\n${boundaries.map((item) => `- ${item}`).join('\n')}`);

    // 5) 资源生成智能体（讲义/实操走 LLM 正文，其余类型用内置结构模板）
    const llmEligible = input.resourceType === 'lecture' || input.resourceType === 'practice_guide';
    let resource: ResourceDocument;
    let generationNote = '';
    let llmResource: ResourceDocument | null = null;
    if (llmEligible) {
      try {
        const genRaw = await callStudyModel('resource_generation',
          `你是“个性化资源生成智能体”，为学习者生成${typeLabel}。只输出 JSON：{"title":"资源标题","objectives":["2到3条学习目标"],"sections":[{"heading":"小节标题","text":"150到260字的正文"}]}，sections 给 2 到 4 个。要求：融合给定证据；引用数字必须与证据一致；面向初学者；禁止编造证据之外的阈值或结论。`,
          JSON.stringify({ designRequirements: requirements, domainPoints: points, domainBoundaries: boundaries, evidence: evidenceDigest(evidencePack) }), 2400);
        const parsed = parseJson<{ title?: unknown; objectives?: unknown; sections?: unknown }>(genRaw);
        const sections = parsed && Array.isArray(parsed.sections) ? parsed.sections.flatMap((item) => {
          const section = item as { heading?: unknown; text?: unknown };
          return typeof section.heading === 'string' && typeof section.text === 'string' ? [{ heading: section.heading, text: section.text }] : [];
        }) : [];
        if (parsed && typeof parsed.title === 'string' && sections.length >= 2) {
          llmResource = buildLlmResourceDocument(`study-${Date.now()}`, input.content, input.resourceType, evidencePack, input.pathNode?.knowledgePointId, {
            title: parsed.title,
            objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map((item) => String(item)) : [],
            sections,
          });
        }
      } catch { generationNote = '生成模型输出异常，已切换内置结构模板。'; }
    }
    if (llmResource) {
      resource = llmResource;
    } else {
      resource = buildResourceDraft(`study-${Date.now()}`, input.content, input.resourceType, evidencePack, input.pathNode?.knowledgePointId);
      if (llmEligible && !generationNote) generationNote = '为保证结构化质量，本篇使用内置结构模板生成。';
    }
    saveAgentBubble(learner.id, runId, 'resource_generation', '资源生成智能体',
      `初稿完成：《${resource.title}》，共 ${resource.blocks.length} 个内容块（含代码示例与数据摘录）。${generationNote || '已按设计要求融入证据引用，交由审核。'}`);

    // 6) 审核与发布门禁（确定性逐条 Claim）；未通过时退回生成端修订一轮，仍不过用内置模板兜底
    const auditOnce = (doc: ResourceDocument) => {
      const result = auditResource(doc, evidencePack);
      const publication = resolveResourcePublication(result.summary.status);
      const audited = { ...doc, evidencePackId: evidencePack.id, auditSummary: result.summary, auditStatus: publication.auditStatus };
      learningStore.saveResourceAudit(audited.id, result.claims);
      return { result, publication, audited };
    };
    const auditNarrative = (result: ReturnType<typeof auditResource>, round: string) => {
      const supported = result.claims.filter((claim) => claim.verdict === 'supported').length;
      const review = result.claims.filter((claim) => claim.verdict === 'review').length;
      const unsupported = result.claims.filter((claim) => claim.verdict === 'unsupported').length;
      return `${round}逐条核对 ${result.claims.length} 条内容声明：支持 ${supported}、待复核 ${review}、无证据支持 ${unsupported}。来源交叉验证：${result.summary.status === 'corroborated' ? '结构化数据与领域文档互证通过' : '来源单一，需保守表达'}。`;
    };

    let outcome = auditOnce(resource);
    if (!outcome.publication.persist && outcome.result.summary.status === 'needs_review' && llmEligible) {
      saveAgentBubble(learner.id, runId, 'cross_validation', '交叉验证与审核 Agent',
        `${auditNarrative(outcome.result, '第一轮：')}未通过发布门禁，退回生成端修订。`);
      const failedClaims = outcome.result.claims
        .filter((claim) => claim.verdict !== 'supported')
        .map((claim) => ({ text: claim.text.slice(0, 160), critique: claim.critique }));
      saveAgentBubble(learner.id, runId, 'resource_generation', '资源生成智能体',
        `收到退回：${failedClaims.length} 处内容需要修订。我会把这些数字改为与证据一致，或删除无法核对的表述。`);
      try {
        const revisedRaw = await callStudyModel('resource_generation',
          `你是“个性化资源生成智能体”。审核退回了${typeLabel}初稿中无法与证据核对的内容。只输出修订后的 JSON：{"title":"资源标题","objectives":["2到3条学习目标"],"sections":[{"heading":"小节标题","text":"150到260字的正文"}]}。要求：保持其余内容不变；被退回的表述要么改成与证据一致的数字，要么删除数字改为定性描述；仍禁止编造证据之外的阈值。`,
          JSON.stringify({ failedClaims, designRequirements: requirements, evidence: evidenceDigest(evidencePack) }), 2400);
        const parsed = parseJson<{ title?: unknown; objectives?: unknown; sections?: unknown }>(revisedRaw);
        const sections = parsed && Array.isArray(parsed.sections) ? parsed.sections.flatMap((item) => {
          const section = item as { heading?: unknown; text?: unknown };
          return typeof section.heading === 'string' && typeof section.text === 'string' ? [{ heading: section.heading, text: section.text }] : [];
        }) : [];
        if (parsed && typeof parsed.title === 'string' && sections.length >= 2) {
          const revised = buildLlmResourceDocument(`study-${Date.now()}`, input.content, input.resourceType, evidencePack, input.pathNode?.knowledgePointId, {
            title: parsed.title,
            objectives: Array.isArray(parsed.objectives) ? parsed.objectives.map((item) => String(item)) : [],
            sections,
          });
          const second = auditOnce(revised);
          if (second.publication.persist) {
            outcome = second;
            saveAgentBubble(learner.id, runId, 'resource_generation', '资源生成智能体', '修订完成：已清除无法核对的数字，重新提交审核。');
          }
        }
      } catch { /* 修订失败则走模板兜底 */ }
    }
    if (!outcome.publication.persist && llmEligible && evidencePack.items.length > 0) {
      saveAgentBubble(learner.id, runId, 'resource_generation', '资源生成智能体', '修订后仍未通过，为保证可追溯性，改用内置结构模板重新生成。');
      resource = buildResourceDraft(`study-${Date.now()}`, input.content, input.resourceType, evidencePack, input.pathNode?.knowledgePointId);
      outcome = auditOnce(resource);
    }
    const { result: finalAudit, publication: finalPublication, audited: auditedResource } = outcome;
    if (finalPublication.persist) learningStore.saveAsset(learner.id, undefined, auditedResource);
    saveAgentBubble(learner.id, runId, 'cross_validation', '交叉验证与审核 Agent',
      `${auditNarrative(finalAudit, '最终：')}${finalPublication.persist ? '通过发布门禁，资源已入库。' : '仍未通过发布门禁，本资源不作为已审核资产发布。'}`);
    saveAgentBubble(learner.id, runId, 'privacy_compliance', '合规与隐私 Agent',
      input.temporaryReference
        ? `本次使用了上传的临时参考《${input.temporaryReference.name}》：仅用于当前任务，不写入知识库、不进入画像，原文不保存。`
        : '未检测到上传资料，无隐私边界问题。');

    // 7) 资产卡片与总控收尾
    learningStore.saveChatMessage(learner.id, 'assistant', finalPublication.persist ? `已生成《${auditedResource.title}》` : `《${auditedResource.title}》待复核，未入库`, {
      surface: 'study', kind: 'asset', runId,
      pathNodeId: input.pathNode?.id ?? null, resourceType: input.resourceType,
      asset: { id: auditedResource.id, title: auditedResource.title, type: auditedResource.type, auditStatus: auditedResource.auditStatus, persisted: finalPublication.persist },
      evidence: { count: evidencePack.items.length, score: evidencePack.coverageScore, crossValidation: finalAudit.summary.status },
    });
    saveAgentBubble(learner.id, runId, 'orchestrator', '协同总控 Agent',
      finalPublication.persist
        ? `本次协同完成：证据 ${evidencePack.items.length} 条，审核声明 ${finalAudit.claims.length} 条，用时 ${Math.max(1, Math.round((Date.now() - startedAt) / 1000))} 秒。去「资源」页阅读《${auditedResource.title}》，或继续 @ 节点让我调整。`
        : `本次协同未产出已审核资产（发布门禁未通过）。建议补充更具体的设备数据关键词（如“压力传感器 异常 现场复核”）再试一次。`);
    learningStore.recordLearningEvent(learner.id, 'study_run_completed', {
      runId, pathNodeId: input.pathNode?.id ?? null, resourceType: input.resourceType,
      persisted: finalPublication.persist, evidenceCount: evidencePack.items.length, claims: finalAudit.claims.length,
      durationMs: Date.now() - startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    saveAgentBubble(learner.id, runId, 'orchestrator', '协同总控 Agent',
      `协同执行中断：${message.slice(0, 160)}。请重试，或换个更具体的任务描述。`);
    learningStore.recordLearningEvent(learner.id, 'study_run_failed', { runId, error: message.slice(0, 300), durationMs: Date.now() - startedAt });
  }
}

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
  if (activeStudyRuns.has(learner.id)) {
    res.status(409).json({ success: false, error: '已有一个协同任务进行中，请等它完成后再发起' });
    return;
  }
  const pathNode = learningStore.getPathGraph(learner.id).nodes.find((node) => node.id === pathNodeId) ?? null;
  learningStore.saveChatMessage(learner.id, 'user', content, {
    surface: 'study', pathNodeId: pathNode?.id ?? null, resourceType,
  });
  const runId = `study-run-${randomUUID()}`;
  activeStudyRuns.set(learner.id, { runId, startedAt: Date.now() });
  void executeStudyRun(learner, { content, pathNode, resourceType, collaborationPreference, selectedAgentIds, temporaryReference }, runId)
    .finally(() => activeStudyRuns.delete(learner.id));
  res.json({ success: true, runId, running: true });
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
