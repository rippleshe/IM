/**
 * 模型与协同运行时共享模块（从 server/index.ts 原样搬移）。
 * API 进程与 BullMQ Worker 进程都必须用同一份模型注册、角色路由和发布门禁判定，
 * 避免 api/worker 两套实现漂移。
 */
// 必须最先加载：模型注册在模块求值时读取 DASHSCOPE_API_KEY（ESM import 提升早于入口的 dotenv.config()）
import 'dotenv/config';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import OpenAI from 'openai';

import {
  ModelRegistry,
  MultiModelClient,
  createDefaultModelProvidersConfig,
  loadModelProvidersConfig,
} from '../src/models/index.js';
import type { ModelConfig, ModelProvidersConfig, ProviderConfig } from '../src/models/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const runtimeModelSettingsPath = path.resolve(process.cwd(), '.im-training-agent', 'model-settings.json');
const runtimeWorkbenchSettingsPath = path.resolve(process.cwd(), '.im-training-agent', 'workbench-settings.json');

export const LEARNING_AGENT_IDS = [
  'learning_planning',
  'evidence_retrieval',
  'domain_expert',
  'resource_generation',
  'cross_validation',
  'privacy_compliance',
] as const;
export type LearningAgentId = typeof LEARNING_AGENT_IDS[number];
type AgentRouteConfig = { modelId: string; thinkingDepth: 'inherit' | ThinkingDepth };
export type RuntimeWorkbenchSettings = {
  agentRouting: Record<LearningAgentId, AgentRouteConfig>;
  defaultModelId: string;
  defaultThinkingDepth: ThinkingDepth;
};

function createDefaultWorkbenchSettings(): RuntimeWorkbenchSettings {
  return {
    agentRouting: Object.fromEntries(LEARNING_AGENT_IDS.map((id) => [id, { modelId: '', thinkingDepth: 'inherit' }])) as Record<LearningAgentId, AgentRouteConfig>,
    defaultModelId: '',
    defaultThinkingDepth: 'medium',
  };
}

function loadRuntimeWorkbenchSettings(): RuntimeWorkbenchSettings {
  const defaults = createDefaultWorkbenchSettings();
  if (!existsSync(runtimeWorkbenchSettingsPath)) return defaults;
  try {
    const parsed = JSON.parse(readFileSync(runtimeWorkbenchSettingsPath, 'utf8')) as Partial<RuntimeWorkbenchSettings>;
    const source = parsed.agentRouting ?? ({} as Partial<Record<LearningAgentId, AgentRouteConfig>>);
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
  } catch {
    // Fall back to safe local defaults when the optional settings file is malformed.
  }
  return defaults;
}

export const runtimeWorkbenchSettings = loadRuntimeWorkbenchSettings();

export function saveRuntimeWorkbenchSettings(): void {
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
/** 运行时模型配置（设置页保存的 provider/model 覆盖）；index.ts 的 settings 端点也使用 */
export const runtimeModelConfig = loadRuntimeModelConfig();

export function mergeModelConfig(): ModelProvidersConfig {
  const providers = new Map(baseModelConfig.providers.map((provider) => [provider.id, provider]));
  for (const provider of runtimeModelConfig.providers) providers.set(provider.id, provider);
  const models = new Map(baseModelConfig.models.map((model) => [model.id, model]));
  for (const model of runtimeModelConfig.models) models.set(model.id, model);
  return { providers: Array.from(providers.values()), models: Array.from(models.values()) };
}

export function saveRuntimeModelConfig(): void {
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

export const modelRegistry = buildModelRegistry();
export const multiModelClient = new MultiModelClient({
  registry: modelRegistry,
  defaultStrategy: 'complexity',
});

export function getPrimaryModelRuntime() {
  // 工作台默认模型优先于基础配置的 isDefault，避免本地运行时选择已切换模型后仍回退到 DashScope。
  const configuredModel = runtimeWorkbenchSettings.defaultModelId
    ? modelRegistry.getModel(runtimeWorkbenchSettings.defaultModelId)
    : undefined;
  const provider = configuredModel
    ? modelRegistry.getProvider(configuredModel.provider)
    : modelRegistry.getDefaultProvider();
  const model = configuredModel ?? (provider
    ? modelRegistry.listModels(provider.id)[0]
    : modelRegistry.listModels()[0]);

  return {
    provider: provider?.id ?? 'dashscope',
    apiKey: provider?.apiKey ?? process.env['DASHSCOPE_API_KEY'] ?? '',
    baseURL: provider?.baseURL ?? process.env['DASHSCOPE_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: model?.id ?? process.env['QWEN_MODEL'] ?? 'qwen-plus',
  };
}

export type ThinkingDepth = 'low' | 'medium' | 'high' | 'max';

export function getThinkingSettings(value: unknown): { temperature: number; maxTokens: number } {
  switch (value) {
    case 'low': return { temperature: 0.7, maxTokens: 2048 };
    case 'high': return { temperature: 0.3, maxTokens: 6144 };
    case 'max': return { temperature: 0.2, maxTokens: 8192 };
    default: return { temperature: 0.45, maxTokens: 4096 };
  }
}

export function getRequestedModel(value: unknown): string | undefined {
  const model = typeof value === 'string' ? value.trim() : '';
  return model && modelRegistry.hasModel(model) ? model : undefined;
}

export type DiscoveredProviderModel = {
  id: string;
  displayName: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

const capabilityRefreshAt = new Map<string, number>();
const CAPABILITY_REFRESH_TTL_MS = 15 * 60 * 1_000;

function readPositiveInteger(source: Record<string, unknown>, paths: string[]): number | undefined {
  for (const pathKey of paths) {
    let current: unknown = source;
    for (const segment of pathKey.split('.')) {
      current = current && typeof current === 'object'
        ? (current as Record<string, unknown>)[segment]
        : undefined;
    }
    const value = typeof current === 'string' ? Number(current) : current;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.floor(value);
  }
  return undefined;
}

/**
 * OpenAI 兼容服务的 /models 没有统一的能力字段；这里兼容常见供应商扩展。
 * 没返回的能力保持 unknown，由已有缓存与内部安全预算兜底。
 */
function normalizeDiscoveredModel(raw: unknown): DiscoveredProviderModel | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Record<string, unknown>;
  const id = typeof source['id'] === 'string' ? source['id'].trim() : '';
  if (!id) return null;
  const name = [source['display_name'], source['displayName'], source['name']]
    .find((value) => typeof value === 'string' && value.trim()) as string | undefined;
  const contextWindow = readPositiveInteger(source, [
    'context_window', 'contextWindow', 'context_length', 'contextLength',
    'max_context_length', 'maxContextLength', 'max_model_len', 'input_token_limit',
    'max_input_tokens', 'limits.context', 'limits.context_window', 'limits.contextWindow',
    'capabilities.context_window', 'capabilities.contextWindow', 'metadata.context_window',
    'metadata.context_length', 'architecture.context_length',
  ]);
  const maxOutputTokens = readPositiveInteger(source, [
    'max_output_tokens', 'maxOutputTokens', 'output_token_limit', 'max_completion_tokens',
    'limits.output', 'limits.max_output_tokens', 'limits.maxOutputTokens',
    'capabilities.max_output_tokens', 'capabilities.maxOutputTokens',
    'metadata.max_output_tokens',
  ]);
  return {
    id,
    displayName: name?.trim() || id,
    ...(contextWindow ? { contextWindow } : {}),
    ...(maxOutputTokens ? { maxOutputTokens } : {}),
  };
}

export async function discoverProviderModels(provider: Pick<ProviderConfig, 'baseURL' | 'apiKey' | 'headers'>): Promise<DiscoveredProviderModel[]> {
  const client = new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, defaultHeaders: provider.headers });
  const page = await withTimeout(client.models.list(), 15_000, '模型目录读取超时');
  return page.data
    .map((model) => normalizeDiscoveredModel(model))
    .filter((model): model is DiscoveredProviderModel => Boolean(model))
    .sort((left, right) => left.displayName.localeCompare(right.displayName, 'zh-CN'));
}

function persistDiscoveredCapabilities(modelId: string, discovered: DiscoveredProviderModel): void {
  const current = modelRegistry.getModel(modelId);
  if (!current || (!discovered.contextWindow && !discovered.maxOutputTokens)) return;
  const updated: ModelConfig = {
    ...current,
    ...(discovered.contextWindow ? { contextWindow: discovered.contextWindow } : {}),
    ...(discovered.maxOutputTokens ? { maxOutputTokens: discovered.maxOutputTokens } : {}),
  };
  modelRegistry.registerModel(updated);
  const runtimeIndex = runtimeModelConfig.models.findIndex((model) => model.id === modelId);
  if (runtimeIndex >= 0) {
    runtimeModelConfig.models[runtimeIndex] = updated;
    saveRuntimeModelConfig();
  }
}

/** 模型被选择或开始任务时刷新能力；短 TTL 防止每条消息都请求服务商。 */
export async function refreshModelCapabilities(modelId: string | undefined, force = false): Promise<{ contextWindow: number; maxOutputTokens: number }> {
  if (!modelId) return getModelLimits(modelId);
  const lastRefresh = capabilityRefreshAt.get(modelId) ?? 0;
  if (!force && Date.now() - lastRefresh < CAPABILITY_REFRESH_TTL_MS) return getModelLimits(modelId);
  const model = modelRegistry.getModel(modelId);
  const provider = model ? modelRegistry.getProvider(model.provider) : undefined;
  if (!model || !provider?.apiKey) return getModelLimits(modelId);
  try {
    const models = await discoverProviderModels(provider);
    const discovered = models.find((item) => item.id === modelId);
    if (discovered) persistDiscoveredCapabilities(modelId, discovered);
  } catch {
    // 部分兼容服务不实现 /models；不影响已配置模型调用，继续使用缓存与安全预算。
  } finally {
    capabilityRefreshAt.set(modelId, Date.now());
  }
  return getModelLimits(modelId);
}

/** 由实际选中的模型能力缓存声明上下文预算；未知时使用内部安全预算。 */
export function getModelLimits(modelId: string | undefined): { contextWindow: number; maxOutputTokens: number } {
  const model = modelId ? modelRegistry.getModel(modelId) : undefined;
  return {
    contextWindow: Math.max(1, model?.contextWindow ?? 128_000),
    maxOutputTokens: Math.max(1, model?.maxOutputTokens ?? 8_192),
  };
}

export function getAgentExecutionSettings(agentId: string, requestedModel: string | undefined, requestedDepth: unknown) {
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

export function getSettingsPayload() {
  const config = mergeModelConfig();
  const providerMap = new Map(config.providers.map((provider) => [provider.id, provider]));
  const storageKind = 'postgres' as const;
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
    privacy: {
      uploadPolicy: 'session_only' as const,
      uploadContentRetained: false as const,
      learnerDataScope: storageKind,
      dataSource: 'PostgreSQL 16 + pgvector',
    },
  };
}

export function resolveResourcePublication(auditStatus: string): { auditStatus: 'passed' | 'manual_review_required'; persist: boolean } {
  if (auditStatus === 'corroborated') return { auditStatus: 'passed', persist: true };
  return { auditStatus: 'manual_review_required', persist: false };
}

export function parseJson<T>(text: string): T | null {
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

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
