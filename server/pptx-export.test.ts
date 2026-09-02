import { describe, expect, it } from 'vitest';

import type { ResourceDocument } from '../src/learning/types.js';
import { resourceToPptx } from './pptx-export.js';

describe('resourceToPptx', () => {
  it('exports a real OOXML presentation with editable resource sections', async () => {
    const resource = {
      id: 'ppt-export-fixture',
      taskId: 'ppt-export-task',
      title: '空压机数据入门',
      type: 'ppt',
      difficulty: 0.3,
      learningObjectives: ['能从压力和电流的变化写出一个有依据的判断。'],
      knowledgePointIds: ['time-series-basics'],
      evidenceIds: ['evidence-1'],
      auditStatus: 'passed',
      createdAt: Date.now(),
      blocks: [
        {
          type: 'paragraph',
          text: '先认识数据，再用一个小任务判断设备状态。',
        },
        {
          type: 'heading',
          level: 2,
          text: '关键概念',
        },
        {
          type: 'list',
          items: ['压力表示负载变化', '电流帮助判断运行状态'],
        },
        {
          type: 'heading',
          level: 2,
          text: '数据样本',
        },
        {
          type: 'table',
          columns: ['timestamp', 'Motor_current', 'DV_pressure'],
          rows: [
            ['2020-09-01 03:59:40', 4.02, 8.87],
            ['2020-09-01 03:59:50', 4.12, 8.91],
          ],
        },
        {
          type: 'heading',
          level: 2,
          text: '马上练习',
        },
        {
          type: 'list',
          items: ['观察一段数据，写下你的判断和依据。'],
        },
      ],
    } as unknown as ResourceDocument;

    const output = await resourceToPptx(resource);

    expect(Buffer.isBuffer(output)).toBe(true);
    expect(output.subarray(0, 2).toString()).toBe('PK');
    expect(output.length).toBeGreaterThan(10_000);
  });
});
