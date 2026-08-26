import OpenAI from 'openai';
import { MultiModelClient } from './client.js';
import type { ModelRegistry } from './registry.js';
import type { TaskComplexityHint } from './config.js';

export interface LLMProviderAdapterOptions {
  registry: ModelRegistry;
  strategy?: string;
  defaultModel?: string;
}

export class LLMProviderAdapter {
  private readonly multiModelClient: MultiModelClient;

  constructor(options: LLMProviderAdapterOptions) {
    this.multiModelClient = new MultiModelClient({
      registry: options.registry,
      defaultStrategy: (options.strategy as import('./router.js').ModelSelectionStrategy) ?? 'complexity',
    });
  }

  async create(params: {
    model?: string;
    messages: OpenAI.Chat.ChatCompletionMessageParam[];
    temperature?: number;
    max_tokens?: number;
    complexity?: TaskComplexityHint['complexity'];
  }): Promise<unknown> {
    const response = await this.multiModelClient.chat({
      messages: params.messages,
      model: params.model,
      temperature: params.temperature,
      maxTokens: params.max_tokens,
      complexityHint: params.complexity ? { complexity: params.complexity } : undefined,
    });

    if (response.raw) {
      return response.raw;
    }

    const text = response.text;
    // Cast the whole object to unknown to avoid ChatCompletionMessage.refusal typing issue
    return {
      id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model ?? params.model ?? 'unknown',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: text,
          },
          finish_reason: 'stop',
        },
      ],
      usage: response.usage
        ? {
            prompt_tokens: response.usage.promptTokens,
            completion_tokens: response.usage.completionTokens,
            total_tokens: response.usage.totalTokens,
          }
        : undefined,
    } as unknown;
  }
}
