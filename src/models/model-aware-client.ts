import type { ModelRegistry } from './registry.js';
import { MultiModelClient } from './client.js';
import { ModelRouter, type ModelSelectionStrategy } from './router.js';
import { TaskComplexityHint } from './config.js';
import { ComplexityEstimator } from './complexity-estimator.js';

export interface ModelAwareClientOptions {
  registry: ModelRegistry;
  strategy?: ModelSelectionStrategy;
}

/**
 * Wraps MultiModelClient to provide convenience methods that auto-resolve
 * model selection by task context. Used by orchestration components
 * (DeepPlanner, AgentCluster, DeepEvaluator, LLMAgentCollaboration) to
 * achieve 大小模型智能搭配.
 */
export class ModelAwareLLMClient {
  private readonly client: MultiModelClient;
  private readonly estimator: ComplexityEstimator;

  constructor(options: ModelAwareClientOptions) {
    this.client = new MultiModelClient({
      registry: options.registry,
      defaultStrategy: options.strategy ?? 'complexity',
    });
    this.estimator = new ComplexityEstimator();
  }

  /**
   * Simple chat with automatic model routing based on complexity hint.
   */
  async chat(params: {
    messages: { role: string; content: string }[];
    complexityHint?: TaskComplexityHint;
    taskType?: string;
    model?: string;
    strategy?: ModelSelectionStrategy;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return this.client.chat({
      messages: params.messages as any,
      model: params.model,
      strategy: params.strategy,
      complexityHint: params.complexityHint,
      taskType: params.taskType,
      temperature: params.temperature,
      maxTokens: params.maxTokens,
    });
  }

  /**
   * Planning: always use a heavy/reasoning-capable model.
   */
  async plan(params: {
    messages: { role: string; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return this.chat({
      messages: params.messages,
      model: params.model,
      complexityHint: { complexity: 'heavy', requiredSpecialties: ['reasoning', 'planning'], requiresStreaming: false },
      strategy: 'complexity',
      temperature: params.temperature ?? 0.3,
      maxTokens: params.maxTokens ?? 4096,
    });
  }

  /**
   * Execution: pick model by sub-task characteristics.
   */
  async execute(params: {
    messages: { role: string; content: string }[];
    complexityHint?: TaskComplexityHint;
    tools?: unknown[];
    taskType?: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return this.chat({
      messages: params.messages,
      complexityHint: params.complexityHint,
      taskType: params.taskType,
      model: params.model,
      strategy: 'complexity',
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 4096,
    });
  }

  /**
   * Evaluation: requires reasoning/analysis capability.
   */
  async evaluate(params: {
    messages: { role: string; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return this.chat({
      messages: params.messages,
      model: params.model,
      complexityHint: { complexity: 'heavy', requiredSpecialties: ['reasoning', 'analysis'], requiresStreaming: false },
      strategy: 'complexity',
      temperature: params.temperature ?? 0.2,
      maxTokens: params.maxTokens ?? 2048,
    });
  }

  /**
   * Simple chat: prefer light model.
   */
  async simple(params: {
    messages: { role: string; content: string }[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string; model: string; provider: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    return this.chat({
      messages: params.messages,
      model: params.model,
      complexityHint: { complexity: 'light', requiresTools: false },
      strategy: 'complexity',
      temperature: params.temperature ?? 0.7,
      maxTokens: params.maxTokens ?? 2048,
    });
  }

  /**
   * Select a model for a specific subTask, returning enough info for logging/debugging.
   */
  selectModelForSubTask(
    registry: ModelRegistry,
    subTask: {
      priority?: string;
      tools?: string[];
      assignedAgentType?: string;
    }
  ): { modelId: string; providerId: string; hint: TaskComplexityHint } {
    const router = this.client.getRouter();
    return this.estimator.selectModelForSubTask(registry, router, subTask);
  }

  getRegistry(): ModelRegistry {
    return this.client.getRegistry();
  }

  getRouter(): ModelRouter {
    return this.client.getRouter();
  }
}
