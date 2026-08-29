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

/* --------------------- 运行前学情信号（升级计划 §4.7 两阶段决策第一阶段） --------------------- */

export interface RunLearnerSignals {
  /** 画像不确定度 = 1 - 目标知识点与先修点加权平均 confidence（不再用"有没有历史"估算） */
  profileUncertainty: number;
  /** 知识风险 = 0.5×近期错误率 + 0.3×先修缺口 + 0.2×掌握不确定性 */
  knowledgeRisk: number;
  weightedConfidence: number;
  recentErrorRate: number;
  prereqGap: number;
  masteryUncertainty: number;
  hasAnswerHistory: boolean;
  /** 信号来源（公开依据，写入 design_constraints artifact 的 basisRefs） */
  basis: string[];
}

interface SignalSkillState {
  pMastery: number;
  confidence: number;
  attemptCount: number;
  correctCount: number;
}

/**
 * 学情信号纯函数：输入目标知识点状态、先修状态与画像正确率，输出可解释信号。
 * 全部数值可回溯到 learner_skill_states / bkt_updates。
 */
export function computeRunLearnerSignals(input: {
  profileAccuracy: number | null;
  hasStudyHistory: boolean;
  targetState: SignalSkillState | null;
  prereqStates: SignalSkillState[];
  prereqTotal: number;
}): RunLearnerSignals {
  const targetConfidence = input.targetState?.confidence ?? 0.1;
  const prereqConfidence = input.prereqStates.length > 0
    ? input.prereqStates.reduce((sum, state) => sum + state.confidence, 0) / input.prereqStates.length
    : null;
  // 先修点按整体权重 0.4 分摊，无先修时目标知识点权重全占
  const weightedConfidence = prereqConfidence === null
    ? targetConfidence
    : 0.6 * targetConfidence + 0.4 * prereqConfidence;
  const profileUncertainty = 1 - Math.min(1, Math.max(0, weightedConfidence));

  const hasAnswerHistory = (input.targetState?.attemptCount ?? 0) > 0
    || input.prereqStates.some((state) => state.attemptCount > 0)
    || input.profileAccuracy !== null;
  const targetAttempts = input.targetState?.attemptCount ?? 0;
  const recentErrorRate = targetAttempts >= 3
    ? 1 - (input.targetState!.correctCount / targetAttempts)
    : input.profileAccuracy !== null
      ? 1 - input.profileAccuracy
      : 0.3;

  const prereqGap = input.prereqTotal === 0
    ? 0
    : 1 - (input.prereqStates.filter((state) => state.pMastery >= 0.6).length / input.prereqTotal);
  const masteryPool = [input.targetState, ...input.prereqStates].filter(Boolean) as SignalSkillState[];
  const masteryUncertainty = masteryPool.length === 0
    ? 0.5
    : 1 - masteryPool.reduce((sum, state) => sum + state.pMastery, 0) / masteryPool.length;
  const knowledgeRisk = Math.min(1, 0.5 * recentErrorRate + 0.3 * prereqGap + 0.2 * masteryUncertainty);

  return {
    profileUncertainty: Number(profileUncertainty.toFixed(3)),
    knowledgeRisk: Number(knowledgeRisk.toFixed(3)),
    weightedConfidence: Number(weightedConfidence.toFixed(3)),
    recentErrorRate: Number(recentErrorRate.toFixed(3)),
    prereqGap: Number(prereqGap.toFixed(3)),
    masteryUncertainty: Number(masteryUncertainty.toFixed(3)),
    hasAnswerHistory,
    basis: [],
  };
}

/** 从路径图计算目标节点的先修闭包（沿前置边向上 BFS，深度上限 4） */
export function prereqClosureOf(
  graph: { nodes: Array<{ id: string; knowledgePointId: string }>; edges: Array<{ fromNodeId: string; toNodeId: string; relation: string }> },
  pathNodeId: string,
): { nodeIds: string[]; knowledgePointIds: string[] } {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const prereqParents = new Map<string, string[]>();
  for (const edge of graph.edges) {
    if (/prereq|before|先行|前置/i.test(edge.relation)) {
      prereqParents.set(edge.toNodeId, [...(prereqParents.get(edge.toNodeId) ?? []), edge.fromNodeId]);
    }
  }
  const visited = new Set<string>();
  const queue: Array<{ id: string; depth: number }> = [{ id: pathNodeId, depth: 0 }];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (current.depth >= 4) continue;
    for (const parentId of prereqParents.get(current.id) ?? []) {
      if (visited.has(parentId) || !byId.has(parentId)) continue;
      visited.add(parentId);
      queue.push({ id: parentId, depth: current.depth + 1 });
    }
  }
  return {
    nodeIds: [...visited],
    knowledgePointIds: [...visited]
      .map((id) => byId.get(id)?.knowledgePointId)
      .filter((id): id is string => Boolean(id)),
  };
}

/**
 * 运行前学情信号（API 侧封装）：目标知识点 + 先修闭包的真实 BKT 状态。
 * 替换旧版"有无学习历史"的粗粒度估算（升级计划 G5）。
 */
export async function computePlannerKnowledgeSignals(learnerId: string, pathNodeId: string | null): Promise<RunLearnerSignals & { targetKnowledgePointId: string | null; basis: string[] }> {
  if (!pathNodeId) {
    const skills = await learningStore.getSkillStates(learnerId);
    const profile = await learningStore.getProfile(learnerId);
    const signals = computeRunLearnerSignals({
      profileAccuracy: profile.accuracy ?? null,
      hasStudyHistory: profile.studyMinutes > 0 || profile.assetsCount > 0,
      targetState: skills[0] ?? null,
      prereqStates: [],
      prereqTotal: 0,
    });
    return {
      ...signals,
      targetKnowledgePointId: skills[0]?.knowledgePointId ?? null,
      basis: skills[0] ? [`skill:${skills[0].knowledgePointId}`] : ['skill:none'],
    };
  }
  const [graph, skills, profile] = await Promise.all([
    learningStore.getPathGraph(learnerId),
    learningStore.getSkillStates(learnerId),
    learningStore.getProfile(learnerId),
  ]);
  const targetNode = graph.nodes.find((node) => node.id === pathNodeId) ?? null;
  const closure = targetNode
    ? prereqClosureOf(graph, targetNode.id)
    : { nodeIds: [], knowledgePointIds: [] };
  const stateByKp = new Map(skills.map((state) => [state.knowledgePointId, state]));
  const targetKp = targetNode?.knowledgePointId ?? null;
  const targetState = targetKp ? stateByKp.get(targetKp) ?? null : null;
  const prereqStates = closure.knowledgePointIds
    .map((kp) => stateByKp.get(kp))
    .filter((state): state is NonNullable<typeof state> => Boolean(state));
  const signals = computeRunLearnerSignals({
    profileAccuracy: profile.accuracy ?? null,
    hasStudyHistory: profile.studyMinutes > 0 || profile.assetsCount > 0,
    targetState,
    prereqStates,
    prereqTotal: closure.knowledgePointIds.length,
  });
  const basis = [
    targetState ? `skill:${targetKp}` : `skill:${targetKp ?? 'none'}:missing`,
    ...prereqStates.map((state) => `skill:${state.knowledgePointId}`),
  ];
  return { ...signals, targetKnowledgePointId: targetKp, basis };
}
