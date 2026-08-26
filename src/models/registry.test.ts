import { describe, it, expect, beforeEach } from 'vitest';
import { ModelRegistry } from './registry.js';
import { ProviderConfig, ModelConfig } from './config.js';

describe('ModelRegistry', () => {
  let registry: ModelRegistry;

  const deepseekProvider: ProviderConfig = {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com',
    apiKey: 'deepseek-key',
  };

  const openaiProvider: ProviderConfig = {
    id: 'openai',
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com',
    apiKey: 'openai-key',
  };

  const deepseekChat: ModelConfig = {
    id: 'deepseek-chat',
    provider: 'deepseek',
    displayName: 'DeepSeek Chat',
    complexity: 'light',
    specialties: ['chat', 'general'],
    contextWindow: 64000,
    maxOutputTokens: 4096,
    pricingPer1kInput: 0.0014,
    pricingPer1kOutput: 0.0028,
  };

  const gpt4o: ModelConfig = {
    id: 'gpt-4o',
    provider: 'openai',
    displayName: 'GPT-4o',
    complexity: 'heavy',
    specialties: ['chat', 'reasoning', 'vision'],
    contextWindow: 128000,
    maxOutputTokens: 16384,
    pricingPer1kInput: 0.005,
    pricingPer1kOutput: 0.015,
  };

  beforeEach(() => {
    registry = new ModelRegistry();
  });

  it('registers provider and model', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerModel(deepseekChat);

    expect(registry.hasProvider('deepseek')).toBe(true);
    expect(registry.hasModel('deepseek-chat')).toBe(true);
    expect(registry.getProvider('deepseek')).toEqual(deepseekProvider);
    expect(registry.getModel('deepseek-chat')).toEqual(deepseekChat);
  });

  it('lists providers and models', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerProvider(openaiProvider);
    registry.registerModel(deepseekChat);
    registry.registerModel(gpt4o);

    expect(registry.listProviders()).toHaveLength(2);
    expect(registry.listModels()).toHaveLength(2);
    expect(registry.listModels('deepseek')).toHaveLength(1);
  });

  it('filters models by complexity', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerProvider(openaiProvider);
    registry.registerModel(deepseekChat);
    registry.registerModel(gpt4o);

    expect(registry.getModelsByComplexity('light')).toHaveLength(1);
    expect(registry.getModelsByComplexity('heavy')).toHaveLength(1);
    expect(registry.getModelsByComplexity('medium')).toHaveLength(0);
  });

  it('filters models by specialty', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerModel(deepseekChat);
    registry.registerModel(gpt4o);

    expect(registry.getModelsBySpecialty('vision')).toHaveLength(1);
    expect(registry.getModelsBySpecialty('chat')).toHaveLength(2);
  });

  it('returns cheapest model', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerProvider(openaiProvider);
    registry.registerModel(deepseekChat);
    registry.registerModel(gpt4o);

    const cheapest = registry.getCheapestModel();
    expect(cheapest?.id).toBe('deepseek-chat');
  });

  it('returns default provider', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerProvider(openaiProvider);

    const defaultProvider = registry.getDefaultProvider();
    expect(defaultProvider?.id).toBe('deepseek');
  });

  it('unregisters model', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerModel(deepseekChat);

    expect(registry.hasModel('deepseek-chat')).toBe(true);
    expect(registry.unregisterModel('deepseek-chat')).toBe(true);
    expect(registry.hasModel('deepseek-chat')).toBe(false);
  });

  it('lists models for provider', () => {
    registry.registerProvider(deepseekProvider);
    registry.registerModel(deepseekChat);

    expect(registry.listModelsForProvider('deepseek')).toHaveLength(1);
    expect(registry.listModelsForProvider('openai')).toHaveLength(0);
  });
});
