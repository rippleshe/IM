/**
 * 习题判分纯函数（题型：choice / blank / short_answer）。
 * choice 按选项 id 精确比对；blank 按标准答案多候选规范化比对；short_answer 由学习者对照参考答案自评。
 */
import type { QuizQuestion } from './types.js';

export interface QuizSubmissionOptions {
  /** 简答题自评结果（对照参考答案后由学习者给出）；choice/blank 忽略该字段 */
  selfAssessed?: boolean;
}

/** 文本答案规范化：全角转半角、去空白与末尾标点、转小写，保证等价表述判对 */
export function normalizeAnswerText(value: string): string {
  return value
    .trim()
    .replace(/[，。；：、！？]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase();
}

export function judgeQuizAnswer(question: QuizQuestion, answerId: string, options: QuizSubmissionOptions = {}): boolean {
  const type = question.type ?? 'choice';
  if (type === 'short_answer') return options.selfAssessed === true;
  const submitted = typeof answerId === 'string' ? answerId.trim().slice(0, 2_000) : '';
  if (!submitted) return false;
  if (type === 'blank') {
    const candidates = question.answerId.split('|').map((item) => normalizeAnswerText(item)).filter(Boolean);
    const normalized = normalizeAnswerText(submitted);
    return candidates.includes(normalized);
  }
  return submitted === question.answerId;
}

/** 提交答案的入库形态与长度上限（choice=选项 id；blank/short_answer=文本答案） */
export function sanitizeSubmittedAnswer(answerId: string): string {
  return (typeof answerId === 'string' ? answerId : '').trim().slice(0, 2_000);
}
