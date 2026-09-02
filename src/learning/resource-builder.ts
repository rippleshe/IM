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
  const title = conciseResourceTitle(query, type);
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
      ? ['第 1 页：学习目标', '第 2 页：数据与资料来源', '第 3 页：字段含义', '第 4 页：时间序列观察', '第 5 页：多字段交叉验证', '第 6 页：风险判断边界', '第 7 页：复核与行动', '第 8 页：练习与迁移']
      : type === 'tiered_quiz'
      ? ['L1 基础：解释一个观测字段的作用', 'L2 判断：根据证据说明风险而非直接下结论', 'L3 迁移：提出复核动作并说明不确定性']
      : ['目标：理解压缩机诊断证据', '证据：传感器与状态记录', '判断：风险与不确定性', '行动：现场复核与维护训练'],
    knowledgePointIds: [knowledgePoint],
    evidenceIds: pack.items.map((item) => item.id),
  };

  const extraBlocks: ResourceBlock[] = [];
  if (isLecture) {
    const datasetTitle = pack.items.find((item) => item.sourceType === 'dataset')?.sourceTitle ?? '当前检索数据';
    const table = representativeTable(pack);
    const fields = table?.columns.filter((column) => !/^(rowId|rowid|id|udi)$/i.test(column)).slice(0, 6) ?? [];
    const fieldText = fields.length > 0 ? fields.join('、') : '当前证据中的观测字段';
    const fallbackSections: Array<[string, string, string[]]> = [
      ['先把问题说清楚', `这份材料围绕“${query.trim().slice(0, 100)}”展开。拿到${datasetTitle}的记录后，不要直接跳到异常或故障结论，先确认数据来自什么设备、每列代表什么、时间字段能否排序，以及本次判断到底需要回答哪个问题。对初学者来说，数据清洗不是把所有“奇怪”的值删掉，而是把原始记录变成可解释、可复查的分析输入。每一步都要留下处理前后的依据，后面看到趋势或差异时才能知道它来自数据本身，还是来自清洗操作。`, ['先定义分析问题，再决定清洗动作', '每一步处理都要能说明理由']],
      ['检查字段与数据类型', `当前证据中可观察到的字段包括${fieldText}。先用表格查看列名、缺失情况和数据类型，再确认哪些列是时间、哪些列是连续测量值、哪些列是状态或标识。字段名相似不代表含义相同，尤其是压力、电流和温度等变量，必须结合资料中的字段说明与单位解释。时间列如果仍是字符串，排序结果可能只是字符顺序；数值列如果混入文本，也会让统计结果失真。因此，清洗的第一项产出应是一张字段字典：列名、类型、单位、允许的空值处理方式，以及对应的来源位置。`, ['字段含义和单位先于数值解释', '类型转换要记录成功与失败的行']],
      ['处理缺失与重复记录', '缺失值要先区分“没有采到”“传输中断”和“本来就不适用”，不能看到空白就统一填零。可以先按列统计缺失，再结合时间窗口和相邻字段决定删除、保留并标记，或使用有依据的填补。重复值也要区分完整重复和关键键重复：同一时间点的整行重复可能是重复上报，但同一时间点不同传感器值则可能需要进一步核对。处理前后都应保留计数和样本，避免为了让图表好看而悄悄改变故障信号。', ['缺失值处理必须说明依据', '重复记录要按业务键和整行分别检查']],
      ['解析时间并建立索引', '时间字段是时序分析的骨架。先将可解析的字符串转换为时间类型，对转换失败的值单独列出，不要静默丢弃；随后检查时间是否重复、是否倒序、相邻记录间隔是否稳定，再决定是否设置为索引。只有时间顺序可靠，滚动统计、重采样、区间比较和趋势可视化才有意义。如果采样间隔不稳定，应在分析中明确这一限制，不要把不规则记录直接当成等间隔序列。清洗后的时间索引还要保留原始字段或版本说明，保证别人可以回溯处理过程。', ['先解析再排序，最后设置索引', '转换失败和不规则间隔都要显式记录']],
      ['观察异常并交叉核验', `清洗完成后，围绕${fieldText}观察单点、相邻窗口和整体趋势。一个读数偏离常见范围只能作为线索，不能直接证明设备故障；要同时核对相关字段是否同步变化、来源资料是否支持该解释，以及现场工况是否一致。对于极端值，先排查单位、符号、传感器状态和采集过程，再决定它是应保留的故障信号还是需要复核的数据问题。最终结果应把“观察到的事实”“基于事实的风险判断”和“仍需确认的内容”分开写，避免图表和统计量制造虚假的确定性。`, ['异常是风险线索，不是确定故障', '用多字段和多来源证据减少误判']],
      ['形成可复查的分析结果', '一份合格的清洗结果不仅有一张干净表格，还应包含处理清单、保留与删除规则、关键字段变化、时间窗口和未解决问题。建议把原始数据、清洗后的数据和处理日志分开保存，给每次处理标注主题和来源。复查时，其他人应能从字段说明回到数据行，从数据行回到分析步骤，再从分析结论找到下一步检查动作。这样做的价值不是增加文档负担，而是让模型生成的讲解、学习者的练习和后续的设备判断共享同一套可追溯事实。', ['处理日志是结果的一部分', '结论必须带来源、边界和下一步动作']],
    ];
    for (const [heading, text, keyPoints] of fallbackSections) {
      pushHeading(extraBlocks, heading, pack.items.map((item) => item.id), knowledgePoint);
      pushParagraph(extraBlocks, text, pack.items.map((item) => item.id), knowledgePoint);
      pushList(extraBlocks, keyPoints, pack.items.map((item) => item.id), knowledgePoint);
    }
  }
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
    const table = representativeTable(pack);
    const fields = table?.columns.filter((column) => !/^(rowId|rowid|id|udi)$/i.test(column)).slice(0, 6) ?? [];
    const fieldNodes = fields.length > 0 ? fields : ['时间字段', '压力字段', '电流字段', '温度字段'];
    const fieldLines = fieldNodes.map((field, index) => `  F${index}[${escapeMermaid(field)}] --> G[趋势观察]`).join('\n');
    const fieldExplanations = fieldNodes.map((field) => [field, `先确认${field}在当前数据中的字段含义、单位和来源位置，再观察它在相邻时间窗口中的变化。该字段只能作为证据链中的一个环节，出现偏离时需要结合其他字段与资料交叉核对，不能把单点读数直接写成确定故障。`]);
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'paragraph',
      position: 2,
      content: `flowchart TD\n  A[学习目标 ${escapeMermaid(query)}] --> B[数据来源]\n  B --> C[数据清洗]\n  C --> D[时间顺序]\n${fieldLines}\n  G --> H[多字段核验]\n  H --> I[风险判断]\n  I --> J[现场复核]\n  I --> K[保留边界]\n  J --> L[行动记录]\n  L --> M[学习反馈]`,
      knowledgePointIds: [knowledgePoint],
      evidenceIds: pack.items.map((item) => item.id),
    });
    pushHeading(extraBlocks, '关键节点解读', pack.items.map((item) => item.id), knowledgePoint);
    for (const [label, explanation] of fieldExplanations) pushParagraph(extraBlocks, `**${label}**：${explanation}`, pack.items.map((item) => item.id), knowledgePoint);
    pushParagraph(extraBlocks, '**风险判断**：把已观察到的事实、证据支持的风险方向和仍需复核的部分分开记录。知识脉络的作用是帮助你按顺序推进分析，而不是替代现场确认。', pack.items.map((item) => item.id), knowledgePoint);
    pushParagraph(extraBlocks, '**现场复核**：根据证据缺口列出要补看的时间窗口、相关字段、设备状态或资料条目，并为每项复核写明预期确认的现象。', pack.items.map((item) => item.id), knowledgePoint);
    pushHeading(extraBlocks, '阅读路径：从证据到行动', pack.items.map((item) => item.id), knowledgePoint);
    pushList(extraBlocks, ['1. 先确认数据来源、字段含义和时间顺序', '2. 再观察目标字段与相关字段的联动变化', '3. 最后形成带边界的风险判断并安排现场复核'], pack.items.map((item) => item.id), knowledgePoint);
    pushHeading(extraBlocks, '阅读路径：从问题到迁移', pack.items.map((item) => item.id), knowledgePoint);
    pushList(extraBlocks, ['1. 从当前节点的问题定义开始', '2. 把同一观察方法迁移到新的时间窗口', '3. 用学习反馈修正下一步练习与资源建议'], pack.items.map((item) => item.id), knowledgePoint);
  }
  if (isPresentation) {
    const evidenceLabel = pack.items[0]?.sourceTitle ?? '当前检索证据';
    const taskLabel = query.trim().slice(0, 60) || '当前学习任务';
    const slides: Array<[string, string[], string]> = [
      ['学习目标', [
        `围绕“${taskLabel}”明确本次要回答的问题`,
        '把每个判断连接到可回溯的数据或资料依据',
        '最后给出行动建议，并保留尚未确认的部分',
      ], '这一页先把任务边界说清楚：先理解问题，再寻找证据，最后形成带有依据和不确定性说明的判断。这样可以避免一开始就跳到故障结论。'],
      ['数据与资料来源', [
        `当前优先参考：${evidenceLabel}`,
        '记录来源位置，便于回到原始数据或资料复核',
        '区分结构化数据、文档说明和待复核线索',
      ], '资料来源不是装饰，而是后续复核的入口。阅读时要同时看来源名称、定位信息和证据内容，不能只凭标题或模型概括做判断。'],
      ['先看字段含义', [
        '确认字段代表什么观测量以及单位',
        '分清原始读数、状态标签和推导结果',
        '遇到含义不确定的字段时先回查资料',
      ], '同一个数值只有放回字段定义和单位里才有意义。先确认“测了什么”，再讨论“是否异常”，可以减少把字段名称误读成设备结论的风险。'],
      ['时间序列观察', [
        '同时观察单点、相邻时间窗口和整体趋势',
        '标出突变、持续偏移和重复出现的区间',
        '记录观察窗口，避免脱离时间语境引用数值',
      ], '时间序列分析不能只截取一个醒目的点。应把异常放在相邻时间段和运行阶段中比较，并记录窗口范围，让其他人能够复现你的观察。'],
      ['多字段交叉验证', [
        '先看目标字段，再核对相关传感器的同步变化',
        '比较不同来源是否支持同一个方向的判断',
        '把相互矛盾的证据单独列出，不强行统一',
      ], '一个字段的偏离只能提供线索。把相关字段和运行记录放在一起比较，既能发现更可靠的模式，也能及时暴露证据之间的冲突。'],
      ['风险判断边界', [
        '异常读数可以支持风险提示',
        '风险提示不等同于已经确认的故障',
        '结论中明确证据覆盖范围和剩余疑问',
      ], '这一步是整个诊断训练的边界控制：把“观察到什么”和“因此能下什么结论”分开写。证据不足时降低表达强度，而不是补写一个看似确定的答案。'],
      ['复核与行动', [
        '列出需要补看的数据、资料或现场检查项',
        '为每个检查项说明预期确认的现象',
        '把高风险或高不确定性问题优先交给复核',
      ], '好的分析会落到下一步动作。复核项要能执行、能记录结果，并且与前面的证据缺口直接对应，而不是只写一句泛化的“建议维修”。'],
      ['练习与迁移', [
        '用分层题检查字段、证据和边界是否理解',
        '把同一方法迁移到新的时间窗口或设备问题',
        '提交反馈后让学习路径更新下一步建议',
      ], '最后把阅读转成练习，再把练习反馈带回路径。资源完成、作答和掌握反馈会成为下一次学习决策的输入，帮助你逐步从理解走向迁移。'],
    ];
    slides.forEach(([heading, bullets, notes], index) => {
      const evidenceIds = pack.items.map((item) => item.id);
      extraBlocks.push({ id: `resource-block-${randomUUID()}`, type: 'heading', position: 2 + index * 3, content: heading, knowledgePointIds: [knowledgePoint], evidenceIds });
      extraBlocks.push({ id: `resource-block-${randomUUID()}`, type: 'list', position: 3 + index * 3, content: bullets, knowledgePointIds: [knowledgePoint], evidenceIds });
      extraBlocks.push({ id: `resource-block-${randomUUID()}`, type: 'paragraph', position: 4 + index * 3, content: notes, knowledgePointIds: [knowledgePoint], evidenceIds });
    });
  }

  const fallbackCodeBlock = analysisCodeBlock(knowledgePoint, pack);
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
    ...(isLecture ? [fallbackCodeBlock] : []),
    ...(tableBlock ? [tableBlock] : []),
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
    }).slice(0, 8) : [];
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

/**
 * 结构可解析不等于可交付。该门槛用于触发一次模型返修，避免“两节各一句”之类草稿直接进入审核。
 */
export function validateLlmResourceDraftQuality(draft: LlmResourceDraft): string[] {
  const issues: string[] = [];
  if (draft.objectives.length < 2) issues.push('学习目标少于 2 条');
  if (draft.kind === 'lecture') {
    if (draft.sections.length < 6 || draft.sections.length > 8) issues.push('讲义必须包含 6 到 8 个完整小节');
    const totalTextLength = draft.sections.reduce((sum, section) => sum + section.text.replace(/\s/g, '').length, 0);
    if (totalTextLength < 2_600) issues.push('讲义正文不足 2600 字，尚未形成完整教学材料');
    const shortSections = draft.sections.filter((section) => section.text.replace(/\s/g, '').length < 300).length;
    if (shortSections > 0) issues.push(`有 ${shortSections} 个小节少于 300 字，讲解过于简略`);
    const duplicateHeadings = draft.sections.length - new Set(draft.sections.map((section) => section.heading.trim())).size;
    if (duplicateHeadings > 0) issues.push('存在重复小节标题，教学脉络不清晰');
    const sectionsWithoutKeyPoints = draft.sections.filter((section) => (section.keyPoints?.length ?? 0) < 2).length;
    if (sectionsWithoutKeyPoints > 0) issues.push(`有 ${sectionsWithoutKeyPoints} 个小节缺少至少 2 条记忆点`);
    if (draft.sections.filter((section) => Boolean(section.code?.code.trim())).length < 2) issues.push('与任务直接相关的代码示例少于 2 个');
    if ((draft.misconceptions?.length ?? 0) < 2) issues.push('常见误区少于 2 个');
    if ((draft.reviewQuestions?.length ?? 0) < 3) issues.push('自测问题少于 3 个');
  } else if (draft.kind === 'presentation') {
    if (draft.slides.length < 8) issues.push('PPT 少于 8 页，叙事不完整');
    if (draft.slides.some((slide) => slide.bullets.length < 3)) issues.push('存在少于 3 条要点的幻灯片');
    if (draft.slides.filter((slide) => (slide.notes?.replace(/\s/g, '').length ?? 0) >= 80).length < Math.max(1, draft.slides.length - 1)) issues.push('多数幻灯片缺少完整讲解词');
  } else if (draft.kind === 'tiered_quiz') {
    if (draft.questions.length < 9) issues.push('分层习题少于 9 道');
    for (const level of ['L1', 'L2', 'L3'] as const) {
      const questions = draft.questions.filter((question) => question.level === level);
      if (questions.length < 3) issues.push(`${level} 题目少于 3 道`);
      for (const type of ['choice', 'blank', 'short_answer'] as const) {
        if (!questions.some((question) => question.type === type)) issues.push(`${level} 缺少 ${type} 题型`);
      }
    }
  } else {
    if (draft.map.nodes.length < 8) issues.push('知识脉络关键节点少于 8 个');
    if ((draft.map.readingPaths?.length ?? 0) < 2) issues.push('知识脉络阅读路径少于 2 条');
  }
  return issues;
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

function pushTeachingParagraphs(blocks: ResourceBlock[], content: string, evidenceIds: string[], knowledgePoint: string): void {
  const paragraphs = content.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean);
  if (paragraphs.length <= 1) {
    pushParagraph(blocks, content, evidenceIds, knowledgePoint);
    return;
  }
  for (const paragraph of paragraphs.slice(0, 6)) pushParagraph(blocks, paragraph, evidenceIds, knowledgePoint);
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
    .replace(/\{([^}\n]*)\}/g, (_, label: string) => `{${sanitizeMermaidLabel(label)}}`)
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
    pushParagraph(blocks, `本讲围绕“${query.trim().slice(0, 80)}”展开。你会先理解问题与关键字段，再沿着分析步骤观察证据、解释现象，并在最后用自测问题检查自己是否真正掌握。`, evidenceIdList, knowledgePoint);
  }

  let hasLlmCode = false;
  if (llm.kind === 'lecture') {
    if (llm.objectives.length > 0) {
      pushHeading(blocks, '学习目标', evidenceIdList, knowledgePoint);
      pushList(blocks, llm.objectives, evidenceIdList, knowledgePoint);
    }
    for (const section of llm.sections.slice(0, 8)) {
      if (!section.heading?.trim() || !section.text?.trim()) continue;
      pushHeading(blocks, section.heading, evidenceIdList, knowledgePoint);
      pushTeachingParagraphs(blocks, section.text, evidenceIdList, knowledgePoint);
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
    if (!hasLlmCode) blocks.push(analysisCodeBlock(knowledgePoint, pack));
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

  return applyDifficulty({
    id: `resource-${randomUUID()}`,
    taskId,
    type,
    title: conciseResourceTitle(llm.title, type, query),
    tags: [RESOURCE_TYPE_LABEL[type]],
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

/** 资源标题是侧栏导航的一部分：去掉请求式前缀与重复类型词，保留一个短而可辨认的主题。 */
function conciseResourceTitle(value: string, type: LearningResourceType, fallbackQuery = value): string {
  const prefix = RESOURCE_TYPE_LABEL[type];
  const cleaned = String(value ?? '')
    .replace(/\s+/g, ' ')
    .replace(/^(请|帮我|给我|生成|做一份|写一份|制作)\s*/u, '')
    .replace(/^(压缩机诊断讲义|诊断训练\s*PPT|分层练习|知识脉络)\s*[:：-]?\s*/u, '')
    .trim();
  const fallback = String(fallbackQuery ?? '').replace(/\s+/g, ' ').trim();
  const subject = cleaned || fallback || '设备诊断基础';
  return `${prefix} · ${subject}`.slice(0, 24).replace(/[：:·\s]+$/u, '');
}

function analysisCodeBlock(knowledgePoint: string, pack: EvidencePack): ResourceBlock {
  const dataset = pack.items.find((item) => item.sourceType === 'dataset');
  const row = pack.items.find(isRowEvidence);
  let record: Record<string, unknown> = {};
  if (row) {
    try { record = JSON.parse(row.content) as Record<string, unknown>; } catch { /* 证据不是 JSON 行时仍生成通用代码 */ }
  }
  const sourceLabel = dataset?.sourceTitle ?? dataset?.sourceId ?? '当前检索数据集';
  const sourceKey = `${dataset?.sourceId ?? ''} ${sourceLabel}`;
  const fileName = /metropt|compressor|空压机/i.test(sourceKey)
    ? 'MetroPT3(AirCompressor).csv'
    : /ai4i/i.test(sourceKey)
    ? 'ai4i_2020.csv'
    : `${String(dataset?.sourceId || 'current-dataset').replace(/[^a-z0-9_-]+/gi, '-')}.csv`;
  const keys = Object.keys(record);
  const timeField = keys.find((key) => /timestamp|datetime|time|时间/i.test(key));
  const numericFields = keys.filter((key) => {
    if (/^(id|udi|rowid)$/i.test(key) || key === timeField) return false;
    const value = record[key];
    return typeof value === 'number' || (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value)));
  }).slice(0, 6);
  const lines = [
    'import pandas as pd',
    '',
    `# 来源：${sourceLabel}（字段与样本应以当前检索证据为准）`,
    `df = pd.read_csv(${JSON.stringify(fileName)})`,
    'print(df.shape)',
    'print(df.head())',
  ];
  if (timeField) {
    lines.push('', `df[${JSON.stringify(timeField)}] = pd.to_datetime(df[${JSON.stringify(timeField)}], errors="coerce")`, `df = df.sort_values(${JSON.stringify(timeField)})`);
  }
  if (numericFields.length > 0) {
    lines.push('', `numeric_fields = ${JSON.stringify(numericFields)}`, 'print(df[numeric_fields].describe())');
  } else {
    lines.push('', 'print(df.info())  # 先核对字段类型、缺失值与记录数');
  }
  return {
    id: `resource-block-${randomUUID()}`,
    type: 'code',
    position: 0,
    content: {
      language: 'python',
      caption: '分析入门：用 pandas 观察设备数据',
      code: lines.join('\n'),
    },
    knowledgePointIds: [knowledgePoint],
    evidenceIds: [],
  };
}

function escapeMermaid(value: string): string {
  return value.replace(/[[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '当前学习目标';
}
