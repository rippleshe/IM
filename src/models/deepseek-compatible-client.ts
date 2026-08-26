import OpenAI from 'openai';
import { MultiModelClient } from './client.js';
import type { ModelRegistry } from './registry.js';
import type { TaskComplexityHint } from './config.js';

export interface DeepSeekCompatibleClientOptions {
  registry: ModelRegistry;
  strategy?: import('./router.js').ModelSelectionStrategy;
  defaultComplexity?: TaskComplexityHint['complexity'];
}

interface MinimalChatResponse {
  text: string;
  model?: string;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class DeepSeekCompatibleClient {
  private readonly multiModelClient: MultiModelClient;
  private readonly registry: ModelRegistry;

  constructor(options: DeepSeekCompatibleClientOptions) {
    this.registry = options.registry;
    this.multiModelClient = new MultiModelClient({
      registry: options.registry,
      defaultStrategy: options.strategy,
    });
  }

  async create(params: OpenAI.Chat.ChatCompletionCreateParams): Promise<unknown> {
    const requestedModel = params.model && this.registry.hasModel(params.model) ? params.model : undefined;
    const response: MinimalChatResponse = await this.multiModelClient.chat({
      messages: (params.messages ?? []) as OpenAI.Chat.ChatCompletionMessageParam[],
      model: requestedModel,
      temperature: params.temperature ?? undefined,
      maxTokens: params.max_tokens ?? undefined,
    });

    const usage = response.usage;
    const text = response.text;
    return {
      id: `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: response.model ?? params.model ?? 'unknown',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant' as const,
            content: text,
          },
          finish_reason: 'stop' as const,
        },
      ],
      usage: usage
        ? {
            prompt_tokens: usage.promptTokens ?? 0,
            completion_tokens: usage.completionTokens ?? 0,
            total_tokens: usage.totalTokens ?? 0,
          }
        : undefined,
    } as unknown;
  }

  get chat() {
    return {
      completions: {
        create: this.create.bind(this),
      },
    };
  }
}
