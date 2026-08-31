/**
 * 对话上下文打包：优先保留最新的完整轮次，直到接近当前模型的实际输入上限。
 * 不截断单条消息，避免把一句话的前半段当作完整语义发送给模型。
 */
export type ConversationTurn = { role: 'user' | 'assistant'; content: string };

export const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_CONTEXT_SAFETY_RESERVE = 12_000;

function estimateTokens(text: string): number {
  // 对中文按约 1 token/字、其他字符按约 3.5 字符/token 估算；宁可略保守，避免超窗。
  const hanCount = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  return hanCount + Math.ceil((text.length - hanCount) / 3.5) + 8;
}

export function packConversationContext(
  messages: ConversationTurn[],
  options: { contextWindow?: number; reservedTokens?: number } = {},
): ConversationTurn[] {
  const contextWindow = Math.max(1, options.contextWindow ?? DEFAULT_CONTEXT_WINDOW);
  const reservedTokens = Math.min(
    Math.max(1, options.reservedTokens ?? DEFAULT_CONTEXT_SAFETY_RESERVE),
    Math.max(1, contextWindow - 1),
  );
  const budget = contextWindow - reservedTokens;
  const kept: ConversationTurn[] = [];
  let used = 0;

  for (const message of [...messages].reverse()) {
    const content = message.content.trim();
    if (!content) continue;
    const size = estimateTokens(content);
    if (used + size > budget) break;
    kept.push({ role: message.role, content });
    used += size;
  }

  return kept.reverse();
}
