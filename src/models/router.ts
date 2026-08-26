import { ModelRegistry } from './registry.js';
import type { ModelConfig, ModelSpecialty, TaskComplexityHint } from './config.js';

export type ModelSelectionStrategy =
  | 'complexity'         // 按任务复杂度选模型（默认）
  | 'specialty'          // 按任务所需能力标签选模型
  | 'cheapest'           // 按价格选最便宜模型
  | 'round_robin'        // 轮询
  | 'fallback';          // 指定首选模型，失败后降级

export interface ModelSelectionContext {
  /** 任务复杂度提示 */
  complexityHint?: TaskComplexityHint;
  /** 任务类型，用于 specialty 路由 */
  taskType?: string;
  /** 已失败过的模型 ID，用于 fallback 策略 */
  failedModelIds?: string[];
  /** 是否允许使用 light 模型 */
  allowLightModel?: boolean;
}

export interface ModelSelectionResult {
  model: ModelConfig;
  providerId: string;
  reason: string;
  fallbackChain?: ModelConfig[];
}

export class ModelRouter {
  private registry: ModelRegistry;
  private roundRobinCounters: Map<string, number> = new Map();

  constructor(registry: ModelRegistry) {
    this.registry = registry;
  }

  select(
    strategy: ModelSelectionStrategy,
    context: ModelSelectionContext = {}
  ): ModelSelectionResult {
    switch (strategy) {
      case 'complexity':
        return this.selectByComplexity(context);
      case 'specialty':
        return this.selectBySpecialty(context);
      case 'cheapest':
        return this.selectCheapest(context);
      case 'round_robin':
        return this.selectRoundRobin(context);
      case 'fallback':
        return this.selectWithFallback(context);
      default:
        return this.selectByComplexity(context);
    }
  }

  private selectByComplexity(context: ModelSelectionContext): ModelSelectionResult {
    const complexity = context.complexityHint?.complexity ?? 'medium';
    const requiredSpecialties = context.complexityHint?.requiredSpecialties ?? [];
    const failedIds = new Set(context.failedModelIds ?? []);

    // 先按复杂度过滤，再按 specialty 精确匹配
    let candidates = this.registry.getModelsByComplexity(complexity);

    if (requiredSpecialties.length > 0) {
      const specialtyCandidates = candidates.filter((m) =>
        requiredSpecialties.some((s) => (m.specialties ?? []).includes(s))
      );
      if (specialtyCandidates.length > 0) {
        candidates = specialtyCandidates;
      }
    }

    // 排除已失败的模型
    candidates = candidates.filter((m) => !failedIds.has(m.id));

    // 如果过滤后无结果，扩大范围
    if (candidates.length === 0) {
      candidates = this.registry
        .listModels()
        .filter((m) => !failedIds.has(m.id));
    }

    if (candidates.length === 0) {
      throw new Error('No available model found for the given strategy and context');
    }

    // 优先选择支持 tools 的模型
    const withTools = candidates.filter((m) => m.tags?.includes('tools') || !complexity || true);
    const selected = withTools.length > 0 ? withTools[0]! : candidates[0]!;

    const fallbackChain = candidates.slice(1);

    return {
      model: selected,
      providerId: selected.provider,
      reason: `Selected ${selected.id} (complexity=${complexity}${requiredSpecialties.length ? `, specialties=[${requiredSpecialties.join(',')}]` : ''})`,
      fallbackChain,
    };
  }

  private selectBySpecialty(context: ModelSelectionContext): ModelSelectionResult {
    const specialties = context.complexityHint?.requiredSpecialties ?? [];
    const failedIds = new Set(context.failedModelIds ?? []);

    if (specialties.length === 0) {
      return this.selectByComplexity(context);
    }

    // 收集满足任意 specialty 的模型，并计算匹配度
    const scored = this.registry
      .listModels()
      .filter((m) => !failedIds.has(m.id))
      .map((m) => {
        const matchedSpecialties = (m.specialties ?? []).filter((s) => specialties.includes(s as ModelSpecialty));
        const score = matchedSpecialties.length / specialties.length;
        return { model: m, score, matchedSpecialties };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length === 0) {
      return this.selectByComplexity(context);
    }

    const best = scored[0]!;
    const fallbackChain = scored.slice(1).map((s) => s.model);

    return {
      model: best.model,
      providerId: best.model.provider,
      reason: `Selected ${best.model.id} (specialty match=${best.matchedSpecialties.join(',')}, score=${best.score.toFixed(2)})`,
      fallbackChain,
    };
  }

  private selectCheapest(_context: ModelSelectionContext): ModelSelectionResult {
    const cheapest = this.registry.getCheapestModel();
    if (!cheapest) {
      throw new Error('No model registered');
    }

    const fallbackChain = this.registry
      .listModels()
      .filter((m) => m.id !== cheapest.id)
      .sort(
        (a, b) =>
          (a.pricingPer1kInput ?? Infinity) + (a.pricingPer1kOutput ?? Infinity) -
          (b.pricingPer1kInput ?? Infinity) - (b.pricingPer1kOutput ?? Infinity)
      );

    return {
      model: cheapest,
      providerId: cheapest.provider,
      reason: `Selected cheapest model ${cheapest.id}`,
      fallbackChain,
    };
  }

  private selectRoundRobin(context: ModelSelectionContext): ModelSelectionResult {
    const candidates = this.registry.listModels();
    if (candidates.length === 0) {
      throw new Error('No model registered');
    }

    // 按 provider 分组轮询，避免同一 provider 连续调用
    const providerMap = new Map<string, ModelConfig[]>();
    for (const m of candidates) {
      const list = providerMap.get(m.provider) ?? [];
      list.push(m);
      providerMap.set(m.provider, list);
    }

    const providers = Array.from(providerMap.keys());
    const providerKey = context.taskType ?? 'default';

    const counter = this.roundRobinCounters.get(providerKey) ?? 0;
    const providerId = providers[counter % providers.length]!;
    this.roundRobinCounters.set(providerKey, counter + 1);

    const models = providerMap.get(providerId)!;
    const model = models[0]!;

    const fallbackChain = candidates.filter((m) => m.id !== model.id);

    return {
      model,
      providerId,
      reason: `Round-robin selected ${model.id} from provider ${providerId}`,
      fallbackChain,
    };
  }

  private selectWithFallback(context: ModelSelectionContext): ModelSelectionResult {
    const failedIds = new Set(context.failedModelIds ?? []);
    const candidates = this.registry.listModels().filter((m) => !failedIds.has(m.id));

    if (candidates.length === 0) {
      throw new Error('No available model for fallback strategy');
    }

    const selected = candidates[0]!;
    const fallbackChain = candidates.slice(1);

    return {
      model: selected,
      providerId: selected.provider,
      reason: `Fallback selected ${selected.id}`,
      fallbackChain,
    };
  }

  /**
   * 根据任务描述估算复杂度，辅助路由
   */
  estimateTaskComplexity(
    input: string,
    options?: { requiresTools?: boolean; requiresReasoning?: boolean }
  ): TaskComplexityHint {
    const length = input.length;
    const hasLongContext = length > 4000;
    const requiresTools = options?.requiresTools ?? false;
    const requiresReasoning = options?.requiresReasoning ?? false;

    if (requiresReasoning || hasLongContext) {
      return {
        complexity: 'heavy',
        requiresTools,
        requiresStreaming: true,
        estimatedInputTokens: Math.ceil(length / 2),
      };
    }

    if (requiresTools || length > 1000) {
      return {
        complexity: 'medium',
        requiresTools: true,
        estimatedInputTokens: Math.ceil(length / 2),
      };
    }

    return {
      complexity: 'light',
      requiresTools: false,
      estimatedInputTokens: Math.ceil(length / 2),
    };
  }
}
