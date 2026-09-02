import { describe, expect, it } from 'vitest';
import { chunkManagedDocument } from './knowledge-governance.js';

describe('受管资料切片', () => {
  it('保留 Markdown 的章节定位并生成稳定内容哈希', () => {
    const chunks = chunkManagedDocument([
      '# 电机诊断',
      '',
      '用于解释设备数据诊断的基础内容。'.repeat(22),
      '',
      '## 振动特征',
      '',
      '振动幅值、频谱和趋势需要结合工况一起判断。'.repeat(26),
    ].join('\n'));
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toMatchObject({ sectionPath: '电机诊断', sortOrder: 1 });
    expect(chunks[1]).toMatchObject({ sectionPath: '电机诊断 / 振动特征', sortOrder: 2 });
    expect(chunks.every((chunk) => chunk.tokenCount > 0 && /^[a-f0-9]{64}$/.test(chunk.contentHash))).toBe(true);
  });

  it('优先在段落边界切分超长正文，单一切片不超过上限', () => {
    const chunks = chunkManagedDocument(`# 资料\n\n${'一段可独立阅读的说明。'.repeat(160)}`);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.content.length <= 1_200)).toBe(true);
  });
});
