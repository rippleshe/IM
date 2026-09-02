import { describe, expect, it } from 'vitest';
import { auditResource, claimLogicalKey, classifyClaimText } from './audit.js';
import { verifyClaim, verifyClaims, type DatasetFieldInfo } from './claim-verification.js';
import type { EvidenceItem, EvidencePack, ResourceDocument } from './types.js';

function evidenceItem(id: string, content: string, sourceType: EvidenceItem['sourceType'] = 'dataset'): EvidenceItem {
  return {
    id,
    sourceType,
    sourceId: 'ds-1',
    sourceTitle: 'AI4I 测试数据',
    locator: 'row 42',
    content,
    retrievalMethod: 'sql',
    relevanceScore: 0.9,
    trustLevel: 'high',
  };
}

function pack(items: EvidenceItem[]): EvidencePack {
  return {
    id: 'pack-1',
    query: '测试',
    items,
    retrievalPlan: ['structured'],
    coverageScore: 0.9,
    crossValidation: { status: 'corroborated', score: 1, checks: [], notes: [] },
    structuredCount: items.length,
    documentCount: 0,
    temporaryCount: 0,
    privacy: { temporaryReferenceUsed: false, retained: false },
    createdAt: 0,
  };
}

function claim(text: string, evidenceIds: string[], claimType?: ReturnType<typeof classifyClaimText>) {
  return {
    id: 'c1',
    text,
    verdict: 'supported' as const,
    critique: '',
    factualScore: 1,
    evidenceIds,
    ...(claimType ? { claimType } : {}),
  };
}

const AI4I_FIELDS: DatasetFieldInfo[] = [
  { fieldName: 'Air temperature', meaning: '空气温度 单位 K 环境温度' },
  { fieldName: 'Torque', meaning: '扭矩 旋转力矩 单位 Nm' },
];

describe('Claim 分类（升级计划 §4.5）', () => {
  it('数值/因果/字段含义/方法步骤/风险建议各归其类', () => {
    expect(classifyClaimText('故障率约为 3.2%')).toBe('numeric');
    expect(classifyClaimText('异常增加会导致故障发生')).toBe('causal');
    expect(classifyClaimText('Torque 字段表示主轴扭矩')).toBe('field_meaning');
    expect(classifyClaimText('首先读取数据，然后筛选异常行')).toBe('method_step');
    expect(classifyClaimText('油温偏高可能存在风险，建议关注')).toBe('risk_advice');
    expect(classifyClaimText('练习：假设某个时间点为 2023-01-01')).toBe('non_factual');
  });
});

describe('声明级幻觉治理：故障注入（升级计划 里程碑 D 必测）', () => {
  it('注入 1：数字改动一个数量级 → 数值核验失败拦截', () => {
    const packData = pack([evidenceItem('e1', 'Air temperature 298.1 K, Torque 52.3 Nm')]);
    const bad = claim('环境温度为 2981 K', ['e1'], 'numeric');
    const result = verifyClaim(bad, packData);
    expect(result.verdict).toBe('unsupported');
    expect(result.checks.find((check) => check.id === 'numeric-precision')?.status).toBe('failed');
  });

  it('注入 2：数字与证据一致 → 通过', () => {
    const packData = pack([evidenceItem('e1', 'Air temperature 298.1 K, Torque 52.3 Nm')]);
    const good = claim('环境温度为 298.1 K', ['e1'], 'numeric');
    expect(verifyClaim(good, packData).verdict).toBe('supported');
  });

  it('精确行数可以支持保守的中文数量下界，不能支持更高下界', () => {
    const packData = pack([evidenceItem('e1', '共 1516948 行记录')]);
    expect(verifyClaim(claim('数据包含超过 150 万行记录', ['e1'], 'numeric'), packData).verdict).toBe('supported');
    expect(verifyClaim(claim('数据包含超过 200 万行记录', ['e1'], 'numeric'), packData).verdict).toBe('unsupported');
  });

  it('注入 3：把"异常风险"写成"一定发生故障" → 越界因果拦截', () => {
    const packData = pack([evidenceItem('e1', '油温异常升高，存在故障风险')]);
    const overreach = claim('油温异常一定会发生故障', ['e1'], 'causal');
    const result = verifyClaim(overreach, packData);
    expect(result.verdict).toBe('unsupported');
    expect(result.checks.find((check) => check.id === 'causal-boundary')?.status).toBe('failed');
    // 保留不确定性限定的表述降为待复核而非直接否决
    const hedged = claim('油温异常可能意味着故障风险', ['e1'], 'causal');
    expect(verifyClaim(hedged, packData).verdict).not.toBe('unsupported');
  });

  it('注入 4：字段含义写错 → 字段字典核验拦截', () => {
    const packData = pack([evidenceItem('e1', 'Torque 数值为 52.3')]);
    const wrong = claim('Torque 字段表示空气湿度', ['e1'], 'field_meaning');
    const result = verifyClaim(wrong, packData, { datasetFields: AI4I_FIELDS });
    expect(result.verdict).toBe('unsupported');
    expect(result.checks.find((check) => check.id === 'field-meaning')?.status).toBe('failed');
    const right = claim('Torque 扭矩数值为 52.3', ['e1'], 'field_meaning');
    expect(verifyClaim(right, packData, { datasetFields: AI4I_FIELDS }).verdict).toBe('supported');
  });

  it('字段类型与格式操作不被误当作字段语义解释', () => {
    const packData = pack([evidenceItem('e1', 'timestamp 采样时间')]);
    const operation = claim('确认 timestamp 列的数据类型后转换为 datetime', ['e1'], 'field_meaning');
    expect(verifyClaim(operation, packData, { datasetFields: [{ fieldName: 'timestamp', meaning: '采样时间' }] }).verdict).toBe('supported');
  });

  it('注入 5：引用越出允许证据范围 → 引用核验拦截', () => {
    const packData = pack([evidenceItem('e1', 'Air temperature 298.1 K')]);
    const outOfScope = claim('环境温度 298.1 K，属于正常范围', ['e1', 'e-missing'], 'numeric');
    const result = verifyClaim(outOfScope, packData);
    expect(result.verdict).toBe('unsupported');
    expect(result.checks.find((check) => check.id === 'citation-scope')?.status).toBe('failed');
  });

  it('注入 6：无证据操作建议 → 基础审核直接 unsupported', () => {
    const packData = pack([evidenceItem('e1', 'Air temperature 298.1 K')]);
    const doc: ResourceDocument = {
      id: 'doc-1', taskId: 't', type: 'lecture', title: '讲义', difficulty: 0.3,
      learningObjectives: [], knowledgePointIds: [],
      blocks: [{ id: 'b1', type: 'paragraph', position: 1, content: '应立即停机并更换主轴轴承', knowledgePointIds: [], evidenceIds: [] }],
      evidenceIds: [], auditStatus: 'pending', createdAt: 0,
    };
    const result = auditResource(doc, packData);
    expect(result.claims[0]?.verdict).toBe('unsupported');
  });

  it('注入 7：verifyClaims 只能更严不能放松', () => {
    const packData = pack([evidenceItem('e1', 'Torque 52.3 Nm')]);
    const records = [
      claim('扭矩为 52.3', ['e1'], 'numeric'),
      { ...claim('扭矩为 9999', ['e1'], 'numeric'), verdict: 'review' as const },
      { ...claim('扭矩为 8888', ['e1'], 'numeric'), verdict: 'unsupported' as const, critique: '已判无证据' },
    ];
    const verified = verifyClaims(records, packData);
    expect(verified[0]?.verdict).toBe('supported');
    expect(verified[1]?.verdict).toBe('unsupported');
    expect(verified[2]?.verdict).toBe('unsupported');
    expect(verified[2]?.critique).toContain('已判无证据');
  });

  it('核验不放松：核验结论只升不降（升级计划门禁原则）', () => {
    const packData = pack([evidenceItem('e1', '温度 298.1 K 正常')]);
    const supported = claim('温度 298.1 K', ['e1'], 'numeric');
    expect(verifyClaim(supported, packData).verdict).toBe('supported');
  });
});

describe('逻辑键与非事实口径（升级计划 §4.5、F 官方口径）', () => {
  it('同一声明改写后 logicalKey 稳定，不同声明不同键', () => {
    expect(claimLogicalKey('环境温度为 298.1 K。')).toBe(claimLogicalKey('环境温度为 298.1 K'));
    expect(claimLogicalKey('环境温度为 298.1 K')).not.toBe(claimLogicalKey('扭矩为 52.3 Nm'));
  });

  it('教学元表达分类为 non_factual（不进入幻觉率分母）', () => {
    expect(classifyClaimText('本节我们先学习数据集字段含义')).toBe('non_factual');
  });
});
