import { describe, expect, it } from 'vitest';
import {
  draftFinalRates,
  mergeGateVerdicts,
  officialHallucinationRate,
  recomputeArtifactHash,
  recomputeRuleGate,
  replayExport,
  validChallengeRate,
  verifyExportIntegrity,
  type ExportPayloadLike,
} from './metrics.js';

function artifact(overrides: Partial<ExportPayloadLike['artifacts'][number]> & { id: string }): ExportPayloadLike['artifacts'][number] {
  const base = {
    nodeKey: 'audit.claims',
    actorKey: 'claim_auditor',
    attempt: 1,
    artifactType: 'claim_audit',
    inputRefs: [],
    payload: { claims: [] },
    publicRationale: { observations: [], basisRefs: [], decision: '审核完成', uncertainty: [], nextAction: null },
    producer: { kind: 'rule', model: null, promptHash: null, settingsHash: null },
    ...overrides,
  } as Omit<ExportPayloadLike['artifacts'][number], 'contentHash'>;
  // 与 persistArtifact 同口径重算散列，模拟真实导出
  return { ...base, contentHash: recomputeArtifactHash(base as ExportPayloadLike['artifacts'][number], 'study-run-1') };
}

function exportPayload(overrides: Partial<ExportPayloadLike> = {}): ExportPayloadLike {
  const artifacts: ExportPayloadLike['artifacts'] = overrides.artifacts ?? [
    artifact({ id: 'study-run-1:audit.claims:1:claim_audit' }),
  ];
  return {
    plan: {
      nodes: [
        { key: 'generate.resource', dependsOn: [], mandatory: false },
        { key: 'audit.claims', dependsOn: ['generate.resource'], mandatory: true },
      ],
      gates: ['audit.claims'],
      strictAdjudication: false,
    },
    run: { id: 'study-run-1', finalAssetId: 'asset-1', executionManifestHash: null },
    events: [{ seq: 1 }, { seq: 2 }, { seq: 3 }],
    artifacts,
    evidenceChain: {
      claims: [],
      auditDecisions: [{ round: 1, verdict: 'supported', released: true }],
      evidencePacks: [{ id: 'pack-1', items: [{ id: 'ev-1' }] }],
    },
    request: { temporaryReference: null },
    ...overrides,
  };
}

describe('官方指标口径（升级计划 §F）', () => {
  it('幻觉率：review 在分母、non_factual 不在、空分母 N/A', () => {
    expect(officialHallucinationRate([
      { verdict: 'supported', claimType: 'numeric' },
      { verdict: 'unsupported', claimType: 'numeric' },
      { verdict: 'unsupported', claimType: 'non_factual' },
    ])).toBe(0.5);
    expect(officialHallucinationRate([{ verdict: 'review', claimType: 'method_step' }])).toBe(0);
    expect(officialHallucinationRate([{ verdict: 'unsupported', claimType: 'non_factual' }])).toBeNull();
  });

  it('初稿/终稿对照与门禁净增益（G10）', () => {
    const trace = [{
      logicalKey: 'k1', auditable: true,
      stages: [
        { attempt: 1, verdict: 'unsupported', claimType: 'numeric', evidence: [] },
        { attempt: 2, verdict: 'supported', claimType: 'numeric', evidence: [] },
      ],
      issues: [],
    }];
    const rates = draftFinalRates(trace);
    expect(rates.draftRate).toBe(1);
    expect(rates.finalRate).toBe(0);
    expect(rates.gateNetGain).toBe(1);
  });

  it('有效质询率：accepted/resolved 计为有效', () => {
    expect(validChallengeRate([{ status: 'raised' }, { status: 'accepted' }, { status: 'resolved' }])).toBeCloseTo(2 / 3);
    expect(validChallengeRate([])).toBeNull();
  });

  it('规则门禁重算与更严合并', () => {
    expect(recomputeRuleGate([{ verdict: 'unsupported', claimType: 'numeric' }], { strict: false })).toBe('unsupported');
    expect(recomputeRuleGate([{ verdict: 'review', claimType: 'numeric' }], { strict: false })).toBe('partial');
    expect(recomputeRuleGate([{ verdict: 'supported', claimType: 'numeric' }], { strict: false })).toBe('supported');
    expect(mergeGateVerdicts('supported', 'partial')).toBe('partial');
    expect(mergeGateVerdicts('unsupported', 'supported')).toBe('unsupported');
  });
});

describe('导出完整性与离线回放（升级计划 §F 验收）', () => {
  it('完整导出通过校验与回放', () => {
    const payload = exportPayload({
      artifacts: [
        artifact({ id: 'study-run-1:audit.claims:1:claim_audit' }),
        artifact({
          id: 'study-run-1:adjudicate.verdict:1:adjudication',
          nodeKey: 'adjudicate.verdict',
          actorKey: 'evidence_judge',
          artifactType: 'adjudication',
          payload: { ruleVerdict: 'partial', verdict: 'partial', released: true },
        }),
        artifact({
          id: 'study-run-1:finalize.publish:1:publication_decision',
          nodeKey: 'finalize.publish',
          actorKey: 'publisher',
          artifactType: 'publication_decision',
          payload: { released: true, finalAssetId: 'asset-1' },
        }),
      ],
      evidenceChain: {
        claims: [{ id: 'c1', attempt: 1, verdict: 'supported', claimType: 'numeric', evidence: [{ evidenceId: 'ev-1', supportLevel: 'supported' }] }],
        auditDecisions: [{ round: 1, verdict: 'partial', released: true }],
        evidencePacks: [{ id: 'pack-1', items: [{ id: 'ev-1' }] }],
      },
    });
    const integrity = verifyExportIntegrity(payload);
    expect(integrity.passed).toBe(true);
    const replay = replayExport(payload);
    expect(replay.passed).toBe(true);
  });

  it('篡改 artifact payload → hash 校验发现', () => {
    const payload = exportPayload();
    payload.artifacts[0]!.payload = { claims: [], tampered: true };
    const integrity = verifyExportIntegrity(payload);
    const hashCheck = integrity.checks.find((check) => check.id === 'artifact-hash');
    expect(hashCheck?.passed).toBe(false);
    expect(integrity.passed).toBe(false);
  });

  it('删除 evidence edge（悬空引用）→ 完整性校验发现', () => {
    const payload = exportPayload({
      evidenceChain: {
        claims: [{ id: 'c1', attempt: 1, verdict: 'supported', claimType: 'numeric', evidence: [{ evidenceId: 'ev-missing', supportLevel: 'supported' }] }],
        auditDecisions: [{ round: 1, verdict: 'supported', released: true }],
        evidencePacks: [{ id: 'pack-1', items: [{ id: 'ev-1' }] }],
      },
    });
    const integrity = verifyExportIntegrity(payload);
    const evidenceCheck = integrity.checks.find((check) => check.id === 'claim-evidence');
    expect(evidenceCheck?.passed).toBe(false);
  });

  it('把裁决改成比规则更松的结果 → replay 发现不一致', () => {
    const payload = exportPayload({
      artifacts: [
        artifact({ id: 'study-run-1:audit.claims:1:claim_audit' }),
        artifact({
          id: 'study-run-1:adjudicate.verdict:1:adjudication',
          nodeKey: 'adjudicate.verdict',
          actorKey: 'evidence_judge',
          artifactType: 'adjudication',
          payload: { ruleVerdict: 'unsupported', verdict: 'supported', released: true },
        }),
        artifact({
          id: 'study-run-1:finalize.publish:1:publication_decision',
          nodeKey: 'finalize.publish',
          actorKey: 'publisher',
          artifactType: 'publication_decision',
          payload: { released: true, finalAssetId: 'asset-1' },
        }),
      ],
      evidenceChain: {
        claims: [{ id: 'c1', attempt: 1, verdict: 'unsupported', claimType: 'numeric', evidence: [] }],
        auditDecisions: [{ round: 1, verdict: 'supported', released: true }],
        evidencePacks: [{ id: 'pack-1', items: [{ id: 'ev-1' }] }],
      },
    });
    const replay = replayExport(payload);
    expect(replay.passed).toBe(false);
    const strictCheck = verifyExportIntegrity(payload).checks.find((check) => check.id === 'adjudication-strictness');
    expect(strictCheck?.passed).toBe(false);
  });

  it('事件 seq 缺口与依赖闭合缺失被发现', () => {
    const payload = exportPayload({
      events: [{ seq: 1 }, { seq: 3 }],
      plan: {
        nodes: [
          { key: 'generate.resource', dependsOn: ['missing.node'], mandatory: false },
          { key: 'audit.claims', dependsOn: [], mandatory: true },
        ],
        gates: ['audit.claims'],
      },
    });
    const integrity = verifyExportIntegrity(payload);
    expect(integrity.checks.find((check) => check.id === 'event-seq')?.passed).toBe(false);
    expect(integrity.checks.find((check) => check.id === 'dag-closure')?.passed).toBe(false);
  });

  it('上传正文泄漏与密钥字段被发现', () => {
    const payload = exportPayload({
      request: { temporaryReference: { name: 'a.md', bodyIncluded: true, content: '机密正文' } as never },
    });
    const integrity = verifyExportIntegrity(payload);
    expect(integrity.checks.find((check) => check.id === 'sensitive-fields')?.passed).toBe(false);
  });

  it('已发布但缺少发布决定 → fail closed 校验发现', () => {
    const payload = exportPayload({
      artifacts: [artifact({ id: 'study-run-1:audit.claims:1:claim_audit' })],
    });
    const integrity = verifyExportIntegrity(payload);
    expect(integrity.checks.find((check) => check.id === 'publication-gate')?.passed).toBe(false);
  });
});
