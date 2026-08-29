/**
 * 干净环境数据引导（docs/挑战杯技术开发总规.md §6.3、§10，Compose bootstrap 服务入口）
 * 空数据卷启动时：应用迁移 → MetroPT-3 目录与字段 → AI4I 数据集 → 知识卡切片 →（可选）Metro 完整 CSV。
 * 幂等：全部步骤可重复执行；Metro 完整 CSV 通过挂载 data/datasets/metropt 提供或环境变量指向。
 */
import 'dotenv/config';
import path from 'node:path';
import { existsSync } from 'node:fs';

import { applyMigrations } from './db-migrate-lib.js';
import { getLearningDatabase } from '../server/db/client.js';
import { seedMetroCatalogPg, importKnowledgeCardsPg, importCsvDatasetPg, importMetroPt3CsvPg } from '../server/db/pg-evidence.js';

async function main(): Promise<void> {
  console.log('[bootstrap] 1/5 应用 PostgreSQL 迁移…');
  await applyMigrations();

  const database = getLearningDatabase();
  const pool = database.pool;

  console.log('[bootstrap] 2/5 MetroPT-3 数据集目录与字段…');
  await seedMetroCatalogPg(pool);

  console.log('[bootstrap] 3/5 AI4I 2020 数据集…');
  const ai4i = importCsvDatasetPg(pool, {
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
  console.log(`[bootstrap]   AI4I 导入：${JSON.stringify(ai4i)}`);

  console.log('[bootstrap] 4/5 知识卡切片…');
  const cards = await importKnowledgeCardsPg(pool);
  console.log(`[bootstrap]   知识卡 ${cards.imported} 张 → ${cards.chunks} 个切片`);

  console.log('[bootstrap] 5/5 MetroPT-3 完整时序（可选）…');
  const metroCsv = process.env['IM_TRAINING_AGENT_METROPT_CSV']
    ?? path.resolve(process.cwd(), 'data', 'datasets', 'metropt', 'MetroPT3(AirCompressor).csv');
  if (existsSync(metroCsv)) {
    const metro = await importMetroPt3CsvPg(pool, metroCsv);
    if (metro.skipped) console.log(`[bootstrap]   已有 ${metro.imported.toLocaleString()} 行，跳过导入`);
    else console.log(`[bootstrap]   已导入 ${metro.imported.toLocaleString()} 行时序数据`);
  } else {
    console.log('[bootstrap]   未提供完整 CSV（不影响运行；AI4I 与知识卡可支撑全部演示）');
  }

  console.log('[bootstrap] ✔ 数据引导完成');
  process.exit(0);
}

main().catch((error) => {
  console.error('[bootstrap] 失败：', error instanceof Error ? error.message : error);
  process.exit(1);
});
