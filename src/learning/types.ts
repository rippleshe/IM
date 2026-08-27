export type LearningResourceType =
  | 'lecture'
  | 'concept_map'
  | 'practice_guide'
  | 'review_cards'
  | 'tiered_quiz'
  | 'challenge_task';

export type EvidenceSourceType = 'dataset' | 'document' | 'learner_state' | 'upload';
export type RetrievalMethod = 'sql' | 'fts' | 'vector' | 'none';
export type EvidenceScope = 'system' | 'session_upload' | 'learner_private';

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
  learnerId?: string;
  sessionId?: string;
  createdAt: number;
}

export interface ResourceBlock {
  id: string;
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'callout' | 'question' | 'checklist' | 'evidence';
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
