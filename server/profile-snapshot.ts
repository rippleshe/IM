/**
 * 学习画像快照生成（从 server/index.ts 原样搬移为共享模块）。
 * API 的 profile/regenerate 与 scripts/demo-seed.ts 共用：种子账号在播种时
 * 就生成好画像描述/关键词/雷达，评委打开画像弹窗即可看到真实画像内容。
 */
import { multiModelClient, parseJson } from './study-runtime.js';
import { identityStore, learningStore } from './study-context.js';

export async function generateProfileSnapshot(learnerId: string, model: string | undefined, thinking: { temperature: number; maxTokens: number }) {
  const current = learningStore.getProfile(learnerId);
  const onboarding = identityStore.getOnboarding(learnerId);
  const response = await multiModelClient.simple({
    messages: [
      {
        role: 'system',
        content: '你是学习画像总结器。只输出 JSON 对象，不要 Markdown。字段必须是 summary（不超过80字）、keywords（3到6个短词）、radar（3到5项，每项含 name、score 0到1、reason）。只能根据提供的统计与技能证据描述，不得虚构能力。',
      },
      { role: 'user', content: JSON.stringify({ initialProfile: onboarding, metrics: { assetsCount: current.assetsCount, todayAssetsCount: current.todayAssetsCount, completedAssetsCount: current.completedAssetsCount, masteredAssetsCount: current.masteredAssetsCount, evidenceCount: current.evidenceCount, studyMinutes: current.studyMinutes, accuracy: current.accuracy }, skills: current.skills }) },
    ],
    model,
    temperature: thinking.temperature,
    maxTokens: Math.min(thinking.maxTokens, 2048),
  });
  const parsed = parseJson<{ summary?: unknown; keywords?: unknown; radar?: unknown }>(response.text) || {};
  const keywords = Array.isArray(parsed.keywords) ? parsed.keywords.map(String).filter(Boolean).slice(0, 6) : [];
  const radar = Array.isArray(parsed.radar) ? parsed.radar.map((raw) => {
    const item = raw as Record<string, unknown>;
    return { name: String(item['name'] || '学习维度'), score: Math.max(0, Math.min(1, Number(item['score']) || 0)), reason: String(item['reason'] || '') };
  }).filter((item) => item.name).slice(0, 5) : [];
  const summary = typeof parsed.summary === 'string' && parsed.summary.trim() ? parsed.summary.trim().slice(0, 160) : current.summary;
  learningStore.saveProfileSnapshot(learnerId, { summary, keywords, radar });
  return learningStore.getProfile(learnerId);
}