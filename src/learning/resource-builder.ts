import { randomUUID } from 'node:crypto';
import { normalizeKnowledgePointId } from './store.js';
import type { EvidencePack, LearningResourceType, QuizQuestion, ResourceBlock, ResourceDocument } from './types.js';

function evidenceBlocks(pack: EvidencePack, knowledgePointId: string, positionOffset = 2): ResourceBlock[] {
  return pack.items.slice(0, 6).map((item, index) => ({
    id: `resource-block-${randomUUID()}`,
    type: 'evidence',
    position: index + positionOffset,
    content: {
      label: item.sourceType === 'dataset' ? '数据样本' : '领域说明',
      locator: item.locator,
      summary: item.content,
    },
    knowledgePointIds: [knowledgePointId],
    evidenceIds: [item.id],
  }));
}

export function buildResourceDraft(
  taskId: string,
  query: string,
  type: LearningResourceType,
  pack: EvidencePack,
  knowledgePointId = 'compressor-diagnosis-evidence',
): ResourceDocument {
  const isLecture = type === 'lecture';
  const title = isLecture
    ? `压缩机诊断讲义：${query}`
    : type === 'practice_guide'
    ? `压缩机诊断实操：${query}`
    : type === 'tiered_quiz'
    ? `分层练习：${query}`
    : type === 'review_cards'
    ? `复习卡片：${query}`
    : type === 'challenge_task'
    ? `挑战任务：${query}`
    : `知识图谱：${query}`;
  const knowledgePoint = normalizeKnowledgePointId(knowledgePointId) || 'compressor-diagnosis-evidence';
  const opening: ResourceBlock = {
    id: `resource-block-${randomUUID()}`,
    type: 'paragraph',
    position: 0,
    content: isLecture
      ? '本资源只使用当前 EvidencePack 中的结构化数据和领域说明。传感器异常用于支持风险判断，不直接等同于确定故障。'
      : type === 'practice_guide'
      ? '请先查看证据定位，再完成数据观察、风险判断和现场复核说明。任何没有数据支持的结论都应标记为不确定。'
      : type === 'tiered_quiz'
      ? '练习按基础理解、证据判断和迁移应用分层。先独立作答，再查看提示和证据定位。'
      : type === 'review_cards'
      ? '每张卡片聚焦一个可复述的概念或判断边界。先回忆，再展开答案与证据定位。'
      : type === 'challenge_task'
      ? '请用给出的数据、证据和约束完成一个可验证的小型诊断任务，并明确说明结论边界。'
      : '下面的 Mermaid 图把学习目标、数据证据、风险判断和现场复核串成一条可追溯关系。',
    knowledgePointIds: [knowledgePoint],
    evidenceIds: pack.items.map((item) => item.id),
  };
  const taskBlock: ResourceBlock = {
    id: `resource-block-${randomUUID()}`,
    type: isLecture || type === 'tiered_quiz' ? 'list' : 'checklist',
    position: 1,
    content: isLecture
      ? ['识别时间序列中的关键观测字段', '区分数据证据、风险判断和维护动作', '保留故障结论的不确定性边界']
      : type === 'practice_guide'
      ? ['记录观察到的字段和值', '说明字段与风险判断的关系', '提出需要现场复核的项目', '写出仍然不确定的内容']
      : type === 'tiered_quiz'
      ? ['L1 基础：解释一个观测字段的作用', 'L2 判断：根据证据说明风险而非直接下结论', 'L3 迁移：提出复核动作并说明不确定性']
      : type === 'review_cards'
      ? ['卡片 1：数据证据与故障结论的区别', '卡片 2：异常窗口需要哪些复核信息', '卡片 3：如何表达不确定性']
      : type === 'challenge_task'
      ? ['读取给定证据', '形成风险判断', '写出复核方案', '提交带依据的结论']
      : ['目标：理解压缩机诊断证据', '证据：传感器与状态记录', '判断：风险与不确定性', '行动：现场复核与维护训练'],
    knowledgePointIds: [knowledgePoint],
    evidenceIds: pack.items.map((item) => item.id),
  };

  const extraBlocks: ResourceBlock[] = [];
  if (type === 'tiered_quiz') {
    const evidenceIds = pack.items.slice(0, 3).map((item) => item.id);
    const questions: QuizQuestion[] = [
      {
        id: 'diagnosis-evidence-boundary',
        level: 'L1',
        prompt: '当传感器读数出现异常时，下列哪种表述最符合设备诊断训练的证据边界？',
        options: [
          { id: 'A', text: '异常读数已经证明设备发生了确定故障。' },
          { id: 'B', text: '异常读数提示风险，需要结合更多证据或现场复核。' },
          { id: 'C', text: '只要存在数据，就不需要说明不确定性。' },
          { id: 'D', text: '删除异常记录后再做判断。' },
        ],
        answerId: 'B',
        explanation: '传感器数据能够支持风险判断，但不能直接替代现场确认或多源证据核验。',
        evidenceIds,
      },
      {
        id: 'diagnosis-review-action',
        level: 'L2',
        prompt: '为了降低单一数据窗口带来的误判，下列哪一步最合适？',
        options: [
          { id: 'A', text: '把风险判断写成确定结论。' },
          { id: 'B', text: '忽略时间窗口，只保留一条读数。' },
          { id: 'C', text: '补充相邻时间段、字段关系或现场复核信息。' },
          { id: 'D', text: '只根据经验选择一个故障标签。' },
        ],
        answerId: 'C',
        explanation: '诊断需要通过相邻工况、字段关系或现场信息交叉核验，明确仍未确认的边界。',
        evidenceIds,
      },
      {
        id: 'diagnosis-conclusion-format',
        level: 'L3',
        prompt: '提交一个可追溯的设备风险结论时，最少应保留什么？',
        options: [
          { id: 'A', text: '风险判断、对应依据和后续复核动作。' },
          { id: 'B', text: '一个没有来源的故障名称。' },
          { id: 'C', text: '只写“建议维修”。' },
          { id: 'D', text: '只保留最终答案，删除过程。' },
        ],
        answerId: 'A',
        explanation: '可追溯结论必须让学习者和审核者看到判断依据、结论边界及可执行的下一步。',
        evidenceIds,
      },
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
  if (type === 'review_cards') {
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'question',
      position: 2,
      content: {
        cards: [
          { prompt: '什么是“证据支持的风险判断”？', answer: '它只说明证据指向的风险，不把异常读数直接写成确定故障。' },
          { prompt: '为什么需要保留不确定性？', answer: '传感器记录无法替代现场复核，结论需要说明尚未确认的部分。' },
          { prompt: '复核动作有什么作用？', answer: '它补充数据无法观察到的现场信息，降低误判风险。' },
        ],
      },
      knowledgePointIds: [knowledgePoint],
      evidenceIds: pack.items.map((item) => item.id),
    });
  }
  if (type === 'challenge_task') {
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'checklist',
      position: 2,
      content: ['选择一个异常窗口或案例片段', '引用至少两条可定位证据', '给出风险判断与不确定性说明', '提出一项可执行的现场复核动作'],
      knowledgePointIds: [knowledgePoint],
      evidenceIds: pack.items.map((item) => item.id),
    });
  }

  return {
    id: `resource-${randomUUID()}`,
    taskId,
    type,
    title,
    difficulty: 0.42,
    learningObjectives: isLecture
      ? ['理解压缩机传感器证据的作用', '建立数据到运维判断的边界']
      : type === 'practice_guide'
      ? ['完成一次可追溯的压缩机风险判断', '区分预测风险与现场确认']
      : type === 'tiered_quiz'
      ? ['分层检验证据理解', '根据作答结果定位下一步训练']
      : type === 'review_cards'
      ? ['快速复述关键概念', '巩固数据诊断的判断边界']
      : type === 'challenge_task'
      ? ['完成一次可追溯的小型诊断任务', '提交有边界的风险结论']
      : ['建立从数据证据到诊断行动的知识关系'],
    knowledgePointIds: [knowledgePoint],
    blocks: [opening, taskBlock, ...extraBlocks, ...evidenceBlocks(pack, knowledgePoint, extraBlocks.length + 2)],
    evidenceIds: pack.items.map((item) => item.id),
    auditStatus: pack.items.length > 0 ? 'passed' : 'revise',
    createdAt: Date.now(),
  };
}

function escapeMermaid(value: string): string {
  return value.replace(/[\[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '当前学习目标';
}
