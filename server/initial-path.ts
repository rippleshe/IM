/**
 * 首次建档的学习路径生成（从 server/index.ts 原样搬移为共享模块）。
 * API 的 /api/learning/onboarding 与 scripts/demo-seed.ts 共用：
 * 演示账号在种子阶段就生成好差异化路径，评委登录即可看到完整知识树。
 */
import { multiModelClient, parseJson } from './study-runtime.js';
import type { OnboardingInput } from '../src/learning/identity.js';
import type { LearningPathEdgeView } from '../src/learning/store.js';

export type GeneratedPathGraph = {
  nodes: Array<{ knowledgePointId: string; title: string; description: string; sortOrder: number }>;
  edges: Array<{ fromKnowledgePointId: string; toKnowledgePointId: string; relation: LearningPathEdgeView['relation'] }>;
};

export function fallbackPathGraph(goal: string): GeneratedPathGraph {
  const subject = goal.replace(/\s+/g, ' ').trim().slice(0, 42) || '工业设备数据诊断工具开发';
  return {
    nodes: [
      { knowledgePointId: 'diagnosis-goal', title: '明确诊断目标与数据边界', description: `把“${subject}”拆成可观察的设备问题、输入变量和输出结论。`, sortOrder: 1 },
      { knowledgePointId: 'python-foundation', title: 'Python 编程基础', description: '掌握变量、函数、条件和循环，能读懂并修改基础分析代码。', sortOrder: 2 },
      { knowledgePointId: 'data-structures', title: 'Python 数据结构', description: '理解列表、字典和表格数据，为处理传感器记录建立代码直觉。', sortOrder: 3 },
      { knowledgePointId: 'csv-dataframe', title: 'CSV 与 DataFrame', description: '能读取、筛选和检查设备数据表，识别字段、缺失值和数据类型。', sortOrder: 4 },
      { knowledgePointId: 'data-cleaning', title: '数据清洗与时间字段', description: '处理缺失、重复、异常格式和时间索引，形成可分析的数据集。', sortOrder: 5 },
      { knowledgePointId: 'sensor-semantics', title: '理解传感器变量与工况', description: '结合设备背景理解压力、电流、温度和状态字段的含义与关系。', sortOrder: 6 },
      { knowledgePointId: 'visualization', title: '运行趋势可视化', description: '使用图表观察变量变化、工况切换和可能的异常窗口。', sortOrder: 7 },
      { knowledgePointId: 'statistics', title: '统计描述与相关性', description: '使用均值、波动、分布和相关性描述设备运行状态。', sortOrder: 8 },
      { knowledgePointId: 'time-series', title: '时间序列分析', description: '理解时间依赖、滑动窗口和趋势变化，为预测与异常识别做准备。', sortOrder: 9 },
      { knowledgePointId: 'reproducible-query', title: 'SQL 与可复现分析', description: '用查询和固定分析步骤形成可以复查的诊断证据。', sortOrder: 10 },
      { knowledgePointId: 'anomaly-detection', title: '异常检测与阈值判断', description: '根据统计特征和运行区间识别异常，并说明判断依据和局限。', sortOrder: 11 },
      { knowledgePointId: 'feature-engineering', title: '诊断特征构造', description: '从原始传感器记录构造窗口、变化率和聚合特征。', sortOrder: 12 },
      { knowledgePointId: 'diagnostic-reasoning', title: '设备诊断逻辑', description: '把数据证据组织成故障线索、置信度和下一步检查建议。', sortOrder: 13 },
      { knowledgePointId: 'diagnostic-report', title: '诊断报告与结果表达', description: '用图表、结论、证据和不确定性完成清晰的诊断报告。', sortOrder: 14 },
      { knowledgePointId: 'diagnostic-tool', title: '完成可运行的诊断工具', description: '整合数据读取、分析、诊断和报告输出，完成一次综合验证。', sortOrder: 15 },
    ],
    edges: [
      { fromKnowledgePointId: 'diagnosis-goal', toKnowledgePointId: 'python-foundation', relation: 'prerequisite' },
      { fromKnowledgePointId: 'python-foundation', toKnowledgePointId: 'data-structures', relation: 'prerequisite' },
      { fromKnowledgePointId: 'diagnosis-goal', toKnowledgePointId: 'csv-dataframe', relation: 'branch' },
      { fromKnowledgePointId: 'csv-dataframe', toKnowledgePointId: 'data-cleaning', relation: 'prerequisite' },
      { fromKnowledgePointId: 'data-cleaning', toKnowledgePointId: 'sensor-semantics', relation: 'prerequisite' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'visualization', relation: 'branch' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'statistics', relation: 'branch' },
      { fromKnowledgePointId: 'statistics', toKnowledgePointId: 'time-series', relation: 'prerequisite' },
      { fromKnowledgePointId: 'sensor-semantics', toKnowledgePointId: 'reproducible-query', relation: 'branch' },
      { fromKnowledgePointId: 'visualization', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'time-series', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'reproducible-query', toKnowledgePointId: 'anomaly-detection', relation: 'application' },
      { fromKnowledgePointId: 'anomaly-detection', toKnowledgePointId: 'feature-engineering', relation: 'prerequisite' },
      { fromKnowledgePointId: 'feature-engineering', toKnowledgePointId: 'diagnostic-reasoning', relation: 'application' },
      { fromKnowledgePointId: 'diagnostic-reasoning', toKnowledgePointId: 'diagnostic-report', relation: 'application' },
      { fromKnowledgePointId: 'diagnostic-report', toKnowledgePointId: 'diagnostic-tool', relation: 'application' },
    ],
  };
}

export function normalizePathGraph(value: unknown, goal: string): GeneratedPathGraph {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const rawNodes = Array.isArray(source['nodes']) ? source['nodes'] : [];
  const nodes = rawNodes.map((raw, index) => {
    const node = raw as Record<string, unknown>;
    return {
      knowledgePointId: String(node['knowledgePointId'] || node['knowledge_point_id'] || `node-${index + 1}`).trim(),
      title: String(node['title'] || '').trim(),
      description: String(node['description'] || node['reason'] || '').trim(),
      sortOrder: Number(node['sortOrder'] || node['sort_order']) || index + 1,
    };
  }).filter((node) => node.knowledgePointId && node.title).slice(0, 18);
  const knownIds = new Set(nodes.map((node) => node.knowledgePointId));
  const rawEdges = Array.isArray(source['edges']) ? source['edges'] : [];
  const edges = rawEdges.map((raw) => {
    const edge = raw as Record<string, unknown>;
    const relation = ['prerequisite', 'branch', 'application', 'review'].includes(String(edge['relation']))
      ? String(edge['relation']) as LearningPathEdgeView['relation']
      : 'branch';
    return {
      fromKnowledgePointId: String(edge['fromKnowledgePointId'] || edge['from'] || edge['from_knowledge_point_id'] || '').trim(),
      toKnowledgePointId: String(edge['toKnowledgePointId'] || edge['to'] || edge['to_knowledge_point_id'] || '').trim(),
      relation,
    };
  }).filter((edge) => knownIds.has(edge.fromKnowledgePointId) && knownIds.has(edge.toKnowledgePointId) && edge.fromKnowledgePointId !== edge.toKnowledgePointId);
  return nodes.length >= 10 && edges.length >= 9 ? { nodes, edges } : fallbackPathGraph(goal);
}

export async function generateInitialPathGraph(input: OnboardingInput, model: string | undefined, thinking: { temperature: number; maxTokens: number }): Promise<GeneratedPathGraph> {
  const response = await multiModelClient.simple({
    messages: [
      {
        role: 'system',
        content: '你是工业设备数据预测与诊断训练的学习路径规划智能体。只输出一个 JSON 对象，不要 Markdown。对象必须只有 nodes 和 edges。nodes 输出 12 到 18 个可执行知识节点，每项必须含 knowledgePointId（稳定英文短 ID）、title、description、sortOrder；description 要说明学习者在该节点要学会什么，粒度控制在一次 30 到 120 分钟学习活动。edges 是节点连接，每项必须含 fromKnowledgePointId、toKnowledgePointId、relation；relation 只能是 prerequisite、branch、application、review。路径必须是有根的知识树/有向无环图，至少包含 3 条并行分支和 2 个汇合应用节点，不能写成“第一章、第二章”的线性目录，也不能把 Agent、检索、审核、资源生成写成学习节点。默认覆盖但要根据学习者基础调整：Python 编程与环境、CSV/DataFrame 与数据清洗、时间字段与传感器变量、可视化、统计基础、时间序列、特征工程、异常检测/预测、SQL 或可复现分析、诊断逻辑、报告或工具实现、综合验证。目标必须落到工业设备数据的预测或诊断任务上；允许分支并行，但每个分支都要能通过边汇合到综合任务。不要将任何节点标为完成，不要凭空声称学习者已经掌握内容。',
      },
      { role: 'user', content: JSON.stringify(input) },
    ],
    model,
    temperature: thinking.temperature,
    maxTokens: Math.min(thinking.maxTokens, 4096),
  });
  return normalizePathGraph(parseJson<unknown>(response.text), input.goal);
}
