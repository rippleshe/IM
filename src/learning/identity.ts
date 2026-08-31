import { createHash, scryptSync, timingSafeEqual } from 'node:crypto';

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

export function normalizeLoginName(value: string): string {
  const result = value.trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,48}$/.test(result)) throw new Error('账号需为 3 至 48 位字母、数字、点、下划线或连字符');
  return result;
}

export function validatePassword(value: string): void {
  if (value.length < 8 || value.length > 128) throw new Error('密码长度需为 8 至 128 位');
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
