/**
 * PostgreSQL 连接与 drizzle 实例（docs/挑战杯技术开发总规.md §2.3）
 * 仅在完成 SQLite→PostgreSQL 迁移校验（scripts/migrate-sqlite-to-pg.ts）后切换运行数据源。
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type LearningDatabase = ReturnType<typeof createLearningDatabase>;

export function resolveDatabaseUrl(): string {
  const url = process.env['DATABASE_URL'];
  if (!url) {
    throw new Error('缺少 DATABASE_URL：请配置 PostgreSQL 连接（见 .env.example）');
  }
  return url;
}

export function createLearningDatabase(databaseUrl = resolveDatabaseUrl()) {
  const pool = new Pool({ connectionString: databaseUrl, max: 10 });
  const db = drizzle(pool, { schema });
  return { pool, db, schema };
}
