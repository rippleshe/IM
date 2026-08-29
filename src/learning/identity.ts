import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import type { SqliteDatabase } from './sqlite.js';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface AuthenticatedLearner {
  id: string;
  loginName: string;
  displayName: string;
  avatarKey: AvatarKey;
  /** 用户自传头像（canvas 缩图后的 data URL，≤200KB）；空 = 用 avatarKey 色块首字母 */
  avatarImage: string | null;
  onboardingCompleted: boolean;
  /** 是否已完成 12 题初始诊断（API 层按诊断会话计算，非 users 列） */
  diagnosticCompleted?: boolean;
}

export const AVATAR_KEYS = ['graphite', 'ocean', 'violet', 'forest', 'amber', 'rose'] as const;
export type AvatarKey = typeof AVATAR_KEYS[number];

/** 头像图片上限（base64 data URL 字符长度），前端 canvas 压到 128px 后远小于该值。 */
export const AVATAR_IMAGE_MAX_CHARS = 280_000;

export interface OnboardingInput {
  role: string;
  programmingFoundation: string;
  goal: string;
  weeklyHours?: number | null;
  selfDescription: string;
}

export interface LearnerOnboarding extends OnboardingInput {
  learnerId: string;
}

export class IdentityStore {
  constructor(private readonly db: SqliteDatabase) {}

  register(input: { loginName: string; displayName: string; password: string }): AuthenticatedLearner {
    const loginName = normalizeLoginName(input.loginName);
    const displayName = normalizeDisplayName(input.displayName, loginName);
    validatePassword(input.password);
    const existing = this.db.prepare('SELECT id FROM users WHERE login_name = ?').get(loginName) as { id?: string } | undefined;
    if (existing?.id) throw new Error('该账号已被注册');

    const salt = randomBytes(16).toString('base64url');
    const passwordHash = hashPassword(input.password, salt);
    const user: AuthenticatedLearner = { id: `user-${randomUUID()}`, loginName, displayName, avatarKey: 'graphite', avatarImage: null, onboardingCompleted: false };
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO users (id, login_name, display_name, avatar_key, password_hash, password_salt, onboarding_completed, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
    `).run(user.id, user.loginName, user.displayName, user.avatarKey, passwordHash, salt, now, now);
    return user;
  }

  authenticate(loginName: string, password: string): AuthenticatedLearner | null {
    const normalized = normalizeLoginName(loginName);
    const row = this.db.prepare(`
      SELECT id, login_name AS loginName, display_name AS displayName, avatar_key AS avatarKey, avatar_image AS avatarImage,
        password_hash AS passwordHash, password_salt AS passwordSalt, onboarding_completed AS onboardingCompleted
      FROM users WHERE login_name = ?
    `).get(normalized) as {
      id: string;
      loginName: string;
      displayName: string;
      avatarKey: string;
      avatarImage: string | null;
      passwordHash: string;
      passwordSalt: string;
      onboardingCompleted: number;
    } | undefined;
    if (!row || !verifyPassword(password, row.passwordSalt, row.passwordHash)) return null;
    return { id: row.id, loginName: row.loginName, displayName: row.displayName, avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage, onboardingCompleted: Boolean(row.onboardingCompleted) };
  }

  createSession(userId: string): { token: string; expiresAt: number } {
    const token = randomBytes(32).toString('base64url');
    const now = Date.now();
    const expiresAt = now + SESSION_LIFETIME_MS;
    this.db.prepare(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(`auth-${randomUUID()}`, userId, hashToken(token), expiresAt, now, now);
    return { token, expiresAt };
  }

  getSessionUser(token: string | undefined): AuthenticatedLearner | null {
    if (!token) return null;
    const now = Date.now();
    const row = this.db.prepare(`
      SELECT u.id, u.login_name AS loginName, u.display_name AS displayName, u.avatar_key AS avatarKey, u.avatar_image AS avatarImage,
        u.onboarding_completed AS onboardingCompleted, s.id AS sessionId
      FROM auth_sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ? AND s.expires_at > ?
    `).get(hashToken(token), now) as {
      id: string;
      loginName: string;
      displayName: string;
      avatarKey: string;
      avatarImage: string | null;
      onboardingCompleted: number;
      sessionId: string;
    } | undefined;
    if (!row) return null;
    this.db.prepare('UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?').run(now, row.sessionId);
    return { id: row.id, loginName: row.loginName, displayName: row.displayName, avatarKey: normalizeAvatarKey(row.avatarKey), avatarImage: row.avatarImage, onboardingCompleted: Boolean(row.onboardingCompleted) };
  }

  revokeSession(token: string | undefined): void {
    if (!token) return;
    this.db.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').run(hashToken(token));
  }

  /** 演示种子幂等重置密码：已有演示账号一律以当前 IM_TRAINING_AGENT_DEMO_PASSWORD 为准。 */
  resetPassword(learnerId: string, password: string): void {
    const salt = randomBytes(16).toString('base64url');
    const passwordHash = hashPassword(password, salt);
    this.db.prepare('UPDATE users SET password_hash = ?, password_salt = ?, updated_at = ? WHERE id = ?')
      .run(passwordHash, salt, Date.now(), learnerId);
  }

  updateAvatar(learnerId: string, avatarKey: string): AuthenticatedLearner | null {
    const nextAvatar = normalizeAvatarKey(avatarKey);
    const now = Date.now();
    this.db.prepare('UPDATE users SET avatar_key = ?, updated_at = ? WHERE id = ?').run(nextAvatar, now, learnerId);
    return this.getById(learnerId);
  }

  /** 用户自传头像：存缩图 data URL；传 null 清除回到色块首字母。 */
  updateAvatarImage(learnerId: string, image: string | null): AuthenticatedLearner | null {
    const now = Date.now();
    this.db.prepare('UPDATE users SET avatar_image = ?, updated_at = ? WHERE id = ?')
      .run(image && image.length <= AVATAR_IMAGE_MAX_CHARS && image.startsWith('data:image/') ? image : null, now, learnerId);
    return this.getById(learnerId);
  }

  getByLoginName(loginName: string): AuthenticatedLearner | null {
    const row = this.db.prepare(`
      SELECT id, login_name AS loginName, display_name AS displayName, avatar_key AS avatarKey,
        avatar_image AS avatarImage, onboarding_completed AS onboardingCompleted FROM users WHERE login_name = ?
    `).get(normalizeLoginName(loginName)) as Omit<AuthenticatedLearner, 'avatarKey' | 'onboardingCompleted'> & { avatarKey: string; onboardingCompleted: number } | undefined;
    return row ? { ...row, avatarKey: normalizeAvatarKey(row.avatarKey), onboardingCompleted: Boolean(row.onboardingCompleted) } : null;
  }

  getById(learnerId: string): AuthenticatedLearner | null {
    const row = this.db.prepare(`
      SELECT id, login_name AS loginName, display_name AS displayName, avatar_key AS avatarKey,
        avatar_image AS avatarImage, onboarding_completed AS onboardingCompleted FROM users WHERE id = ?
    `).get(learnerId) as Omit<AuthenticatedLearner, 'avatarKey' | 'onboardingCompleted'> & { avatarKey: string; onboardingCompleted: number } | undefined;
    return row ? { ...row, avatarKey: normalizeAvatarKey(row.avatarKey), onboardingCompleted: Boolean(row.onboardingCompleted) } : null;
  }

  saveOnboarding(learnerId: string, input: OnboardingInput): LearnerOnboarding {
    const normalized = normalizeOnboarding(input);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO learner_onboarding (learner_id, role, programming_foundation, goal, weekly_hours, self_description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(learner_id) DO UPDATE SET
        role = excluded.role,
        programming_foundation = excluded.programming_foundation,
        goal = excluded.goal,
        weekly_hours = excluded.weekly_hours,
        self_description = excluded.self_description,
        updated_at = excluded.updated_at
    `).run(learnerId, normalized.role, normalized.programmingFoundation, normalized.goal, normalized.weeklyHours ?? null, normalized.selfDescription, now, now);
    this.db.prepare('UPDATE users SET onboarding_completed = 1, updated_at = ? WHERE id = ?').run(now, learnerId);
    return { learnerId, ...normalized };
  }

  getOnboarding(learnerId: string): LearnerOnboarding | null {
    const row = this.db.prepare(`
      SELECT learner_id AS learnerId, role, programming_foundation AS programmingFoundation,
        goal, weekly_hours AS weeklyHours, self_description AS selfDescription
      FROM learner_onboarding WHERE learner_id = ?
    `).get(learnerId) as LearnerOnboarding | undefined;
    return row ?? null;
  }
}

export function normalizeLoginName(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,48}$/.test(result)) throw new Error('账号需为 3 至 48 位字母、数字、点、下划线或连字符');
  return result;
}

function normalizeDisplayName(value: string, fallback: string): string {
  const result = value.trim() || fallback;
  if (result.length > 32) throw new Error('昵称不能超过 32 个字符');
  return result;
}

export function validatePassword(value: string): void {
  if (value.length < 8 || value.length > 128) throw new Error('密码长度需为 8 至 128 位');
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

export function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('base64');
}

export function verifyPassword(password: string, salt: string, expected: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt));
  const expectedBuffer = Buffer.from(expected);
  return actual.length === expectedBuffer.length && timingSafeEqual(actual, expectedBuffer);
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

export function normalizeAvatarKey(value: string): AvatarKey {
  return (AVATAR_KEYS as readonly string[]).includes(value) ? value as AvatarKey : 'graphite';
}
