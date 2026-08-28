import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';
import type { QuizQuestion, ResourceDocument } from './types.js';
import type { ClaimAuditRecord } from './audit.js';

export interface LearningPathItemView {
  id: string;
  knowledgePointId: string;
  title: string;
  status: string;
  priority: number;
  reason: string;
  completionCriteria: string;
  recommendedResourceType: string;
}

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
  retained: false;
  createdAt: number;
}

export class LearningStore {
  constructor(private readonly db: SqliteDatabase) {}

  saveAsset(learnerId: string, sessionId: string | undefined, resource: ResourceDocument): ResourceDocument {
    this.db.prepare(`
      INSERT OR REPLACE INTO learning_assets
        (id, learner_id, session_id, type, title, content_json, audit_status, evidence_ids_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      resource.id,
      learnerId,
      sessionId ?? null,
      resource.type,
      resource.title,
      JSON.stringify(resource),
      resource.auditStatus,
      JSON.stringify(resource.evidenceIds),
      resource.createdAt,
    );
    return resource;
  }

  listAssets(learnerId: string): ResourceDocument[] {
    const rows = this.db.prepare(`
      SELECT content_json AS contentJson FROM learning_assets
      WHERE learner_id = ? ORDER BY created_at DESC
    `).all(learnerId) as Array<{ contentJson: string }>;
    return rows.map((row) => normalizeResourceDocument(JSON.parse(row.contentJson) as ResourceDocument));
  }

  getAsset(learnerId: string, assetId: string): ResourceDocument | null {
    const row = this.db.prepare(`
      SELECT content_json AS contentJson FROM learning_assets
      WHERE learner_id = ? AND id = ?
    `).get(learnerId, assetId) as { contentJson?: string } | undefined;
    if (!row?.contentJson) return null;
    try {
      return normalizeResourceDocument(JSON.parse(row.contentJson) as ResourceDocument);
    } catch {
      return null;
    }
  }

  deleteAsset(learnerId: string, assetId: string): boolean {
    const asset = this.getAsset(learnerId, assetId);
    if (!asset) return false;
    this.db.prepare('DELETE FROM learning_asset_page_notes WHERE learner_id = ? AND asset_id = ?').run(learnerId, assetId);
    this.db.prepare('DELETE FROM learning_quiz_attempts WHERE learner_id = ? AND asset_id = ?').run(learnerId, assetId);
    this.db.prepare('DELETE FROM learning_asset_feedback WHERE learner_id = ? AND asset_id = ?').run(learnerId, assetId);
    this.db.prepare('DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE resource_id = ?)').run(assetId);
    this.db.prepare('DELETE FROM claims WHERE resource_id = ?').run(assetId);
    this.db.prepare('DELETE FROM learning_assets WHERE learner_id = ? AND id = ?').run(learnerId, assetId);
    this.recordLearningEvent(learnerId, 'asset_deleted', { assetId, type: asset.type });
    return true;
  }

  listAssetPageNotes(learnerId: string, assetId: string): AssetPageNoteView[] {
    return this.db.prepare(`
      SELECT page_key AS pageKey, content, updated_at AS updatedAt
      FROM learning_asset_page_notes
      WHERE learner_id = ? AND asset_id = ? ORDER BY updated_at DESC
    `).all(learnerId, assetId) as AssetPageNoteView[];
  }

  saveAssetPageNote(learnerId: string, assetId: string, pageKey: string, content: string): AssetPageNoteView {
    const safePageKey = pageKey.trim().slice(0, 160);
    const safeContent = content.trim().slice(0, 12_000);
    const updatedAt = Date.now();
    this.db.prepare(`
      INSERT INTO learning_asset_page_notes (learner_id, asset_id, page_key, content, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, asset_id, page_key) DO UPDATE SET
        content = excluded.content, updated_at = excluded.updated_at
    `).run(learnerId, assetId, safePageKey, safeContent, updatedAt);
    this.recordLearningEvent(learnerId, 'asset_page_note_saved', { assetId, pageKey: safePageKey, characters: safeContent.length });
    return { pageKey: safePageKey, content: safeContent, updatedAt };
  }

  getAssetFeedback(learnerId: string, assetId: string): AssetFeedbackView | null {
    const row = this.db.prepare(`
      SELECT completed, mastered, mastery_level AS masteryLevel, difficulty_rating AS difficultyRating,
        user_rating AS userRating, note, updated_at AS updatedAt
      FROM learning_asset_feedback WHERE learner_id = ? AND asset_id = ?
    `).get(learnerId, assetId) as {
      completed: number; mastered: number; masteryLevel: string | null; difficultyRating: number | null;
      userRating: number | null; note: string | null; updatedAt: number;
    } | undefined;
    if (!row) return null;
    return {
      completed: Boolean(row.completed),
      mastered: Boolean(row.mastered),
      masteryLevel: row.masteryLevel === 'high' || row.masteryLevel === 'medium' || row.masteryLevel === 'low' ? row.masteryLevel : null,
      difficultyRating: row.difficultyRating,
      userRating: row.userRating,
      note: row.note,
      updatedAt: Number(row.updatedAt),
    };
  }

  listQuizAttempts(learnerId: string, assetId: string): QuizAttemptView[] {
    const rows = this.db.prepare(`
      SELECT id, question_id AS questionId, answer_json AS answerJson, correct, duration_ms AS durationMs, created_at AS createdAt
      FROM learning_quiz_attempts WHERE learner_id = ? AND asset_id = ? ORDER BY created_at ASC
    `).all(learnerId, assetId) as Array<{ id: string; questionId: string; answerJson: string; correct: number; durationMs: number; createdAt: number }>;
    return rows.map((row) => {
      let answerId = '';
      try { answerId = String((JSON.parse(row.answerJson) as { answerId?: string }).answerId ?? ''); } catch { /* historical malformed attempt */ }
      return { id: row.id, questionId: row.questionId, answerId, correct: Boolean(row.correct), durationMs: Number(row.durationMs), createdAt: Number(row.createdAt) };
    });
  }

  submitQuizAttempt(learnerId: string, assetId: string, questionId: string, answerId: string, durationMs: number): QuizSubmissionResult {
    const asset = this.getAsset(learnerId, assetId);
    if (!asset || asset.type !== 'tiered_quiz') throw new Error('未找到这份习题资产');
    const question = extractQuizQuestions(asset).find((item) => item.id === questionId);
    if (!question) throw new Error('未找到这道题');
    const normalizedAnswerId = answerId.trim().slice(0, 32);
    const correct = normalizedAnswerId === question.answerId;
    const safeDuration = Math.max(0, Math.min(Math.round(durationMs), 3_600_000));
    const attempt: QuizAttemptView = {
      id: `quiz-attempt-${randomUUID()}`,
      questionId: question.id,
      answerId: normalizedAnswerId,
      correct,
      durationMs: safeDuration,
      createdAt: Date.now(),
    };
    this.db.prepare(`
      INSERT INTO learning_quiz_attempts (id, learner_id, asset_id, question_id, answer_json, correct, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(attempt.id, learnerId, assetId, question.id, JSON.stringify({ answerId: normalizedAnswerId }), correct ? 1 : 0, safeDuration, attempt.createdAt);
    const knowledgePointId = normalizeKnowledgePointId(asset.knowledgePointIds[0] ?? '') || 'industrial-diagnosis-foundation';
    this.db.prepare(`
      INSERT INTO learner_skill_states (learner_id, knowledge_point_id, mastery, confidence, attempt_count, correct_count, updated_at)
      VALUES (?, ?, ?, ?, 1, ?, ?)
      ON CONFLICT(learner_id, knowledge_point_id) DO UPDATE SET
        attempt_count = learner_skill_states.attempt_count + 1,
        correct_count = learner_skill_states.correct_count + excluded.correct_count,
        mastery = MIN(1, MAX(0, learner_skill_states.mastery + CASE WHEN excluded.correct_count = 1 THEN 0.08 ELSE -0.04 END)),
        confidence = MIN(1, learner_skill_states.confidence + 0.08),
        updated_at = excluded.updated_at
    `).run(learnerId, knowledgePointId, correct ? 0.28 : 0.16, 0.18, correct ? 1 : 0, attempt.createdAt);
    this.recordLearningEvent(learnerId, 'answer_recorded', { assetId, questionId: question.id, correct: correct ? 1 : 0, total: 1, durationMs: safeDuration, knowledgePointId });
    return { attempt, question };
  }

  recordLearningEvent(learnerId: string, eventType: string, payload: unknown): string {
    const id = `learning-event-${randomUUID()}`;
    this.db.prepare(`
      INSERT INTO learning_events (id, learner_id, event_type, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, learnerId, eventType, JSON.stringify(payload), Date.now());
    return id;
  }

  saveChatMessage(
    learnerId: string,
    role: LearningChatMessageView['role'],
    content: string,
    metadata: Record<string, unknown> = {},
  ): LearningChatMessageView {
    const message: LearningChatMessageView = {
      id: `chat-${randomUUID()}`,
      role,
      content: content.trim().slice(0, 12_000),
      metadata,
      createdAt: Date.now(),
    };
    this.db.prepare(`
      INSERT INTO learning_chat_messages (id, learner_id, role, content, metadata_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(message.id, learnerId, message.role, message.content, JSON.stringify(message.metadata), message.createdAt);
    return message;
  }

  listChatMessages(learnerId: string, limit = 80, surface: 'path' | 'study' = 'path'): LearningChatMessageView[] {
    const rows = this.db.prepare(`
      SELECT id, role, content, metadata_json AS metadataJson, created_at AS createdAt
      FROM learning_chat_messages WHERE learner_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(learnerId, Math.max(1, Math.min(limit, 200))) as Array<{
      id: string; role: string; content: string; metadataJson: string; createdAt: number;
    }>;
    const messages: LearningChatMessageView[] = rows.reverse().map((row): LearningChatMessageView => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.metadataJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        // Preserve the conversation even if one historical metadata record is malformed.
      }
      return { id: row.id, role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content, metadata, createdAt: Number(row.createdAt) };
    });
    return messages.filter((message) => surface === 'study'
      ? message.metadata['surface'] === 'study'
      : message.metadata['surface'] !== 'study');
  }

  clearLegacySeedPath(learnerId: string): void {
    this.db.prepare(`
      DELETE FROM learning_path_items
      WHERE learner_id = ? AND id IN ('path-evidence-reading', 'path-practice-case', 'path-quiz-feedback')
    `).run(learnerId);
  }

  ensureInitialPath(learnerId: string): void {
    // 路径只由一次真实学习任务生成，不在这里注入演示节点。
    void learnerId;
  }

  replacePath(
    learnerId: string,
    items: Array<{
      knowledgePointId: string;
      title: string;
      status: string;
      priority: number;
      reason: string;
      completionCriteria: string;
      recommendedResourceType: string;
    }>,
  ): LearningPathItemView[] {
    const insert = this.db.prepare(`
      INSERT INTO learning_path_items
        (id, learner_id, knowledge_point_id, title, status, priority, reason, completion_criteria, recommended_resource_type, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    this.db.prepare('DELETE FROM learning_path_items WHERE learner_id = ?').run(learnerId);
    items.forEach((item, index) => {
      insert.run(
        `path-${randomUUID()}`,
        learnerId,
        item.knowledgePointId || `goal-${index + 1}`,
        item.title,
        item.status,
        item.priority || index + 1,
        item.reason,
        item.completionCriteria,
        item.recommendedResourceType,
        now,
      );
    });
    return this.getPath(learnerId);
  }

  getPath(learnerId: string): LearningPathItemView[] {
    this.ensureInitialPath(learnerId);
    return this.db.prepare(`
      SELECT id, knowledge_point_id AS knowledgePointId, title, status, priority,
        reason, completion_criteria AS completionCriteria,
        recommended_resource_type AS recommendedResourceType
      FROM learning_path_items WHERE learner_id = ? ORDER BY priority ASC
    `).all(learnerId) as LearningPathItemView[];
  }

  replacePathGraph(
    learnerId: string,
    nodes: Array<{ knowledgePointId: string; title: string; description: string; sortOrder?: number }>,
    edges: Array<{ fromKnowledgePointId: string; toKnowledgePointId: string; relation: LearningPathEdgeView['relation'] }>,
  ): LearningPathGraphView {
    const now = Date.now();
    this.db.prepare('DELETE FROM learning_path_edges WHERE learner_id = ?').run(learnerId);
    this.db.prepare('DELETE FROM learning_path_nodes WHERE learner_id = ?').run(learnerId);
    const insertNode = this.db.prepare(`
      INSERT INTO learning_path_nodes
        (id, learner_id, knowledge_point_id, title, description, user_status, mastered, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?)
    `);
    const nodeIds = new Map<string, string>();
    nodes.forEach((node, index) => {
      const id = `path-node-${randomUUID()}`;
      const key = node.knowledgePointId.trim() || `node-${index + 1}`;
      nodeIds.set(key, id);
      insertNode.run(id, learnerId, key, node.title.trim(), node.description.trim(), node.sortOrder ?? index + 1, now, now);
    });
    const insertEdge = this.db.prepare(`
      INSERT OR IGNORE INTO learning_path_edges (id, learner_id, from_node_id, to_node_id, relation, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    edges.forEach((edge) => {
      const fromNodeId = nodeIds.get(edge.fromKnowledgePointId);
      const toNodeId = nodeIds.get(edge.toKnowledgePointId);
      if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) return;
      insertEdge.run(`path-edge-${randomUUID()}`, learnerId, fromNodeId, toNodeId, edge.relation, now);
    });
    return this.getPathGraph(learnerId);
  }

  getPathGraph(learnerId: string): LearningPathGraphView {
    const nodes = this.db.prepare(`
      SELECT id, knowledge_point_id AS knowledgePointId, title, description,
        user_status AS userStatus, mastered, sort_order AS sortOrder
      FROM learning_path_nodes WHERE learner_id = ? ORDER BY sort_order ASC, created_at ASC
    `).all(learnerId) as Array<Omit<LearningPathNodeView, 'mastered' | 'userStatus'> & { mastered: number; userStatus: string }>;
    const edges = this.db.prepare(`
      SELECT id, from_node_id AS fromNodeId, to_node_id AS toNodeId, relation
      FROM learning_path_edges WHERE learner_id = ? ORDER BY created_at ASC
    `).all(learnerId) as LearningPathEdgeView[];
    const evidence = this.getRecommendationEvidence(learnerId);
    return {
      nodes: nodes.map((node) => ({
        ...node,
        userStatus: ['not_started', 'learning', 'completed'].includes(node.userStatus)
          ? node.userStatus as LearningPathNodeView['userStatus']
          : 'not_started',
        mastered: Boolean(node.mastered),
        recommendation: this.recommendationForNode(node, evidence),
      })),
      edges,
    };
  }

  private getRecommendationEvidence(learnerId: string): {
    skills: Map<string, { mastery: number; attemptCount: number; correctCount: number }>;
    feedbackLevels: Map<string, 'high' | 'medium' | 'low'>;
  } {
    const skillRows = this.db.prepare(`
      SELECT knowledge_point_id AS knowledgePointId, mastery, attempt_count AS attemptCount, correct_count AS correctCount
      FROM learner_skill_states WHERE learner_id = ?
    `).all(learnerId) as Array<{ knowledgePointId: string; mastery: number; attemptCount: number; correctCount: number }>;
    const skills = new Map<string, { mastery: number; attemptCount: number; correctCount: number }>();
    for (const row of skillRows) {
      skills.set(normalizeKnowledgePointId(row.knowledgePointId), {
        mastery: Number(row.mastery),
        attemptCount: Number(row.attemptCount),
        correctCount: Number(row.correctCount),
      });
    }
    const feedbackRows = this.db.prepare(`
      SELECT a.content_json AS contentJson, f.mastery_level AS masteryLevel
      FROM learning_asset_feedback f
      JOIN learning_assets a ON a.learner_id = f.learner_id AND a.id = f.asset_id
      WHERE f.learner_id = ? AND f.mastery_level IN ('high', 'medium', 'low')
      ORDER BY f.updated_at DESC
    `).all(learnerId) as Array<{ contentJson: string; masteryLevel: string }>;
    const feedbackLevels = new Map<string, 'high' | 'medium' | 'low'>();
    for (const row of feedbackRows) {
      let firstKnowledgePointId = '';
      try {
        const parsed = JSON.parse(row.contentJson) as { knowledgePointIds?: unknown };
        firstKnowledgePointId = Array.isArray(parsed.knowledgePointIds) && typeof parsed.knowledgePointIds[0] === 'string'
          ? parsed.knowledgePointIds[0]
          : '';
      } catch {
        // 忽略历史损坏的资产 JSON，反馈证据继续按其余资产计算。
      }
      const key = normalizeKnowledgePointId(firstKnowledgePointId);
      if (key && !feedbackLevels.has(key)) feedbackLevels.set(key, row.masteryLevel as 'high' | 'medium' | 'low');
    }
    return { skills, feedbackLevels };
  }

  private recommendationForNode(
    node: { knowledgePointId: string },
    evidence: ReturnType<LearningStore['getRecommendationEvidence']>,
  ): PathNodeRecommendation {
    const key = normalizeKnowledgePointId(node.knowledgePointId);
    return computeNodeRecommendation({
      skill: evidence.skills.get(key) ?? null,
      feedbackLevel: evidence.feedbackLevels.get(key) ?? null,
    });
  }

  applyPathRevision(learnerId: string, revision: LearningPathRevisionInput): { path: LearningPathGraphView; changed: boolean } {
    const current = this.getPathGraph(learnerId);
    const nodeByKnowledgePoint = new Map(current.nodes.map((node) => [node.knowledgePointId, node]));
    const now = Date.now();
    let changed = false;
    let nextSortOrder = Math.max(0, ...current.nodes.map((node) => node.sortOrder)) + 1;
    const insertNode = this.db.prepare(`
      INSERT INTO learning_path_nodes
        (id, learner_id, knowledge_point_id, title, description, user_status, mastered, sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'not_started', 0, ?, ?, ?)
    `);
    for (const candidate of revision.addNodes ?? []) {
      const knowledgePointId = normalizeKnowledgePointId(candidate.knowledgePointId);
      const title = candidate.title.trim().slice(0, 80);
      const description = candidate.description.trim().slice(0, 280);
      if (!knowledgePointId || !title || !description || nodeByKnowledgePoint.has(knowledgePointId)) continue;
      const node: LearningPathNodeView = {
        id: `path-node-${randomUUID()}`,
        knowledgePointId,
        title,
        description,
        userStatus: 'not_started',
        mastered: false,
        sortOrder: nextSortOrder++,
      };
      insertNode.run(node.id, learnerId, node.knowledgePointId, node.title, node.description, node.sortOrder, now, now);
      nodeByKnowledgePoint.set(node.knowledgePointId, node);
      changed = true;
    }
    for (const candidate of revision.updateNodes ?? []) {
      const target = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.knowledgePointId));
      if (!target || target.userStatus === 'completed' || target.mastered) continue;
      const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim().slice(0, 80) : target.title;
      const description = typeof candidate.description === 'string' && candidate.description.trim() ? candidate.description.trim().slice(0, 280) : target.description;
      if (title === target.title && description === target.description) continue;
      this.db.prepare(`UPDATE learning_path_nodes SET title = ?, description = ?, updated_at = ? WHERE learner_id = ? AND id = ?`)
        .run(title, description, now, learnerId, target.id);
      nodeByKnowledgePoint.set(target.knowledgePointId, { ...target, title, description });
      changed = true;
    }
    const existingEdges = new Set(current.edges.map((edge) => `${edge.fromNodeId}:${edge.toNodeId}:${edge.relation}`));
    const insertEdge = this.db.prepare(`
      INSERT OR IGNORE INTO learning_path_edges (id, learner_id, from_node_id, to_node_id, relation, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const candidate of revision.addEdges ?? []) {
      const from = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.fromKnowledgePointId));
      const to = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.toKnowledgePointId));
      const relation = ['prerequisite', 'branch', 'application', 'review'].includes(candidate.relation) ? candidate.relation : 'branch';
      const edgeKey = from && to ? `${from.id}:${to.id}:${relation}` : '';
      if (!from || !to || from.id === to.id || existingEdges.has(edgeKey)) continue;
      insertEdge.run(`path-edge-${randomUUID()}`, learnerId, from.id, to.id, relation, now);
      existingEdges.add(edgeKey);
      changed = true;
    }
    if (changed) this.recordLearningEvent(learnerId, 'path_revised_from_conversation', { revision });
    return { path: this.getPathGraph(learnerId), changed };
  }

  setPathNodeStatus(
    learnerId: string,
    nodeId: string,
    patch: { userStatus?: LearningPathNodeView['userStatus']; mastered?: boolean },
  ): LearningPathNodeView | null {
    const current = this.db.prepare(`
      SELECT id, knowledge_point_id AS knowledgePointId, title, description,
        user_status AS userStatus, mastered, sort_order AS sortOrder
      FROM learning_path_nodes WHERE learner_id = ? AND id = ?
    `).get(learnerId, nodeId) as (Omit<LearningPathNodeView, 'mastered' | 'userStatus'> & { mastered: number; userStatus: string }) | undefined;
    if (!current) return null;
    const userStatus = patch.userStatus ?? (['not_started', 'learning', 'completed'].includes(current.userStatus)
      ? current.userStatus as LearningPathNodeView['userStatus']
      : 'not_started');
    const mastered = patch.mastered ?? Boolean(current.mastered);
    this.db.prepare(`
      UPDATE learning_path_nodes SET user_status = ?, mastered = ?, updated_at = ?
      WHERE learner_id = ? AND id = ?
    `).run(userStatus, mastered ? 1 : 0, Date.now(), learnerId, nodeId);
    this.recordLearningEvent(learnerId, 'path_node_status_changed', { nodeId, userStatus, mastered });
    const recommendation = this.recommendationForNode(current, this.getRecommendationEvidence(learnerId));
    return { ...current, userStatus, mastered, recommendation };
  }

  saveAssetFeedback(learnerId: string, assetId: string, patch: AssetFeedbackInput): void {
    const previous = this.db.prepare(`
      SELECT completed, mastered, mastery_level AS masteryLevel, difficulty_rating AS difficultyRating, user_rating AS userRating, note
      FROM learning_asset_feedback WHERE learner_id = ? AND asset_id = ?
    `).get(learnerId, assetId) as {
      completed: number;
      mastered: number;
      masteryLevel: string | null;
      difficultyRating: number | null;
      userRating: number | null;
      note: string | null;
    } | undefined;
    const requestedLevel = patch.masteryLevel === 'high' || patch.masteryLevel === 'medium' || patch.masteryLevel === 'low'
      ? patch.masteryLevel
      : patch.masteryLevel === null
      ? null
      : previous?.masteryLevel === 'high' || previous?.masteryLevel === 'medium' || previous?.masteryLevel === 'low'
      ? previous.masteryLevel
      : null;
    const completed = patch.completed ?? (requestedLevel ? true : Boolean(previous?.completed));
    const mastered = patch.mastered ?? (requestedLevel === 'high' ? true : requestedLevel ? false : Boolean(previous?.mastered));
    const difficultyRating = normalizeRating(patch.difficultyRating ?? previous?.difficultyRating ?? null);
    const userRating = normalizeRating(patch.userRating ?? previous?.userRating ?? null);
    const note = (patch.note ?? previous?.note ?? '').trim().slice(0, 2_000) || null;
    this.db.prepare(`
      INSERT INTO learning_asset_feedback
        (id, learner_id, asset_id, completed, mastered, mastery_level, difficulty_rating, user_rating, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, asset_id) DO UPDATE SET
        completed = excluded.completed,
        mastered = excluded.mastered,
        mastery_level = excluded.mastery_level,
        difficulty_rating = excluded.difficulty_rating,
        user_rating = excluded.user_rating,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(`asset-feedback-${randomUUID()}`, learnerId, assetId, completed ? 1 : 0, mastered ? 1 : 0, requestedLevel, difficultyRating, userRating, note, Date.now());
    this.recordLearningEvent(learnerId, 'asset_feedback_recorded', { assetId, completed, mastered, masteryLevel: requestedLevel, difficultyRating, userRating });
  }

  getProfile(learnerId: string): LearnerProfileView {
    const assets = this.db.prepare('SELECT COUNT(*) AS count FROM learning_assets WHERE learner_id = ?').get(learnerId) as { count: number };
    const evidence = this.db.prepare('SELECT COUNT(*) AS count FROM learning_events WHERE learner_id = ?').get(learnerId) as { count: number };
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayAssets = this.db.prepare('SELECT COUNT(*) AS count FROM learning_assets WHERE learner_id = ? AND created_at >= ?').get(learnerId, todayStart.getTime()) as { count: number };
    const completedAssets = this.db.prepare('SELECT COUNT(*) AS count FROM learning_asset_feedback WHERE learner_id = ? AND completed = 1').get(learnerId) as { count: number };
    const masteredAssets = this.db.prepare('SELECT COUNT(*) AS count FROM learning_asset_feedback WHERE learner_id = ? AND mastered = 1').get(learnerId) as { count: number };
    const events = this.db.prepare('SELECT event_type AS eventType, payload_json AS payloadJson FROM learning_events WHERE learner_id = ?').all(learnerId) as Array<{ eventType: string; payloadJson: string }>;
    let studyMinutes = 0;
    let answered = 0;
    let correct = 0;
    for (const event of events) {
      try {
        const payload = JSON.parse(event.payloadJson) as { durationMs?: number; total?: number; correct?: number };
        studyMinutes += Number(payload.durationMs || 0) / 60000;
        if (event.eventType === 'answer_recorded') {
          answered += Number(payload.total || 1);
          correct += Number(payload.correct || 0);
        }
      } catch {
        // Ignore malformed historical payloads and keep computed metrics available.
      }
    }
    const skills = this.db.prepare(`
      SELECT knowledge_point_id AS knowledgePointId, mastery, confidence, attempt_count AS attemptCount, correct_count AS correctCount
      FROM learner_skill_states WHERE learner_id = ? ORDER BY updated_at DESC
    `).all(learnerId) as LearnerProfileView['skills'];
    const snapshot = this.db.prepare(`
      SELECT summary, keywords_json AS keywordsJson, radar_json AS radarJson
      FROM learner_profile_snapshots WHERE learner_id = ? ORDER BY generated_at DESC LIMIT 1
    `).get(learnerId) as { summary?: string; keywordsJson?: string; radarJson?: string } | undefined;
    let keywords: string[] = [];
    let radar: LearnerRadarItem[] = [];
    try { keywords = snapshot?.keywordsJson ? JSON.parse(snapshot.keywordsJson) : []; } catch { keywords = []; }
    try { radar = snapshot?.radarJson ? JSON.parse(snapshot.radarJson) : []; } catch { radar = []; }
    return {
      learnerId,
      summary: snapshot?.summary || (Number(evidence.count) > 0 ? '画像已根据学习证据更新' : '完成一次学习任务后，系统会形成第一版画像'),
      status: Number(evidence.count) > 0 ? 'learning' : 'awaiting_evidence',
      assetsCount: Number(assets.count),
      todayAssetsCount: Number(todayAssets.count),
      completedAssetsCount: Number(completedAssets.count),
      masteredAssetsCount: Number(masteredAssets.count),
      evidenceCount: Number(evidence.count),
      studyMinutes: Math.round(studyMinutes * 10) / 10,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) / 100 : null,
      keywords,
      radar,
      skills,
    };
  }

  saveProfileSnapshot(learnerId: string, profile: { summary: string; keywords: string[]; radar: LearnerRadarItem[] }): void {
    this.db.prepare(`
      INSERT INTO learner_profile_snapshots (id, learner_id, summary, keywords_json, radar_json, generated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      `profile-${randomUUID()}`,
      learnerId,
      profile.summary,
      JSON.stringify(profile.keywords),
      JSON.stringify(profile.radar),
      Date.now(),
    );
  }

  saveResourceAudit(resourceId: string, claims: ClaimAuditRecord[]): void {
    const insertClaim = this.db.prepare(`
      INSERT OR REPLACE INTO claims (id, resource_id, text, verdict, critique, factual_score)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertEvidence = this.db.prepare(`
      INSERT OR REPLACE INTO claim_evidence (claim_id, evidence_id, support_level)
      VALUES (?, ?, ?)
    `);
    claims.forEach((claim) => {
      insertClaim.run(claim.id, resourceId, claim.text, claim.verdict, claim.critique, claim.factualScore);
      claim.evidenceIds.forEach((evidenceId) => insertEvidence.run(
        claim.id,
        evidenceId,
        claim.verdict === 'supported' ? 'supports' : 'requires_review',
      ));
    });
  }

  listPrivacyAuditEvents(limit = 8): PrivacyAuditEventView[] {
    const boundedLimit = Math.max(1, Math.min(limit, 30));
    const rows = this.db.prepare(`
      SELECT id, event_type AS eventType, file_name AS fileName, byte_count AS byteCount,
        redacted_fields_json AS redactedFieldsJson, retained, created_at AS createdAt
      FROM privacy_audit_events
      ORDER BY created_at DESC LIMIT ?
    `).all(boundedLimit) as Array<{
      id: string;
      eventType: string;
      fileName: string | null;
      byteCount: number | null;
      redactedFieldsJson: string | null;
      retained: number;
      createdAt: number;
    }>;
    return rows.map((row) => {
      let redactedFields: unknown[] = [];
      try { redactedFields = row.redactedFieldsJson ? JSON.parse(row.redactedFieldsJson) : []; } catch { redactedFields = []; }
      return {
        id: row.id,
        eventType: row.eventType,
        fileName: row.fileName,
        byteCount: row.byteCount === null ? null : Number(row.byteCount),
        redactedFieldCount: Array.isArray(redactedFields) ? redactedFields.length : 0,
        retained: false,
        createdAt: Number(row.createdAt),
      };
    });
  }

  clearPrivacyAuditEvents(): number {
    const result = this.db.prepare('DELETE FROM privacy_audit_events').run() as { changes?: number };
    return Number(result.changes ?? 0);
  }

  listEvidence(learnerId: string, limit = 20): Array<{
    id: string;
    packId: string | null;
    packQuery: string | null;
    packCoverageScore: number | null;
    crossValidation: unknown;
    privacy: unknown;
    sourceType: string;
    sourceId: string;
    sourceTitle: string;
    sourceScope: string;
    locator: string;
    content: string;
    retrievalMethod: string;
    relevanceScore: number;
    trustLevel: string;
    metadata: unknown;
  }> {
    const boundedLimit = Math.max(1, Math.min(limit, 50));
    const rows = this.db.prepare(`
      SELECT e.id, p.id AS packId, p.query AS packQuery, p.coverage_score AS packCoverageScore,
        p.cross_validation_json AS crossValidationJson, p.privacy_json AS privacyJson,
        e.source_type AS sourceType, e.source_id AS sourceId, e.source_title AS sourceTitle,
        e.source_scope AS sourceScope, e.locator, e.content,
        e.retrieval_method AS retrievalMethod, e.relevance_score AS relevanceScore,
        e.trust_level AS trustLevel, e.metadata_json AS metadataJson
      FROM evidence_items e
      INNER JOIN evidence_pack_items pi ON pi.evidence_id = e.id
      INNER JOIN evidence_packs p ON p.id = pi.pack_id
      WHERE p.learner_id = ?
      ORDER BY e.created_at DESC LIMIT ?
    `).all(learnerId, boundedLimit) as Array<{
      id: string;
      packId: string | null;
      packQuery: string | null;
      packCoverageScore: number | null;
      crossValidationJson: string | null;
      privacyJson: string | null;
      sourceType: string;
      sourceId: string;
      sourceTitle: string | null;
      sourceScope: string | null;
      locator: string;
      content: string;
      retrievalMethod: string;
      relevanceScore: number;
      trustLevel: string;
      metadataJson: string | null;
    }>;
    return rows.map((row) => {
      const parse = (value: unknown): unknown => {
        try { return typeof value === 'string' ? JSON.parse(value) : value; } catch { return value; }
      };
      return {
        id: String(row.id),
        packId: row.packId ? String(row.packId) : null,
        packQuery: row.packQuery ? String(row.packQuery) : null,
        packCoverageScore: row.packCoverageScore === null || row.packCoverageScore === undefined ? null : Number(row.packCoverageScore),
        crossValidation: parse(row.crossValidationJson),
        privacy: parse(row.privacyJson),
        sourceType: String(row.sourceType),
        sourceId: String(row.sourceId),
        sourceTitle: row.sourceTitle ? String(row.sourceTitle) : '',
        sourceScope: row.sourceScope ? String(row.sourceScope) : 'system',
        locator: String(row.locator),
        content: String(row.content),
        retrievalMethod: String(row.retrievalMethod),
        relevanceScore: Number(row.relevanceScore),
        trustLevel: String(row.trustLevel),
        metadata: parse(row.metadataJson),
      };
    });
  }
}

function extractQuizQuestions(asset: ResourceDocument): QuizQuestion[] {
  const questionBlock = asset.blocks.find((block) => block.type === 'question');
  const raw = questionBlock?.content;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const candidate = (raw as { questions?: unknown }).questions;
  if (!Array.isArray(candidate)) return [];
  return candidate.flatMap((item): QuizQuestion[] => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const value = item as Partial<QuizQuestion>;
    if (typeof value.id !== 'string' || typeof value.prompt !== 'string' || typeof value.answerId !== 'string' || !Array.isArray(value.options)) return [];
    const options = value.options.flatMap((option) => option && typeof option.id === 'string' && typeof option.text === 'string'
      ? [{ id: option.id, text: option.text }]
      : []);
    if (options.length < 2 || !options.some((option) => option.id === value.answerId)) return [];
    return [{
      id: value.id,
      level: value.level === 'L2' || value.level === 'L3' ? value.level : 'L1',
      prompt: value.prompt,
      options,
      answerId: value.answerId,
      explanation: typeof value.explanation === 'string' ? value.explanation : '',
      evidenceIds: Array.isArray(value.evidenceIds) ? value.evidenceIds.filter((id): id is string => typeof id === 'string') : [],
    }];
  });
}

function normalizeResourceDocument(asset: ResourceDocument): ResourceDocument {
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

function normalizeRating(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

export function normalizeKnowledgePointId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}
