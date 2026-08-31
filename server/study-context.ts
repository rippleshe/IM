/**
 * 学习数据层引导：运行时唯一使用 PostgreSQL 16 + pgvector，
 * API 与 worker 共用同一组异步存储实现，避免多套数据语义漂移。
 */
import 'dotenv/config';

import { getLearningDatabase } from './db/client.js';
import { PgEvidenceService } from './db/pg-evidence.js';
import { PgIdentityStore, PgLearningStore } from './db/pg-store.js';

export type DataSourceKind = 'postgres';
export const dataSource: DataSourceKind = 'postgres';

const pg = getLearningDatabase();

export const evidenceService = new PgEvidenceService(pg.pool);
export const learningStore = new PgLearningStore(pg.pool);
export const identityStore = new PgIdentityStore(pg.pool);
