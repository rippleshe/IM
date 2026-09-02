/**
 * 黄金标注导出（docs/挑战杯技术开发总规.md §8.2）
 *
 * 把评测集中确定性定义的黄金集固化到 data/evaluation/，作为第三方可复核的固定标注：
 * - gold-cases.json：60 案例全集（画像/域/任务层/资源类型/任务文本/必备知识点/目标难度区间/允许证据范围/期望结构）
 * - gold-knowledge-points.json：知识点 → 检索关键词映射（离线覆盖检查口径）
 * - personas.json：三画像 BKT 先验（难度适配推演口径）
 * 用法：pnpm gold:export（幂等覆盖写）
 */
import 'dotenv/config';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'path';
import { buildEvaluationCases, PERSONA_PRIORS } from '../src/learning/evaluation.js';

const KP_KEYWORDS: Record<string, string[]> = {
  'pandas-reading': ['read_csv', 'DataFrame', 'pandas', 'CSV'],
  'ai4i-overview': ['AI4I', 'Machine failure', '预测性维护'],
  'ai4i-failure-modes': ['TWF', 'HDF', 'PWF', 'OSF', '刀具磨损', '散热'],
  'statistics-basics': ['均值', '中位数', '分布', '分位'],
  'evidence-boundary': ['风险判断', '现场复核', '不确定性', '证据'],
  'time-series-basics': ['滑动', '窗口', '趋势', '时序', '采样'],
  'anomaly-threshold': ['阈值', '异常', '告警', '分位数'],
  'data-cleaning': ['缺失', '清洗', '插值', 'NaN'],
  'python-basics': ['Python', 'type(', '循环', '变量'],
};

const cases = buildEvaluationCases();
if (cases.length !== 60) {
  console.error(`[gold] 案例数 ${cases.length} ≠ 60，拒绝导出`);
  process.exit(1);
}
const dir = path.join(process.cwd(), 'data', 'evaluation');
mkdirSync(dir, { recursive: true });
writeFileSync(path.join(dir, 'gold-cases.json'), JSON.stringify({ description: '60 案例黄金标注（升级计划 里程碑 F）；由 scripts/export-gold-labels.ts 从 src/learning/evaluation.ts 确定性生成，修改案例定义后需重新导出并评审', generatedAt: new Date().toISOString(), cases }, null, 2), 'utf8');
writeFileSync(path.join(dir, 'gold-knowledge-points.json'), JSON.stringify({ description: '黄金知识点 → 知识库检索关键词（离线覆盖口径；live 覆盖率以 Claim evidence edge 为准）', mapping: KP_KEYWORDS }, null, 2), 'utf8');
writeFileSync(path.join(dir, 'personas.json'), JSON.stringify({ description: '三画像 BKT 先验（难度适配推演口径；与 demo:seed 诊断作答模式一致）', personas: PERSONA_PRIORS }, null, 2), 'utf8');
console.log(`[gold] 已导出 ${cases.length} 个案例与黄金标注 → data/evaluation/`);
