/**
 * 学习画像快照生成（从 server/index.ts 原样搬移为共享模块）。
 * API 的 profile/regenerate 与 scripts/demo-seed.ts 共用：种子账号在播种时
 * 就生成好画像描述/关键词/雷达，评委打开画像弹窗即可看到真实画像内容。
 */
import { identityStore, learningStore } from './study-context.js';

const KNOWLEDGE_LABELS: Record<string, string> = {
  'python-basics': 'Python 基础',
  'python-control': 'Python 控制流',
  'python-data-structures': 'Python 数据结构',
  'pandas-reading': '数据读取',
  'pandas-filter': '数据筛选',
  'data-cleaning': '数据清洗',
  'statistics-basics': '统计基础',
  'time-series-basics': '时序分析',
  'evidence-boundary': '证据边界',
  'anomaly-threshold': '阈值与异常判断',
  'ai4i-overview': 'AI4I 数据集',
  'ai4i-failure-modes': '故障机理',
  'metropt-3-basics': 'MetroPT-3 时序',
  'machine-learning-basics': '机器学习基础',
  'industrial-diagnosis-foundation': '设备诊断基础',
  'compressor-diagnosis-evidence': '设备诊断证据',
};

function cleanSentence(value: string): string {
  return value
    .replace(/\s+([，。；：！？、」』】）])/g, '$1')
    .replace(/([「『【（])\s+/g, '$1')
    .replace(/[。！？!?；;，,：:]+$/g, '')
    .trim();
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return cleanSentence(value);
  return Array.isArray(value)
    ? cleanSentence(value.filter((item): item is string => typeof item === 'string').join('、'))
    : '';
}

function backgroundKeywords(background: string): string[] {
  const knownTerms = [
    '中职机电', '机电', 'Python', '零基础', '数据分析', '设备诊断', '传感器', '机器学习', '统计', '时序分析', '运维',
  ];
  const matched = knownTerms.filter((term) => background.toLowerCase().includes(term.toLowerCase()));
  if (matched.length > 0) return matched;
  return background
    .split(/[，,。；;、/|\s]+/)
    .map((item) => item.trim().replace(/^(我|希望|想要|目前|正在)/, ''))
    .filter((item) => item.length >= 2 && item.length <= 10)
    .slice(0, 3);
}

/**
 * 画像只由已持久化的诊断、作答、反馈与学习记录确定性生成。
 * 不使用语言模型，避免没有新数据时因采样差异产生不同画像。
 */
export async function generateProfileSnapshot(learnerId: string, _model?: string, _thinking?: { temperature: number; maxTokens: number }) {
  const current = await learningStore.getProfile(learnerId);
  const onboarding = await identityStore.getOnboarding(learnerId);
  const graph = await learningStore.getPathGraph(learnerId);
  const titleByKnowledgePoint = new Map(graph.nodes.map((node) => [node.knowledgePointId, node.title]));
  const labelOf = (knowledgePointId: string): string => KNOWLEDGE_LABELS[knowledgePointId] ?? titleByKnowledgePoint.get(knowledgePointId) ?? knowledgePointId;
  const skills = [...current.skills].sort((a, b) => a.mastery - b.mastery || b.confidence - a.confidence);
  const focus = skills[0];
  const background: string = textOf(onboarding?.selfDescription) || textOf(onboarding?.role);
  const accuracy = current.accuracy === null || current.accuracy === undefined ? null : Math.round(current.accuracy * 100);
  const intro = background ? `${background}，` : '';
  const summary = current.evidenceCount === 0
    ? `${intro}尚未产生可用学习记录。完成入学诊断或一次练习后，系统会基于作答和反馈更新画像。`
    : `${intro}已积累 ${current.evidenceCount} 条学习记录${accuracy === null ? '' : `，当前正确率 ${accuracy}%`}。${focus ? `建议优先巩固「${labelOf(focus.knowledgePointId)}」。` : '继续通过作答与反馈积累学习证据。'}`;
  const keywords: string[] = [...new Set([
    ...(background ? backgroundKeywords(background) : []),
    ...skills.slice(0, 3).map((skill) => labelOf(skill.knowledgePointId)).filter((label) => label !== '专业知识学习'),
  ])].slice(0, 5);
  const radar = [
    { name: '学习投入', score: Math.min(1, current.studyMinutes / 120), reason: `已学习 ${current.studyMinutes} 分钟` },
    { name: '练习表现', score: current.accuracy ?? 0, reason: accuracy === null ? '尚无习题作答' : `当前正确率 ${accuracy}%` },
    { name: '知识掌握', score: skills.length ? skills.reduce((sum, skill) => sum + skill.mastery, 0) / skills.length : 0, reason: skills.length ? `依据 ${skills.length} 个知识点的作答状态` : '尚无知识状态' },
    { name: '反馈完整度', score: current.assetsCount ? current.completedAssetsCount / current.assetsCount : 0, reason: `已完成 ${current.completedAssetsCount}/${current.assetsCount} 份资源` },
  ].map((item) => ({ ...item, score: Number(Math.max(0, Math.min(1, item.score)).toFixed(2)) }));
  const unchanged = current.summary === summary
    && JSON.stringify(current.keywords) === JSON.stringify(keywords)
    && JSON.stringify(current.radar) === JSON.stringify(radar);
  if (!unchanged) await learningStore.saveProfileSnapshot(learnerId, { summary, keywords, radar });
  return { profile: await learningStore.getProfile(learnerId), updated: !unchanged };
}
