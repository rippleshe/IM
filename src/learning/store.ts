import { randomUUID } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';
import type { ResourceDocument } from './types.js';
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
  difficultyRating?: number | null;
  userRating?: number | null;
  note?: string | null;
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
    return rows.map((row) => JSON.parse(row.contentJson) as ResourceDocument);
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

  listChatMessages(learnerId: string, limit = 80): LearningChatMessageView[] {
    const rows = this.db.prepare(`
      SELECT id, role, content, metadata_json AS metadataJson, created_at AS createdAt
      FROM learning_chat_messages WHERE learner_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(learnerId, Math.max(1, Math.min(limit, 200))) as Array<{
      id: string; role: string; content: string; metadataJson: string; createdAt: number;
    }>;
    return rows.reverse().map((row) => {
      let metadata: Record<string, unknown> = {};
      try {
        const parsed = JSON.parse(row.metadataJson) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) metadata = parsed as Record<string, unknown>;
      } catch {
        // Preserve the conversation even if one historical metadata record is malformed.
      }
      return { id: row.id, role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content, metadata, createdAt: Number(row.createdAt) };
    });
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
    return {
      nodes: nodes.map((node) => ({
        ...node,
        userStatus: ['not_started', 'learning', 'completed'].includes(node.userStatus)
          ? node.userStatus as LearningPathNodeView['userStatus']
          : 'not_started',
        mastered: Boolean(node.mastered),
      })),
      edges,
    };
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
    return { ...current, userStatus, mastered };
  }

  saveAssetFeedback(learnerId: string, assetId: string, patch: AssetFeedbackInput): void {
    const previous = this.db.prepare(`
      SELECT completed, mastered, difficulty_rating AS difficultyRating, user_rating AS userRating, note
      FROM learning_asset_feedback WHERE learner_id = ? AND asset_id = ?
    `).get(learnerId, assetId) as {
      completed: number;
      mastered: number;
      difficultyRating: number | null;
      userRating: number | null;
      note: string | null;
    } | undefined;
    const completed = patch.completed ?? Boolean(previous?.completed);
    const mastered = patch.mastered ?? Boolean(previous?.mastered);
    const difficultyRating = normalizeRating(patch.difficultyRating ?? previous?.difficultyRating ?? null);
    const userRating = normalizeRating(patch.userRating ?? previous?.userRating ?? null);
    const note = (patch.note ?? previous?.note ?? '').trim().slice(0, 2_000) || null;
    this.db.prepare(`
      INSERT INTO learning_asset_feedback
        (id, learner_id, asset_id, completed, mastered, difficulty_rating, user_rating, note, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id, asset_id) DO UPDATE SET
        completed = excluded.completed,
        mastered = excluded.mastered,
        difficulty_rating = excluded.difficulty_rating,
        user_rating = excluded.user_rating,
        note = excluded.note,
        updated_at = excluded.updated_at
    `).run(`asset-feedback-${randomUUID()}`, learnerId, assetId, completed ? 1 : 0, mastered ? 1 : 0, difficultyRating, userRating, note, Date.now());
    this.recordLearningEvent(learnerId, 'asset_feedback_recorded', { assetId, completed, mastered, difficultyRating, userRating });
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

  listEvidence(limit = 20): Array<{
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
      LEFT JOIN evidence_pack_items pi ON pi.evidence_id = e.id
      LEFT JOIN evidence_packs p ON p.id = pi.pack_id
      ORDER BY e.created_at DESC LIMIT ?
    `).all(boundedLimit) as Array<{
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

function normalizeRating(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}

function normalizeKnowledgePointId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
}
