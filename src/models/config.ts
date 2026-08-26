export interface ProviderConfig {
  /** 唯一标识，如 deepseek、openai、anthropic、dashscope */
  id: string;
  /** 显示名称 */
  displayName: string;
  /** API base URL，如 https://api.deepseek.com */
  baseURL: string;
  /** API Key 来源：环境变量名或直接写入 */
  apiKey: string;
  /** 是否为默认 provider（当模型未指定 provider 时回退） */
  isDefault?: boolean;
  /** 自定义请求头 */
  headers?: Record<string, string>;
  /** 额外连接/请求选项 */
  requestOptions?: {
    timeoutMs?: number;
    maxRetries?: number;
    connectTimeoutMs?: number;
  };
}

export interface ModelConfig {
  /** 模型唯一 ID，如 deepseek-chat、gpt-4o */
  id: string;
  /** 所属 provider id */
  provider: string;
  /** 显示名称 */
  displayName: string;
  /** 模型用途标签，用于任务路由 */
  tags?: string[];
  /** 适合的任务复杂度：light / medium / heavy */
  complexity?: 'light' | 'medium' | 'heavy';
  /** 适合的场景 */
  specialties?: string[];
  /** 上下文窗口（token），用于自动压缩判断 */
  contextWindow?: number;
  /** 最大输出 token */
  maxOutputTokens?: number;
  /** 每 1k 输入 token 价格（USD），用于预算控制 */
  pricingPer1kInput?: number;
  /** 每 1k 输出 token 价格（USD），用于预算控制 */
  pricingPer1kOutput?: number;
  /** 覆盖 provider 级别的 baseURL（可选） */
  baseURL?: string;
  /** 覆盖 provider 级别的 apiKey（可选） */
  apiKey?: string;
}

export interface ModelProvidersConfig {
  providers: ProviderConfig[];
  models: ModelConfig[];
}

export type ModelComplexity = 'light' | 'medium' | 'heavy';
export type ModelSpecialty =
  | 'chat'
  | 'planning'
  | 'coding'
  | 'analysis'
  | 'writing'
  | 'reasoning'
  | 'vision'
  | 'general';

export interface TaskComplexityHint {
  /** 推荐复杂度 */
  complexity: ModelComplexity;
  /** 需要的能力标签 */
  requiredSpecialties?: ModelSpecialty[];
  /** 预估输入 token 数 */
  estimatedInputTokens?: number;
  /** 是否要求 tool calling */
  requiresTools?: boolean;
  /** 是否要求 streaming */
  requiresStreaming?: boolean;
}
