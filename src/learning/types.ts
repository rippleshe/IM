export type LearningResourceType =
  | 'lecture'
  | 'concept_map'
  | 'practice_guide'
  | 'review_cards'
  | 'tiered_quiz'
  | 'challenge_task';

const LEARNING_RESOURCE_TYPE_VALUES: readonly LearningResourceType[] = [
  'lecture', 'concept_map', 'practice_guide', 'review_cards', 'tiered_quiz', 'challenge_task',
];

export function isLearningResourceType(value: unknown): value is LearningResourceType {
  return typeof value === 'string' && (LEARNING_RESOURCE_TYPE_VALUES as readonly string[]).includes(value);
}

export type EvidenceSourceType = 'dataset' | 'document' | 'learner_state' | 'upload';
export type RetrievalMethod = 'sql' | 'fts' | 'vector' | 'none';
export type EvidenceScope = 'system' | 'session_upload' | 'learner_private';

/** 混合检索信息（总规 §7.5）：向量路是否可用与降级原因 */
export interface HybridRetrievalInfo {
  vectorUsed: boolean;
  degraded: boolean;
  reason?: string;
  ftsCandidates: number;
  vectorCandidates: number;
}

export interface EvidenceCheck {
  id: string;
  label: string;
  status: 'passed' | 'review' | 'failed';
  detail: string;
  evidenceIds: string[];
}

export interface CrossValidationResult {
  status: 'corroborated' | 'needs_review' | 'conflict' | 'unsupported';
  score: number;
  checks: EvidenceCheck[];
  notes: string[];
}

export interface EvidenceItem {
  id: string;
  sourceType: EvidenceSourceType;
  sourceId: string;
  sourceTitle?: string;
  locator: string;
  content: string;
  retrievalMethod: RetrievalMethod;
  relevanceScore: number;
  trustLevel: 'high' | 'medium' | 'low';
  scope?: EvidenceScope;
  metadata?: Record<string, string | number | boolean>;
}

export interface EvidencePack {
  id: string;
  query: string;
  items: EvidenceItem[];
  retrievalPlan: Array<'structured' | 'document'>;
  coverageScore: number;
  crossValidation: CrossValidationResult;
  structuredCount: number;
  documentCount: number;
  temporaryCount: number;
  privacy: {
    temporaryReferenceUsed: boolean;
    retained: false;
  };
  /** 混合检索信息（总规 §7.5）：向量路是否可用与降级原因，仅 PG 数据源填充 */
  hybrid?: HybridRetrievalInfo;
  learnerId?: string;
  sessionId?: string;
  createdAt: number;
}

export interface ResourceBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'code' | 'callout' | 'question' | 'checklist' | 'evidence';
  position: number;
  content: unknown;
  knowledgePointIds: string[];
  evidenceIds: string[];
}

export interface QuizOption {
  id: string;
  text: string;
}

export interface QuizQuestion {
  id: string;
  level: 'L1' | 'L2' | 'L3';
  prompt: string;
  options: QuizOption[];
  answerId: string;
  explanation: string;
  evidenceIds: string[];
}

export interface ResourceDocument {
  id: string;
  taskId: string;
  type: LearningResourceType;
  title: string;
  difficulty: number;
  /** 难度校准依据（总规 §7.2），无校准信息时缺省 */
  difficultyCalibration?: {
    targetDifficulty: number;
    expectedSuccessRate: number;
    rationale: string[];
  };
  learningObjectives: string[];
  knowledgePointIds: string[];
  blocks: ResourceBlock[];
  evidenceIds: string[];
  evidencePackId?: string;
  auditSummary?: CrossValidationResult;
  auditStatus: 'pending' | 'passed' | 'revise' | 'manual_review_required';
  createdAt: number;
}

export interface MetroReading {
  rowId: number;
  timestamp: string;
  tp2: number | null;
  tp3: number | null;
  h1: number | null;
  dvPressure: number | null;
  reservoirs: number | null;
  oilTemperature: number | null;
  motorCurrent: number | null;
  comp: number | null;
  dvElectric: number | null;
  towers: number | null;
  mpg: number | null;
  lps: number | null;
  pressureSwitch: number | null;
  oilLevel: number | null;
  caudalImpulses: number | null;
}

export interface DatasetSummary {
  id: string;
  name: string;
  rowCount: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  fieldCount: number;
}
