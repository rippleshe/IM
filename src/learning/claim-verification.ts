/**
 * Claim 确定性核验（docs/挑战杯多智能体可信协同升级计划.md §4.5、里程碑 D）
 *
 * 纯函数：对一条已分类的 Claim 执行规则级核验——
 * - 数值 Claim：数字/单位是否精确出现在绑定证据中；
 * - 字段含义 Claim：字段名与解释是否对得上数据集字段字典；
 * - 因果 Claim：越界因果规则——相关/异常不得写成确定故障原因；
 * - 通用：证据定位必须存在，且不得越出允许证据包。
 *
 * 核验结论只能比输入 verdict 更严（supported → review → unsupported），绝不放松。
 */
import { claimLogicalKey, numericAssertionsSupported, type ClaimAuditRecord, type ClaimType } from './audit.js';
import type { EvidencePack } from './types.js';

export interface DatasetFieldInfo {
  fieldName: string;
  meaning: string;
}

export interface ClaimCheck {
  id: string;
  label: string;
  status: 'passed' | 'failed' | 'review';
  detail: string;
}

export interface ClaimVerificationResult {
  claimId: string;
  claimType: ClaimType;
  checks: ClaimCheck[];
  /** 合并后的规则结论（只能更严） */
  verdict: 'supported' | 'review' | 'unsupported';
  critique: string;
  factualScore: number;
}

const VERDICT_SEVERITY: Record<ClaimVerificationResult['verdict'], number> = {
  supported: 0, review: 1, unsupported: 2,
};

/** 绝对化因果表述：出现即视为越界因果（升级计划 D 必测故障注入第 3 类） */
const ABSOLUTE_CAUSAL_PATTERNS = [
  '一定会', '必然导致', '必然发生', '必然引发', '肯定发生', '一定会发生', '必然是', '肯定是',
  '一定导致', '必然造成', '一定造成', '百分之百',
];
/** 因果限定词：存在时说明表述保留了不确定性边界 */
const HEDGE_WORDS = ['可能', '风险', '倾向', '或存在', '或与', '疑似', '有待', '需现场', '建议复核', '提示'];

function evidenceTextOf(record: ClaimAuditRecord, pack: EvidencePack): { text: string; missingIds: string[] } {
  const found = pack.items.filter((item) => record.evidenceIds.includes(item.id));
  const missingIds = record.evidenceIds.filter((id) => !found.some((item) => item.id === id));
  return { text: found.map((item) => item.content).join('\n'), missingIds };
}

/** 数值核验：Claim 中每个数字都必须在绑定证据中出现（数字本体；百分比额外核对 %） */
function verifyNumeric(record: ClaimAuditRecord, evidenceText: string): ClaimCheck {
  const numbers = record.text.match(/\d+(?:\.\d+)?/g) ?? [];
  if (numbers.length === 0) {
    return { id: 'numeric-precision', label: '数值与证据一致', status: 'passed', detail: '无数值表述' };
  }
  if (numericAssertionsSupported(record.text, evidenceText)) {
    return { id: 'numeric-precision', label: '数值与证据一致', status: 'passed', detail: `${numbers.length} 个数字均可在证据中定位` };
  }
  return {
    id: 'numeric-precision',
    label: '数值与证据一致',
    status: 'failed',
    detail: '数字或数量边界未能在绑定证据中核对（数量级/改动风险）',
  };
}

/** 字段含义核验：只校验“表示/含义”等语义断言，不把字段名或类型操作误当字段释义。 */
function verifyFieldMeaning(record: ClaimAuditRecord, fields: DatasetFieldInfo[]): ClaimCheck | null {
  const semanticAssertion = ['含义', '表示', '是指', '定义为', '指的是', '含义为', '代表']
    .some((hint) => record.text.includes(hint));
  if (!semanticAssertion) return null;
  // 习题解析可能同时提到正确字段和干扰项字段；干扰项不是作者对这些字段的
  // 释义，不能因为它们出现在同一段解析里就逐个触发字段含义门禁。
  const primaryAssertion = record.text.split(/(?:选项|干扰项|错误选项)/)[0] ?? record.text;
  const mentioned = fields.filter((field) => primaryAssertion.includes(field.fieldName));
  if (mentioned.length === 0) return null;
  for (const field of mentioned) {
    // 含义关键词重叠：解释句中至少 2 个 2+ 字片段能在登记含义中找到
    const meaningTokens = field.meaning
      .replace(/[，。；、（）()]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length >= 2);
    const overlap = meaningTokens.filter((token) => record.text.includes(token)).length;
    if (meaningTokens.length > 0 && overlap === 0) {
      return {
        id: 'field-meaning',
        label: '字段含义与数据集字典一致',
        status: 'failed',
        detail: `对字段 ${field.fieldName} 的解释与数据集登记含义（${field.meaning.slice(0, 60)}）无重合`,
      };
    }
  }
  return { id: 'field-meaning', label: '字段含义与数据集字典一致', status: 'passed', detail: `${mentioned.length} 个字段解释与字典重合` };
}

/** 越界因果核验：绝对化因果表述没有限定词时，fail closed */
function verifyCausalBoundary(record: ClaimAuditRecord): ClaimCheck | null {
  const hasAbsolute = ABSOLUTE_CAUSAL_PATTERNS.some((pattern) => record.text.includes(pattern));
  if (!hasAbsolute) return null;
  const hasHedge = HEDGE_WORDS.some((word) => record.text.includes(word));
  if (hasHedge) {
    return { id: 'causal-boundary', label: '因果表述未越界', status: 'review', detail: '含绝对化表述但保留了不确定性限定，需人工确认' };
  }
  return {
    id: 'causal-boundary',
    label: '因果表述未越界',
    status: 'failed',
    detail: '把相关/异常写成了确定性因果结论（如"一定发生故障"），超出证据支持边界',
  };
}

/** 引用核验：证据定位必须存在且在允许证据包内 */
function verifyCitations(record: ClaimAuditRecord, missingIds: string[]): ClaimCheck | null {
  if (record.evidenceIds.length === 0) return null;
  if (missingIds.length === 0) {
    return { id: 'citation-scope', label: '证据引用未越出允许范围', status: 'passed', detail: `${record.evidenceIds.length} 条引用均在证据包内` };
  }
  return {
    id: 'citation-scope',
    label: '证据引用未越出允许范围',
    status: 'failed',
    detail: `引用越出允许证据包：${missingIds.join('、')}`,
  };
}

function mergeVerdict(checks: ClaimCheck[], input: ClaimAuditRecord): { verdict: ClaimVerificationResult['verdict']; critique: string } {
  let severity = VERDICT_SEVERITY[input.verdict];
  for (const check of checks) {
    if (check.status === 'failed') severity = Math.max(severity, 2);
    else if (check.status === 'review') severity = Math.max(severity, 1);
  }
  const verdict = severity === 2 ? 'unsupported' : severity === 1 ? 'review' : 'supported';
  const failed = checks.filter((check) => check.status === 'failed').map((check) => check.detail);
  const review = checks.filter((check) => check.status === 'review').map((check) => check.detail);
  const critique = [
    ...(failed.length > 0 ? failed : []),
    ...(failed.length === 0 && review.length > 0 ? review : []),
    ...(failed.length === 0 && review.length === 0 && input.verdict === 'supported' ? [] : [input.critique]),
  ].filter(Boolean).join('；').slice(0, 400);
  return { verdict, critique: critique || input.critique };
}

/**
 * 对单条 Claim 执行确定性核验（升级计划里程碑 D）。
 * 字段字典为空时跳过字段核验（如实标注）；其余规则不受影响。
 */
export function verifyClaim(
  record: ClaimAuditRecord,
  pack: EvidencePack,
  context: { datasetFields?: DatasetFieldInfo[] } = {},
): ClaimVerificationResult {
  const claimType = record.claimType ?? 'risk_advice';
  const { text: evidenceText, missingIds } = evidenceTextOf(record, pack);
  const checks: ClaimCheck[] = [];

  checks.push(verifyNumeric(record, evidenceText));
  if (claimType === 'field_meaning' && (context.datasetFields?.length ?? 0) > 0) {
    const fieldCheck = verifyFieldMeaning(record, context.datasetFields ?? []);
    if (fieldCheck) checks.push(fieldCheck);
  } else if (claimType === 'field_meaning') {
    checks.push({ id: 'field-meaning', label: '字段含义与数据集字典一致', status: 'review', detail: '字段字典不可用，需智能体补充核验字段解释' });
  }
  const causalCheck = verifyCausalBoundary(record);
  if (causalCheck) checks.push(causalCheck);
  const citationCheck = verifyCitations(record, missingIds);
  if (citationCheck) checks.push(citationCheck);

  const { verdict, critique } = mergeVerdict(checks, record);
  return {
    claimId: record.id,
    claimType,
    checks,
    verdict,
    critique,
    factualScore: verdict === 'supported' ? 1 : verdict === 'review' ? 0.6 : 0,
  };
}

/** 批量核验：返回升级后的记录（claimType/logicalKey 透传，verdict 只能更严） */
export function verifyClaims(
  records: ClaimAuditRecord[],
  pack: EvidencePack,
  context: { datasetFields?: DatasetFieldInfo[] } = {},
): Array<ClaimAuditRecord> {
  return records.map((record) => {
    const result = verifyClaim(record, pack, context);
    if (result.verdict === record.verdict && result.critique === record.critique) return record;
    return {
      ...record,
      verdict: result.verdict,
      critique: result.critique || record.critique,
      factualScore: result.factualScore,
      claimType: record.claimType ?? result.claimType,
      logicalKey: record.logicalKey ?? claimLogicalKey(record.text),
    };
  });
}
