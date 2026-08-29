import { describe, expect, it } from 'vitest';
import {
  ACTOR_KEYS,
  ARTIFACT_TYPES,
  artifactIdOf,
  hashArtifactContent,
  NODE_ACTOR_KEY,
  sha256,
  stableStringify,
  type ArtifactProducer,
  type PublicRationale,
} from './artifacts.js';

const rationale: PublicRationale = {
  observations: ['取回 8 条证据'],
  basisRefs: ['ev-1'],
  decision: '证据移交生成端',
  uncertainty: [],
  nextAction: null,
};

const producer: ArtifactProducer = { kind: 'rule', model: null, promptHash: null, settingsHash: null };

function hashInput(payload: Record<string, unknown>) {
  return {
    runId: 'study-run-1',
    nodeKey: 'retrieve.structured' as const,
    actorKey: NODE_ACTOR_KEY['retrieve.structured'],
    attempt: 1,
    artifactType: 'evidence_set' as const,
    inputRefs: [] as string[],
    payload,
    publicRationale: rationale,
    producer,
  };
}

describe('VACP 产物契约（升级计划 §4.4）', () => {
  it('稳定序列化：相同内容不同 key 顺序得到相同字符串与散列', () => {
    const a = stableStringify({ b: 1, a: { d: [2, { z: 3, y: 4 }], c: null } });
    const b = stableStringify({ a: { c: null, d: [2, { y: 4, z: 3 }] }, b: 1 });
    expect(a).toBe(b);
    expect(sha256(a)).toBe(sha256(b));
  });

  it('稳定序列化保持数组顺序：顺序不同则内容不同', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it('payload 改一个字符，内容散列必须变化', () => {
    const base = hashArtifactContent(hashInput({ count: 8 }));
    const changed = hashArtifactContent(hashInput({ count: 9 }));
    const tweakedText = hashArtifactContent(hashInput({ count: 8, note: 'x' }));
    expect(changed).not.toBe(base);
    expect(tweakedText).not.toBe(base);
    expect(base).toBe(hashArtifactContent(hashInput({ count: 8 })));
  });

  it('公开理由或生产者元数据变化会改变散列', () => {
    const base = hashArtifactContent(hashInput({ count: 8 }));
    const otherRationale = hashArtifactContent({
      ...hashInput({ count: 8 }),
      publicRationale: { ...rationale, decision: '不同决定' },
    });
    const otherProducer = hashArtifactContent({
      ...hashInput({ count: 8 }),
      producer: { kind: 'agent', model: 'qwen-plus', promptHash: 'p', settingsHash: 's' },
    });
    expect(otherRationale).not.toBe(base);
    expect(otherProducer).not.toBe(base);
  });

  it('产物 ID 按 run/节点/轮次/类型确定性生成；同节点同 attempt 恒等', () => {
    expect(artifactIdOf('study-run-1', 'generate.resource', 2, 'resource_draft'))
      .toBe('study-run-1:generate.resource:2:resource_draft');
    expect(artifactIdOf('study-run-1', 'generate.resource', 1, 'resource_draft'))
      .not.toBe(artifactIdOf('study-run-1', 'generate.resource', 2, 'resource_draft'));
  });

  it('每个节点都有唯一执行者键；执行者集合符合升级计划 §4.3', () => {
    expect(NODE_ACTOR_KEY['assess.learner']).toBe('learner_modeler');
    expect(NODE_ACTOR_KEY['generate.resource']).toBe('resource_author');
    expect(NODE_ACTOR_KEY['debate.challenge']).toBe('red_team_critic');
    expect(NODE_ACTOR_KEY['adjudicate.verdict']).toBe('evidence_judge');
    expect(NODE_ACTOR_KEY['finalize.publish']).toBe('publisher');
    expect(new Set(Object.values(NODE_ACTOR_KEY)).size).toBe(Object.keys(NODE_ACTOR_KEY).length);
    expect(ACTOR_KEYS).toHaveLength(10);
    expect(ARTIFACT_TYPES.length).toBeGreaterThanOrEqual(11);
  });
});
