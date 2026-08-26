import { describe, it, expect, beforeEach } from 'vitest';
import { ComplexityEstimator } from './complexity-estimator.js';
import { ModelRegistry } from './registry.js';
import { ModelRouter } from './router.js';
import { ProviderConfig, ModelConfig } from './config.js';

describe('ComplexityEstimator', () => {
  let estimator: ComplexityEstimator;

  beforeEach(() => {
    estimator = new ComplexityEstimator();
  });

  it('matches research tasks as heavy complexity', () => {
    const hint = estimator.estimate('深度研究报告：AI Agent 发展趋势');
    expect(hint.complexity).toBe('heavy');
    expect(hint.requiredSpecialties).toContain('analysis');
  });

  it('matches coding tasks as medium complexity', () => {
    const hint = estimator.estimate('编写代码实现一个Python爬虫程序');
    expect(hint.complexity).toBe('medium');
    expect(hint.requiresTools).toBe(true);
  });

  it('matches evaluation tasks as heavy', () => {
    const hint = estimator.estimate('评估这份报告的质量');
    expect(hint.complexity).toBe('heavy');
  });

  it('matches simple chat as light', () => {
    const hint = estimator.estimate('你好，帮我写个简单的问候语');
    expect(hint.complexity).toBe('light');
  });

  it('falls back to medium for unknown tasks', () => {
    const hint = estimator.estimate('some random task');
    expect(hint.complexity).toBe('medium');
  });

  it('maps priority levels correctly', () => {
    expect(estimator.priorityToHint('critical').complexity).toBe('heavy');
    expect(estimator.priorityToHint('high').complexity).toBe('heavy');
    expect(estimator.priorityToHint('normal').complexity).toBe('medium');
    expect(estimator.priorityToHint('low').complexity).toBe('light');
  });

  it('selects model for subTask with registry and router', () => {
    const registry = new ModelRegistry();
    const provider: ProviderConfig = { id: 'test', displayName: 'Test', baseURL: 'http://test', apiKey: 'test' };
    registry.registerProvider(provider);
    registry.registerModel({
      id: 'test-light', provider: 'test', displayName: 'Light',
      complexity: 'light', specialties: ['chat'], tags: ['tools'],
    });
    registry.registerModel({
      id: 'test-heavy', provider: 'test', displayName: 'Heavy',
      complexity: 'heavy', specialties: ['reasoning'],
    });

    const router = new ModelRouter(registry);
    const result = estimator.selectModelForSubTask(registry, router, {
      priority: 'critical',
      tools: ['web_search'],
      assignedAgentType: 'researcher',
    });

    expect(result.modelId).toBe('test-heavy');
    expect(result.hint.complexity).toBe('heavy');
  });

  it('selects light model for low-priority tasks without tools', () => {
    const registry = new ModelRegistry();
    const provider: ProviderConfig = { id: 'test', displayName: 'Test', baseURL: 'http://test', apiKey: 'test' };
    registry.registerProvider(provider);
    registry.registerModel({
      id: 'test-light', provider: 'test', displayName: 'Light',
      complexity: 'light', specialties: ['chat'], tags: ['tools'],
    });
    registry.registerModel({
      id: 'test-heavy', provider: 'test', displayName: 'Heavy',
      complexity: 'heavy', specialties: ['reasoning'],
    });

    const router = new ModelRouter(registry);
    const result = estimator.selectModelForSubTask(registry, router, {
      priority: 'low',
      tools: [],
      assignedAgentType: 'writer',
    });

    // With low priority and no tools, should prefer light model
    expect(result.modelId).toBe('test-light');
  });
});
