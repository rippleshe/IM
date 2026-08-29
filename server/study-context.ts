/**
 * 学习数据层引导（docs/挑战杯技术开发总规.md §2.3）
 *
 * 数据源切换：
 * - 默认 DATABASE_URL 存在即使用 PostgreSQL（唯一业务数据源，总规 §11 锁定假设）；
 * - IM_TRAINING_AGENT_DATA_SOURCE=sqlite 可显式回退（SQLite 仅作只读迁移源与可恢复备份）；
 * - api 与 worker 进程共用本模块，保证两个进程对学习数据的语义完全一致。
 */
import 'dotenv/config';

import path from 'path';

import { getLearningDatabase } from './db/client.js';
import { PgEvidenceService } from './db/pg-evidence.js';
import { PgIdentityStore, PgLearningStore } from './db/pg-store.js';
import { openSqlite, getDatasetDatabasePath, getLearningDatabasePath, initializeDatasetDatabase, initializeLearningDatabase } from '../src/learning/sqlite.js';
import { EvidenceService, rebuildDocumentFts, seedMetroCatalog } from '../src/learning/evidence.js';
import { importKnowledgeCards } from '../src/learning/knowledge-import.js';
import { importCsvDataset } from '../src/learning/tabular.js';
import { IdentityStore } from '../src/learning/identity.js';
import { LearningStore } from '../src/learning/store.js';
import type { SqliteDatabase } from '../src/learning/sqlite.js';

export type DataSourceKind = 'postgres' | 'sqlite';

export const dataSource: DataSourceKind =
  process.env['IM_TRAINING_AGENT_DATA_SOURCE'] === 'sqlite' || !process.env['DATABASE_URL']
    ? 'sqlite'
    : 'postgres';

/* ------------------------------------------------------------------ */
/* 数据源实例                                                            */
/* ------------------------------------------------------------------ */

const pg = dataSource === 'postgres' ? getLearningDatabase() : null;

export const learningDb: SqliteDatabase | null = dataSource === 'sqlite' ? openSqlite(getLearningDatabasePath()) : null;
export const datasetDb: SqliteDatabase | null = dataSource === 'sqlite' ? openSqlite(getDatasetDatabasePath()) : null;

if (dataSource === 'sqlite' && learningDb && datasetDb) {
  initializeLearningDatabase(learningDb);
  initializeDatasetDatabase(datasetDb);
  seedMetroCatalog(datasetDb);
  importCsvDataset(datasetDb, {
    id: 'ai4i-2020',
    name: 'AI4I 2020 Predictive Maintenance',
    csvPath: path.resolve(process.cwd(), 'data', 'datasets', 'ai4i', 'ai4i_2020.csv'),
    sourcePath: 'IM-Training-Agent-datasets/raw/AI4I_2020.zip::ai4i2020.csv',
    license: 'UCI AI4I 2020（引用以官方页面为准）',
    labelFields: ['Machine failure', 'TWF', 'HDF', 'PWF', 'OSF', 'RNF'],
    fieldMeanings: {
      'UDI': '样本编号',
      'Product ID': '产品编号，首字母 L/M/H 对应低/中/高质量等级',
      'Type': '产品质量等级 L/M/H',
      'Air temperature [K]': '环境温度',
      'Process temperature [K]': '工艺温度',
      'Rotational speed [rpm]': '主轴转速',
      'Torque [Nm]': '扭矩',
      'Tool wear [min]': '刀具累计磨损时间',
      'Machine failure': '机器故障总标签（1 表示本次记录发生故障）',
      'TWF': '刀具磨损故障',
      'HDF': '散热故障（温差过小或转速过低）',
      'PWF': '功率故障（转速与扭矩乘积偏离额定范围）',
      'OSF': '过应力故障（扭矩与磨损过大）',
      'RNF': '随机故障',
    },
  });
  importKnowledgeCards(datasetDb);
  rebuildDocumentFts(datasetDb);
}

/** 两种实现的公开 API 逐方法等价；调用方 await 兼容（同步实现 await 为 no-op）。 */
export const evidenceService = pg ? new PgEvidenceService(pg.pool) : new EvidenceService(datasetDb!, learningDb!);
export const learningStore: LearningStore | PgLearningStore = pg ? new PgLearningStore(pg.pool) : new LearningStore(learningDb!);
export const identityStore: IdentityStore | PgIdentityStore = pg ? new PgIdentityStore(pg.pool) : new IdentityStore(learningDb!);
