import type { CrossValidationResult, EvidenceItem } from './types.js';

const TERM_ALIASES: Record<string, string[]> = {
  '压缩机': ['compressor', 'air production unit', 'apu'],
  '故障': ['failure', 'fault', 'anomaly'],
  '异常': ['anomaly', 'abnormal'],
  '泄漏': ['air leak', 'leak'],
  '传感器': ['sensor', 'signal'],
  '字段': ['attribute', 'feature', 'field'],
  '压力': ['pressure', 'tp2', 'tp3'],
  '油温': ['oil temperature', 'temperature'],
  '电流': ['motor current', 'current'],
  '阀': ['valve', 'dv pressure', 'intake valve'],
  '低压': ['low pressure', 'lps'],
  '维护': ['maintenance', 'predictive maintenance'],
  '预测': ['prediction', 'predictive maintenance'],
  '数据': ['dataset', 'data'],
  '编程': ['python', 'code'],
  '代码': ['python', 'code'],
  '清洗': ['data cleaning', 'pandas'],
  '分析': ['pandas', 'analysis'],
  '统计': ['statistics', 'describe'],
  '可视化': ['matplotlib', 'visualization'],
  '扭矩': ['torque'],
  '转速': ['rotational speed'],
  '直方图': ['histogram', 'hist'],
  '箱线图': ['boxplot', 'box'],
  '绘图': ['matplotlib', 'plot', 'pyplot'],
  '画图': ['matplotlib', 'plot', 'pyplot'],
  '图': ['matplotlib', 'plot'],
  '时间序列': ['time series', 'timeseries', 'datetime'],
  '重采样': ['resample', 'resampling', 'period'],
  '滑动窗口': ['rolling', 'window', 'moving'],
  '滚动': ['rolling', 'window'],
  '窗口': ['window', 'rolling'],
  '缺失值': ['missing data', 'missing', 'nan'],
  '缺失': ['missing data', 'dropna', 'fillna'],
  '分组': ['groupby', 'group'],
  '聚合': ['groupby', 'aggregate', 'agg'],
  '索引': ['indexing', 'index', 'loc', 'iloc'],
  '筛选': ['indexing', 'selection', 'loc', 'iloc'],
  '选择': ['indexing', 'selection'],
  '均值': ['mean', 'average'],
  '中位数': ['median'],
  '标准差': ['std', 'standard deviation'],
  '孤立森林': ['isolation forest', 'isolationforest'],
  '离群': ['outlier detection', 'outlier', 'novelty'],
  '异常检测': ['outlier detection', 'anomaly detection', 'isolation forest'],
  '循环': ['loop', 'for', 'while'],
  '函数': ['function', 'def'],
  '列表': ['list'],
  '字典': ['dict', 'dictionary'],
  '异常处理': ['exception', 'error handling', 'try'],
  '采样': ['resample', 'sampling'],
};

export function normalizeSearchTerms(query: string): string[] {
  const knownChinese = Object.keys(TERM_ALIASES).filter((term) => query.includes(term));
  const english = Array.from(query.matchAll(/[A-Za-z][A-Za-z0-9_ -]{1,40}/g))
    .map((match) => match[0].trim())
    .filter(Boolean);
  const raw = [...knownChinese, ...english];
  const expanded = raw.flatMap((term) => [term, ...(TERM_ALIASES[term] ?? [])]);
  return Array.from(new Set(expanded.map((term) => term.trim().toLowerCase()).filter(Boolean))).slice(0, 18);
}

export function crossValidate(items: EvidenceItem[]): CrossValidationResult {
  const structured = items.filter((item) => item.sourceType === 'dataset');
  const documents = items.filter((item) => item.sourceType === 'document');
  const locatable = items.filter((item) => item.locator.trim().length > 0);
  const checks = [
    {
      id: 'structured-source',
      label: 'CSV 结构化证据',
      status: structured.length > 0 ? 'passed' as const : 'review' as const,
      detail: structured.length > 0 ? `已查询 ${structured.length} 条结构化证据` : '没有获得可查询的数据证据',
      evidenceIds: structured.map((item) => item.id),
    },
    {
      id: 'document-source',
      label: 'PDF/领域文档证据',
      status: documents.length > 0 ? 'passed' as const : 'review' as const,
      detail: documents.length > 0 ? `已检索 ${documents.length} 条领域说明` : '没有获得可引用的领域文档证据',
      evidenceIds: documents.map((item) => item.id),
    },
    {
      id: 'source-agreement',
      label: '来源交叉验证',
      status: structured.length > 0 && documents.length > 0 ? 'passed' as const : 'review' as const,
      detail: structured.length > 0 && documents.length > 0
        ? '数据观测与领域说明均有来源，可进入审核裁判'
        : '只有单一来源，结论需要保守表达',
      evidenceIds: items.map((item) => item.id),
    },
    {
      id: 'source-locator',
      label: '来源定位完整',
      status: locatable.length === items.length && items.length > 0 ? 'passed' as const : 'failed' as const,
      detail: `${locatable.length}/${items.length} 条证据具备可回溯定位`,
      evidenceIds: locatable.map((item) => item.id),
    },
  ];
  const passed = checks.filter((check) => check.status === 'passed').length;
  const score = items.length === 0 ? 0 : Math.round(((passed / checks.length) * 0.7 + Math.min(1, items.length / 10) * 0.3) * 100) / 100;
  const status = items.length === 0
    ? 'unsupported'
    : structured.length > 0 && documents.length > 0
    ? 'corroborated'
    : 'needs_review';
  return {
    status,
    score,
    checks,
    notes: status === 'corroborated'
      ? ['结构化数据和领域文档已同时提供，生成内容仍需逐条 Claim 审核。']
      : ['当前证据来源不完整，不能把模型输出当作确定结论。'],
  };
}
