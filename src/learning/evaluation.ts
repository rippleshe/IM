/**
 * 评测案例与指标（docs/挑战杯技术开发总规.md §8.2）
 * 60 个固定案例：三画像各 20，覆盖 AI4I、MetroPT-3、六类资源与基础/进阶/迁移三层任务。
 * 纯函数：案例生成确定性，指标计算可复现。
 */
import type { LearningResourceType } from './types.js';

export type EvaluationPersona = 'learner-foundation' | 'learner-advanced' | 'learner-maintenance';
export type EvaluationDomain = 'ai4i' | 'metropt3';
export type EvaluationTaskLevel = 'basic' | 'advanced' | 'transfer';

export interface EvaluationCase {
  id: string;
  code: string;
  persona: EvaluationPersona;
  domain: EvaluationDomain;
  taskLevel: EvaluationTaskLevel;
  resourceType: LearningResourceType;
  task: string;
  requiredKnowledgePoints: string[];
  targetDifficultyRange: [number, number];
  allowedEvidenceScope: string[];
  expectedStructure: Record<string, unknown>;
}

/** 画像 → BKT 初始先验（与 demo:seed 的诊断作答模式一致，用于离线难度适配推演） */
export const PERSONA_PRIORS: Record<EvaluationPersona, { pMastery: number; confidence: number; prereqReadiness: number }> = {
  'learner-foundation': { pMastery: 0.18, confidence: 0.35, prereqReadiness: 0.25 },
  'learner-advanced': { pMastery: 0.72, confidence: 0.8, prereqReadiness: 0.9 },
  'learner-maintenance': { pMastery: 0.45, confidence: 0.6, prereqReadiness: 0.6 },
};

const PERSONA_TASK_FOCUS: Record<EvaluationPersona, Record<EvaluationDomain, Record<EvaluationTaskLevel, string>>> = {
  'learner-foundation': {
    ai4i: {
      basic: '解释 AI4I 数据集里 Machine failure 标签的含义，输出一份能看懂字段的学习讲义',
      advanced: '对比 AI4I 中 HDF 与 PWF 两类故障样本的过程温度差异，输出带数据摘录的分层习题',
      transfer: '把 AI4I 的字段观察方法迁移到新的传感器 CSV，输出可复用的实操指南',
    },
    metropt3: {
      basic: '看懂 MetroPT-3 压力传感器字段含义与采样频率，输出入门讲义',
      advanced: '在 MetroPT-3 故障窗口里观察 DV_pressure 变化，输出诊断复核卡片',
      transfer: '用 MetroPT-3 的观察思路分析一段未见过的空压机数据，输出挑战任务',
    },
  },
  'learner-advanced': {
    ai4i: {
      basic: '用 pandas 统计 AI4I 各故障标签的正样本率，输出含代码示例的讲义',
      advanced: '对 AI4I 的扭矩-转速关系做统计检验并比较故障判别思路，输出分层习题',
      transfer: '把 AI4I 上的阈值判别方法迁移到 MetroPT-3，输出可比较算法优劣的挑战任务',
    },
    metropt3: {
      basic: '梳理 MetroPT-3 的 15 个信号语义与量纲，输出知识图谱',
      advanced: '在故障窗口上实现滑动窗口统计与阈值告警对比，输出实操指南',
      transfer: '设计一个可迁移到其他设备的时序异常检测实验方案，输出挑战任务',
    },
  },
  'learner-maintenance': {
    ai4i: {
      basic: '从运维视角解释 AI4I 五类故障对应的现场检查动作，输出复习卡片',
      advanced: '基于 AI4I 标签统计给出巡检优先级建议，输出带证据的分层习题',
      transfer: '把 AI4I 的故障-动作映射整理成新设备的点检表模板，输出实操指南',
    },
    metropt3: {
      basic: '解释 MetroPT-3 压力开关与安全阀信号在现场的含义，输出讲义',
      advanced: '结合故障窗口生成一份可执行的现场诊断报告讲义',
      transfer: '为同类空压机输出一份可复用的诊断报告模板挑战任务',
    },
  },
};

const DOMAIN_KNOWLEDGE_POINTS: Record<EvaluationDomain, string[]> = {
  ai4i: ['pandas-reading', 'ai4i-overview', 'ai4i-failure-modes', 'statistics-basics', 'evidence-boundary'],
  metropt3: ['pandas-reading', 'time-series-basics', 'anomaly-threshold', 'data-cleaning', 'evidence-boundary'],
};

const LEVEL_KNOWLEDGE_POINTS: Record<EvaluationTaskLevel, string[]> = {
  basic: ['python-basics', 'pandas-reading'],
  advanced: ['statistics-basics', 'anomaly-threshold'],
  transfer: ['evidence-boundary', 'data-cleaning'],
};

const RESOURCE_TYPES: LearningResourceType[] = [
  'lecture', 'tiered_quiz', 'presentation', 'concept_map',
];

/**
 * 目标难度区间按教学原则独立设定（不拟合模型输出）：
 * 初学者任何资源都应偏易；进阶者接受高难度；在职转岗居中；
 * 习题相对讲义类要求区间相应收紧。
 */
function targetBandFor(persona: EvaluationPersona, type: LearningResourceType): [number, number] {
  const base: Record<EvaluationPersona, [number, number]> = {
    'learner-foundation': [0, 0.3],
    'learner-advanced': [0.4, 0.85],
    'learner-maintenance': [0.1, 0.5],
  };
  const quiz: Record<EvaluationPersona, [number, number]> = {
    'learner-foundation': [0, 0.2],
    'learner-advanced': [0.35, 0.8],
    'learner-maintenance': [0.05, 0.4],
  };
  if (type === 'tiered_quiz') return quiz[persona];
  return base[persona];
}

/** 生成 60 个固定案例：每画像 20 = 4 类资源 × 5 个域与任务组合 */
export function buildEvaluationCases(): EvaluationCase[] {
  const personas: EvaluationPersona[] = ['learner-foundation', 'learner-advanced', 'learner-maintenance'];
  const cases: EvaluationCase[] = [];
  for (const persona of personas) {
    for (const type of RESOURCE_TYPES) {
      const combos: Array<{ domain: EvaluationDomain; level: EvaluationTaskLevel }> = [
        { domain: 'ai4i', level: 'basic' },
        { domain: 'metropt3', level: 'advanced' },
        { domain: 'metropt3', level: 'transfer' },
      ];
      combos.push({ domain: 'ai4i', level: 'transfer' }, { domain: 'ai4i', level: 'advanced' });
      for (const combo of combos) {
        const index = cases.filter((item) => item.persona === persona).length + 1;
        const task = PERSONA_TASK_FOCUS[persona][combo.domain][combo.level];
        cases.push({
          id: `eval-${persona}-${index.toString().padStart(2, '0')}`,
          code: `${persona}:${type}:${combo.domain}:${combo.level}#${index}`,
          persona,
          domain: combo.domain,
          taskLevel: combo.level,
          resourceType: type,
          task,
          requiredKnowledgePoints: [...new Set([...DOMAIN_KNOWLEDGE_POINTS[combo.domain], ...LEVEL_KNOWLEDGE_POINTS[combo.level]])],
          targetDifficultyRange: targetBandFor(persona, type),
          allowedEvidenceScope: combo.domain === 'ai4i' ? ['dataset:ai4i-2020', 'document:knowledge-cards'] : ['dataset:metropt-3', 'document:knowledge-cards'],
          expectedStructure: {
            requiresEvidenceBlocks: true,
            requiresKnowledgePointBinding: true,
            quizTier: type === 'tiered_quiz' ? ['L1', 'L2', 'L3'] : null,
          },
        });
      }
    }
  }
  return cases;
}

/** 难度适配判定：校准难度落在案例目标区间内 */
export function difficultyMatches(calibration: { targetDifficulty: number }, targetRange: [number, number]): boolean {
  return calibration.targetDifficulty >= targetRange[0] && calibration.targetDifficulty <= targetRange[1];
}

/** 核心知识覆盖率：有证据支持的知识点 / 黄金知识点 */
export function coverageRate(supportedKnowledgePoints: Iterable<string>, required: string[]): number {
  const supported = new Set(supportedKnowledgePoints);
  const requiredSet = new Set(required);
  if (requiredSet.size === 0) return 1;
  let hit = 0;
  for (const knowledgePoint of requiredSet) {
    if (supported.has(knowledgePoint)) hit += 1;
  }
  return hit / requiredSet.size;
}

/**
 * 幻觉率（升级计划 §F 官方口径）：unsupported 事实声明 / 可审计事实声明。
 * non_factual 教学表达不入分母；空分母返回 null（N/A），不能当作 0。
 */
export function hallucinationRate(claims: Array<{ verdict: string; claimType?: string | null }>): number | null {
  const auditable = claims.filter((claim) => (claim.claimType ?? 'risk_advice') !== 'non_factual');
  if (auditable.length === 0) return null;
  const unsupported = auditable.filter((claim) => claim.verdict === 'unsupported').length;
  return Math.round((unsupported / auditable.length) * 1000) / 1000;
}

/** 初稿幻觉率（attempt 1）与终稿幻觉率（最大 attempt）对照；无轮次数据时如实返回 null */
export function draftFinalHallucinationRates(
  claims: Array<{ attempt?: number | null; verdict: string; claimType?: string | null }>,
): { draft: number | null; final: number | null; gain: number | null } {
  const attempts = [...new Set(claims.map((claim) => claim.attempt ?? 1))].sort((a, b) => a - b);
  if (attempts.length === 0) return { draft: null, final: null, gain: null };
  const rateAt = (attempt: number): number | null =>
    hallucinationRate(claims.filter((claim) => (claim.attempt ?? 1) === attempt));
  const draft = rateAt(attempts[0]!);
  const final = rateAt(attempts.at(-1)!);
  return { draft, final, gain: draft !== null && final !== null ? Math.round((draft - final) * 1000) / 1000 : null };
}
