# SSE事件类型优化说明

## 新增事件类型

为了更好地展示多智能体协同过程，在 `server/runs/protocol.ts` 中新增了3个SSE事件类型：

### 1. `node.evidence_found` - 证据检索完成
**触发时机**：`retrieve.structured` 或 `retrieve.document` 节点完成证据检索后

**用途**：
- 展示检索到的证据数量
- 显示证据质量评分
- 提供证据来源概览

**推荐payload字段**：
```typescript
{
  evidenceCount: number;      // 检索到的证据数量
  avgConfidence: number;       // 平均置信度
  sources: string[];           // 数据源列表
}
```

### 2. `node.validation_challenge` - 交叉验证质疑
**触发时机**：`debate.challenge` 节点发现需要质疑的内容时

**用途**：
- 展示质疑的具体内容
- 显示质疑依据
- 提供质疑严重程度

**推荐payload字段**：
```typescript
{
  challengedClaims: number;    // 质疑的声明数量
  severity: 'low' | 'medium' | 'high';  // 严重程度
  reasoning: string;           // 质疑理由摘要
}
```

### 3. `node.validation_verdict` - 验证裁决结果
**触发时机**：`adjudicate.verdict` 节点完成证据裁决后

**用途**：
- 展示最终裁决结果
- 显示通过/驳回的声明数量
- 提供裁决依据摘要

**推荐payload字段**：
```typescript
{
  approved: number;            // 通过的声明数量
  rejected: number;            // 驳回的声明数量
  confidence: number;          // 裁决置信度
}
```

---

## 实现建议

### 在 executor.ts 中触发事件

```typescript
// 示例：证据检索完成后
await appendRunEvent(run.id, {
  nodeKey: 'retrieve.structured',
  type: 'node.evidence_found',
  summary: `检索到 ${evidenceCount} 条证据，平均置信度 ${avgConfidence.toFixed(2)}`,
  payload: {
    evidenceCount,
    avgConfidence,
    sources: ['MetroPT-3', 'AI4I', 'Knowledge Cards'],
  },
});

// 示例：交叉验证质疑
await appendRunEvent(run.id, {
  nodeKey: 'debate.challenge',
  type: 'node.validation_challenge',
  summary: `发现 ${challengedCount} 处需要质疑的内容`,
  payload: {
    challengedClaims: challengedCount,
    severity: 'medium',
    reasoning: '部分声明缺少充分证据支撑',
  },
});

// 示例：验证裁决结果
await appendRunEvent(run.id, {
  nodeKey: 'adjudicate.verdict',
  type: 'node.validation_verdict',
  summary: `裁决完成：${approved} 条通过，${rejected} 条驳回`,
  payload: {
    approved,
    rejected,
    confidence: 0.85,
  },
});
```

---

## 前端展示增强

前端可以根据这些新事件类型提供更丰富的可视化：

```typescript
// 在 DagProgressEnhanced 组件中处理新事件
if (event.type === 'node.evidence_found') {
  return (
    <div className="flex items-center gap-2 text-xs text-emerald-700">
      <Database className="h-3 w-3" />
      <span>{event.summary}</span>
    </div>
  );
}

if (event.type === 'node.validation_challenge') {
  return (
    <div className="flex items-center gap-2 text-xs text-amber-700">
      <AlertTriangle className="h-3 w-3" />
      <span>{event.summary}</span>
    </div>
  );
}

if (event.type === 'node.validation_verdict') {
  return (
    <div className="flex items-center gap-2 text-xs text-blue-700">
      <CheckCircle className="h-3 w-3" />
      <span>{event.summary}</span>
    </div>
  );
}
```

---

## 演示视频录制建议

录制演示视频时，可以重点展示这些事件的实时推送：

1. **证据检索阶段**：展示 `node.evidence_found` 事件，说明零幻觉机制的证据驱动特性
2. **交叉验证阶段**：展示 `node.validation_challenge` 事件，说明多智能体辩论机制
3. **裁决阶段**：展示 `node.validation_verdict` 事件，说明质量门禁机制

---

## 状态

✅ 事件类型定义已添加到 `server/runs/protocol.ts`  
⏳ 需要在 `server/runs/executor.ts` 中的具体节点执行逻辑中触发这些事件  
⏳ 需要在前端 `DagProgressEnhanced` 组件中添加这些事件的可视化展示

**优先级**：中等（可选优化项，不影响核心功能）
