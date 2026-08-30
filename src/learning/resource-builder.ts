import { randomUUID } from 'node:crypto';
import { normalizeKnowledgePointId } from './store.js';
import type { EvidenceItem, EvidencePack, LearningResourceType, QuizQuestion, ResourceBlock, ResourceDocument } from './types.js';
import type { DifficultyCalibration } from './difficulty.js';

/** 组装选项：难度校准由调用方按学习者状态计算（总规 §7.2），替换历史硬编码 0.42 */
export interface ResourceBuildOptions {
  calibration?: DifficultyCalibration;
}

function applyDifficulty(resource: ResourceDocument, calibration?: DifficultyCalibration): ResourceDocument {
  resource.difficulty = calibration ? Number(calibration.targetDifficulty.toFixed(3)) : 0.5;
  if (calibration) resource.difficultyCalibration = calibration;
  return resource;
}

function evidenceBlocks(pack: EvidencePack, knowledgePointId: string): ResourceBlock[] {
  // 结构化数据证据已由「数据摘录」表格呈现，原始 JSON 摘要对学习者是噪音；只保留领域文档说明卡
  return pack.items
    .filter((item) => item.sourceType !== 'dataset')
    .slice(0, 4)
    .map((item, index) => ({
      id: `resource-block-${randomUUID()}`,
      type: 'evidence' as const,
      position: index + 2,
      content: {
        label: '领域说明',
        locator: item.locator,
        summary: item.content,
      },
      knowledgePointIds: [knowledgePointId],
      evidenceIds: [item.id],
    }));
}

const isRowEvidence = (item: EvidenceItem): boolean => item.sourceType === 'dataset'
  && (item.metadata?.['queryKind'] === 'recent_rows' || item.metadata?.['queryKind'] === 'dataset_row');

// 按查询主题优先选择对应数据集，让讲义里的代码示例与数据摘录保持一致。
const DATASET_HINTS: Array<[string, RegExp]> = [
  ['ai4i-2020', /pandas|python|csv|代码|编程|预测性维护|扭矩|转速|刀具|质量等级|machine\s*failure/i],
  ['metropt-3', /压缩机|compressor|泄漏|leak|压力|pressure|油温|oil|时序|传感器|干燥塔/i],
];

// 从结构化证据里挑代表性数据行，生成讲义中的“数据摘录”表格：主标签列在前，其次时间列，再是普通字段。
function representativeTable(pack: EvidencePack): { caption: string; columns: string[]; rows: Array<Array<string | number | null>>; sources: string[]; evidenceIds: string[] } | null {
  const allRowItems = pack.items.filter(isRowEvidence);
  let rowItems = allRowItems.slice(0, 3);
  for (const [datasetId, hint] of DATASET_HINTS) {
    if (!hint.test(pack.query)) continue;
    const preferred = allRowItems.filter((item) => item.sourceId === datasetId);
    if (preferred.length > 0) rowItems = preferred.slice(0, 3);
    break;
  }
  const evidenceIds = rowItems.map((item) => item.id);
  const parsed = rowItems.flatMap((item) => {
    try { return [JSON.parse(item.content) as Record<string, unknown>]; } catch { return []; }
  });
  if (parsed.length === 0) return null;
  const firstRecord = parsed[0];
  if (!firstRecord) return null;
  const keys = Object.keys(firstRecord);
  const labelKeys = keys.filter((key) => /failure|fault|异常|故障/i.test(key));
  const isTime = (key: string) => /timestamp|time|时间/i.test(key);
  const isIdLike = (key: string) => /^(udi|rowid|id|product id)$/i.test(key);
  const isLabel = (key: string) => labelKeys.includes(key);
  const ordered = [
    ...keys.filter((key) => isLabel(key) && key === labelKeys[0]),
    ...keys.filter(isTime),
    ...keys.filter((key) => !isLabel(key) && !isTime(key) && !isIdLike(key)),
    ...keys.filter(isIdLike),
    ...keys.filter((key) => isLabel(key) && key !== labelKeys[0]),
  ];
  const columns = Array.from(new Set(ordered)).slice(0, 7);
  const rows = parsed.map((record) => columns.map((column) => {
    const value = record[column];
    if (typeof value === 'string' && value.length > 22) return `${value.slice(0, 21)}…`;
    return (value ?? null) as string | number | null;
  }));
  return {
    caption: '代表性数据摘录：来自结构化数据集查询，可回溯到具体行',
    columns,
    rows,
    sources: Array.from(new Set(rowItems.map((item) => item.locator))),
    evidenceIds,
  };
}

export function buildResourceDraft(
  taskId: string,
  query: string,
  type: LearningResourceType,
  pack: EvidencePack,
  knowledgePointId = 'compressor-diagnosis-evidence',
  options: ResourceBuildOptions = {},
): ResourceDocument {
  const isLecture = type === 'lecture';
  const isPresentation = type === 'presentation';
  const title = isLecture
    ? `压缩机诊断讲义：${query}`
    : isPresentation
    ? `诊断训练 PPT：${query}`
    : type === 'tiered_quiz'
    ? `分层练习：${query}`
    : `知识脉络：${query}`;
  const knowledgePoint = normalizeKnowledgePointId(knowledgePointId) || 'compressor-diagnosis-evidence';
  const opening: ResourceBlock = {
    id: `resource-block-${randomUUID()}`,
    type: 'paragraph',
    position: 0,
    content: isLecture
      ? '本资源只使用当前 EvidencePack 中的结构化数据和领域说明。传感器异常用于支持风险判断，不直接等同于确定故障。'
      : isPresentation
      ? '这份 PPT 按“问题、证据、判断、行动”组织，每页只表达一个可回溯的学习要点。'
      : type === 'tiered_quiz'
      ? '练习按基础理解、证据判断和迁移应用分层。先独立作答，再查看提示和证据定位。'
      : '下面的 Mermaid 图把学习目标、数据证据、风险判断和现场复核串成一条可追溯关系。',
    knowledgePointIds: [knowledgePoint],
    evidenceIds: pack.items.map((item) => item.id),
  };
  const taskBlock: ResourceBlock = {
    id: `resource-block-${randomUUID()}`,
    type: isLecture || isPresentation || type === 'tiered_quiz' ? 'list' : 'checklist',
    position: 1,
    content: isLecture
      ? ['识别时间序列中的关键观测字段', '区分数据证据、风险判断和维护动作', '保留故障结论的不确定性边界']
      : isPresentation
      ? ['第 1 页：学习目标与问题边界', '第 2 页：关键证据与数据摘录', '第 3 页：风险判断与不确定性', '第 4 页：复核行动与练习']
      : type === 'tiered_quiz'
      ? ['L1 基础：解释一个观测字段的作用', 'L2 判断：根据证据说明风险而非直接下结论', 'L3 迁移：提出复核动作并说明不确定性']
      : ['目标：理解压缩机诊断证据', '证据：传感器与状态记录', '判断：风险与不确定性', '行动：现场复核与维护训练'],
    knowledgePointIds: [knowledgePoint],
    evidenceIds: pack.items.map((item) => item.id),
  };

  const extraBlocks: ResourceBlock[] = [];
  if (type === 'tiered_quiz') {
    const evidenceIds = pack.items.slice(0, 3).map((item) => item.id);
    const q = (
      id: string,
      type: 'choice' | 'blank' | 'short_answer',
      level: 'L1' | 'L2' | 'L3',
      prompt: string,
      rest: Partial<Pick<QuizQuestion, 'options' | 'answerId'>>,
      explanation: string,
    ): QuizQuestion => ({
      id, type, level, prompt,
      options: rest.options,
      answerId: rest.answerId ?? '',
      explanation,
      evidenceIds,
    });
    const questions: QuizQuestion[] = [
      q('tpl-l1-choice-1', 'choice', 'L1', '当传感器读数出现异常时，下列哪种表述最符合设备诊断训练的证据边界？', {
        options: [
          { id: 'A', text: '异常读数已经证明设备发生了确定故障。' },
          { id: 'B', text: '异常读数提示风险，需要结合更多证据或现场复核。' },
          { id: 'C', text: '只要存在数据，就不需要说明不确定性。' },
          { id: 'D', text: '删除异常记录后再做判断。' },
        ],
        answerId: 'B',
      }, '传感器数据能够支持风险判断，但不能直接替代现场确认或多源证据核验。'),
      q('tpl-l1-short-1', 'short_answer', 'L1', '用你自己的话说一说：在设备诊断中，什么是"数据证据"？它的作用边界在哪里？', {
        answerId: '数据证据是从设备传感器、运行记录中直接读到的观测事实（字段、数值、时间窗口）；它的作用边界是支持风险判断和定位异常，不能单独作为确定故障的结论，最终判断需要多源证据和现场复核。',
      }, '要点：数据证据 = 可回溯的观测事实；边界 = 支持风险判断，不等于确定故障。'),
      q('tpl-l1-blank-1', 'blank', 'L1', '数据异常只能支持____判断，不能直接等同于确定故障。', {
        answerId: '风险|风险判断',
      }, '证据的边界：数据异常提示的是风险（风险判断），确定故障需要多源证据与现场复核。'),
      q('tpl-l2-choice-1', 'choice', 'L2', '为了降低单一数据窗口带来的误判，下列哪一步最合适？', {
        options: [
          { id: 'A', text: '把风险判断写成确定结论。' },
          { id: 'B', text: '忽略时间窗口，只保留一条读数。' },
          { id: 'C', text: '补充相邻时间段、字段关系或现场复核信息。' },
          { id: 'D', text: '只根据经验选择一个故障标签。' },
        ],
        answerId: 'C',
      }, '诊断需要通过相邻工况、字段关系或现场信息交叉核验，明确仍未确认的边界。'),
      q('tpl-l2-blank-1', 'blank', 'L2', '要判断某传感器读数是否异常，除了和阈值比较，还应观察它与哪些字段的____关系（如温度升高时电流是否同步变化）。', {
        answerId: '相关|关联|变化|联动',
      }, '单一阈值容易误判，字段间的相关/联动关系是交叉验证异常的重要手段。'),
      q('tpl-l2-short-1', 'short_answer', 'L2', '假设你在某时间窗口观察到油温持续升高。请说明：你会先核对哪些证据，再判断是否存在风险？', {
        answerId: '先核对油温字段含义与单位；查看相邻时间窗口的走势而非单点；检查与油温相关的字段（如电流、压力）是否同步变化；对照历史正常区间给出偏离幅度；最后保留不确定性，给出"需现场复核"的风险结论。',
      }, '要点：字段含义与单位 → 时间窗口走势 → 关联字段交叉 → 偏离幅度 → 保留不确定性边界。'),
      q('tpl-l3-choice-1', 'choice', 'L3', '提交一个可追溯的设备风险结论时，最少应保留什么？', {
        options: [
          { id: 'A', text: '风险判断、对应依据和后续复核动作。' },
          { id: 'B', text: '一个没有来源的故障名称。' },
          { id: 'C', text: '只写"建议维修"。' },
          { id: 'D', text: '只保留最终答案，删除过程。' },
        ],
        answerId: 'A',
      }, '可追溯结论必须让学习者和审核者看到判断依据、结论边界及可执行的下一步。'),
      q('tpl-l3-blank-1', 'blank', 'L3', '把"数据异常"直接写成"设备一定发生故障"违反了____边界（提示：因果表述超出证据支持范围）。', {
        answerId: '因果|因果表述|证据|证据边界',
      }, '数据异常与故障之间是相关性而非确定性因果，绝对化因果表述超出证据支持边界。'),
      q('tpl-l3-short-1', 'short_answer', 'L3', '如果让你为团队写一份"数据异常复核流程"，你会包含哪几个步骤？每个步骤的产出是什么？', {
        answerId: '① 异常登记：记录字段、时间窗口与数值；② 证据核对：字段含义、单位、相邻窗口走势与关联字段；③ 交叉验证：与历史区间、其他传感器或运行记录比对；④ 风险分级：给出偏离幅度与影响范围，保留不确定性；⑤ 复核行动：明确现场检查项与责任人。产出依次是异常清单、证据记录、比对结论、风险分级与复核工单。',
      }, '要点：登记 → 证据核对 → 交叉验证 → 风险分级 → 复核行动，每步有明确产出且保留不确定性。'),
    ];
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'question',
      position: 2,
      content: {
        questions,
      },
      knowledgePointIds: [knowledgePoint],
      evidenceIds: pack.items.map((item) => item.id),
    });
  }
  if (type === 'concept_map') {
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'paragraph',
      position: 2,
      content: `flowchart TD\n  A[学习目标：${escapeMermaid(query)}] --> B[传感器与状态证据]\n  B --> C[风险判断]\n  C --> D[现场复核]\n  D --> E[维护动作]\n  C --> F[保留不确定性]`,
      knowledgePointIds: [knowledgePoint],
      evidenceIds: pack.items.map((item) => item.id),
    });
  }
  if (isPresentation) {
    const slides = [
      ['学习目标', `围绕“${query}”建立可追溯的诊断判断框架。`],
      ['关键证据', '先观察数据和字段关系，再区分已知事实与尚待验证的风险。'],
      ['判断边界', '异常信号提示风险，不直接等同于确定故障；需要交叉核验或现场复核。'],
      ['下一步', '完成一组分层习题，并把不确定点带回学习路径继续补强。'],
    ];
    slides.forEach(([heading, text], index) => {
      extraBlocks.push({ id: `resource-block-${randomUUID()}`, type: 'heading', position: 2 + index * 2, content: heading, knowledgePointIds: [knowledgePoint], evidenceIds: pack.items.map((item) => item.id) });
      extraBlocks.push({ id: `resource-block-${randomUUID()}`, type: 'paragraph', position: 3 + index * 2, content: text, knowledgePointIds: [knowledgePoint], evidenceIds: pack.items.map((item) => item.id) });
    });
  }

  const analysisCodeBlock: ResourceBlock = {
    id: `resource-block-${randomUUID()}`,
    type: 'code',
    position: 0,
    content: {
      language: 'python',
      caption: '分析入门：用 pandas 观察设备数据',
      code: [
        'import pandas as pd',
        '',
        'df = pd.read_csv("ai4i_2020.csv")',
        'print(df.shape)                              # 行数与列数',
        'print(df.head())                             # 先看几行长什么样',
        'print(df["Machine failure"].value_counts())  # 故障样本有多少',
        '',
        'failed = df[df["Machine failure"] == 1]',
        'print(failed[["Air temperature [K]", "Torque [Nm]", "Tool wear [min]"]].describe())',
      ].join('\n'),
    },
    knowledgePointIds: [knowledgePoint],
    evidenceIds: [],
  };
  const table = representativeTable(pack);
  const tableBlock: ResourceBlock | null = table ? {
    id: `resource-block-${randomUUID()}`,
    type: 'table',
    position: 0,
    content: table,
    knowledgePointIds: [knowledgePoint],
    evidenceIds: table.evidenceIds,
  } : null;
  const blocks = [
    opening,
    taskBlock,
    ...extraBlocks,
    ...(isLecture ? [analysisCodeBlock] : []),
    ...(tableBlock ? [tableBlock] : []),
    ...evidenceBlocks(pack, knowledgePoint),
  ];

  return applyDifficulty({
    id: `resource-${randomUUID()}`,
    taskId,
    type,
    title,
    difficulty: 0.5,
    learningObjectives: isLecture
      ? ['理解压缩机传感器证据的作用', '建立数据到运维判断的边界']
      : isPresentation
      ? ['用四页讲清诊断问题、证据、判断与行动', '保留每个结论的依据和边界']
      : type === 'tiered_quiz'
      ? ['分层检验证据理解', '根据作答结果定位下一步训练']
      : ['建立从数据证据到诊断行动的知识关系'],
    knowledgePointIds: [knowledgePoint],
    blocks: blocks.map((block, index) => ({ ...block, position: index })),
    evidenceIds: pack.items.map((item) => item.id),
    auditStatus: pack.items.length > 0 ? 'passed' : 'revise',
    createdAt: Date.now(),
  }, options.calibration);
}

/* ----------------------------- LLM 结构化草稿（四种资源） ----------------------------- */

/** 讲义小节：Markdown 正文 + 可选代码示例与记忆点 */
export interface LlmLectureSection {
  heading: string;
  text: string;
  code?: { caption?: string; language?: string; code: string };
  keyPoints?: string[];
}

/** PPT 单页：页标题 + 要点 + 讲解词 */
export interface LlmPresentationSlide {
  heading: string;
  bullets: string[];
  notes?: string;
}

/** 习题单题：分层三题型（选择/填空/简答） */
export interface LlmQuizQuestion {
  type: 'choice' | 'blank' | 'short_answer';
  level: 'L1' | 'L2' | 'L3';
  prompt: string;
  options: Array<{ id: string; text: string }>;
  answerId: string;
  explanation: string;
}

/** 知识脉络：Mermaid 图 + 节点解释 + 阅读路径 */
export interface LlmConceptMapDraft {
  mermaid: string;
  nodes: Array<{ label: string; explanation: string }>;
  readingPaths?: Array<{ title: string; steps: string[] }>;
}

/** 四种资源的 LLM 草稿（按 type 判别） */
export type LlmResourceDraft =
  | { kind: 'lecture'; title: string; lead?: string; objectives: string[]; sections: LlmLectureSection[]; misconceptions?: Array<{ wrong: string; correct: string }>; reviewQuestions?: string[] }
  | { kind: 'presentation'; title: string; lead?: string; objectives: string[]; slides: LlmPresentationSlide[] }
  | { kind: 'tiered_quiz'; title: string; lead?: string; objectives: string[]; questions: LlmQuizQuestion[] }
  | { kind: 'concept_map'; title: string; lead?: string; objectives: string[]; map: LlmConceptMapDraft };

function asStringArray(value: unknown, limit: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, limit)
    : [];
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * 解析资源生成的 LLM 原始输出为按类型判别的草稿。
 * 结构不满足该类型的最低要求时返回 null，调用方回退确定性模板。
 */
export function parseLlmResourceDraft(type: LearningResourceType, raw: unknown): LlmResourceDraft | null {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const title = asString(source['title']);
  const lead = asString(source['lead']);
  const objectives = asStringArray(source['objectives'], 4);
  const base = { title, lead: lead || undefined, objectives };
  if (type === 'lecture') {
    const sections = Array.isArray(source['sections']) ? source['sections'].flatMap((item) => {
      const section = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const heading = asString(section['heading']);
      const text = asString(section['text']);
      if (!heading || !text) return [];
      const codeRaw = section['code'] && typeof section['code'] === 'object' ? section['code'] as Record<string, unknown> : null;
      return [{
        heading,
        text,
        code: codeRaw && asString(codeRaw['code']) ? { caption: asString(codeRaw['caption']) || undefined, language: asString(codeRaw['language']) || undefined, code: asString(codeRaw['code']) } : undefined,
        keyPoints: asStringArray(section['keyPoints'], 4).length > 0 ? asStringArray(section['keyPoints'], 4) : undefined,
      }];
    }).slice(0, 6) : [];
    if (!title || sections.length < 2) return null;
    const misconceptions = Array.isArray(source['misconceptions']) ? source['misconceptions'].flatMap((item) => {
      const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const wrong = asString(entry['wrong']);
      const correct = asString(entry['correct']);
      return wrong && correct ? [{ wrong, correct }] : [];
    }).slice(0, 3) : [];
    const reviewQuestions = asStringArray(source['reviewQuestions'], 3);
    return {
      kind: 'lecture', ...base,
      sections,
      misconceptions: misconceptions.length > 0 ? misconceptions : undefined,
      reviewQuestions: reviewQuestions.length > 0 ? reviewQuestions : undefined,
    };
  }
  if (type === 'presentation') {
    const slides = Array.isArray(source['slides']) ? source['slides'].flatMap((item) => {
      const slide = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const heading = asString(slide['heading']);
      const bullets = asStringArray(slide['bullets'], 6);
      const notes = asString(slide['notes']);
      if (!heading || bullets.length === 0) return [];
      return [{ heading, bullets, notes: notes || undefined }];
    }).slice(0, 10) : [];
    if (!title || slides.length < 2) return null;
    return { kind: 'presentation', ...base, slides };
  }
  if (type === 'tiered_quiz') {
    const questions = Array.isArray(source['questions']) ? source['questions'].flatMap((item) => {
      const question = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const level = asString(question['level']);
      const prompt = asString(question['prompt']);
      const rawType = asString(question['type']);
      const questionType: LlmQuizQuestion['type'] = ['choice', 'blank', 'short_answer'].includes(rawType)
        ? rawType as LlmQuizQuestion['type']
        : 'choice';
      const options = Array.isArray(question['options']) ? question['options'].flatMap((option) => {
        const entry = option && typeof option === 'object' ? option as Record<string, unknown> : {};
        const id = asString(entry['id']);
        const text = asString(entry['text']);
        return id && text ? [{ id, text }] : [];
      }) : [];
      if (!['L1', 'L2', 'L3'].includes(level) || !prompt) return [];
      // choice 需要 3 个以上选项；填空与简答需要参考答案
      if (questionType === 'choice' && options.length < 3) return [];
      if (questionType !== 'choice' && !asString(question['answer'])) return [];
      return [{
        type: questionType,
        level: level as 'L1' | 'L2' | 'L3',
        prompt,
        options,
        answerId: questionType === 'choice' ? asString(question['answerId']) : asString(question['answer']),
        explanation: asString(question['explanation']),
      }];
    }).slice(0, 12) : [];
    if (!title || questions.length < 2) return null;
    return { kind: 'tiered_quiz', ...base, questions };
  }
  const mapRaw = source['map'] && typeof source['map'] === 'object' ? source['map'] as Record<string, unknown> : source;
  const mermaid = asString(mapRaw['mermaid']);
  const nodes = Array.isArray(mapRaw['nodes']) ? mapRaw['nodes'].flatMap((item) => {
    const node = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const label = asString(node['label']);
    const explanation = asString(node['explanation']);
    return label && explanation ? [{ label, explanation }] : [];
  }).slice(0, 14) : [];
  const readingPaths = Array.isArray(mapRaw['readingPaths']) ? mapRaw['readingPaths'].flatMap((item) => {
    const path = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    const pathTitle = asString(path['title']);
    const steps = asStringArray(path['steps'], 10);
    return pathTitle && steps.length >= 2 ? [{ title: pathTitle, steps }] : [];
  }).slice(0, 3) : [];
  if (!title || !mermaid) return null;
  return {
    kind: 'concept_map', ...base,
    map: { mermaid, nodes, readingPaths: readingPaths.length > 0 ? readingPaths : undefined },
  };
}

function pushHeading(blocks: ResourceBlock[], content: string, evidenceIds: string[], knowledgePoint: string): void {
  blocks.push({
    id: `resource-block-${randomUUID()}`,
    type: 'heading',
    position: 0,
    content: content.trim().slice(0, 60),
    knowledgePointIds: [knowledgePoint],
    evidenceIds,
  });
}

function pushParagraph(blocks: ResourceBlock[], content: string, evidenceIds: string[], knowledgePoint: string): void {
  blocks.push({
    id: `resource-block-${randomUUID()}`,
    type: 'paragraph',
    position: 0,
    content: content.trim().slice(0, 6_000),
    knowledgePointIds: [knowledgePoint],
    evidenceIds,
  });
}

function pushList(blocks: ResourceBlock[], content: string[], evidenceIds: string[], knowledgePoint: string): void {
  blocks.push({
    id: `resource-block-${randomUUID()}`,
    type: 'list',
    position: 0,
    content: content.map((item) => item.trim().slice(0, 300)).filter(Boolean).slice(0, 8),
    knowledgePointIds: [knowledgePoint],
    evidenceIds,
  });
}

function pushCode(blocks: ResourceBlock[], code: { caption?: string; language?: string; code: string }, knowledgePoint: string): void {
  blocks.push({
    id: `resource-block-${randomUUID()}`,
    type: 'code',
    position: 0,
    content: {
      language: (code.language ?? 'python').trim().slice(0, 24) || 'python',
      caption: (code.caption ?? '代码示例').trim().slice(0, 60),
      code: code.code.replace(/\t/g, '  ').slice(0, 3_600),
    },
    knowledgePointIds: [knowledgePoint],
    evidenceIds: [],
  });
}

/** Mermaid 语法最小校验与清洗：首行必须声明图类型；节点/边标签内的半角符号会破坏解析，统一替换为空格 */
function sanitizeMermaid(source: string): string | null {
  const text = source.trim().replace(/\r/g, '');
  if (!/^(flowchart|graph)\s+(TD|TB|LR|RL)/i.test(text)) return null;
  const lines = text.split('\n').map((line) => line.trim()).filter(Boolean);
  if (lines.length < 3) return null;
  // 清洗方括号/花括号/圆括号标签与 |边标签| 内的半角危险字符（引号、尖括号、冒号、分号等）
  const cleaned = lines.map((line) => line
    .replace(/\[([^\]\n]*)\]/g, (_, label: string) => `[${sanitizeMermaidLabel(label)}]`)
    .replace(/\{([^\}\n]*)\}/g, (_, label: string) => `{${sanitizeMermaidLabel(label)}}`)
    .replace(/\(([^)\n]*)\)/g, (_, label: string) => `(${sanitizeMermaidLabel(label)})`)
    .replace(/\|([^|\n]*)\|/g, (_, label: string) => `|${sanitizeMermaidLabel(label)}|`)
    .replace(/<\/?[a-zA-Z][^>]*>/g, '')
    .replace(/["'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  ).filter(Boolean).join('\n');
  if (!/^(flowchart|graph)\s+(TD|TB|LR|RL)/i.test(cleaned)) return null;
  return cleaned.slice(0, 4_000);
}

function sanitizeMermaidLabel(label: string): string {
  return label
    .replace(/[\]}>:";`'"（）()<>]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || '节点';
}

// LLM 生成正文，结构与证据块（数据摘录表、证据卡）仍由确定性构建器组装。
// 内容块统一绑定全量证据 ID：Claim 审核据此核对数字与字段，未绑定会被判 unsupported 卡死发布门禁。
export function buildLlmResourceDocument(
  taskId: string,
  query: string,
  type: LearningResourceType,
  pack: EvidencePack,
  knowledgePointId: string | undefined,
  llm: LlmResourceDraft,
  options: ResourceBuildOptions = {},
): ResourceDocument {
  const knowledgePoint = normalizeKnowledgePointId(knowledgePointId ?? '') || 'compressor-diagnosis-evidence';
  const evidenceIdList = pack.items.map((item) => item.id);
  const blocks: ResourceBlock[] = [];

  const lead = 'lead' in llm && typeof llm.lead === 'string' ? llm.lead.trim() : '';
  if (lead) {
    pushParagraph(blocks, lead, evidenceIdList, knowledgePoint);
  } else {
    pushParagraph(blocks, '本资源由多智能体依据当前证据包协同生成：学情定位 → 双路检索 → 领域核对 → 逐条 Claim 审核。涉及数据均来自可回溯的证据，未在证据中的数字一律不采用。', evidenceIdList, knowledgePoint);
  }

  let hasLlmCode = false;
  if (llm.kind === 'lecture') {
    for (const section of llm.sections.slice(0, 6)) {
      if (!section.heading?.trim() || !section.text?.trim()) continue;
      pushHeading(blocks, section.heading, evidenceIdList, knowledgePoint);
      pushParagraph(blocks, section.text, evidenceIdList, knowledgePoint);
      if (section.keyPoints && section.keyPoints.length > 0) {
        pushList(blocks, section.keyPoints.map((item) => `**${item}**`), evidenceIdList, knowledgePoint);
      }
      if (section.code?.code?.trim()) {
        hasLlmCode = true;
        pushCode(blocks, section.code, knowledgePoint);
      }
    }
    if (llm.misconceptions && llm.misconceptions.length > 0) {
      pushHeading(blocks, '常见误区', evidenceIdList, knowledgePoint);
      pushList(blocks, llm.misconceptions.map((item) => `**误区**：${item.wrong} → **正确理解**：${item.correct}`), evidenceIdList, knowledgePoint);
    }
    if (llm.reviewQuestions && llm.reviewQuestions.length > 0) {
      pushHeading(blocks, '自测问题', evidenceIdList, knowledgePoint);
      pushList(blocks, llm.reviewQuestions, evidenceIdList, knowledgePoint);
    }
    if (!hasLlmCode) blocks.push(analysisCodeBlock(knowledgePoint));
    const table = representativeTable(pack);
    if (table) {
      blocks.push({
        id: `resource-block-${randomUUID()}`,
        type: 'table',
        position: 0,
        content: table,
        knowledgePointIds: [knowledgePoint],
        evidenceIds: table.evidenceIds,
      });
    }
  } else if (llm.kind === 'presentation') {
    for (const slide of llm.slides.slice(0, 10)) {
      if (!slide.heading?.trim()) continue;
      pushHeading(blocks, slide.heading, evidenceIdList, knowledgePoint);
      const bullets = Array.isArray(slide.bullets) ? slide.bullets : [];
      if (bullets.length > 0) pushList(blocks, bullets, evidenceIdList, knowledgePoint);
      if (slide.notes?.trim()) pushParagraph(blocks, slide.notes, evidenceIdList, knowledgePoint);
    }
  } else if (llm.kind === 'tiered_quiz') {
    const questions: QuizQuestion[] = llm.questions.slice(0, 12).flatMap((question, index): QuizQuestion[] => {
      const options = question.options
        .filter((option) => option.text.trim())
        .map((option, optionIndex) => ({
          id: /^[A-Z]$/.test(option.id) ? option.id : 'ABCD'[optionIndex] ?? 'E',
          text: option.text.trim().slice(0, 200),
        }))
        .slice(0, 4);
      if (question.type === 'choice') {
        const optionIds = new Set(options.map((option) => option.id));
        if (options.length < 3) return [];
        const answerId = optionIds.has(question.answerId) ? question.answerId : options[0]!.id;
        return [{
          id: `quiz-${index + 1}-${question.level}`,
          type: 'choice' as const,
          level: question.level,
          prompt: question.prompt.trim().slice(0, 500),
          options,
          answerId,
          explanation: (question.explanation ?? '').trim().slice(0, 800) || '结合证据核对各选项依据后再确认结论。',
          evidenceIds: evidenceIdList.slice(0, 3),
        }];
      }
      // 填空 / 简答：answerId 字段承载标准答案或参考答案文本，判分与自评由服务端完成
      const answer = question.answerId.trim().slice(0, 400);
      if (!answer) return [];
      return [{
        id: `quiz-${index + 1}-${question.level}`,
        type: question.type,
        level: question.level,
        prompt: question.prompt.trim().slice(0, 500),
        answerId: answer,
        explanation: (question.explanation ?? '').trim().slice(0, 800) || '对照参考答案检查自己是否答出了关键要点。',
        evidenceIds: evidenceIdList.slice(0, 3),
      }];
    });
    if (questions.length >= 2) {
      blocks.push({
        id: `resource-block-${randomUUID()}`,
        type: 'question',
        position: 0,
        content: { questions },
        knowledgePointIds: [knowledgePoint],
        evidenceIds: evidenceIdList,
      });
    } else {
      return buildResourceDraft(taskId, query, type, pack, knowledgePointId, options);
    }
  } else {
    const mermaid = sanitizeMermaid(llm.map.mermaid ?? '');
    if (mermaid) {
      blocks.push({
        id: `resource-block-${randomUUID()}`,
        type: 'paragraph',
        position: 0,
        content: mermaid,
        knowledgePointIds: [knowledgePoint],
        evidenceIds: [],
      });
      if (llm.map.nodes.length > 0) {
        pushHeading(blocks, '关键节点解读', evidenceIdList, knowledgePoint);
        for (const node of llm.map.nodes.slice(0, 14)) {
          if (!node.label?.trim() || !node.explanation?.trim()) continue;
          pushParagraph(blocks, `**${node.label.trim().slice(0, 40)}**：${node.explanation.trim()}`, evidenceIdList, knowledgePoint);
        }
      }
      for (const path of (llm.map.readingPaths ?? []).slice(0, 3)) {
        if (!path.title?.trim() || !Array.isArray(path.steps) || path.steps.length < 2) continue;
        pushHeading(blocks, `阅读路径：${path.title.trim().slice(0, 40)}`, evidenceIdList, knowledgePoint);
        pushList(blocks, path.steps.map((step, index) => `${index + 1}. ${String(step).trim().slice(0, 60)}`), evidenceIdList, knowledgePoint);
      }
    } else {
      return buildResourceDraft(taskId, query, type, pack, knowledgePointId, options);
    }
  }

  blocks.push(...evidenceBlocks(pack, knowledgePoint));
  return applyDifficulty({
    id: `resource-${randomUUID()}`,
    taskId,
    type,
    title: llm.title.trim().slice(0, 80) || `${RESOURCE_TYPE_LABEL[type]}：${query}`,
    difficulty: 0.5,
    learningObjectives: llm.objectives.map((item) => String(item).trim().slice(0, 60)).filter(Boolean).slice(0, 4),
    knowledgePointIds: [knowledgePoint],
    blocks: blocks.map((block, index) => ({ ...block, position: index })),
    evidenceIds: evidenceIdList,
    auditStatus: pack.items.length > 0 ? 'passed' : 'revise',
    createdAt: Date.now(),
  }, options.calibration);
}

const RESOURCE_TYPE_LABEL: Record<LearningResourceType, string> = {
  lecture: '讲义', presentation: 'PPT', tiered_quiz: '分层练习', concept_map: '知识脉络',
};

function analysisCodeBlock(knowledgePoint: string): ResourceBlock {
  return {
    id: `resource-block-${randomUUID()}`,
    type: 'code',
    position: 0,
    content: {
      language: 'python',
      caption: '分析入门：用 pandas 观察设备数据',
      code: [
        'import pandas as pd',
        '',
        'df = pd.read_csv("ai4i_2020.csv")',
        'print(df.shape)                              # 行数与列数',
        'print(df.head())                             # 先看几行长什么样',
        'print(df["Machine failure"].value_counts())  # 故障样本有多少',
        '',
        'failed = df[df["Machine failure"] == 1]',
        'print(failed[["Air temperature [K]", "Torque [Nm]", "Tool wear [min]"]].describe())',
      ].join('\n'),
    },
    knowledgePointIds: [knowledgePoint],
    evidenceIds: [],
  };
}

function escapeMermaid(value: string): string {
  return value.replace(/[\[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '当前学习目标';
}
