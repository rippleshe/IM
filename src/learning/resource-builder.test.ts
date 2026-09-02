import { describe, expect, it } from 'vitest';
import { auditResource } from './audit.js';
import {
  buildLlmResourceDocument,
  buildResourceDraft,
  parseLlmResourceDraft,
  validateLlmResourceDraftQuality,
} from './resource-builder.js';
import { extractQuizQuestions } from './store.js';
import type { EvidenceItem, EvidencePack, LearningResourceType, QuizQuestion } from './types.js';

function evidenceItem(id: string, content: string, sourceType: EvidenceItem['sourceType'] = 'dataset'): EvidenceItem {
  return {
    id,
    sourceType,
    sourceId: 'ai4i-2020',
    sourceTitle: 'AI4I 测试数据',
    locator: 'row 42',
    content,
    retrievalMethod: 'sql',
    relevanceScore: 0.9,
    trustLevel: 'high',
  };
}

function pack(items: EvidenceItem[]): EvidencePack {
  return {
    id: 'pack-1',
    query: '设备数据观察',
    items,
    retrievalPlan: ['structured'],
    coverageScore: 0.9,
    crossValidation: { status: 'corroborated', score: 1, checks: [], notes: [] },
    structuredCount: items.length,
    documentCount: 0,
    temporaryCount: 0,
    privacy: { temporaryReferenceUsed: false, retained: false },
    createdAt: 0,
  };
}

const EVIDENCE = [
  evidenceItem('e1', 'Air temperature [K] = 298.1, Torque [Nm] = 52.3, Machine failure = 0'),
  evidenceItem('e2', '故障样本 33 条，正常样本 9967 行，失败率约 0.33%', 'document'),
  // 行级结构化证据：讲义“数据摘录”表格的来源（representativeTable 只认 recent_rows/dataset_row）
  evidenceItem('e3', JSON.stringify({ 'Machine failure': 1, 'Air temperature [K]': 298.1, 'Torque [Nm]': 52.3, 'Tool wear [min]': 0 }), 'dataset'),
];

EVIDENCE[2]!.metadata = { queryKind: 'recent_rows' };

const METRO_ROW = evidenceItem(
  'metro-row-1',
  JSON.stringify({ rowId: '15169470', timestamp: '2020-09-01 03:59:50', tp2: -0.014, tp3: 8.86, h1: 8.848, dvPressure: -0.0219, motorCurrent: 3.7, oilTemperature: 59.4 }),
  'dataset',
);
METRO_ROW.sourceId = 'metropt-3';
METRO_ROW.sourceTitle = 'MetroPT-3 Air Compressor 数据行';
METRO_ROW.metadata = { queryKind: 'recent_rows' };

const METRO_PACK = { ...pack([METRO_ROW]), query: '空压机传感器时间序列数据清洗' };

const METRO_MATCHED_ROW = {
  ...METRO_ROW,
  id: 'metro-matched-row-1',
  metadata: { queryKind: 'query_matched_rows' },
};

describe('parseLlmResourceDraft：结构校验与回退', () => {
  it('讲义：完整输出解析为各字段，缺失字段被剔除', () => {
    const draft = parseLlmResourceDraft('lecture', {
      title: '观察设备数据',
      lead: '这份讲义带你从字段开始。',
      objectives: ['说出字段含义'],
      sections: [
        { heading: '从一行数据开始', text: '正文 300 字……', code: { language: 'python', code: 'import pandas as pd' }, keyPoints: ['记住字段名'] },
        { heading: '故障样本', text: '正文……' },
      ],
      misconceptions: [{ wrong: '异常即故障', correct: '异常只是风险信号' }],
      reviewQuestions: ['你会先看哪个字段？'],
    });
    expect(draft).not.toBeNull();
    expect(draft?.kind).toBe('lecture');
    if (draft?.kind !== 'lecture') return;
    expect(draft.sections).toHaveLength(2);
    expect(draft.sections[0]?.code?.code).toContain('pandas');
    expect(draft.misconceptions).toHaveLength(1);
    expect(draft.reviewQuestions).toHaveLength(1);
  });

  it('四类资源：解析并保留面向初学者的术语入口', () => {
    const draft = parseLlmResourceDraft('lecture', {
      title: '从一行记录开始',
      objectives: ['读懂一行记录', '完成一次观察'],
      glossary: [
        { term: '时间字段', plainMeaning: '记录每次测量发生时间的列，用来把记录按先后顺序排列。', example: '同一设备的两次读数可以按时间先后比较。', use: '开始观察趋势前先确认它。' },
        { term: '测量值', plainMeaning: '传感器在某个时刻读到的数值，用来描述设备当时的状态。', example: '压力和温度都可能是测量值。', use: '跟着示例观察变化。' },
        { term: '风险判断', plainMeaning: '根据已有记录指出需要继续核对的方向，不等于已经证明故障。', example: '某段读数持续偏离时先标为风险线索。', use: '最后整理下一步复核动作。' },
      ],
      sections: [{ heading: '先看问题', text: '先理解要观察什么。' }, { heading: '再做一步', text: '再按顺序完成观察。' }],
    });
    expect(draft?.kind).toBe('lecture');
    expect(draft?.glossary).toHaveLength(3);
  });

  it('讲义：缺标题或小节不足 2 → 返回 null（模板兜底）', () => {
    expect(parseLlmResourceDraft('lecture', { title: 'x', sections: [{ heading: 'a', text: 'b' }] })).toBeNull();
    expect(parseLlmResourceDraft('lecture', { sections: [{ heading: 'a', text: 'b' }, { heading: 'c', text: 'd' }] })).toBeNull();
  });

  it('PPT：空 bullets 的页被过滤，页数不足 → null', () => {
    const draft = parseLlmResourceDraft('presentation', {
      title: '诊断演示',
      slides: [
        { heading: '问题', bullets: ['温度偏高', '扭矩波动'], notes: '讲解词' },
        { heading: '空页', bullets: [] },
        { heading: '行动', bullets: ['现场复核'] },
      ],
    });
    expect(draft?.kind).toBe('presentation');
    if (draft?.kind !== 'presentation') return;
    expect(draft.slides).toHaveLength(2);
    expect(parseLlmResourceDraft('presentation', { title: 'x', slides: [{ heading: 'a', bullets: [] }] })).toBeNull();
  });

  it('习题：非法 level/选项不足被过滤，answerId 非法时回退首个选项', () => {
    const draft = parseLlmResourceDraft('tiered_quiz', {
      title: '分层练习',
      questions: [
        { level: 'L1', prompt: '选项不足', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }], answerId: 'A', explanation: 'x' },
        { level: 'L9', prompt: '非法层级', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }], answerId: 'A', explanation: 'x' },
        { level: 'L2', prompt: '有效题', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' }], answerId: 'C', explanation: '因为 C' },
        { level: 'L3', prompt: 'answerId 非法', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' }], answerId: 'E', explanation: 'x' },
      ],
    });
    expect(draft?.kind).toBe('tiered_quiz');
    if (draft?.kind !== 'tiered_quiz') return;
    expect(draft.questions).toHaveLength(2);
    expect(draft.questions[0]?.answerId).toBe('C');
    expect(draft.questions[1]?.answerId).toBe('E'); // 解析层透传，回退在组装层处理
    expect(parseLlmResourceDraft('tiered_quiz', { title: 'x', questions: [] })).toBeNull();
  });

  it('知识脉络：缺 mermaid → null', () => {
    expect(parseLlmResourceDraft('concept_map', { title: 'x', map: { mermaid: '', nodes: [] } })).toBeNull();
  });
});

describe('validateLlmResourceDraftQuality：可交付质量门槛', () => {
  it('能识别只有两节短句、缺记忆点和缺自测的伪讲义', () => {
    const draft = parseLlmResourceDraft('lecture', {
      title: '过短讲义',
      objectives: ['认识字段'],
      sections: [
        { heading: '字段', text: '一句话。' },
        { heading: '方法', text: '另一句话。' },
      ],
    })!;
    const issues = validateLlmResourceDraftQuality(draft);
    expect(issues.some((issue) => issue.includes('6 到 8'))).toBe(true);
    expect(issues.some((issue) => issue.includes('正文不足'))).toBe(true);
    expect(issues.some((issue) => issue.includes('记忆点'))).toBe(true);
    expect(issues.some((issue) => issue.includes('自测问题'))).toBe(true);
    expect(issues.some((issue) => issue.includes('白话术语表'))).toBe(true);
  });

  it('术语表缺例子或使用场景时不能通过质量门槛', () => {
    const draft = parseLlmResourceDraft('presentation', {
      title: '入门演示',
      objectives: ['读懂概念', '完成观察'],
      glossary: [
        { term: '时间字段', plainMeaning: '记录每次测量发生时间的列，用来把记录按先后顺序排列。' },
        { term: '测量值', plainMeaning: '传感器在某个时刻读到的数值，用来描述设备当时的状态。' },
        { term: '风险判断', plainMeaning: '根据已有记录指出需要继续核对的方向，不等于已经证明故障。' },
      ],
      slides: Array.from({ length: 8 }, (_, index) => ({ heading: `第${index + 1}页`, bullets: ['先看问题', '跟着做一步', '说明能否判断'], notes: '先用中文解释这一页，再带学习者完成一个小动作并说明下一步。' })),
    })!;
    const issues = validateLlmResourceDraftQuality(draft);
    expect(issues.some((issue) => issue.includes('例子或使用场景'))).toBe(true);
  });

  it('知识脉络路径过长且没有小检查时不能通过质量门槛', () => {
    const draft = parseLlmResourceDraft('concept_map', {
      title: '数据清洗入门',
      objectives: ['看懂数据问题', '完成基础检查'],
      glossary: [
        { term: '时间戳', plainMeaning: '记录一条数据在什么时候产生的时间信息，帮助我们按先后顺序观察变化。', example: '例如一条记录写着上午十点。', use: '用来检查顺序和时间间隔。' },
        { term: '缺失值', plainMeaning: '本来应该有内容的单元格变成空白或无效值，说明这条记录的信息不完整。', example: '例如温度这一格没有读数。', use: '用来判断能否直接计算。' },
        { term: '重复值', plainMeaning: '同一条数据被完整记录了不止一次，可能让统计结果看起来比实际更多。', example: '例如两行内容完全相同。', use: '用来决定是否保留多余记录。' },
      ],
      map: {
        mermaid: 'flowchart TD\nA-->B\nB-->C',
        nodes: Array.from({ length: 8 }, (_, index) => ({ label: `节点${index}`, explanation: '这是一段足够长的节点解释，用于说明它为什么重要、如何观察以及学习者下一步可以做什么。' })),
        readingPaths: [{ title: '入门', steps: ['节点1', '节点2', '节点3', '节点4', '节点5', '节点6'] }, { title: '复核', steps: ['节点2', '节点3'] }],
      },
    })!;
    const issues = validateLlmResourceDraftQuality(draft);
    expect(issues.some((issue) => issue.includes('超过 5 步'))).toBe(true);
    expect(issues.some((issue) => issue.includes('小检查问题'))).toBe(true);
  });

  it('解析与组装保留最多 8 个讲义小节', () => {
    const draft = parseLlmResourceDraft('lecture', {
      title: '完整讲义结构',
      objectives: ['理解字段', '完成分析'],
      sections: Array.from({ length: 8 }, (_, index) => ({
        heading: `第 ${index + 1} 节`,
        text: `第 ${index + 1} 节正文`,
      })),
    });
    expect(draft?.kind).toBe('lecture');
    if (draft?.kind !== 'lecture') return;
    expect(draft.sections).toHaveLength(8);
    const doc = buildLlmResourceDocument('task-8', '八节讲义', 'lecture', pack(EVIDENCE), 'kp', draft);
    expect(doc.blocks.filter((block) => block.type === 'heading' && String(block.content).startsWith('第 '))).toHaveLength(8);
  });
});

describe('buildLlmResourceDocument：块组装与证据绑定', () => {
  it('讲义：lead + 各节 + 误区 + 自测 + 数据表，内容块全部绑定证据', () => {
    const llm = parseLlmResourceDraft('lecture', {
      title: '观察设备数据',
      lead: '导语',
      objectives: ['识别关键字段'],
      sections: [
        { heading: '从一行数据开始', text: 'Air temperature [K] 为 298.1，先用肉眼观察。' },
        { heading: '故障样本', text: '证据中故障样本 33 条。', code: { caption: '读取故障样本', language: 'python', code: 'df[df["Machine failure"] == 1]' } },
      ],
    })!;
    const doc = buildLlmResourceDocument('task-1', '设备数据观察', 'lecture', pack(EVIDENCE), 'industrial-diagnosis-foundation', llm);
    const types = doc.blocks.map((block) => block.type);
    expect(types).not.toContain('evidence');
    expect(doc.evidenceIds).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']));
    expect(types[0]).toBe('paragraph'); // lead
    expect(types).toContain('heading');
    expect(types).toContain('code');
    expect(types).toContain('table'); // representativeTable 由 row 证据生成
    // LLM 已提供 code → 不再附加内置 pandas 示例
    expect(doc.blocks.filter((block) => block.type === 'code')).toHaveLength(1);
    // 除代码/表格外，内容块都绑定证据供 Claim 审核回溯
    for (const block of doc.blocks) {
      if (['code', 'table', 'evidence'].includes(block.type)) continue;
      if (block.type === 'paragraph' && String(block.content).startsWith('flowchart')) continue;
      expect(block.evidenceIds.length).toBeGreaterThan(0);
    }
  });

  it('讲义：术语表会先于正文呈现，作为学习者入口', () => {
    const llm = parseLlmResourceDraft('lecture', {
      title: '从一行记录开始',
      lead: '先从一个小问题开始。',
      objectives: ['读懂字段', '完成观察'],
      glossary: [
        { term: '时间字段', plainMeaning: '记录每次测量发生时间的列，用来把记录按先后顺序排列。', example: '两次读数按时间先后比较。', use: '开始观察前确认它。' },
        { term: '测量值', plainMeaning: '传感器在某个时刻读到的数值，用来描述设备当时的状态。', example: '压力和温度都是测量值。', use: '跟着示例观察变化。' },
        { term: '风险判断', plainMeaning: '根据已有记录指出需要继续核对的方向，不等于已经证明故障。', example: '读数持续偏离时先标为线索。', use: '最后整理复核动作。' },
      ],
      sections: [{ heading: '先看问题', text: '先理解要观察什么。' }, { heading: '再做一步', text: '再按顺序完成观察。' }],
    })!;
    const doc = buildLlmResourceDocument('task-glossary', '设备数据入门', 'lecture', pack(EVIDENCE), 'kp', llm);
    const glossaryHeading = doc.blocks.findIndex((block) => block.type === 'heading' && block.content === '先把几个词说清楚');
    expect(glossaryHeading).toBeGreaterThan(0);
    expect(doc.blocks[glossaryHeading + 1]?.type).toBe('list');
    expect(JSON.stringify(doc.blocks[glossaryHeading + 1]?.content)).toContain('按时间先后比较');
  });

  it('PPT：每页为 heading + 要点列表 + 讲解词段落', () => {
    const llm = parseLlmResourceDraft('presentation', {
      title: '诊断演示',
      slides: [
        { heading: '问题', bullets: ['温度偏高', '扭矩波动'], notes: '这一页说明现象。' },
        { heading: '行动', bullets: ['现场复核'] },
      ],
    })!;
    const doc = buildLlmResourceDocument('task-1', '压缩机诊断', 'presentation', pack(EVIDENCE), 'kp', llm);
    const headings = doc.blocks.filter((block) => block.type === 'heading');
    expect(doc.blocks.some((block) => block.type === 'evidence')).toBe(false);
    expect(headings).toHaveLength(2);
    const lists = doc.blocks.filter((block) => block.type === 'list');
    expect(lists).toHaveLength(2);
    expect(doc.blocks.some((block) => block.type === 'paragraph' && String(block.content).includes('这一页说明现象'))).toBe(true);
  });

  it('PPT模板兜底：门禁退回时仍保留 8 页以上的完整讲解结构', () => {
    const doc = buildResourceDraft('task-fallback', '设备数据时间序列观察', 'presentation', pack(EVIDENCE), 'kp');
    const headings = doc.blocks.filter((block) => block.type === 'heading');
    const slideLists = doc.blocks.filter((block) => block.type === 'list' && Array.isArray(block.content)).slice(1);
    expect(headings.length).toBeGreaterThanOrEqual(8);
    expect(slideLists).toHaveLength(headings.length);
    expect(slideLists.every((block) => (block.content as unknown[]).length >= 3)).toBe(true);
  });

  it('习题：生成 question 块，非法 answerId 回退首个选项', () => {
    const llm = parseLlmResourceDraft('tiered_quiz', {
      title: '分层练习',
      questions: [
        { level: 'L1', prompt: '题干一', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' }], answerId: 'B', explanation: 'B 对' },
        { level: 'L2', prompt: '题干二', options: [{ id: 'A', text: 'a' }, { id: 'B', text: 'b' }, { id: 'C', text: 'c' }, { id: 'D', text: 'd' }], answerId: 'E', explanation: '' },
      ],
    })!;
    const doc = buildLlmResourceDocument('task-1', '证据边界', 'tiered_quiz', pack(EVIDENCE), 'kp', llm);
    const questionBlock = doc.blocks.find((block) => block.type === 'question');
    expect(doc.blocks.some((block) => block.type === 'evidence')).toBe(false);
    expect(questionBlock).toBeDefined();
    const questions = (questionBlock!.content as { questions: Array<{ answerId: string; explanation: string }> }).questions;
    expect(questions).toHaveLength(2);
    expect(questions[1]!.answerId).toBe('A'); // 非法 answerId → 回退第一个选项
    expect(questions[1]!.explanation.length).toBeGreaterThan(0);
  });

  it('知识脉络：mermaid 非法 → 回退确定性模板', () => {
    const llm = { kind: 'concept_map' as const, title: '知识脉络', objectives: [], map: { mermaid: '不是 mermaid 语法', nodes: [] } };
    const doc = buildLlmResourceDocument('task-1', '压缩机诊断', 'concept_map', pack(EVIDENCE), 'kp', llm);
    expect(doc.blocks.some((block) => block.type === 'evidence')).toBe(false);
    // 模板兜底：包含 flowchart 段落与 checklist
    expect(doc.blocks.some((block) => block.type === 'paragraph' && String(block.content).startsWith('flowchart'))).toBe(true);
  });

  it('知识脉络：合法 mermaid + 节点解读 + 阅读路径', () => {
    const llm = {
      kind: 'concept_map' as const,
      title: '证据到判断',
      objectives: ['建立知识关系'],
      map: {
        mermaid: 'flowchart TD\n  A[传感器证据] --> B[风险判断]\n  B --> C[现场复核]',
        nodes: [{ label: '传感器证据', explanation: '来自 AI4I 与 MetroPT-3 的字段观察。' }],
        readingPaths: [{ title: '入门阅读线', steps: ['传感器证据', '风险判断', '现场复核'] }],
      },
    };
    const doc = buildLlmResourceDocument('task-1', '压缩机诊断', 'concept_map', pack(EVIDENCE), 'kp', llm);
    expect(doc.blocks[1]?.type).toBe('paragraph');
    expect(String(doc.blocks[1]?.content)).toMatch(/^flowchart TD/);
    expect(doc.blocks.some((block) => String(block.content).includes('**传感器证据**'))).toBe(true);
    expect(doc.blocks.some((block) => block.type === 'heading' && String(block.content).includes('入门阅读线'))).toBe(true);
  });
});

describe('buildResourceDraft：长内容与数据集跟随', () => {
  it('讲义模板兜底仍然是可学习的长内容，而不是几块短占位符', () => {
    const doc = buildResourceDraft('task-long-lecture', '空压机数据清洗与时间字段处理', 'lecture', METRO_PACK, 'kp');
    const headings = doc.blocks.filter((block) => block.type === 'heading');
    const textChars = doc.blocks.reduce((total, block) => {
      if (typeof block.content === 'string') return total + block.content.length;
      if (Array.isArray(block.content)) return total + block.content.map(String).join('').length;
      return total;
    }, 0);
    expect(headings.length).toBeGreaterThanOrEqual(6);
    expect(textChars).toBeGreaterThan(1500);
  });

  it('讲义代码示例跟随当前 MetroPT-3 证据，不再固定套用 AI4I 故障字段', () => {
    const doc = buildResourceDraft('task-metro-code', '空压机传感器时间序列分析', 'lecture', METRO_PACK, 'kp');
    const code = String(doc.blocks.find((block) => block.type === 'code')?.content && (doc.blocks.find((block) => block.type === 'code')!.content as { code: string }).code);
    expect(code).toContain('MetroPT3(AirCompressor).csv');
    expect(code).toContain('timestamp');
    expect(code).toContain('motorCurrent');
    expect(code).not.toContain('Machine failure');
    expect(code).not.toContain('Air temperature [K]');
  });

  it('混合数据集时优先当前命中的行，通用 pandas 词不能把空压机切成 AI4I', () => {
    const aiRow = { ...EVIDENCE[2]!, id: 'ai4i-row-mixed' };
    const mixedPack = {
      ...pack([aiRow, METRO_MATCHED_ROW]),
      query: '请用 pandas 整理空压机的时间字段',
    };
    const doc = buildResourceDraft('task-mixed-dataset', mixedPack.query, 'lecture', mixedPack, 'kp');
    const table = doc.blocks.find((block) => block.type === 'table')?.content as { columns: string[]; evidenceIds: string[] } | undefined;
    expect(table?.columns).toContain('timestamp');
    expect(table?.columns).not.toContain('Machine failure');
    expect(table?.evidenceIds).toEqual(['metro-matched-row-1']);
    const code = String((doc.blocks.find((block) => block.type === 'code')?.content as { code?: string } | undefined)?.code ?? '');
    expect(code).toContain('MetroPT3(AirCompressor).csv');
    expect(code).toContain("timestamp");
    expect(code).not.toContain('Machine failure');
  });

  it('知识脉络模板兜底包含可读的关系图、节点解释和两条阅读路径', () => {
    const doc = buildResourceDraft('task-long-map', '空压机传感器证据到风险判断', 'concept_map', METRO_PACK, 'kp');
    const mermaid = String(doc.blocks.find((block) => block.type === 'paragraph' && String(block.content).startsWith('flowchart'))?.content ?? '');
    expect((mermaid.match(/\[/g) ?? []).length).toBeGreaterThanOrEqual(10);
    expect(doc.blocks.filter((block) => block.type === 'heading').length).toBeGreaterThanOrEqual(3);
    expect(doc.blocks.some((block) => String(block.content).includes('阅读路径：从证据到行动'))).toBe(true);
    expect(doc.blocks.some((block) => String(block.content).includes('dvPressure'))).toBe(true);
  });

  it('知识脉络会把节点小检查放在节点解释后', () => {
    const llm = parseLlmResourceDraft('concept_map', {
      title: '带检查的知识脉络',
      objectives: ['看懂关系'],
      map: {
        mermaid: 'flowchart TD\nA-->B\nB-->C',
        nodes: [{ label: '问题', explanation: '先从一个真实问题开始，观察现象并决定下一步动作。', checkQuestion: '你现在要先确认什么？' }],
      },
    })!;
    const doc = buildLlmResourceDocument('task-map-check', '知识脉络', 'concept_map', METRO_PACK, 'kp', llm);
    expect(doc.blocks.some((block) => String(block.content).includes('小检查：你现在要先确认什么？'))).toBe(true);
  });
});

describe('生成 → 审核门禁联动', () => {
  it('数字与证据一致 → 无 unsupported/review，可过门禁', () => {
    const llm = parseLlmResourceDraft('lecture', {
      title: '观察设备数据',
      objectives: ['识别字段'],
      sections: [
        { heading: '字段观察', text: 'Torque [Nm] 为 52.3，处于正常范围。' },
        { heading: '故障占比', text: '证据中故障样本 33 条，失败率约 0.33%。' },
      ],
    })!;
    const doc = buildLlmResourceDocument('task-1', '设备数据观察', 'lecture', pack(EVIDENCE), 'kp', llm);
    const result = auditResource(doc, pack(EVIDENCE));
    const auditable = result.claims.filter((claim) => claim.claimType !== 'non_factual');
    expect(auditable.length).toBeGreaterThan(0);
    expect(auditable.every((claim) => claim.verdict === 'supported')).toBe(true);
  });

  it('正文引用证据外的数字 → 数值核验降级，门禁能抓住', () => {
    const llm = parseLlmResourceDraft('lecture', {
      title: '观察设备数据',
      objectives: ['识别字段'],
      sections: [
        { heading: '字段观察', text: 'Torque [Nm] 为 999.9，远超正常值。' },
        { heading: '故障占比', text: '证据显示故障样本 33 条。' },
      ],
    })!;
    const doc = buildLlmResourceDocument('task-1', '设备数据观察', 'lecture', pack(EVIDENCE), 'kp', llm);
    const result = auditResource(doc, pack(EVIDENCE));
    expect(result.summary.status).not.toBe('corroborated');
    expect(result.claims.some((claim) => claim.verdict !== 'supported')).toBe(true);
  });

  it('模板兜底（quiz）仍产出可判分的三层三题型题目', () => {
    const doc = buildResourceDraft('task-1', '证据边界', 'tiered_quiz', pack(EVIDENCE), 'kp');
    const questionBlock = doc.blocks.find((block) => block.type === 'question');
    const questions = (questionBlock!.content as { questions: Array<{ level: string; type: string }> }).questions;
    expect(questions).toHaveLength(9);
    expect(questions.map((question) => question.level)).toEqual(['L1', 'L1', 'L1', 'L2', 'L2', 'L2', 'L3', 'L3', 'L3']);
    for (const level of ['L1', 'L2', 'L3']) {
      const levelQuestions = questions.filter((question) => question.level === level);
      expect(levelQuestions.map((question) => question.type).sort()).toEqual(['blank', 'choice', 'short_answer']);
    }
  });

  it('四类模板资源都只保留证据关联，不把原始证据卡拼进学习正文', () => {
    for (const type of ['lecture', 'presentation', 'tiered_quiz', 'concept_map'] as const) {
      const doc = buildResourceDraft(`task-${type}`, '设备数据观察', type, pack(EVIDENCE), 'kp');
      expect(doc.evidenceIds).toEqual(expect.arrayContaining(['e1', 'e2', 'e3']));
      expect(doc.blocks.some((block) => block.type === 'evidence')).toBe(false);
    }
  });

  it('判分：填空多候选规范化匹配，简答按自评', async () => {
    const { judgeQuizAnswer } = await import('./quiz.js');
    const blank: QuizQuestion = { id: 'q', type: 'blank', level: 'L1', prompt: 'p', answerId: '风险|风险判断', explanation: '', evidenceIds: [] };
    expect(judgeQuizAnswer(blank, ' 风险判断 ')).toBe(true);
    expect(judgeQuizAnswer(blank, '故障')).toBe(false);
    const short: QuizQuestion = { id: 'q2', type: 'short_answer', level: 'L2', prompt: 'p', answerId: '要点', explanation: '', evidenceIds: [] };
    expect(judgeQuizAnswer(short, '我的回答', { selfAssessed: true })).toBe(true);
    expect(judgeQuizAnswer(short, '我的回答', { selfAssessed: false })).toBe(false);
    const choice: QuizQuestion = { id: 'q3', level: 'L1', prompt: 'p', options: [{ id: 'A', text: 'a' }], answerId: 'A', explanation: '', evidenceIds: [] };
    expect(judgeQuizAnswer(choice, 'A')).toBe(true);
  });

  it('资源阅读解析保留填空与简答题，提交时可按题目 ID 找到它们', () => {
    const asset = buildResourceDraft('task-quiz-types', '证据边界', 'tiered_quiz', pack(EVIDENCE), 'kp');
    const questions = extractQuizQuestions(asset);
    expect(questions).toHaveLength(9);
    expect(questions.map((question) => question.type)).toEqual([
      'choice', 'short_answer', 'blank', 'choice', 'blank', 'short_answer', 'choice', 'blank', 'short_answer',
    ]);
  });
});
