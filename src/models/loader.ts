import { readFileSync, existsSync } from 'fs';
import { createRequire } from 'module';
import path from 'path';
import type { ModelProvidersConfig } from './config.js';

export interface LoadModelProvidersConfigOptions {
  /** 配置文件路径，支持 .ts 或 .json；默认按顺序查找常见位置 */
  configPath?: string;
  /** 若未显式指定，则按以下路径依次尝试 */
  defaultPaths?: string[];
}

const DEFAULT_PATHS = [
  'models.config.ts',
  'models.config.json',
  'src/models.config.ts',
  'config/models.config.ts',
];

export function loadModelProvidersConfig(
  options: LoadModelProvidersConfigOptions = {}
): ModelProvidersConfig {
  const paths = options.defaultPaths ?? DEFAULT_PATHS;
  const explicit = options.configPath;
  const resolved = explicit ?? paths.find((p) => existsSync(p));

  if (!resolved) {
    throw new Error(
      'Model providers config not found. ' +
      'Create one of: ' +
      paths.join(', ')
    );
  }

  if (resolved.endsWith('.json')) {
    const absolute = path.isAbsolute(resolved) ? resolved : path.join(process.cwd(), resolved);
    return JSON.parse(readFileSync(absolute, 'utf-8')) as ModelProvidersConfig;
  }

  if (resolved.endsWith('.ts')) {
    const absolute = path.isAbsolute(resolved) ? resolved : path.join(process.cwd(), resolved);
    const require = createRequire(absolute);
    // @ts-ignore - ESM import of TS config is fine in Node via tsx/ts-node
    const mod = require(absolute);
    const exported = (mod as { exampleModelProvidersConfig?: ModelProvidersConfig }).exampleModelProvidersConfig ??
      (mod as { default?: ModelProvidersConfig }).default ??
      (mod as ModelProvidersConfig);
    return exported as ModelProvidersConfig;
  }

  throw new Error(`Unsupported config format: ${resolved}`);
}
