// models.config.ts — IM-Training-Agent 多模型配置
// 默认主模型：通义千问 / DashScope OpenAI-compatible API

import type { ModelProvidersConfig } from './src/models/config.js';

export const exampleModelProvidersConfig: ModelProvidersConfig = {
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
      id: process.env['QWEN_MODEL'] ?? 'qwen-plus',
      provider: 'dashscope',
      displayName: 'Qwen Plus',
      complexity: 'heavy',
      specialties: ['chat', 'general', 'planning', 'reasoning', 'analysis', 'writing', 'coding'],
      tags: ['tools'],
      // 部署初始能力缓存；运行时会优先用服务商模型目录中的能力元数据刷新。
      // 兼容接口未提供限制时才保留该缓存，并按实际请求预留输出空间。
      contextWindow: 1_000_000,
      maxOutputTokens: 32_768,
    },
  ],
};
