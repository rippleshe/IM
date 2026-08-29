/**
 * PostgreSQL 版身份与学习存储（docs/挑战杯技术开发总规.md §2.3、§6）
 *
 * 与 src/learning/identity.ts、src/learning/store.ts 的 SQLite 实现保持逐方法
 * 等价的公开 API；切换由 server/study-context.ts 按数据源完成，调用方无感。
 * 约定：时间列为 epoch 毫秒 bigint；JSON 列为 jsonb（直接读写对象）；布尔为 boolean。
 */
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';

import {
  AVATAR_IMAGE_MAX_CHARS,
  hashPassword,
  hashToken,
  normalizeAvatarKey,
  normalizeLoginName,
  validatePassword,
  type AuthenticatedLearner,
  type LearnerOnboarding,
  type OnboardingInput,
} from '../../src/learning/identity.js';
import {
  normalizeKnowledgePointId,
  normalizeResourceDocument,
  extractQuizQuestions,
  computeNodeRecommendation,
  type AssetFeedbackInput,
  type AssetFeedbackView,
  type AssetPageNoteView,
  type LearningChatMessageView,
  type LearningPathEdgeView,
  type LearningPathGraphView,
  type LearningPathNodeView,
  type LearningPathRevisionInput,
  type LearnerProfileView,
  type LearnerRadarItem,
  type PrivacyAuditEventView,
  type QuizAttemptView,
  type QuizSubmissionResult,
} from '../../src/learning/store.js';
import { bktUpdate, createBktState, type BktState } from '../../src/learning/bkt.js';
import type { ClaimAuditRecord } from '../../src/learning/audit.js';
import type { ResourceDocument } from '../../src/learning/types.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

/** 事务包装：多语句写入的原子性（与 SQLite 版逐语句自动提交语义对齐，仅用于复合写） */
export async function withTransaction<T>(pool: Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/* ------------------------------------------------------------------ */
/* 身份与会话                                                           */
/* ------------------------------------------------------------------ */

export class PgIdentityStore {
  constructor(private readonly pool: Pool) {}

  async register(input: { loginName: string; displayName: string; password: string }): Promise<AuthenticatedLearner> {
    const loginName = normalizeLoginName(input.loginName);
    const displayName = normalizeDisplayName(input.displayName, loginName);
    validatePassword(input.password);
    const salt = randomBytes(16).toString('base64url');
    const passwordHash = hashPassword(input.password, salt);
    const user: AuthenticatedLearner = { id: `user-${randomUUID()}`, loginName, displayName, avatarKey: 'graphite', avatarImage: null, onboardingCompleted: false };
    const now = Date.now();
    try {
      await this.pool.query(
        `INSERT INTO users (id, login_name, display_name, avatar_key, password_hash, password_salt, onboarding_completed, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8)`,
        [user.id, user.loginName, user.displayName, user.avatarKey, passwordHash, salt, now, now],
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') throw new Error('该账号已被注册');
      throw error;
    }
    return user;
  }

  async authenticate(loginName: string, password: string): Promise<AuthenticatedLearner | null> {
    const normalized = normalizeLoginName(loginName);
    const row = (await this.pool.query(
      `SELECT id, login_name AS "loginName", display_name AS "displayName", avatar_key AS "avatarKey", avatar_image AS "avatarImage",
        password_hash AS "passwordHash", password_salt AS "passwordSalt", onboarding_completed AS "onboardingCompleted"
       FROM users WHERE login_name = $1`, [normalized],
    )).rows[0] as {
      id: string; loginName: string; displayName: string; avatarKey: string; avatarImage: string | null;
      passwordHash: string; passwordSalt: string; onboardingCompleted: boolean;
    } | undefined;
    if (!row || !verifyPassword(password, row.passwordSalt, row.passwordHash)) return null;
    return {
      id: row.id, loginName: row.loginName, displayName: row.displayName,
      avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage ?? null,
      onboardingCompleted: Boolean(row.onboardingCompleted),
    };
  }

  async createSession(userId: string): Promise<{ token: string; expiresAt: number }> {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + SESSION_LIFETIME_MS;
    await this.pool.query(
      `INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [`auth-${randomUUID()}`, userId, hashToken(token), expiresAt, now, now],
    );
    return { token, expiresAt };
  }

  async getSessionUser(token: string | undefined): Promise<AuthenticatedLearner | null> {
    if (!token) return null;
    const now = Date.now();
    const row = (await this.pool.query(
      `SELECT u.id, u.login_name AS "loginName", u.display_name AS "displayName", u.avatar_key AS "avatarKey", u.avatar_image AS "avatarImage",
        u.onboarding_completed AS "onboardingCompleted", s.id AS "sessionId"
       FROM auth_sessions s JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = $1 AND s.expires_at > $2`, [hashToken(token), now],
    )).rows[0] as {
      id: string; loginName: string; displayName: string; avatarKey: string; avatarImage: string | null;
      onboardingCompleted: boolean; sessionId: string;
    } | undefined;
    if (!row) return null;
    await this.pool.query('UPDATE auth_sessions SET last_seen_at = $1 WHERE id = $2', [now, row.sessionId]);
    return {
      id: row.id, loginName: row.loginName, displayName: row.displayName,
      avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage ?? null,
      onboardingCompleted: Boolean(row.onboardingCompleted),
    };
  }

  async revokeSession(token: string | undefined): Promise<void> {
    if (!token) return;
    await this.pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  /** 演示种子幂等重置密码：已有演示账号一律以当前 IM_TRAINING_AGENT_DEMO_PASSWORD 为准。 */
  async resetPassword(learnerId: string, password: string): Promise<void> {
    const salt = randomBytes(16).toString('base64url');
    const passwordHash = hashPassword(password, salt);
    await this.pool.query('UPDATE users SET password_hash = $1, password_salt = $2, updated_at = $3 WHERE id = $4', [passwordHash, salt, Date.now(), learnerId]);
  }

  async updateAvatar(learnerId: string, avatarKey: string): Promise<AuthenticatedLearner | null> {
    const nextAvatar = normalizeAvatarKey(avatarKey);
    await this.pool.query('UPDATE users SET avatar_key = $1, updated_at = $2 WHERE id = $3', [nextAvatar, Date.now(), learnerId]);
    return this.getById(learnerId);
  }

  async updateAvatarImage(learnerId: string, image: string | null): Promise<AuthenticatedLearner | null> {
    const safe = image && image.length <= AVATAR_IMAGE_MAX_CHARS && image.startsWith('data:image/') ? image : null;
    await this.pool.query('UPDATE users SET avatar_image = $1, updated_at = $2 WHERE id = $3', [safe, Date.now(), learnerId]);
    return this.getById(learnerId);
  }

  async getByLoginName(loginName: string): Promise<AuthenticatedLearner | null> {
    const row = (await this.pool.query(
      `SELECT id, login_name AS "loginName", display_name AS "displayName", avatar_key AS "avatarKey",
        avatar_image AS "avatarImage", onboarding_completed AS "onboardingCompleted" FROM users WHERE login_name = $1`,
      [normalizeLoginName(loginName)],
    )).rows[0] as {
      id: string; loginName: string; displayName: string; avatarKey: string; avatarImage: string | null; onboardingCompleted: boolean;
    } | undefined;
    return row
      ? { ...row, avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage ?? null, onboardingCompleted: Boolean(row.onboardingCompleted) }
      : null;
  }

  async getById(learnerId: string): Promise<AuthenticatedLearner | null> {
    const row = (await this.pool.query(
      `SELECT id, login_name AS "loginName", display_name AS "displayName", avatar_key AS "avatarKey",
        avatar_image AS "avatarImage", onboarding_completed AS "onboardingCompleted" FROM users WHERE id = $1`, [learnerId],
    )).rows[0] as {
      id: string; loginName: string; displayName: string; avatarKey: string; avatarImage: string | null; onboardingCompleted: boolean;
    } | undefined;
    return row
      ? { ...row, avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage ?? null, onboardingCompleted: Boolean(row.onboardingCompleted) }
      : null;
  }

  async saveOnboarding(learnerId: string, input: OnboardingInput): Promise<LearnerOnboarding> {
    const normalized = normalizeOnboarding(input);
    const now = Date.now();
    await this.pool.query(
      `INSERT INTO learner_onboarding (learner_id, role, programming_foundation, goal, weekly_hours, self_description, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (learner_id) DO UPDATE SET
         role = excluded.role, programming_foundation = excluded.programming_foundation, goal = excluded.goal,
         weekly_hours = excluded.weekly_hours, self_description = excluded.self_description, updated_at = excluded.updated_at`,
      [learnerId, normalized.role, normalized.programmingFoundation, normalized.goal, normalized.weeklyHours ?? null, normalized.selfDescription, now, now],
    );
    await this.pool.query('UPDATE users SET onboarding_completed = true, updated_at = $1 WHERE id = $2', [now, learnerId]);
    return { learnerId, ...normalized };
  }

  async getOnboarding(learnerId: string): Promise<LearnerOnboarding | null> {
    const row = (await this.pool.query(
      `SELECT learner_id AS "learnerId", role, programming_foundation AS "programmingFoundation",
        goal, weekly_hours AS "weeklyHours", self_description AS "selfDescription"
       FROM learner_onboarding WHERE learner_id = $1`, [learnerId],
    )).rows[0] as LearnerOnboarding | undefined;
    return row ?? null;
  }
}

/* ------------------------------------------------------------------ */
/* 学习存储                                                             */
/* ------------------------------------------------------------------ */

export class PgLearningStore {
  constructor(private readonly pool: Pool) {}

  async saveAsset(learnerId: string, sessionId: string | undefined, resource: ResourceDocument): Promise<ResourceDocument> {
    await this.pool.query(
      `INSERT INTO learning_assets
        (id, learner_id, session_id, type, title, content_json, audit_status, evidence_ids_json, difficulty, difficulty_calibration, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       ON CONFLICT (id) DO UPDATE SET
         title = excluded.title, content_json = excluded.content_json, audit_status = excluded.audit_status,
         evidence_ids_json = excluded.evidence_ids_json, difficulty = excluded.difficulty,
         difficulty_calibration = excluded.difficulty_calibration`,
      [
        resource.id, learnerId, sessionId ?? null, resource.type, resource.title,
        JSON.stringify(resource), resource.auditStatus, JSON.stringify(resource.evidenceIds),
        resource.difficultyCalibration ? resource.difficulty : null,
        resource.difficultyCalibration ? JSON.stringify(resource.difficultyCalibration) : null, resource.createdAt,
      ],
    );
    return resource;
  }

  async listAssets(learnerId: string): Promise<ResourceDocument[]> {
    const rows = (await this.pool.query(
      'SELECT content_json AS "contentJson" FROM learning_assets WHERE learner_id = $1 ORDER BY created_at DESC', [learnerId],
    )).rows as Array<{ contentJson: ResourceDocument }>;
    return rows.map((row) => normalizeResourceDocument(row.contentJson));
  }

  async getAsset(learnerId: string, assetId: string): Promise<ResourceDocument | null> {
    const row = (await this.pool.query(
      'SELECT content_json AS "contentJson" FROM learning_assets WHERE learner_id = $1 AND id = $2', [learnerId, assetId],
    )).rows[0] as { contentJson: ResourceDocument } | undefined;
    if (!row?.contentJson) return null;
    try {
      return normalizeResourceDocument(row.contentJson);
    } catch {
      return null;
    }
  }

  async deleteAsset(learnerId: string, assetId: string): Promise<boolean> {
    const asset = await this.getAsset(learnerId, assetId);
    if (!asset) return false;
    await withTransaction(this.pool, async (client) => {
      await client.query('DELETE FROM learning_asset_page_notes WHERE learner_id = $1 AND asset_id = $2', [learnerId, assetId]);
      await client.query('DELETE FROM learning_quiz_attempts WHERE learner_id = $1 AND asset_id = $2', [learnerId, assetId]);
      await client.query('DELETE FROM learning_asset_feedback WHERE learner_id = $1 AND asset_id = $2', [learnerId, assetId]);
      await client.query('DELETE FROM claim_evidence WHERE claim_id IN (SELECT id FROM claims WHERE resource_id = $1)', [assetId]);
      await client.query('DELETE FROM claims WHERE resource_id = $1', [assetId]);
      await client.query('DELETE FROM learning_assets WHERE learner_id = $1 AND id = $2', [learnerId, assetId]);
    });
    await this.recordLearningEvent(learnerId, 'asset_deleted', { assetId, type: asset.type });
    return true;
  }

  async listAssetPageNotes(learnerId: string, assetId: string): Promise<AssetPageNoteView[]> {
    const rows = (await this.pool.query(
      `SELECT page_key AS "pageKey", content, updated_at AS "updatedAt"
       FROM learning_asset_page_notes WHERE learner_id = $1 AND asset_id = $2 ORDER BY updated_at DESC`, [learnerId, assetId],
    )).rows as AssetPageNoteView[];
    return rows;
  }

  async saveAssetPageNote(learnerId: string, assetId: string, pageKey: string, content: string): Promise<AssetPageNoteView> {
    const safePageKey = pageKey.trim().slice(0, 160);
    const safeContent = content.trim().slice(0, 12_000);
    const updatedAt = Date.now();
    await this.pool.query(
      `INSERT INTO learning_asset_page_notes (learner_id, asset_id, page_key, content, updated_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (learner_id, asset_id, page_key) DO UPDATE SET
         content = excluded.content, updated_at = excluded.updated_at`,
      [learnerId, assetId, safePageKey, safeContent, updatedAt],
    );
    await this.recordLearningEvent(learnerId, 'asset_page_note_saved', { assetId, pageKey: safePageKey, characters: safeContent.length });
    return { pageKey: safePageKey, content: safeContent, updatedAt };
  }

  async getAssetFeedback(learnerId: string, assetId: string): Promise<AssetFeedbackView | null> {
    const row = (await this.pool.query(
      `SELECT completed, mastered, mastery_level AS "masteryLevel", difficulty_rating AS "difficultyRating",
        user_rating AS "userRating", note, updated_at AS "updatedAt"
       FROM learning_asset_feedback WHERE learner_id = $1 AND asset_id = $2`, [learnerId, assetId],
    )).rows[0] as {
      completed: boolean; mastered: boolean; masteryLevel: string | null; difficultyRating: number | null;
      userRating: number | null; note: string | null; updatedAt: string | number;
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

  async listQuizAttempts(learnerId: string, assetId: string): Promise<QuizAttemptView[]> {
    const rows = (await this.pool.query(
      `SELECT id, question_id AS "questionId", answer_json AS "answerJson", correct, duration_ms AS "durationMs", created_at AS "createdAt"
       FROM learning_quiz_attempts WHERE learner_id = $1 AND asset_id = $2 ORDER BY created_at ASC`, [learnerId, assetId],
    )).rows as Array<{ id: string; questionId: string; answerJson: { answerId?: string }; correct: boolean; durationMs: number; createdAt: string | number }>;
    return rows.map((row) => ({
      id: row.id,
      questionId: row.questionId,
      answerId: String(row.answerJson?.answerId ?? ''),
      correct: Boolean(row.correct),
      durationMs: Number(row.durationMs),
      createdAt: Number(row.createdAt),
    }));
  }

  async submitQuizAttempt(learnerId: string, assetId: string, questionId: string, answerId: string, durationMs: number): Promise<QuizSubmissionResult> {
    const asset = await this.getAsset(learnerId, assetId);
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
    await this.pool.query(
      `INSERT INTO learning_quiz_attempts (id, learner_id, asset_id, question_id, answer_json, correct, duration_ms, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [attempt.id, learnerId, assetId, question.id, { answerId: normalizedAnswerId }, correct, safeDuration, attempt.createdAt],
    );
    const knowledgePointId = normalizeKnowledgePointId(asset.knowledgePointIds[0] ?? '') || 'industrial-diagnosis-foundation';
    await this.applySkillObservation(learnerId, knowledgePointId, correct, 'quiz_attempt');
    await this.recordLearningEvent(learnerId, 'answer_recorded', { assetId, questionId: question.id, correct: correct ? 1 : 0, total: 1, durationMs: safeDuration, knowledgePointId });
    return { attempt, question };
  }

  /** BKT 观测更新（总规 §7.1）：读状态 → bktUpdate → 写状态 + bkt_updates 审计行（同事务，保证审计完整） */
  async applySkillObservation(learnerId: string, knowledgePointId: string, correct: boolean, trigger: string): Promise<BktState> {
    const key = normalizeKnowledgePointId(knowledgePointId);
    const before = await this.getSkillState(learnerId, key) ?? createBktState(0.15);
    const after = bktUpdate(before, correct);
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO learner_skill_states (learner_id, knowledge_point_id, p_mastery, confidence, attempt_count, correct_count, p_guess, p_slip, p_learn, evidence_source, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (learner_id, knowledge_point_id) DO UPDATE SET
           p_mastery = excluded.p_mastery, confidence = excluded.confidence,
           attempt_count = excluded.attempt_count, correct_count = excluded.correct_count,
           p_guess = excluded.p_guess, p_slip = excluded.p_slip, p_learn = excluded.p_learn,
           evidence_source = excluded.evidence_source, updated_at = excluded.updated_at`,
        [learnerId, key, after.pMastery, after.confidence, after.attemptCount, after.correctCount, after.pGuess, after.pSlip, after.pLearn, trigger, Date.now()],
      );
      await client.query(
        `INSERT INTO bkt_updates (id, learner_id, knowledge_point_id, trigger_type, before, after, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [`bkt-${randomUUID()}`, learnerId, key, trigger, before, after, Date.now()],
      );
    });
    return after;
  }

  async getSkillState(learnerId: string, knowledgePointId: string): Promise<BktState | null> {
    const row = (await this.pool.query(
      `SELECT p_mastery AS "pMastery", confidence, attempt_count AS "attemptCount", correct_count AS "correctCount",
        p_guess AS "pGuess", p_slip AS "pSlip", p_learn AS "pLearn"
       FROM learner_skill_states WHERE learner_id = $1 AND knowledge_point_id = $2`,
      [learnerId, normalizeKnowledgePointId(knowledgePointId)],
    )).rows[0] as BktState | undefined;
    return row ?? null;
  }

  async getSkillStates(learnerId: string): Promise<Array<BktState & { knowledgePointId: string }>> {
    const rows = (await this.pool.query(
      `SELECT knowledge_point_id AS "knowledgePointId", p_mastery AS "pMastery", confidence, attempt_count AS "attemptCount",
        correct_count AS "correctCount", p_guess AS "pGuess", p_slip AS "pSlip", p_learn AS "pLearn"
       FROM learner_skill_states WHERE learner_id = $1 ORDER BY updated_at DESC`, [learnerId],
    )).rows as Array<BktState & { knowledgePointId: string }>;
    return rows;
  }

  /** 诊断会话落库：结果 + 逐题作答，可审计（总规 §7.3）。PG 会话结果整体存 result jsonb。 */
  async saveDiagnosticSession(
    learnerId: string,
    result: { total: number; correct: number; byDimension: Record<string, { total: number; correct: number }> },
    answers: Array<{ questionId: string; answerId: string; correct: boolean; durationMs: number }>,
  ): Promise<string> {
    const sessionId = `diag-session-${randomUUID()}`;
    const now = Date.now();
    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO diagnostic_sessions (id, learner_id, status, result, started_at, completed_at)
         VALUES ($1, $2, 'completed', $3, $4, $5)`,
        [sessionId, learnerId, { total: result.total, correct: result.correct, byDimension: result.byDimension }, now, now],
      );
      for (const answer of answers) {
        await client.query(
          `INSERT INTO diagnostic_answers (id, session_id, learner_id, question_id, answer_id, correct, duration_ms, answered_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [`diag-answer-${randomUUID()}`, sessionId, learnerId, answer.questionId, answer.answerId, answer.correct, answer.durationMs, now],
        );
      }
    });
    await this.recordLearningEvent(learnerId, 'diagnostic_completed', { sessionId, total: result.total, correct: result.correct });
    return sessionId;
  }

  async getLatestDiagnosticSession(learnerId: string): Promise<{ sessionId: string; total: number; correct: number; createdAt: number } | null> {
    const row = (await this.pool.query(
      `SELECT id AS "sessionId", result, completed_at AS "createdAt"
       FROM diagnostic_sessions WHERE learner_id = $1 AND status = 'completed' ORDER BY completed_at DESC LIMIT 1`, [learnerId],
    )).rows[0] as { sessionId: string; result: { total?: number; correct?: number } | null; createdAt: string | number } | undefined;
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      total: Number(row.result?.total ?? 0),
      correct: Number(row.result?.correct ?? 0),
      createdAt: Number(row.createdAt),
    };
  }

  async recordLearningEvent(learnerId: string, eventType: string, payload: unknown): Promise<string> {
    const id = `learning-event-${randomUUID()}`;
    await this.pool.query(
      'INSERT INTO learning_events (id, learner_id, event_type, payload_json, created_at) VALUES ($1, $2, $3, $4, $5)',
      [id, learnerId, eventType, payload, Date.now()],
    );
    return id;
  }

  async saveChatMessage(
    learnerId: string,
    role: LearningChatMessageView['role'],
    content: string,
    metadata: Record<string, unknown> = {},
  ): Promise<LearningChatMessageView> {
    const message: LearningChatMessageView = {
      id: `chat-${randomUUID()}`,
      role,
      content: content.trim().slice(0, 12_000),
      metadata,
      createdAt: Date.now(),
    };
    await this.pool.query(
      `INSERT INTO learning_chat_messages (id, learner_id, role, content, metadata_json, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [message.id, learnerId, message.role, message.content, message.metadata, message.createdAt],
    );
    return message;
  }

  async listChatMessages(learnerId: string, limit = 80, surface: 'path' | 'study' = 'path'): Promise<LearningChatMessageView[]> {
    const rows = (await this.pool.query(
      `SELECT id, role, content, metadata_json AS "metadataJson", created_at AS "createdAt"
       FROM learning_chat_messages WHERE learner_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [learnerId, Math.max(1, Math.min(limit, 200))],
    )).rows as Array<{ id: string; role: string; content: string; metadataJson: Record<string, unknown>; createdAt: string | number }>;
    const messages: LearningChatMessageView[] = rows.reverse().map((row) => {
      const parsed = row.metadataJson;
      const metadata: Record<string, unknown> = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
      return { id: row.id, role: row.role === 'assistant' ? 'assistant' : 'user', content: row.content, metadata, createdAt: Number(row.createdAt) };
    });
    return messages.filter((message) => surface === 'study'
      ? message.metadata['surface'] === 'study'
      : message.metadata['surface'] !== 'study');
  }

  async replacePathGraph(
    learnerId: string,
    nodes: Array<{ knowledgePointId: string; title: string; description: string; sortOrder?: number }>,
    edges: Array<{ fromKnowledgePointId: string; toKnowledgePointId: string; relation: LearningPathEdgeView['relation'] }>,
  ): Promise<LearningPathGraphView> {
    const now = Date.now();
    await withTransaction(this.pool, async (client) => {
      await client.query('DELETE FROM learning_path_edges WHERE learner_id = $1', [learnerId]);
      await client.query('DELETE FROM learning_path_nodes WHERE learner_id = $1', [learnerId]);
      const nodeIds = new Map<string, string>();
      for (let index = 0; index < nodes.length; index += 1) {
        const node = nodes[index]!;
        const id = `path-node-${randomUUID()}`;
        const key = node.knowledgePointId.trim() || `node-${index + 1}`;
        nodeIds.set(key, id);
        await client.query(
          `INSERT INTO learning_path_nodes
            (id, learner_id, knowledge_point_id, title, description, user_status, mastered, sort_order, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, 'not_started', false, $6, $7, $8)`,
          [id, learnerId, key, node.title.trim(), node.description.trim(), node.sortOrder ?? index + 1, now, now],
        );
      }
      for (const edge of edges) {
        const fromNodeId = nodeIds.get(edge.fromKnowledgePointId);
        const toNodeId = nodeIds.get(edge.toKnowledgePointId);
        if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) continue;
        await client.query(
          `INSERT INTO learning_path_edges (id, learner_id, from_node_id, to_node_id, relation, created_at)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (learner_id, from_node_id, to_node_id, relation) DO NOTHING`,
          [`path-edge-${randomUUID()}`, learnerId, fromNodeId, toNodeId, edge.relation, now],
        );
      }
    });
    return this.getPathGraph(learnerId);
  }

  async getPathGraph(learnerId: string): Promise<LearningPathGraphView> {
    const nodeRows = (await this.pool.query(
      `SELECT id, knowledge_point_id AS "knowledgePointId", title, description,
        user_status AS "userStatus", mastered, sort_order AS "sortOrder"
       FROM learning_path_nodes WHERE learner_id = $1 ORDER BY sort_order ASC, created_at ASC`, [learnerId],
    )).rows as Array<Omit<LearningPathNodeView, 'mastered' | 'userStatus'> & { mastered: boolean; userStatus: string }>;
    const edges = (await this.pool.query(
      `SELECT id, from_node_id AS "fromNodeId", to_node_id AS "toNodeId", relation
       FROM learning_path_edges WHERE learner_id = $1 ORDER BY created_at ASC`, [learnerId],
    )).rows as LearningPathEdgeView[];
    const evidence = await this.getRecommendationEvidence(learnerId);
    return {
      nodes: nodeRows.map((node) => ({
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

  private async getRecommendationEvidence(learnerId: string): Promise<{
    skills: Map<string, { mastery: number; attemptCount: number; correctCount: number }>;
    feedbackLevels: Map<string, 'high' | 'medium' | 'low'>;
  }> {
    const skillRows = (await this.pool.query(
      `SELECT knowledge_point_id AS "knowledgePointId", p_mastery AS "mastery", attempt_count AS "attemptCount", correct_count AS "correctCount"
       FROM learner_skill_states WHERE learner_id = $1`, [learnerId],
    )).rows as Array<{ knowledgePointId: string; mastery: number; attemptCount: number; correctCount: number }>;
    const skills = new Map<string, { mastery: number; attemptCount: number; correctCount: number }>();
    for (const row of skillRows) {
      skills.set(normalizeKnowledgePointId(row.knowledgePointId), {
        mastery: Number(row.mastery),
        attemptCount: Number(row.attemptCount),
        correctCount: Number(row.correctCount),
      });
    }
    const feedbackRows = (await this.pool.query(
      `SELECT a.content_json AS "contentJson", f.mastery_level AS "masteryLevel"
       FROM learning_asset_feedback f
       JOIN learning_assets a ON a.learner_id = f.learner_id AND a.id = f.asset_id
       WHERE f.learner_id = $1 AND f.mastery_level IN ('high', 'medium', 'low')
       ORDER BY f.updated_at DESC`, [learnerId],
    )).rows as Array<{ contentJson: { knowledgePointIds?: unknown }; masteryLevel: string }>;
    const feedbackLevels = new Map<string, 'high' | 'medium' | 'low'>();
    for (const row of feedbackRows) {
      const firstKnowledgePointId = Array.isArray(row.contentJson?.knowledgePointIds) && typeof row.contentJson.knowledgePointIds[0] === 'string'
        ? row.contentJson.knowledgePointIds[0]
        : '';
      const key = normalizeKnowledgePointId(firstKnowledgePointId);
      if (key && !feedbackLevels.has(key)) feedbackLevels.set(key, row.masteryLevel as 'high' | 'medium' | 'low');
    }
    return { skills, feedbackLevels };
  }

  private recommendationForNode(
    node: { knowledgePointId: string },
    evidence: { skills: Map<string, { mastery: number; attemptCount: number; correctCount: number }>; feedbackLevels: Map<string, 'high' | 'medium' | 'low'> },
  ) {
    const key = normalizeKnowledgePointId(node.knowledgePointId);
    return computeNodeRecommendation({
      skill: evidence.skills.get(key) ?? null,
      feedbackLevel: evidence.feedbackLevels.get(key) ?? null,
    });
  }

  async applyPathRevision(learnerId: string, revision: LearningPathRevisionInput): Promise<{ path: LearningPathGraphView; changed: boolean }> {
    const current = await this.getPathGraph(learnerId);
    const nodeByKnowledgePoint = new Map(current.nodes.map((node) => [node.knowledgePointId, node]));
    const now = Date.now();
    let changed = false;
    let nextSortOrder = Math.max(0, ...current.nodes.map((node) => node.sortOrder)) + 1;
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
      await this.pool.query(
        `INSERT INTO learning_path_nodes
          (id, learner_id, knowledge_point_id, title, description, user_status, mastered, sort_order, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'not_started', false, $6, $7, $8)`,
        [node.id, learnerId, node.knowledgePointId, node.title, node.description, node.sortOrder, now, now],
      );
      nodeByKnowledgePoint.set(node.knowledgePointId, node);
      changed = true;
    }
    for (const candidate of revision.updateNodes ?? []) {
      const target = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.knowledgePointId));
      if (!target || target.userStatus === 'completed' || target.mastered) continue;
      const title = typeof candidate.title === 'string' && candidate.title.trim() ? candidate.title.trim().slice(0, 80) : target.title;
      const description = typeof candidate.description === 'string' && candidate.description.trim() ? candidate.description.trim().slice(0, 280) : target.description;
      if (title === target.title && description === target.description) continue;
      await this.pool.query(
        'UPDATE learning_path_nodes SET title = $1, description = $2, updated_at = $3 WHERE learner_id = $4 AND id = $5',
        [title, description, now, learnerId, target.id],
      );
      nodeByKnowledgePoint.set(target.knowledgePointId, { ...target, title, description });
      changed = true;
    }
    const existingEdges = new Set(current.edges.map((edge) => `${edge.fromNodeId}:${edge.toNodeId}:${edge.relation}`));
    for (const candidate of revision.addEdges ?? []) {
      const from = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.fromKnowledgePointId));
      const to = nodeByKnowledgePoint.get(normalizeKnowledgePointId(candidate.toKnowledgePointId));
      const relation = ['prerequisite', 'branch', 'application', 'review'].includes(candidate.relation) ? candidate.relation : 'branch';
      const edgeKey = from && to ? `${from.id}:${to.id}:${relation}` : '';
      if (!from || !to || from.id === to.id || existingEdges.has(edgeKey)) continue;
      await this.pool.query(
        `INSERT INTO learning_path_edges (id, learner_id, from_node_id, to_node_id, relation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (learner_id, from_node_id, to_node_id, relation) DO NOTHING`,
        [`path-edge-${randomUUID()}`, learnerId, from.id, to.id, relation, now],
      );
      existingEdges.add(edgeKey);
      changed = true;
    }
    if (changed) await this.recordLearningEvent(learnerId, 'path_revised_from_conversation', { revision });
    return { path: await this.getPathGraph(learnerId), changed };
  }

  async setPathNodeStatus(
    learnerId: string,
    nodeId: string,
    patch: { userStatus?: LearningPathNodeView['userStatus']; mastered?: boolean },
  ): Promise<LearningPathNodeView | null> {
    const current = (await this.pool.query(
      `SELECT id, knowledge_point_id AS "knowledgePointId", title, description,
        user_status AS "userStatus", mastered, sort_order AS "sortOrder"
       FROM learning_path_nodes WHERE learner_id = $1 AND id = $2`, [learnerId, nodeId],
    )).rows[0] as (Omit<LearningPathNodeView, 'mastered' | 'userStatus'> & { mastered: boolean; userStatus: string }) | undefined;
    if (!current) return null;
    const userStatus = patch.userStatus ?? (['not_started', 'learning', 'completed'].includes(current.userStatus)
      ? current.userStatus as LearningPathNodeView['userStatus']
      : 'not_started');
    const mastered = patch.mastered ?? Boolean(current.mastered);
    await this.pool.query(
      'UPDATE learning_path_nodes SET user_status = $1, mastered = $2, updated_at = $3 WHERE learner_id = $4 AND id = $5',
      [userStatus, mastered, Date.now(), learnerId, nodeId],
    );
    await this.recordLearningEvent(learnerId, 'path_node_status_changed', { nodeId, userStatus, mastered });
    const recommendation = this.recommendationForNode(current, await this.getRecommendationEvidence(learnerId));
    return { ...current, userStatus, mastered, recommendation };
  }

  async saveAssetFeedback(learnerId: string, assetId: string, patch: AssetFeedbackInput): Promise<void> {
    const previous = (await this.pool.query(
      `SELECT completed, mastered, mastery_level AS "masteryLevel", difficulty_rating AS "difficultyRating", user_rating AS "userRating", note
       FROM learning_asset_feedback WHERE learner_id = $1 AND asset_id = $2`, [learnerId, assetId],
    )).rows[0] as {
      completed: boolean; mastered: boolean; masteryLevel: string | null;
      difficultyRating: number | null; userRating: number | null; note: string | null;
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
    await this.pool.query(
      `INSERT INTO learning_asset_feedback
        (id, learner_id, asset_id, completed, mastered, mastery_level, difficulty_rating, user_rating, note, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (learner_id, asset_id) DO UPDATE SET
         completed = excluded.completed, mastered = excluded.mastered, mastery_level = excluded.mastery_level,
         difficulty_rating = excluded.difficulty_rating, user_rating = excluded.user_rating,
         note = excluded.note, updated_at = excluded.updated_at`,
      [`asset-feedback-${randomUUID()}`, learnerId, assetId, completed, mastered, requestedLevel, difficultyRating, userRating, note, Date.now()],
    );
    await this.recordLearningEvent(learnerId, 'asset_feedback_recorded', { assetId, completed, mastered, masteryLevel: requestedLevel, difficultyRating, userRating });
  }

  async getProfile(learnerId: string): Promise<LearnerProfileView> {
    const count = async (sql: string, params: unknown[] = []): Promise<number> =>
      Number(((await this.pool.query(sql, params)).rows[0] as { count: string | number }).count);
    const assetsCount = await count('SELECT COUNT(*) AS count FROM learning_assets WHERE learner_id = $1', [learnerId]);
    const evidenceCount = await count('SELECT COUNT(*) AS count FROM learning_events WHERE learner_id = $1', [learnerId]);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayAssetsCount = await count('SELECT COUNT(*) AS count FROM learning_assets WHERE learner_id = $1 AND created_at >= $2', [learnerId, todayStart.getTime()]);
    const completedAssetsCount = await count('SELECT COUNT(*) AS count FROM learning_asset_feedback WHERE learner_id = $1 AND completed = true', [learnerId]);
    const masteredAssetsCount = await count('SELECT COUNT(*) AS count FROM learning_asset_feedback WHERE learner_id = $1 AND mastered = true', [learnerId]);
    const events = (await this.pool.query(
      'SELECT event_type AS "eventType", payload_json AS "payloadJson" FROM learning_events WHERE learner_id = $1', [learnerId],
    )).rows as Array<{ eventType: string; payloadJson: Record<string, unknown> }>;
    let studyMinutes = 0;
    let answered = 0;
    let correct = 0;
    for (const event of events) {
      try {
        const payload = event.payloadJson as { durationMs?: number; total?: number; correct?: number };
        studyMinutes += Number(payload.durationMs || 0) / 60000;
        if (event.eventType === 'answer_recorded') {
          answered += Number(payload.total || 1);
          correct += Number(payload.correct || 0);
        }
      } catch {
        // Ignore malformed historical payloads and keep computed metrics available.
      }
    }
    const skills = (await this.pool.query(
      `SELECT knowledge_point_id AS "knowledgePointId", p_mastery AS "mastery", confidence, attempt_count AS "attemptCount", correct_count AS "correctCount"
       FROM learner_skill_states WHERE learner_id = $1 ORDER BY updated_at DESC`, [learnerId],
    )).rows as LearnerProfileView['skills'];
    const snapshot = (await this.pool.query(
      `SELECT summary, keywords_json AS "keywordsJson", radar_json AS "radarJson"
       FROM learner_profile_snapshots WHERE learner_id = $1 ORDER BY generated_at DESC LIMIT 1`, [learnerId],
    )).rows[0] as { summary?: string; keywordsJson?: string[]; radarJson?: LearnerRadarItem[] } | undefined;
    return {
      learnerId,
      summary: snapshot?.summary || (evidenceCount > 0 ? '画像已根据学习证据更新' : '完成一次学习任务后，系统会形成第一版画像'),
      status: evidenceCount > 0 ? 'learning' : 'awaiting_evidence',
      assetsCount,
      todayAssetsCount,
      completedAssetsCount,
      masteredAssetsCount,
      evidenceCount,
      studyMinutes: Math.round(studyMinutes * 10) / 10,
      accuracy: answered > 0 ? Math.round((correct / answered) * 100) / 100 : null,
      keywords: Array.isArray(snapshot?.keywordsJson) ? snapshot!.keywordsJson : [],
      radar: Array.isArray(snapshot?.radarJson) ? snapshot!.radarJson : [],
      skills,
    };
  }

  async saveProfileSnapshot(learnerId: string, profile: { summary: string; keywords: string[]; radar: LearnerRadarItem[] }): Promise<void> {
    await this.pool.query(
      `INSERT INTO learner_profile_snapshots (id, learner_id, summary, keywords_json, radar_json, generated_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [`profile-${randomUUID()}`, learnerId, profile.summary, JSON.stringify(profile.keywords), JSON.stringify(profile.radar), Date.now()],
    );
  }

  async saveResourceAudit(resourceId: string, claims: ClaimAuditRecord[]): Promise<void> {
    for (const claim of claims) {
      await this.pool.query(
        `INSERT INTO claims (id, resource_id, text, verdict, critique, factual_score, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (id) DO UPDATE SET
           text = excluded.text, verdict = excluded.verdict, critique = excluded.critique, factual_score = excluded.factual_score`,
        [claim.id, resourceId, claim.text, claim.verdict, claim.critique, claim.factualScore, Date.now()],
      );
      for (const evidenceId of claim.evidenceIds) {
        await this.pool.query(
          `INSERT INTO claim_evidence (claim_id, evidence_id, support_level)
           VALUES ($1, $2, $3)
           ON CONFLICT (claim_id, evidence_id) DO UPDATE SET support_level = excluded.support_level`,
          [claim.id, evidenceId, claim.verdict === 'supported' ? 'supports' : 'requires_review'],
        );
      }
    }
  }

  async listPrivacyAuditEvents(limit = 8): Promise<PrivacyAuditEventView[]> {
    const boundedLimit = Math.max(1, Math.min(limit, 30));
    const rows = (await this.pool.query(
      `SELECT id, event_type AS "eventType", file_name AS "fileName", byte_count AS "byteCount",
        redacted_fields_json AS "redactedFieldsJson", retained, created_at AS "createdAt"
       FROM privacy_audit_events ORDER BY created_at DESC LIMIT $1`, [boundedLimit],
    )).rows as Array<{
      id: string; eventType: string; fileName: string | null; byteCount: string | number | null;
      redactedFieldsJson: unknown; retained: boolean; createdAt: string | number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      fileName: row.fileName,
      byteCount: row.byteCount === null || row.byteCount === undefined ? null : Number(row.byteCount),
      redactedFieldCount: Array.isArray(row.redactedFieldsJson) ? row.redactedFieldsJson.length : 0,
      retained: false,
      createdAt: Number(row.createdAt),
    }));
  }

  async clearPrivacyAuditEvents(): Promise<number> {
    const result = await this.pool.query('DELETE FROM privacy_audit_events');
    return result.rowCount ?? 0;
  }

  async listEvidence(learnerId: string, limit = 20): Promise<Array<{
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
  }>> {
    const boundedLimit = Math.max(1, Math.min(limit, 50));
    const rows = (await this.pool.query(
      `SELECT e.id, p.id AS "packId", p.query AS "packQuery", p.coverage_score AS "packCoverageScore",
        p.cross_validation_json AS "crossValidation", p.privacy_json AS "privacy",
        e.source_type AS "sourceType", e.source_id AS "sourceId", e.source_title AS "sourceTitle",
        e.source_scope AS "sourceScope", e.locator, e.content,
        e.retrieval_method AS "retrievalMethod", e.relevance_score AS "relevanceScore",
        e.trust_level AS "trustLevel", e.metadata_json AS "metadata"
       FROM evidence_items e
       INNER JOIN evidence_pack_items pi ON pi.evidence_id = e.id
       INNER JOIN evidence_packs p ON p.id = pi.pack_id
       WHERE p.learner_id = $1
       ORDER BY e.created_at DESC LIMIT $2`, [learnerId, boundedLimit],
    )).rows as Array<{
      id: string; packId: string | null; packQuery: string | null; packCoverageScore: number | null;
      crossValidation: unknown; privacy: unknown; sourceType: string; sourceId: string; sourceTitle: string | null;
      sourceScope: string | null; locator: string; content: string; retrievalMethod: string;
      relevanceScore: number; trustLevel: string; metadata: unknown;
    }>;
    return rows.map((row) => ({
      id: String(row.id),
      packId: row.packId ? String(row.packId) : null,
      packQuery: row.packQuery ? String(row.packQuery) : null,
      packCoverageScore: row.packCoverageScore === null || row.packCoverageScore === undefined ? null : Number(row.packCoverageScore),
      crossValidation: row.crossValidation,
      privacy: row.privacy,
      sourceType: String(row.sourceType),
      sourceId: String(row.sourceId),
      sourceTitle: row.sourceTitle ? String(row.sourceTitle) : '',
      sourceScope: row.sourceScope ? String(row.sourceScope) : 'system',
      locator: String(row.locator),
      content: String(row.content),
      retrievalMethod: String(row.retrievalMethod),
      relevanceScore: Number(row.relevanceScore),
      trustLevel: String(row.trustLevel),
      metadata: row.metadata,
    }));
  }
}

/* ----------------------------- 共享工具 ----------------------------- */

function normalizeDisplayName(value: string, fallback: string): string {
  const result = value.trim() || fallback;
  if (result.length > 32) throw new Error('昵称不能超过 32 个字符');
  return result;
}

function normalizeOnboarding(input: OnboardingInput): OnboardingInput {
  const role = input.role.trim().slice(0, 48);
  const programmingFoundation = input.programmingFoundation.trim().slice(0, 48);
  const goal = input.goal.trim().slice(0, 160);
  const selfDescription = input.selfDescription.trim().slice(0, 1_000);
  if (!role || !programmingFoundation || !goal) throw new Error('请补全基础背景、编程基础和学习目标');
  const weeklyHours = input.weeklyHours === undefined || input.weeklyHours === null
    ? null
    : Math.max(0, Math.min(80, Number(input.weeklyHours) || 0));
  return { role, programmingFoundation, goal, weeklyHours, selfDescription };
}

function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt));
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

function normalizeRating(value: number | null): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(1, Math.min(5, Math.round(value)));
}
