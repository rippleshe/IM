/**
 * 模型与协同运行时共享模块（从 server/index.ts 原样搬移）。
 * API 进程与 BullMQ Worker 进程都必须用同一份模型注册、角色路由和发布门禁判定，
 * 避免 api/worker 两套实现漂移。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  ModelRegistry,
  MultiModelClient,
  createDefaultModelProvidersConfig,
  loadModelProvidersConfig,
} from '../src/models/index.js';
import type { ModelProvidersConfig } from '../src/models/config.js';

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
const AUTO_ASSET_TYPES = ['lecture', 'tiered_quiz', 'concept_map'] as const;
export { AUTO_ASSET_TYPES };
export type AutoAssetType = typeof AUTO_ASSET_TYPES[number];
export type RuntimeWorkbenchSettings = {
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
    if (Array.isArray(parsed.autoAssetTypes)) {
      const selected = parsed.autoAssetTypes.filter((type): type is AutoAssetType => AUTO_ASSET_TYPES.includes(type as AutoAssetType));
      if (selected.length > 0) defaults.autoAssetTypes = selected;
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
const runtimeModelConfig = loadRuntimeModelConfig();

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
  const provider = modelRegistry.getDefaultProvider();
  const model = provider
    ? modelRegistry.listModels(provider.id)[0]
    : modelRegistry.listModels()[0];

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
