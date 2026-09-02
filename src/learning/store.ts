import type { QuizQuestion, QuizQuestionType, ResourceDocument } from './types.js';

export interface LearningPathNodeView {
  id: string;
  knowledgePointId: string;
  title: string;
  description: string;
  userStatus: 'not_started' | 'learning' | 'completed';
  mastered: boolean;
  sortOrder: number;
  recommendation?: PathNodeRecommendation;
}

export type PathNodeRecommendationLevel = 'no_evidence' | 'reinforce' | 'maintain' | 'advance';

export interface PathNodeRecommendation {
  level: PathNodeRecommendationLevel;
  reason: string;
  attemptCount: number;
  correctCount: number;
  mastery: number;
  /** 参与本次建议计算的持久化证据来源。 */
  sources?: Array<'diagnostic' | 'quiz_attempt' | 'asset_feedback' | 'learning_decision'>;
  /** 参与本次建议计算的最新证据时间；没有直接证据时为空。 */
  updatedAt?: number | null;
}

export interface NodeRecommendationInput {
  skill?: { mastery: number; attemptCount: number; correctCount: number } | null;
  feedbackLevel?: 'high' | 'medium' | 'low' | null;
}

// 路径节点建议由确定性规则从作答与反馈证据推导，不自动改写用户手动状态。
export function computeNodeRecommendation(input: NodeRecommendationInput): PathNodeRecommendation {
  const attemptCount = input.skill?.attemptCount ?? 0;
  const correctCount = input.skill?.correctCount ?? 0;
  const mastery = Number((input.skill?.mastery ?? 0).toFixed(2));
  const correctRate = attemptCount > 0 ? correctCount / attemptCount : 0;
  const percent = Math.round(correctRate * 100);
  const metrics = { attemptCount, correctCount, mastery };
  if (attemptCount === 0) {
    if (input.feedbackLevel === 'low') {
      return { level: 'reinforce', reason: '你对相关资料的掌握反馈是“掌握不好”，建议先补强这个节点', ...metrics };
    }
    if (input.feedbackLevel === 'high' || input.feedbackLevel === 'medium') {
      return { level: 'maintain', reason: '已阅读相关资料但还没有作答记录，建议做一组练习验证掌握情况', ...metrics };
    }
    return { level: 'no_evidence', reason: '该节点还没有作答或学习反馈，从一次讲义学习或练习开始', ...metrics };
  }
  if (input.feedbackLevel === 'low') {
    return { level: 'reinforce', reason: `你将资料掌握反馈标为“掌握不好”，建议先补强这个节点（已作答 ${attemptCount} 次，正确率 ${percent}%）`, ...metrics };
  }
  if (correctRate < 0.6 || mastery < 0.3) {
    return { level: 'reinforce', reason: `已作答 ${attemptCount} 次，正确率 ${percent}%，建议补强后再继续后续节点`, ...metrics };
  }
  if (attemptCount >= 4 && correctRate >= 0.75 && mastery >= 0.5) {
    return { level: 'advance', reason: `已作答 ${attemptCount} 次，正确率 ${percent}%，可以尝试进阶任务或挑战题`, ...metrics };
  }
  return { level: 'maintain', reason: `已作答 ${attemptCount} 次，正确率 ${percent}%，按当前节奏继续`, ...metrics };
}

export interface LearningPathEdgeView {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  relation: 'prerequisite' | 'branch' | 'application' | 'review';
}

export interface LearningPathGraphView {
  nodes: LearningPathNodeView[];
  edges: LearningPathEdgeView[];
}

export interface LearningPathRevisionInput {
  addNodes?: Array<{ knowledgePointId: string; title: string; description: string }>;
  updateNodes?: Array<{ knowledgePointId: string; title?: string; description?: string }>;
  addEdges?: Array<{ fromKnowledgePointId: string; toKnowledgePointId: string; relation: LearningPathEdgeView['relation'] }>;
}

export interface AssetFeedbackInput {
  completed?: boolean;
  mastered?: boolean;
  masteryLevel?: 'high' | 'medium' | 'low' | null;
  difficultyRating?: number | null;
  userRating?: number | null;
  note?: string | null;
}

export interface AssetFeedbackView {
  completed: boolean;
  mastered: boolean;
  masteryLevel: 'high' | 'medium' | 'low' | null;
  difficultyRating: number | null;
  userRating: number | null;
  note: string | null;
  updatedAt: number;
}

export interface AssetPageNoteView {
  pageKey: string;
  content: string;
  updatedAt: number;
}

export interface QuizAttemptView {
  id: string;
  questionId: string;
  answerId: string;
  correct: boolean;
  durationMs: number;
  createdAt: number;
}

export interface QuizSubmissionResult {
  attempt: QuizAttemptView;
  question: QuizQuestion;
}

export interface LearningChatMessageView {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface LearnerRadarItem {
  name: string;
  score: number;
  reason?: string;
}

export interface LearnerProfileView {
  learnerId: string;
  summary: string;
  status: 'awaiting_evidence' | 'learning';
  assetsCount: number;
  todayAssetsCount: number;
  completedAssetsCount: number;
  masteredAssetsCount: number;
  evidenceCount: number;
  studyMinutes: number;
  accuracy: number | null;
  keywords: string[];
  radar: LearnerRadarItem[];
  skills: Array<{
    knowledgePointId: string;
    mastery: number;
    confidence: number;
    attemptCount: number;
    correctCount: number;
  }>;
}

export interface PrivacyAuditEventView {
  id: string;
  eventType: string;
  fileName: string | null;
  byteCount: number | null;
  redactedFieldCount: number;
  retained: boolean;
  createdAt: number;
}

export function extractQuizQuestions(asset: ResourceDocument): QuizQuestion[] {
  const questionBlock = asset.blocks.find((block) => block.type === 'question');
  const raw = questionBlock?.content;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const candidate = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item): QuizQuestion[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Partial<QuizQuestion>;
    if (typeof value.id !== 'string' || typeof value.prompt !== 'string' || typeof value.answerId !== 'string') return [];
    const type: QuizQuestionType = value.type === 'blank' || value.type === 'short_answer' ? value.type : 'choice';
    const options = (Array.isArray(value.options) ? value.options : []).flatMap((option) => option && typeof option.id === 'string' && typeof option.text === 'string'
      ? [{ id: option.id, text: option.text }]
      : []);
    if (!value.answerId.trim()) return [];
    if (type === 'choice' && (options.length < 2 || !options.some((option) => option.id === value.answerId))) return [];
    return [{
      id: value.id,
      type,
      level: value.level === 'L2' || value.level === 'L3' ? value.level : 'L1',
      prompt: value.prompt,
      options: options.length > 0 ? options : undefined,
      answerId: value.answerId,
      explanation: typeof value.explanation === 'string' ? value.explanation : '',
      evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === 'string') : [],
    }];
  });
}

export function normalizeResourceDocument(asset: ResourceDocument): ResourceDocument {
  if (asset.type !== 'tiered_quiz' || extractQuizQuestions(asset).length > 0) return asset;
  const questionBlock = asset.blocks.find((block) => block.type === 'question');
  if (!questionBlock) return asset;
  const evidenceIds = asset.evidenceIds.slice(0, 3);
  const questions: QuizQuestion[] = [
    {
      id: 'legacy-evidence-boundary', level: 'L1', prompt: '设备传感器出现异常时，哪种判断最符合证据边界？',
      options: [{ id: 'A', text: '已经证明设备确定故障。' }, { id: 'B', text: '提示风险，需要补充证据或现场复核。' }, { id: 'C', text: '不再需要说明不确定性。' }, { id: 'D', text: '直接删除异常记录。' }],
      answerId: 'B', explanation: '单一读数支持的是风险判断，不等于确定故障；仍应保留复核边界。', evidenceIds,
    },
    {
      id: 'legacy-cross-check', level: 'L2', prompt: '为了降低单一时间窗口带来的误判，最合适的动作是？',
      options: [{ id: 'A', text: '忽略相邻工况。' }, { id: 'B', text: '直接写出故障名称。' }, { id: 'C', text: '补充关联字段、时间窗口或现场复核。' }, { id: 'D', text: '只保留最终结论。' }],
      answerId: 'C', explanation: '交叉核验需要更多可定位证据，或通过现场复核来降低不确定性。', evidenceIds,
    },
    {
      id: 'legacy-traceability', level: 'L3', prompt: '一份可追溯的风险结论至少应保留什么？',
      options: [{ id: 'A', text: '风险判断、依据和复核动作。' }, { id: 'B', text: '一个无来源的结论。' }, { id: 'C', text: '只写建议维修。' }, { id: 'D', text: '删除推理过程。' }],
      answerId: 'A', explanation: '可追溯的判断需要明确依据、结论边界和后续可以执行的动作。', evidenceIds,
    },
  ];
  return {
    ...asset,
    blocks: asset.blocks.map((block) => block.id === questionBlock.id ? { ...block, content: { questions } } : block),
  };
}

export function normalizeKnowledgePointId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}
