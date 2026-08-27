import { randomUUID } from 'node:crypto';
import type { EvidencePack, LearningResourceType, ResourceBlock, ResourceDocument } from './types.js';

function evidenceBlocks(pack: EvidencePack, positionOffset = 2): ResourceBlock[] {
  return pack.items.slice(0, 6).map((item, index) => ({
    id: `resource-block-${randomUUID()}`,
    type: 'evidence',
    position: index + positionOffset,
    content: {
      label: item.sourceType === 'dataset' ? '数据样本' : '领域说明',
      locator: item.locator,
      summary: item.content,
    },
    knowledgePointIds: ['compressor-diagnosis-evidence'],
    evidenceIds: [item.id],
  }));
}

export function buildResourceDraft(
  taskId: string,
  query: string,
  type: Extract<LearningResourceType, 'lecture' | 'practice_guide' | 'tiered_quiz' | 'concept_map'>,
  pack: EvidencePack,
): ResourceDocument {
  const isLecture = type === 'lecture';
  const title = isLecture
    ? `压缩机诊断讲义：${query}`
    : type === 'practice_guide'
    ? `压缩机诊断实操：${query}`
    : type === 'tiered_quiz'
    ? `分层练习：${query}`
    : `知识图谱：${query}`;
  const knowledgePointId = 'compressor-diagnosis-evidence';
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
      : '下面的 Mermaid 图把学习目标、数据证据、风险判断和现场复核串成一条可追溯关系。',
    knowledgePointIds: [knowledgePointId],
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
      : ['目标：理解压缩机诊断证据', '证据：传感器与状态记录', '判断：风险与不确定性', '行动：现场复核与维护训练'],
    knowledgePointIds: [knowledgePointId],
    evidenceIds: pack.items.map((item) => item.id),
  };

  const extraBlocks: ResourceBlock[] = [];
  if (type === 'tiered_quiz') {
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'question',
      position: 2,
      content: {
        levels: [
          { level: 'L1 基础理解', question: '从证据中指出两个观测字段，并说明它们记录了什么。' },
          { level: 'L2 证据判断', question: '哪些现象只能支持风险判断，为什么不能直接证明故障？' },
          { level: 'L3 迁移应用', question: '设计一个现场复核动作，并说明它如何降低不确定性。' },
        ],
      },
      knowledgePointIds: [knowledgePointId],
      evidenceIds: pack.items.map((item) => item.id),
    });
  }
  if (type === 'concept_map') {
    extraBlocks.push({
      id: `resource-block-${randomUUID()}`,
      type: 'paragraph',
      position: 2,
      content: `flowchart TD\n  A[学习目标：${escapeMermaid(query)}] --> B[传感器与状态证据]\n  B --> C[风险判断]\n  C --> D[现场复核]\n  D --> E[维护动作]\n  C --> F[保留不确定性]`,
      knowledgePointIds: [knowledgePointId],
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
      : ['建立从数据证据到诊断行动的知识关系'],
    knowledgePointIds: [knowledgePointId],
    blocks: [opening, taskBlock, ...extraBlocks, ...evidenceBlocks(pack, extraBlocks.length + 2)],
    evidenceIds: pack.items.map((item) => item.id),
    auditStatus: pack.items.length > 0 ? 'passed' : 'revise',
    createdAt: Date.now(),
  };
}

function escapeMermaid(value: string): string {
  return value.replace(/[\[\]{}()<>|]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || '当前学习目标';
}
