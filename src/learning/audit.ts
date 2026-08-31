import type { CrossValidationResult, EvidencePack, ResourceDocument } from './types.js';

/**
 * Claim 类型（升级计划 §4.5）：
 * 数值 / 字段含义 / 方法步骤 / 因果判断 / 风险建议 / 非事实教学表达。
 * non_factual 不进入幻觉率分母（升级计划 F 官方口径）。
 */
export type ClaimType = 'numeric' | 'field_meaning' | 'method_step' | 'causal' | 'risk_advice' | 'non_factual';

const NON_FACTUAL_HINTS = [
  '我们先', '本节', '本讲义', '本资源', '学习目标', '接下来', '练习', '作业', '请大家',
  '学习者可以', '建议先学', '建议复习', '读完本', '本指南',
];
const CAUSAL_HINTS = ['因为', '导致', '引发', '造成', '会使得', '从而引起', '故障原因', '根因', '意味着故障', '说明故障'];
const FIELD_HINTS = ['字段', '含义', '表示', '是指', '定义为', '指的是', '含义为', '代表'];
const STEP_HINTS = ['步骤', '首先', '然后', '最后', '方法：', '流程', '依次', '操作：'];
const ADVICE_HINTS = ['风险', '可能', '建议', '注意', '警惕', '或存在', '倾向于'];

/** 声明分类（确定性启发式，可单测）：因果 > 数值 > 非事实教学表达 > 字段含义 > 方法步骤 > 风险建议 */
export function classifyClaimText(text: string): ClaimType {
  const hasNumber = /\b\d+(?:\.\d+)?\b|[０-９]/.test(text);
  if (CAUSAL_HINTS.some((hint) => text.includes(hint))) return 'causal';
  if (hasNumber) return 'numeric';
  if (NON_FACTUAL_HINTS.some((hint) => text.includes(hint)) && !ADVICE_HINTS.some((hint) => text.includes(hint))) return 'non_factual';
  if (FIELD_HINTS.some((hint) => text.includes(hint))) return 'field_meaning';
  if (STEP_HINTS.some((hint) => text.includes(hint))) return 'method_step';
  if (ADVICE_HINTS.some((hint) => text.includes(hint))) return 'risk_advice';
  return 'risk_advice';
}

/**
 * 逻辑键：同一事实声明跨修订轮的稳定映射（升级计划 §4.5 supersedes）。
 * 规范化文本后截取，保证改写幅度不大的同一声明可以关联。
 */
export function claimLogicalKey(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[\s，。；：、,.:;!?！？'"'（）()【】[\]{}<>《》—\-\\|/]/g, '')
    .replace(/[。．]/g, '');
  return normalized.slice(0, 96);
}

export interface ClaimAuditRecord {
  id: string;
  text: string;
  verdict: 'supported' | 'review' | 'unsupported';
  critique: string;
  factualScore: number;
  evidenceIds: string[];
  /** 声明类型（升级计划 §4.5）；历史记录缺省为 risk_advice */
  claimType?: ClaimType;
  /** 跨修订轮稳定键 */
  logicalKey?: string;
}

export interface ResourceAuditResult {
  summary: CrossValidationResult;
  claims: ClaimAuditRecord[];
}

function claimText(content: unknown): string[] {
  if (typeof content === 'string') {
    return content.includes('flowchart') || content.includes('-->') ? [] : [content];
  }
  if (Array.isArray(content)) return content.flatMap((item) => claimText(item));
  if (content && typeof content === 'object') {
    return Object.values(content as Record<string, unknown>).flatMap((item) => claimText(item));
  }
  return [];
}

function hasNumericSupport(text: string, evidenceText: string): boolean {
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g);
  if (!numbers || numbers.length === 0) return true;
  return numbers.every((number) => evidenceText.includes(number));
}

export function auditResource(resource: ResourceDocument, pack: EvidencePack): ResourceAuditResult {
  const claims: ClaimAuditRecord[] = [];
  resource.blocks.forEach((block) => {
    // 代码示例是操作说明，数据表格是证据摘录，证据块本身是定位信息——都不是需要逐条核对的事实声明。
    if (block.type === 'code' || block.type === 'table' || block.type === 'evidence') return;
    claimText(block.content).forEach((text) => {
      const evidenceIds = block.evidenceIds.filter((id) => pack.items.some((item) => item.id === id));
      const evidenceText = evidenceIds
        .map((id) => pack.items.find((item) => item.id === id)?.content ?? '')
        .join('\n');
      const hasEvidence = evidenceIds.length > 0;
      const numericSupported = hasNumericSupport(text, evidenceText);
      const verdict = !hasEvidence ? 'unsupported' : !numericSupported ? 'review' : 'supported';
      claims.push({
        id: `${resource.id}-claim-${claims.length + 1}`,
        text: text.slice(0, 500),
        verdict,
        critique: !hasEvidence
          ? '没有绑定证据定位，不能发布为确定结论。'
          : !numericSupported
          ? '数字或单位未在绑定证据中找到，需要人工复核。'
          : '已绑定结构化数据或领域文档证据。',
        factualScore: verdict === 'supported' ? 1 : verdict === 'review' ? 0.6 : 0,
        evidenceIds,
        claimType: classifyClaimText(text),
        logicalKey: claimLogicalKey(text),
      });
    });
  });
  // 汇总口径（升级计划 F 官方口径）：non_factual 教学表达不进入幻觉率分母，也不阻断发布
  const auditable = claims.filter((claim) => (claim.claimType ?? 'risk_advice') !== 'non_factual');
  const unsupported = auditable.filter((claim) => claim.verdict === 'unsupported').length;
  const review = auditable.filter((claim) => claim.verdict === 'review').length;
  const nonFactualCount = claims.length - auditable.length;
  const claimScore = auditable.length === 0 ? 0 : (auditable.length - unsupported - review * 0.4) / auditable.length;
  const checks = [
    ...pack.crossValidation.checks,
    {
      id: 'claim-coverage',
      label: 'Claim 证据覆盖',
      status: unsupported === 0 && auditable.length > 0 ? 'passed' as const : 'failed' as const,
      detail: `${auditable.length - unsupported}/${auditable.length} 条事实声明已绑定证据${nonFactualCount > 0 ? `（${nonFactualCount} 条非事实教学表达不计入分母）` : ''}`,
      evidenceIds: auditable.flatMap((claim) => claim.evidenceIds),
    },
    {
      id: 'numeric-consistency',
      label: '数字与单位一致',
      status: review === 0 ? 'passed' as const : 'review' as const,
      detail: review === 0 ? '未发现无法从证据核对的数字' : `${review} 条内容需要核对数字或单位`,
      evidenceIds: auditable.filter((claim) => claim.verdict === 'review').flatMap((claim) => claim.evidenceIds),
    },
  ];
  const status = unsupported > 0
    ? 'unsupported'
    : review > 0 || pack.crossValidation.status !== 'corroborated'
    ? 'needs_review'
    : 'corroborated';
  return {
    claims,
    summary: {
      status,
      score: Math.round(Math.max(0, Math.min(1, claimScore * 0.65 + pack.crossValidation.score * 0.35)) * 100) / 100,
      checks,
      notes: status === 'corroborated'
        ? ['来源交叉验证和 Claim 级核对均通过，可保存为已审核资产。']
        : ['存在未支持或待复核内容，不能把整份资源标记为确定结论。'],
    },
  };
}
