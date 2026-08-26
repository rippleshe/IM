import { describe, it, expect } from 'vitest';
import { loadModelProvidersConfig } from './loader.js';

describe('loadModelProvidersConfig', () => {
  it('throws when no config file exists', () => {
    expect(() => loadModelProvidersConfig({ defaultPaths: ['__nonexistent__.ts'] })).toThrow();
  });

  it('loads from json config', () => {
    const config = loadModelProvidersConfig({
      configPath: 'src/models/config.example.ts',
    });
    expect(config.providers.length).toBeGreaterThan(0);
    expect(config.models.length).toBeGreaterThan(0);
  });
});
