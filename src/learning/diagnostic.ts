/**
 * 初始诊断 12 题（docs/挑战杯技术开发总规.md §7.3）
 * 题集固定：Python 3、数据处理 3、统计 2、时序 2、设备诊断 2。
 * 自述/学历只作 BKT 先验，不得直接当作掌握度；作答结果驱动初始知识状态。
 */
import { bktUpdate, createBktState, type BktState } from './bkt.js';

export type DiagnosticDimension =
  | 'python'
  | 'data_processing'
  | 'statistics'
  | 'time_series'
  | 'device_diagnosis';

export interface DiagnosticOption {
  id: string;
  text: string;
}

export interface DiagnosticQuestion {
  id: string;
  code: string;
  dimension: DiagnosticDimension;
  level: 'L1' | 'L2' | 'L3';
  knowledgePointId: string;
  prompt: string;
  options: DiagnosticOption[];
  answerId: string;
  explanation: string;
}

export const DIAGNOSTIC_QUESTIONS: DiagnosticQuestion[] = [
  {
    id: 'diag-py-1', code: 'py-basics-variable', dimension: 'python', level: 'L1', knowledgePointId: 'python-basics',
    prompt: '在 Python 中查看变量 x 的数据类型，应使用哪个内置函数？',
    options: [
      { id: 'a', text: 'typeof(x)' },
      { id: 'b', text: 'type(x)' },
      { id: 'c', text: 'x.dtype' },
      { id: 'd', text: 'datatype(x)' },
    ],
    answerId: 'b',
    explanation: 'type(x) 返回对象的类型；typeof 不是 Python 内置函数，dtype 是 NumPy/Pandas 数组的属性。',
  },
  {
    id: 'diag-py-2', code: 'py-control-loop', dimension: 'python', level: 'L1', knowledgePointId: 'python-control',
    prompt: '以下哪段代码正确实现了"遍历列表并只输出偶数"？',
    options: [
      { id: 'a', text: 'for n in nums: if n % 2 == 0: print(n)' },
      { id: 'b', text: 'for n in nums: if n / 2 == 0: print(n)' },
      { id: 'c', text: 'while n in nums: if n % 2: print(n)' },
      { id: 'd', text: 'for n of nums: if n % 2 == 0: print(n)' },
    ],
    answerId: 'a',
    explanation: 'n % 2 == 0 判断偶数；`for n of` 不是 Python 语法；n / 2 == 0 只在 n=0 时成立。',
  },
  {
    id: 'diag-py-3', code: 'py-data-dict', dimension: 'python', level: 'L2', knowledgePointId: 'python-data-structures',
    prompt: '表达式 {"tp2": 2.1, "tp3": 2.4}["tp2"] 的结果是',
    options: [
      { id: 'a', text: '报错 KeyError' },
      { id: 'b', text: '2.1' },
      { id: 'c', text: '0' },
      { id: 'd', text: '("tp2", 2.1)' },
    ],
    answerId: 'b',
    explanation: '字典用方括号按键取值，"tp2" 存在时返回对应值 2.1。',
  },
  {
    id: 'diag-dp-1', code: 'dp-read-csv', dimension: 'data_processing', level: 'L1', knowledgePointId: 'pandas-reading',
    prompt: '用 pandas 读取设备传感器 CSV 文件，最常用的函数是',
    options: [
      { id: 'a', text: 'pd.read_excel(path)' },
      { id: 'b', text: 'pd.read_csv(path)' },
      { id: 'c', text: 'open(path).read()' },
      { id: 'd', text: 'pd.load(path)' },
    ],
    answerId: 'b',
    explanation: 'pd.read_csv 是读取 CSV 的标准入口，返回 DataFrame；open+read 只得到字符串。',
  },
  {
    id: 'diag-dp-2', code: 'dp-filter-rows', dimension: 'data_processing', level: 'L2', knowledgePointId: 'pandas-filter',
    prompt: 'df 是含 DV_pressure 列的传感器 DataFrame，筛选"压力下降大于 0.5"的行，正确写法是',
    options: [
      { id: 'a', text: 'df[df["DV_pressure"] > 0.5]' },
      { id: 'b', text: 'df.filter("DV_pressure > 0.5")' },
      { id: 'c', text: 'df["DV_pressure" > 0.5]' },
      { id: 'd', text: 'df.where("DV_pressure > 0.5")' },
    ],
    answerId: 'a',
    explanation: '布尔掩码索引 df[条件] 是 pandas 筛选行的标准方式；条件要在列上计算而不是用字符串。',
  },
  {
    id: 'diag-dp-3', code: 'dp-clean-missing', dimension: 'data_processing', level: 'L2', knowledgePointId: 'data-cleaning',
    prompt: '分析前发现传感器列存在少量缺失值（NaN），下面哪种处理最不合适？',
    options: [
      { id: 'a', text: '直接把整行删除（dropna）并说明删除数量' },
      { id: 'b', text: '用前后采样的插值填充并说明方法' },
      { id: 'c', text: '不做任何处理也不声明，直接统计均值' },
      { id: 'd', text: '用同工况中位数填充并记录处理步骤' },
    ],
    answerId: 'c',
    explanation: '缺失值处理必须透明且可追溯；静默忽略会污染统计结论，违反证据可追溯原则。',
  },
  {
    id: 'diag-st-1', code: 'st-mean-median', dimension: 'statistics', level: 'L1', knowledgePointId: 'statistics-basics',
    prompt: '油温数据中有一个明显异常的高值，此时比较"平均数 vs 中位数"，通常',
    options: [
      { id: 'a', text: '中位数更能代表典型水平' },
      { id: 'b', text: '平均数更能代表典型水平' },
      { id: 'c', text: '两者一定相等' },
      { id: 'd', text: '两者都与异常值无关' },
    ],
    answerId: 'a',
    explanation: '均值对极端值敏感，中位数稳健；存在离群值时中位数更能代表典型水平。',
  },
  {
    id: 'diag-st-2', code: 'st-distribution', dimension: 'statistics', level: 'L2', knowledgePointId: 'statistics-basics',
    prompt: '想快速观察电机电流的取值分布和离群点，最合适的图是',
    options: [
      { id: 'a', text: '饼图' },
      { id: 'b', text: '直方图或箱线图' },
      { id: 'c', text: '词云图' },
      { id: 'd', text: '雷达图' },
    ],
    answerId: 'b',
    explanation: '直方图展示连续变量分布形状，箱线图给出分位数与离群点，都是数值分布的标准工具。',
  },
  {
    id: 'diag-ts-1', code: 'ts-window', dimension: 'time_series', level: 'L2', knowledgePointId: 'time-series-basics',
    prompt: '对传感器时序做"滑动窗口均值"的主要目的是',
    options: [
      { id: 'a', text: '把时间戳转换成字符串' },
      { id: 'b', text: '平滑短期波动，突出趋势变化' },
      { id: 'c', text: '增加采样频率' },
      { id: 'd', text: '替换缺失时间戳' },
    ],
    answerId: 'b',
    explanation: '滑动平均通过窗口聚合平滑噪声，让趋势和阶段变化更易观察，是时序分析的基础操作。',
  },
  {
    id: 'diag-ts-2', code: 'ts-boundary', dimension: 'time_series', level: 'L3', knowledgePointId: 'anomaly-threshold',
    prompt: '某时刻 TP2 低于历史 5% 分位数，据此最严谨的结论是',
    options: [
      { id: 'a', text: '该传感器已发生故障，必须立即停机' },
      { id: 'b', text: '该时刻取值显著低于常态，属于需要结合相邻信号与现场复核的风险信号' },
      { id: 'c', text: '设备一定发生了空气泄漏' },
      { id: 'd', text: '数据一定记录错误，应删除该点' },
    ],
    answerId: 'b',
    explanation: '低分位取值只是统计意义上的异常信号；直接推断故障或具体故障类型属于越界因果。',
  },
  {
    id: 'diag-dd-1', code: 'dd-field-meaning', dimension: 'device_diagnosis', level: 'L2', knowledgePointId: 'ai4i-overview',
    prompt: 'AI4I 数据集中 "Tool wear [min]" 表示',
    options: [
      { id: 'a', text: '刀具累计使用分钟数' },
      { id: 'b', text: '主轴转速' },
      { id: 'c', text: '加工合格率' },
      { id: 'd', text: '环境温度' },
    ],
    answerId: 'a',
    explanation: 'Tool wear 是刀具累计磨损时间（分钟），字段含义以数据集说明为准，不允许凭空解释。',
  },
  {
    id: 'diag-dd-2', code: 'dd-evidence-chain', dimension: 'device_diagnosis', level: 'L3', knowledgePointId: 'evidence-boundary',
    prompt: '一份可追溯的诊断结论必须包含',
    options: [
      { id: 'a', text: '只给结论，展示自信即可' },
      { id: 'b', text: '结论 + 数据定位（表/行/时间窗）+ 不确定性说明' },
      { id: 'c', text: '只给数据图，不给结论' },
      { id: 'd', text: '把所有可能的故障都列一遍' },
    ],
    answerId: 'b',
    explanation: '结论必须携带可回溯的数据定位与不确定性边界，这是证据化诊断区别于猜测的核心。',
  },
];

export interface DiagnosticAnswerInput {
  questionId: string;
  answerId: string;
  durationMs?: number;
}

export interface DiagnosticScoreItem {
  question: DiagnosticQuestion;
  answerId: string;
  correct: boolean;
  durationMs: number;
}

export interface DiagnosticScoreResult {
  items: DiagnosticScoreItem[];
  total: number;
  correct: number;
  byDimension: Record<DiagnosticDimension, { total: number; correct: number }>;
  /** 每个知识点的作答序列，驱动 BKT 初始状态 */
  byKnowledgePoint: Array<{ knowledgePointId: string; correct: boolean }>;
}

export function scoreDiagnostic(
  answers: DiagnosticAnswerInput[],
  questions: DiagnosticQuestion[] = DIAGNOSTIC_QUESTIONS,
): DiagnosticScoreResult {
  const byId = new Map(questions.map((question) => [question.id, question]));
  const items: DiagnosticScoreItem[] = [];
  const byDimension = Object.fromEntries(
    (['python', 'data_processing', 'statistics', 'time_series', 'device_diagnosis'] as DiagnosticDimension[]).map((dim) => [dim, { total: 0, correct: 0 }]),
  ) as Record<DiagnosticDimension, { total: number; correct: number }>;
  const byKnowledgePoint: DiagnosticScoreResult['byKnowledgePoint'] = [];

  for (const answer of answers) {
    const question = byId.get(answer.questionId);
    if (!question) continue;
    const correct = question.answerId === answer.answerId;
    const durationMs = Math.max(0, Math.round(answer.durationMs ?? 0));
    items.push({ question, answerId: answer.answerId, correct, durationMs });
    byDimension[question.dimension].total += 1;
    if (correct) byDimension[question.dimension].correct += 1;
    byKnowledgePoint.push({ knowledgePointId: question.knowledgePointId, correct });
  }
  return {
    items,
    total: items.length,
    correct: items.filter((item) => item.correct).length,
    byDimension,
    byKnowledgePoint,
  };
}

/** 诊断作答 → 各知识点 BKT 初始状态（先验低起点，观测驱动修正） */
export function initialBktStates(result: DiagnosticScoreResult): Map<string, BktState> {
  const states = new Map<string, BktState>();
  for (const observation of result.byKnowledgePoint) {
    const current = states.get(observation.knowledgePointId) ?? createBktState(0.15);
    states.set(observation.knowledgePointId, applyBktObservation(current, observation.correct));
  }
  return states;
}

function applyBktObservation(state: BktState, correct: boolean): BktState {
  // 与练习作答共用 bktUpdate 公式路径，保证诊断与练习的更新语义一致
  return bktUpdate(state, correct);
}
