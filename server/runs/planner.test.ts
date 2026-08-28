import { describe, expect, it } from 'vitest';
import {
  planStudyRun,
  PlanningError,
  validatePlan,
} from './planner.js';
import type { StudyRunRequest } from './protocol.js';

function autoRequest(overrides: Partial<StudyRunRequest> = {}): StudyRunRequest {
  return {
    task: '为压缩机故障窗口生成讲义',
    pathNodeId: null,
    resourceType: 'lecture',
    collaborationMode: 'auto',
    selectedAgentIds: [],
    temporaryReference: null,
    ...overrides,
  };
}

describe('planStudyRun（docs/挑战杯技术开发总规.md §5）', () => {
  it('auto 模式产出完整 DAG：双路检索并行、门禁齐全、至少 3 个业务角色', () => {
    const plan = planStudyRun('run-1', autoRequest(), { profileUncertainty: 0.3, knowledgeRisk: 0.1, evidenceCoverageHint: 'normal' });

    const keys = plan.nodes.map((node) => node.key);
    expect(keys).toContain('retrieve.structured');
    expect(keys).toContain('retrieve.document');
    expect(keys).toContain('generate.resource');
    expect(plan.gates).toEqual(expect.arrayContaining(['audit.claims', 'privacy.compliance']));

    const document = plan.nodes.find((node) => node.key === 'retrieve.document');
    expect(document?.dependsOn).toEqual([]);
    const generate = plan.nodes.find((node) => node.key === 'generate.resource');
    expect(generate?.dependsOn).toEqual(expect.arrayContaining(['analyze.domain', 'assess.learner']));

    const businessRoles = new Set(
      plan.nodes.filter((node) => !node.mandatory).map((node) => node.role),
    );
    expect(businessRoles.size).toBeGreaterThanOrEqual(3);
  });

  it('画像不确定度高时反方质询增加难度适配议题，知识风险高时裁决从严', () => {
    const strict = planStudyRun('run-2', autoRequest(), { profileUncertainty: 0.8, knowledgeRisk: 0.6, evidenceCoverageHint: 'sparse' });
    expect(strict.challengeFocus).toContain('difficulty_mismatch');
    expect(strict.strictAdjudication).toBe(true);
    expect(strict.riskLevel).toBe('high');
  });

  it('custom 模式：selectedAgentIds 真实裁剪业务节点，但门禁全部保留', () => {
    const plan = planStudyRun('run-3', autoRequest({
      collaborationMode: 'custom',
      selectedAgentIds: ['learning_planning', 'evidence_retrieval', 'resource_generation'],
    }), { profileUncertainty: 0.2, knowledgeRisk: 0 });

    const keys = plan.nodes.map((node) => node.key);
    // 未选 domain_expert → 领域分析节点被真实移除
    expect(keys).not.toContain('analyze.domain');
    // 已选 → 保留
    expect(keys).toContain('assess.learner');
    expect(keys).toContain('retrieve.structured');
    // 门禁不可移除
    expect(keys).toEqual(expect.arrayContaining(['audit.claims', 'debate.challenge', 'adjudicate.verdict', 'privacy.compliance', 'finalize.publish']));
  });

  it('custom 模式拒绝业务角色不足与取消资源生成', () => {
    expect(() => planStudyRun('run-4', autoRequest({
      collaborationMode: 'custom',
      selectedAgentIds: ['resource_generation'],
    }))).toThrow(PlanningError);

    expect(() => planStudyRun('run-5', autoRequest({
      collaborationMode: 'custom',
      selectedAgentIds: ['learning_planning', 'evidence_retrieval', 'domain_expert'],
    }))).toThrow(/资源生成角色/);
  });

  it('auto 模式忽略 selectedAgentIds 之外的角色约束，计划永远可过校验', () => {
    const plan = planStudyRun('run-6', autoRequest(), undefined);
    expect(validatePlan(plan)).toEqual([]);
  });

  it('validatePlan 能发现缺失门禁与循环依赖', () => {
    const broken = planStudyRun('run-7', autoRequest(), undefined);
    const tampered = {
      ...broken,
      // 整体移除隐私合规门禁节点，模拟门禁被绕过
      nodes: broken.nodes
        .filter((node) => node.key !== 'privacy.compliance')
        .map((node) =>
          node.key === 'audit.claims' ? { ...node, dependsOn: ['adjudicate.verdict' as const] } : node,
        ),
      gates: broken.gates.filter((gate) => gate !== 'privacy.compliance'),
    };
    const problems = validatePlan(tampered);
    expect(problems).toContain('缺少必要门禁 privacy.compliance');
    expect(problems).toContain('计划存在循环依赖');
  });
});
