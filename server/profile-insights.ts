/**
 * 画像洞见（docs/挑战杯技术开发总规.md §3 GET /api/learning/profile 扩展、§4 产品闭环第 3 步）
 * 从 BKT 技能状态、路径先修与诊断会话确定性推导：知识盲区、难度匹配曲线、资源匹配与最近诊断。
 * 全部数字可回溯到 learner_skill_states / bkt_updates / diagnostic_sessions，不虚构能力评价。
 */
import { calibrateDifficulty, type ScaffoldStrength } from '../src/learning/difficulty.js';
import { normalizeKnowledgePointId, type LearningPathEdgeView } from '../src/learning/store.js';
import { learningStore } from './study-context.js';
import type { LearningResourceType } from '../src/learning/types.js';

/** 常见知识点的中文标签；未命中的知识点直接展示 ID */
const KP_LABELS: Record<string, string> = {
  'python-basics': 'Python 基础',
  'python-control': 'Python 控制流',
  'python-data-structures': 'Python 数据结构',
  'pandas-reading': 'pandas 读数',
  'pandas-filter': 'pandas 筛选',
  'data-cleaning': '数据清洗',
  'statistics-basics': '统计基础',
  'time-series-basics': '时序分析基础',
  'evidence-boundary': '证据边界',
  'anomaly-threshold': '阈值与异常判断',
  'ai4i-overview': 'AI4I 数据集',
  'ai4i-failure-modes': '故障机理',
  'metropt-3-basics': 'MetroPT-3 时序',
  'machine-learning-basics': '机器学习基础',
  'industrial-diagnosis-foundation': '设备诊断入门',
};

function labelOf(knowledgePointId: string): string {
  return KP_LABELS[knowledgePointId] ?? knowledgePointId;
}

export interface ProfileBlindSpot {
  knowledgePointId: string;
  label: string;
  pMastery: number;
  confidence: number;
  attemptCount: number;
  reason: string;
}

export interface DifficultyCurvePoint {
  knowledgePointId: string;
  label: string;
  pMastery: number;
  confidence: number;
  prereqReadiness: number;
  scaffold: ScaffoldStrength;
  targetDifficulty: number;
  expectedSuccessRate: number;
}

export interface ResourceMatchItem {
  resourceType: LearningResourceType;
  label: string;
  targetDifficulty: number;
  expectedSuccessRate: number;
  suitability: 'recommended' | 'ok' | 'stretch';
  note: string;
}

export interface ProfileInsights {
  blindSpots: ProfileBlindSpot[];
  difficultyCurve: DifficultyCurvePoint[];
  resourceMatch: ResourceMatchItem[];
  latestDiagnostic: { total: number; correct: number; createdAt: number } | null;
}

const RESOURCE_SCAFFOLD: Record<LearningResourceType, ScaffoldStrength> = {
  lecture: 'high',
  practice_guide: 'high',
  concept_map: 'high',
  review_cards: 'high',
  tiered_quiz: 'medium',
  challenge_task: 'low',
};
const RESOURCE_LABELS: Record<LearningResourceType, string> = {
  lecture: '讲义',
  tiered_quiz: '分层习题',
  practice_guide: '实操指南',
  concept_map: '知识图谱',
  review_cards: '复习卡片',
  challenge_task: '挑战任务',
};

export async function buildProfileInsights(learnerId: string): Promise<ProfileInsights> {
  const skills = await learningStore.getSkillStates(learnerId);
  const graph = await learningStore.getPathGraph(learnerId);
  const masteredIds = new Set(
    graph.nodes.filter((node) => node.mastered || node.userStatus === 'completed').map((node) => node.id),
  );
  const prereqReadinessOf = (knowledgePointId: string): number => {
    const node = graph.nodes.find((item) => item.knowledgePointId === knowledgePointId);
    if (!node) return 1;
    const prereqIds = graph.edges
      .filter((edge: LearningPathEdgeView) => edge.toNodeId === node.id && /prereq|before|先行|前置/i.test(edge.relation))
      .map((edge) => edge.fromNodeId);
    if (prereqIds.length === 0) return 1;
    return prereqIds.filter((id) => masteredIds.has(id)).length / prereqIds.length;
  };

  // 盲区：掌握概率低且已有作答证据的知识点，按“掌握低 × 有证据”排序，最多 3 个
  const blindSpots: ProfileBlindSpot[] = skills
    .filter((state) => state.pMastery < 0.5)
    .sort((a, b) => (b.attemptCount > 0 ? 1 : 0) - (a.attemptCount > 0 ? 1 : 0) || a.pMastery - b.pMastery)
    .slice(0, 3)
    .map((state) => ({
      knowledgePointId: state.knowledgePointId,
      label: labelOf(state.knowledgePointId),
      pMastery: Number(state.pMastery.toFixed(2)),
      confidence: Number(state.confidence.toFixed(2)),
      attemptCount: state.attemptCount,
      reason: state.attemptCount > 0
        ? `已作答 ${state.attemptCount} 次（对 ${state.correctCount} 次），掌握概率 ${(state.pMastery * 100).toFixed(0)}%，置信度 ${(state.confidence * 100).toFixed(0)}%`
        : `仅有诊断证据：掌握概率 ${(state.pMastery * 100).toFixed(0)}%，还没有练习作答`,
    }));

  // 难度匹配曲线：每个技能点按当前状态推导“讲义脚手架”与“挑战脚手架”两个端点的建议难度
  const difficultyCurve: DifficultyCurvePoint[] = skills.slice(0, 6).map((state) => {
    const key = normalizeKnowledgePointId(state.knowledgePointId);
    const prereqReadiness = prereqReadinessOf(key);
    const calibration = calibrateDifficulty({
      pMastery: state.pMastery,
      confidence: state.confidence,
      prereqReadiness,
      scaffold: RESOURCE_SCAFFOLD.tiered_quiz,
    });
    return {
      knowledgePointId: key,
      label: labelOf(key),
      pMastery: Number(state.pMastery.toFixed(2)),
      confidence: Number(state.confidence.toFixed(2)),
      prereqReadiness: Number(prereqReadiness.toFixed(2)),
      scaffold: RESOURCE_SCAFFOLD.tiered_quiz,
      targetDifficulty: Number(calibration.targetDifficulty.toFixed(2)),
      expectedSuccessRate: Number(calibration.expectedSuccessRate.toFixed(2)),
    };
  });

  // 资源匹配：以最需要补强的技能点（或第一个技能点）为基准，给出六类资源的建议难度与适配判断
  const focusSkill = skills.find((state) => state.pMastery < 0.5) ?? skills[0];
  const resourceMatch: ResourceMatchItem[] = focusSkill
    ? (Object.keys(RESOURCE_SCAFFOLD) as LearningResourceType[]).map((resourceType) => {
        const key = normalizeKnowledgePointId(focusSkill.knowledgePointId);
        const calibration = calibrateDifficulty({
          pMastery: focusSkill.pMastery,
          confidence: focusSkill.confidence,
          prereqReadiness: prereqReadinessOf(key),
          scaffold: RESOURCE_SCAFFOLD[resourceType],
        });
        const targetDifficulty = Number(calibration.targetDifficulty.toFixed(2));
        const suitability: ResourceMatchItem['suitability'] = targetDifficulty <= 0.35
          ? 'recommended'
          : targetDifficulty <= 0.6 ? 'ok' : 'stretch';
        const note = suitability === 'recommended'
          ? `当前状态最适合：预计成功率 ${(calibration.expectedSuccessRate * 100).toFixed(0)}%`
          : suitability === 'ok'
            ? `可以尝试：建议先完成推荐资源后再做`
            : `属于进阶挑战：预计成功率 ${(calibration.expectedSuccessRate * 100).toFixed(0)}%，掌握后再做效果更好`;
        return { resourceType, label: RESOURCE_LABELS[resourceType], targetDifficulty, expectedSuccessRate: Number(calibration.expectedSuccessRate.toFixed(2)), suitability, note };
      })
    : [];

  const latestDiagnostic = await learningStore.getLatestDiagnosticSession(learnerId);

  return { blindSpots, difficultyCurve, resourceMatch, latestDiagnostic };
}
