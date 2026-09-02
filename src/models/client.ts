import type OpenAI from 'openai';
import { ModelRegistry } from './registry.js';
import type { ModelProvidersConfig } from './config.js';
import { ModelRouter, ModelSelectionStrategy, ModelSelectionContext, ModelSelectionResult } from './router.js';

export interface ModelClientOptions {
  registry: ModelRegistry;
  router?: ModelRouter;
  defaultStrategy?: ModelSelectionStrategy;
}

export interface ModelCallOptions {
  model?: string;
  strategy?: ModelSelectionStrategy;
  complexityHint?: import('./config.js').TaskComplexityHint;
  taskType?: string;
  messages: OpenAI.ChatCompletionMessageParam[];
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  tools?: OpenAI.ChatCompletionTool[];
  toolChoice?: OpenAI.ChatCompletionToolChoiceOption;
  stream?: boolean;
  onStreamChunk?: (chunk: string) => void;
}

export interface ModelCallResult {
  text: string;
  model: string;
  provider: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  raw?: OpenAI.ChatCompletion;
}

export class MultiModelClient {
  private registry: ModelRegistry;
  private router: ModelRouter;
  private defaultStrategy: ModelSelectionStrategy;

  constructor(options: ModelClientOptions) {
    this.registry = options.registry;
    this.router = options.router ?? new ModelRouter(options.registry);
    this.defaultStrategy = options.defaultStrategy ?? 'complexity';
  }

  async simple(options: { messages: OpenAI.ChatCompletionMessageParam[]; model?: string; temperature?: number; maxTokens?: number }): Promise<ModelCallResult> {
    return this.chat({
      messages: options.messages,
      model: options.model,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
    });
  }

  /**
   * 流式文本调用。保留与 chat 相同的路由、超时和模型注册语义，
   * 只把服务商返回的可见正文增量交给调用方；不暴露隐藏推理字段。
   */
  async streamText(options: {
    messages: OpenAI.ChatCompletionMessageParam[];
    model?: string;
    temperature?: number;
    maxTokens?: number;
    onChunk: (chunk: string) => void;
  }): Promise<ModelCallResult> {
    return this.chat({ ...options, stream: true, onStreamChunk: options.onChunk });
  }

  async chat(options: ModelCallOptions): Promise<ModelCallResult> {
    const selection = this.resolveModel(options);
    const client = this.registry.getClientForModel(selection.model.id);

    if (!client) {
      throw new Error(
        `No OpenAI client found for provider: ${selection.model.provider}. ` +
        `Register the provider in ModelRegistry first.`
      );
    }

    const modelId = options.model ?? selection.model.id;

    try {
      const request = {
        model: modelId,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: selection.model.maxOutputTokens
          ? Math.min(options.maxTokens ?? selection.model.maxOutputTokens, selection.model.maxOutputTokens)
          : options.maxTokens ?? 4096,
        top_p: options.topP,
        tools: options.tools,
        tool_choice: options.toolChoice,
      };
      if (options.stream) {
        const stream = await client.chat.completions.create({ ...request, stream: true });
        let text = '';
        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content;
          if (typeof delta === 'string' && delta) {
            text += delta;
            options.onStreamChunk?.(delta);
          }
        }
        return { text, model: modelId, provider: selection.model.provider };
      }
      const response = await client.chat.completions.create({ ...request, stream: false });
      const text = response.choices[0]?.message?.content ?? '';
      return {
        text,
        model: modelId,
        provider: selection.model.provider,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
            }
          : undefined,
        raw: response,
      };
    } catch (error) {
      // 如果存在 fallbackChain 且不是最后一次选择，尝试降级
      const fallback = selection.fallbackChain?.[0];
      if (fallback && (!options.strategy || options.strategy !== 'fallback')) {
        const retryClient = this.registry.getClientForModel(fallback.id);
        if (retryClient) {
          try {
            const retryResponse = await retryClient.chat.completions.create({
              model: fallback.id,
              messages: options.messages,
              temperature: options.temperature ?? 0.7,
              max_tokens: fallback.maxOutputTokens
                ? Math.min(options.maxTokens ?? fallback.maxOutputTokens, fallback.maxOutputTokens)
                : options.maxTokens ?? 4096,
              top_p: options.topP,
              tools: options.tools,
              tool_choice: options.toolChoice,
              stream: false,
            });

            const retryText = retryResponse.choices[0]?.message?.content ?? '';

            return {
              text: retryText,
              model: fallback.id,
              provider: fallback.provider,
              usage: retryResponse.usage
                ? {
                    promptTokens: retryResponse.usage.prompt_tokens,
                    completionTokens: retryResponse.usage.completion_tokens,
                    totalTokens: retryResponse.usage.total_tokens,
                  }
                : undefined,
              raw: retryResponse,
            };
          } catch {
            // 忽略 fallback 错误，抛原始错误
          }
        }
      }

      throw error;
    }
  }

  getRegistry(): ModelRegistry {
    return this.registry;
  }

  getRouter(): ModelRouter {
    return this.router;
  }

  private resolveModel(options: ModelCallOptions): ModelSelectionResult {
    if (options.model) {
      const model = this.registry.getModel(options.model);
      if (!model) {
        throw new Error(`Model not found in registry: ${options.model}`);
      }
      return {
        model,
        providerId: model.provider,
        reason: `Direct model selection: ${model.id}`,
      };
    }

    const strategy = options.strategy ?? this.defaultStrategy;

    const context: ModelSelectionContext = {
      complexityHint: options.complexityHint,
      taskType: options.taskType,
      allowLightModel: true,
    };

    return this.router.select(strategy, context);
  }
}

export function createDefaultModelProvidersConfig(): ModelProvidersConfig {
  const qwenModel = process.env['QWEN_MODEL'] ?? 'qwen-plus';

  return {
    providers: [
      {
        id: 'dashscope',
        displayName: '通义千问 / DashScope',
        baseURL: process.env['DASHSCOPE_BASE_URL'] ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: process.env['DASHSCOPE_API_KEY'] ?? '',
        isDefault: true,
      },
      {
        id: 'deepseek',
        displayName: 'DeepSeek',
        baseURL: process.env['DEEPSEEK_BASE_URL'] ?? 'https://api.deepseek.com',
        apiKey: process.env['DEEPSEEK_API_KEY'] ?? '',
      },
    ],
    models: [
      {
        id: qwenModel,
        provider: 'dashscope',
        displayName: 'Qwen Plus',
        complexity: 'heavy',
        specialties: ['chat', 'general', 'planning', 'reasoning', 'analysis', 'writing', 'coding'],
        tags: ['tools'],
        // 内置部署基线；服务端运行时会用模型目录元数据自动刷新能力。
        contextWindow: 1_000_000,
        maxOutputTokens: 32_768,
      },
    ],
  };
}
