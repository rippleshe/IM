/**
 * 学习数据层引导（从 server/index.ts 原样搬移）。
 * API 进程与 BullMQ Worker 进程共用同一份 SQLite 打开/初始化与存储实例，
 * 确保两个进程对学习数据的语义完全一致（迁移校验通过前运行数据源仍是 SQLite）。
 */
import path from 'path';

import { openSqlite, getDatasetDatabasePath, getLearningDatabasePath, initializeDatasetDatabase, initializeLearningDatabase } from '../src/learning/sqlite.js';
import { EvidenceService, rebuildDocumentFts, seedMetroCatalog } from '../src/learning/evidence.js';
import { importKnowledgeCards } from '../src/learning/knowledge-import.js';
import { importCsvDataset } from '../src/learning/tabular.js';
import { IdentityStore } from '../src/learning/identity.js';
import { LearningStore } from '../src/learning/store.js';

const learningDb = openSqlite(getLearningDatabasePath());
const datasetDb = openSqlite(getDatasetDatabasePath());
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
export { learningDb, datasetDb };
export const evidenceService = new EvidenceService(datasetDb, learningDb);
export const learningStore = new LearningStore(learningDb);
export const identityStore = new IdentityStore(learningDb);
