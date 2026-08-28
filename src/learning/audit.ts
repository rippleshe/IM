import type { CrossValidationResult, EvidencePack, ResourceDocument } from './types.js';

export interface ClaimAuditRecord {
  id: string;
  text: string;
  verdict: 'supported' | 'review' | 'unsupported';
  critique: string;
  factualScore: number;
  evidenceIds: string[];
}

export interface ResourceAuditResult {
  summary: CrossValidationResult;
  claims: ClaimAuditRecord[];
}

function claimText(content: unknown): string[] {
  if (typeof content === 'string') {
    return content.includes('flowchart') || content.includes('-->') ? [] : [content];
  }
  if (Array.isArray(content)) return content.flatMap((item) => claimText(item));
  if (content && typeof content === 'object') {
    return Object.values(content as Record<string, unknown>).flatMap((item) => claimText(item));
  }
  return [];
}

function hasNumericSupport(text: string, evidenceText: string): boolean {
  const numbers = text.match(/\b\d+(?:\.\d+)?\b/g);
  if (!numbers || numbers.length === 0) return true;
  return numbers.every((number) => evidenceText.includes(number));
}

export function auditResource(resource: ResourceDocument, pack: EvidencePack): ResourceAuditResult {
  const claims: ClaimAuditRecord[] = [];
  resource.blocks.forEach((block) => {
    // 代码示例是操作说明，数据表格是证据摘录；两者都不是需要逐条核对的事实声明。
    if (block.type === 'code' || block.type === 'table') return;
    claimText(block.content).forEach((text) => {
      const evidenceIds = block.evidenceIds.filter((id) => pack.items.some((item) => item.id === id));
      const evidenceText = evidenceIds
        .map((id) => pack.items.find((item) => item.id === id)?.content ?? '')
        .join('\n');
      const hasEvidence = evidenceIds.length > 0;
      const numericSupported = hasNumericSupport(text, evidenceText);
      const verdict = !hasEvidence ? 'unsupported' : !numericSupported ? 'review' : 'supported';
      claims.push({
        id: `${resource.id}-claim-${claims.length + 1}`,
        text: text.slice(0, 500),
        verdict,
        critique: !hasEvidence
          ? '没有绑定证据定位，不能发布为确定结论。'
          : !numericSupported
          ? '数字或单位未在绑定证据中找到，需要人工复核。'
          : '已绑定结构化数据或领域文档证据。',
        factualScore: verdict === 'supported' ? 1 : verdict === 'review' ? 0.6 : 0,
        evidenceIds,
      });
    });
  });
  const unsupported = claims.filter((claim) => claim.verdict === 'unsupported').length;
  const review = claims.filter((claim) => claim.verdict === 'review').length;
  const claimScore = claims.length === 0 ? 0 : (claims.length - unsupported - review * 0.4) / claims.length;
  const checks = [
    ...pack.crossValidation.checks,
    {
      id: 'claim-coverage',
      label: 'Claim 证据覆盖',
      status: unsupported === 0 && claims.length > 0 ? 'passed' as const : 'failed' as const,
      detail: `${claims.length - unsupported}/${claims.length} 条内容声明已绑定证据`,
      evidenceIds: claims.flatMap((claim) => claim.evidenceIds),
    },
    {
      id: 'numeric-consistency',
      label: '数字与单位一致',
      status: review === 0 ? 'passed' as const : 'review' as const,
      detail: review === 0 ? '未发现无法从证据核对的数字' : `${review} 条内容需要核对数字或单位`,
      evidenceIds: claims.filter((claim) => claim.verdict === 'review').flatMap((claim) => claim.evidenceIds),
    },
  ];
  const status = unsupported > 0
    ? 'unsupported'
    : review > 0 || pack.crossValidation.status !== 'corroborated'
    ? 'needs_review'
    : 'corroborated';
  return {
    claims,
    summary: {
      status,
      score: Math.round(Math.max(0, Math.min(1, claimScore * 0.65 + pack.crossValidation.score * 0.35)) * 100) / 100,
      checks,
      notes: status === 'corroborated'
        ? ['来源交叉验证和 Claim 级核对均通过，可保存为已审核资产。']
        : ['存在未支持或待复核内容，不能把整份资源标记为确定结论。'],
    },
  };
}
