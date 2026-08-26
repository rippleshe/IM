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
      contextWindow: 131072,
      maxOutputTokens: 8192,
    },
  ],
};
