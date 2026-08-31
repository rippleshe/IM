/**
 * StudyRun API 路由（docs/挑战杯技术开发总规.md §3、§4）
 * 202 建库 → SSE 增量事件（Last-Event-ID 续传）→ 快照 → 取消。
 * learnerId 一律从 HttpOnly Cookie 会话推导，URL 与请求体不作为授权依据。
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import type { AuthenticatedLearner } from '../../src/learning/identity.js';
import type { LearningResourceType } from '../../src/learning/types.js';
import { identityStore, learningStore } from '../study-context.js';
import { getLearningDatabase } from '../db/client.js';
import { auditDecisions, claims, claimEvidence, debateIssues, evidenceItems, evidencePackItems, evidencePacks, studyRuns } from '../db/schema.js';
import { formatSseEvent } from './protocol.js';
import { PlanningError, parseStudyRunRequest, planStudyRun } from './planner.js';
import { packConversationContext } from '../conversation-context.js';
import { getAgentExecutionSettings, refreshModelCapabilities } from '../study-runtime.js';
import { listRunArtifacts, persistArtifact } from './artifacts.js';
import { getRunSnapshot } from './snapshots.js';
import { buildClaimTrace } from './claim-trace.js';
import { replayExport, verifyExportIntegrity, type ExportPayloadLike } from './metrics.js';
import { taskFactRisk } from './policy.js';
import { computePlannerKnowledgeSignals } from '../profile-insights.js';
import {
  RunNotFoundError,
  appendRunEvent,
  createStudyRun,
  enqueueRootNodes,
  findRunByIdempotencyKey,
  getRunForLearner,
  listEventsSince,
  listRunNodes,
  requestCancelRun,
} from './service.js';
import { cancelRunJobs } from './queue.js';
import { createRunSubscriber } from './events.js';

type RequireLearner = (req: express.Request, res: express.Response) => Promise<AuthenticatedLearner | null> | AuthenticatedLearner | null;

/**
 * 运行前学情信号（升级计划 §4.7 两阶段决策·第一阶段）：
 * 目标知识点 + 先修闭包的真实 BKT 置信度、先修缺口、近期错误率与任务事实风险。
 * 替换旧版"有无学习历史"的粗粒度估算（G5）。
 */
async function derivePlannerSignals(
  learnerId: string,
  pathNodeId: string | null,
  task: string,
  resourceType: LearningResourceType,
): Promise<{
  profileUncertainty: number;
  knowledgeRisk: number;
  taskRisk: number;
  evidenceCoverageHint: 'sparse' | 'normal' | 'rich';
  targetKnowledgePointId: string | null;
  basis: string[];
}> {
  const knowledge = await computePlannerKnowledgeSignals(learnerId, pathNodeId);
  const taskRisk = taskFactRisk({ task, resourceType });
  return {
    profileUncertainty: knowledge.profileUncertainty,
    knowledgeRisk: knowledge.knowledgeRisk,
    taskRisk: taskRisk.score,
    evidenceCoverageHint: 'normal',
    targetKnowledgePointId: knowledge.targetKnowledgePointId,
    basis: [...knowledge.basis, ...taskRisk.reasons.map((reason) => `task-risk:${reason}`)],
  };
}

/**
 * 比赛证据包构建（总规 §8.3 + 升级计划 §5.2）。
 * GET /export 与 POST /verify 共用：快照初稿状态、artifact 清单、按轮次分组的 Claim、
 * EvidencePack 快照、脱敏上传正文。
 */
async function buildRunExportPayload(
  run: Awaited<ReturnType<typeof getRunForLearner>>,
  learner: AuthenticatedLearner,
): Promise<Record<string, unknown>> {
  const database = getLearningDatabase();
  const [nodes, events, artifacts, claimRows, debateRows, decisionRows] = await Promise.all([
    listRunNodes(run.id),
    listEventsSince(run.id, 0),
    listRunArtifacts(run.id, learner.id),
    database.db.select().from(claims).where(eq(claims.resourceId, run.id)),
    database.db.select().from(debateIssues).where(eq(debateIssues.runId, run.id)),
    database.db.select().from(auditDecisions).where(eq(auditDecisions.runId, run.id)).orderBy(asc(auditDecisions.round)),
  ]);
  const claimIds = claimRows.map((row) => row.id);
  const edges = claimIds.length > 0
    ? await database.db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, claimIds))
    : [];
  const edgesByClaim = new Map<string, Array<{ evidenceId: string; supportLevel: string }>>();
  for (const edge of edges) {
    edgesByClaim.set(edge.claimId, [
      ...(edgesByClaim.get(edge.claimId) ?? []),
      { evidenceId: edge.evidenceId, supportLevel: edge.supportLevel },
    ]);
  }
  // 证据包快照：本运行会话产生的全部 EvidencePack 及其证据条目（不只 Claim 的 evidenceId）
  const packs = await database.db.select().from(evidencePacks).where(eq(evidencePacks.sessionId, `study-run-${run.id}`));
  const packIds = packs.map((pack) => pack.id);
  const packItemRows = packIds.length > 0
    ? await database.db.select().from(evidencePackItems).where(inArray(evidencePackItems.packId, packIds))
    : [];
  const evidenceIds = [...new Set(packItemRows.map((row) => row.evidenceId))];
  const evidenceRows = evidenceIds.length > 0
    ? await database.db.select().from(evidenceItems).where(inArray(evidenceItems.id, evidenceIds))
    : [];
  const finalAsset = run.finalAssetId ? await learningStore.getAsset(learner.id, run.finalAssetId) : null;
  const feedback = finalAsset ? await learningStore.getAssetFeedback(learner.id, finalAsset.id) : null;
  const chatMessages = (await learningStore.listChatMessages(learner.id, 200, 'study'))
    .filter((message) => message.metadata['runId'] === run.id);
  const onboarding = await identityStore.getOnboarding(learner.id);
  // G7 修复：运行起点学情取自 run_start 快照；历史运行无快照时回退现查并如实标注
  const runStart = await getRunSnapshot(run.id, 'run_start');
  const generationEnd = await getRunSnapshot(run.id, 'generation_end');
  const runRow = (await database.db.select().from(studyRuns).where(eq(studyRuns.id, run.id)).limit(1))[0];
  const initialLearnerState = runStart
    ? { source: 'run_start_snapshot', snapshotId: runStart.id, skillStates: runStart.skillStates, profileSummary: runStart.profileSummary }
    : {
        source: 'live_query_at_export（历史运行无起点快照）',
        skillStates: await learningStore.getSkillStates(learner.id),
        diagnostic: await learningStore.getLatestDiagnosticSession(learner.id),
      };
  const reference = run.request.temporaryReference;
  return {
    exportedAt: new Date().toISOString(),
    learner: {
      id: learner.id,
      loginName: learner.loginName,
      onboarding,
    },
    initialLearnerState,
    generationEndState: generationEnd
      ? { source: 'generation_end_snapshot', snapshotId: generationEnd.id, skillStates: generationEnd.skillStates, profileSummary: generationEnd.profileSummary }
      : null,
    request: {
      ...run.request,
      // 隐私（升级计划 §5.2）：上传正文不进入导出，只保留审计元数据
      temporaryReference: reference
        ? { name: reference.name, byteCount: Buffer.byteLength(reference.content, 'utf8'), bodyIncluded: false }
        : null,
    },
    plan: run.plan,
    verificationPolicy: runRow?.verificationPolicyJson ?? null,
    run: {
      id: run.id, status: run.status, revisionRound: run.revisionRound, riskLevel: run.riskLevel,
      finalAssetId: run.finalAssetId, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
      executionManifestHash: runRow?.executionManifestHash ?? null,
    },
    dagNodes: nodes.map((node) => ({
      nodeKey: node.nodeKey, role: node.role, attempt: node.attempt, status: node.status,
      mandatory: node.mandatory, startedAt: node.startedAt, finishedAt: node.finishedAt,
      resultSummary: node.resultSummary, actorKey: node.actorKey ?? null, primaryArtifactId: node.primaryArtifactId ?? null,
    })),
    events,
    agentConclusions: chatMessages.filter((message) => message.metadata['kind'] === 'agent'),
    artifacts: artifacts.map((artifact) => ({
      id: artifact.id, nodeKey: artifact.nodeKey, actorKey: artifact.actorKey, attempt: artifact.attempt,
      artifactType: artifact.artifactType, inputRefs: artifact.inputRefs, payload: artifact.payload,
      publicRationale: artifact.publicRationale, producer: artifact.producer,
      contentHash: artifact.contentHash, createdAt: artifact.createdAt,
    })),
    evidenceChain: {
      // Claim 按 attempt 分组：初稿与修订轮都可追踪（升级计划 G2）
      claimsByAttempt: claimRows.reduce<Record<string, Array<Record<string, unknown>>>>((acc, row) => {
        const key = String(row.attempt ?? 1);
        acc[key] = [
          ...(acc[key] ?? []),
          {
            id: row.id, text: row.text, verdict: row.verdict, critique: row.critique,
            factualScore: row.factualScore, draftArtifactId: row.draftArtifactId,
            claimType: row.claimType, logicalKey: row.logicalKey, supersedesClaimId: row.supersedesClaimId,
            evidence: edgesByClaim.get(row.id) ?? [],
          },
        ];
        return acc;
      }, {}),
      claims: claimRows.map((row) => ({
        id: row.id, attempt: row.attempt, draftArtifactId: row.draftArtifactId, claimType: row.claimType,
        text: row.text, verdict: row.verdict, critique: row.critique, factualScore: row.factualScore,
        evidence: edgesByClaim.get(row.id) ?? [],
      })),
      debateIssues: debateRows,
      auditDecisions: decisionRows,
      evidencePacks: packs.map((pack) => ({
        id: pack.id, query: pack.query, retrievalPlan: pack.retrievalPlanJson,
        coverageScore: pack.coverageScore, crossValidation: pack.crossValidationJson,
        items: packItemRows
          .filter((item) => item.packId === pack.id)
          .map((item) => evidenceRows.find((evidence) => evidence.id === item.evidenceId))
          .filter(Boolean),
      })),
    },
    finalAsset,
    learningFeedback: feedback,
  };
}

export function createRunsRouter(requireLearner: RequireLearner): express.Router {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const request = parseStudyRunRequest(req.body);
      // 协同运行在入队前冻结完整对话快照；清除群聊后，新运行自然从空上下文开始。
      const route = getAgentExecutionSettings('learning_planning', undefined, undefined);
      const limits = await refreshModelCapabilities(route.model);
      request.conversationContext = packConversationContext(
        (await learningStore.listChatMessages(learner.id, 200, 'study')).map((message) => ({
          role: message.role,
          content: message.content,
        })),
        { contextWindow: limits.contextWindow, reservedTokens: limits.maxOutputTokens + 12_000 },
      );
      const runId = `study-run-${randomUUID()}`;
      // 幂等键（总规 §3）：同 learner 重复提交同一 key 直接返回既有运行
      const idempotencyKey = typeof req.headers['idempotency-key'] === 'string' && req.headers['idempotency-key'].trim()
        ? req.headers['idempotency-key'].trim().slice(0, 120)
        : null;
      if (idempotencyKey) {
        const existing = await findRunByIdempotencyKey(learner.id, idempotencyKey);
        if (existing) {
          res.status(200).json({ success: true, runId: existing.id, plan: existing.plan, replayed: true });
          return;
        }
      }
      const signals = await derivePlannerSignals(learner.id, request.pathNodeId, request.task, request.resourceType);
      const plan = planStudyRun(runId, request, signals);
      const run = await createStudyRun({ runId, learnerId: learner.id, request, plan, idempotencyKey });
      // VACP（升级计划 §4.7）：planner 输入固化为 artifact，不只放在 plan JSON
      await persistArtifact({
        runId,
        learnerId: learner.id,
        nodeKey: 'assess.learner',
        attempt: 1,
        artifactType: 'design_constraints',
        inputRefs: [],
        payload: {
          phase: 'run_pre_plan',
          signals: {
            profileUncertainty: signals.profileUncertainty,
            knowledgeRisk: signals.knowledgeRisk,
            taskRisk: signals.taskRisk,
            targetKnowledgePointId: signals.targetKnowledgePointId,
          },
          taskFactReasons: signals.basis.filter((item) => item.startsWith('task-risk:')).map((item) => item.replace('task-risk:', '')),
          resourceType: request.resourceType,
          collaborationMode: request.collaborationMode,
          selectedAgentIds: request.selectedAgentIds,
          // 反馈→决策→下一运行链（升级计划 里程碑 E）
          sourceDecisionId: request.sourceDecisionId ?? null,
        },
        publicRationale: {
          observations: [
            `画像不确定度 ${signals.profileUncertainty}`,
            `知识风险 ${signals.knowledgeRisk}`,
            `任务事实风险 ${signals.taskRisk}`,
          ],
          basisRefs: signals.basis.filter((item) => !item.startsWith('task-risk:')),
          decision: `按信号生成 ${plan.nodes.length} 节点 / ${plan.gates.length} 门禁 / 风险 ${plan.riskLevel} 的运行计划`,
          uncertainty: [],
          nextAction: '双路证据检索后按实际覆盖修正审核策略',
        },
        producer: { kind: 'rule', model: null, promptHash: null, settingsHash: null },
      });
      await learningStore.saveChatMessage(learner.id, 'user', request.task, {
        surface: 'study', pathNodeId: request.pathNodeId, resourceType: request.resourceType,
      });
      await appendRunEvent(runId, {
        nodeKey: null,
        type: 'run.accepted',
        summary: `运行已受理：${plan.nodes.length} 个节点、${plan.gates.length} 道不可跳过门禁，风险等级 ${plan.riskLevel}。`,
        payload: { riskLevel: plan.riskLevel, gates: plan.gates },
      });
      await enqueueRootNodes(run);
      res.status(202).json({ success: true, runId, plan });
    } catch (error) {
      if (error instanceof PlanningError) {
        res.status(400).json({ success: false, error: error.message });
        return;
      }
      console.error('[runs] 创建运行失败：', error);
      res.status(500).json({ success: false, error: '运行创建失败，请稍后重试' });
    }
  });

  router.get('/:runId', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      const nodes = await listRunNodes(run.id);
      res.json({
        success: true,
        run: {
          id: run.id,
          status: run.status,
          revisionRound: run.revisionRound,
          riskLevel: run.riskLevel,
          cancelRequested: run.cancelRequested,
          finalAssetId: run.finalAssetId,
          createdAt: run.createdAt,
          startedAt: run.startedAt,
          finishedAt: run.finishedAt,
        },
        task: run.request.task,
        resourceType: run.request.resourceType,
        pathNodeId: run.request.pathNodeId,
        plan: run.plan,
        nodes,
      });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] 读取快照失败：', error);
      res.status(500).json({ success: false, error: '读取运行快照失败' });
    }
  });

  router.get('/:runId/events', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const lastId = Number(Array.isArray(req.headers['last-event-id']) ? req.headers['last-event-id'][0] : req.headers['last-event-id'] ?? '0') || 0;
      for (const event of await listEventsSince(run.id, lastId)) {
        res.write(formatSseEvent(event));
      }
      const terminal = run.status === 'succeeded' || run.status === 'failed' || run.status === 'cancelled';
      if (terminal) {
        res.end();
        return;
      }
      const subscriber = createRunSubscriber();
      const channel = `run:${run.id}`;
      const onMessage = (_ch: string, message: string): void => {
        try {
          res.write(formatSseEvent(JSON.parse(message)));
        } catch {
          // 单条消息解析失败不中断流
        }
      };
      subscriber.on('message', onMessage);
      void subscriber.subscribe(channel);
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        subscriber.off('message', onMessage);
        void subscriber.quit();
      });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] SSE 失败：', error);
      res.status(500).json({ success: false, error: '事件流建立失败' });
    }
  });

  router.post('/:runId/cancel', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await requestCancelRun(learner.id, req.params.runId);
      await cancelRunJobs(run.id);
      res.json({ success: true, status: run.status });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] 取消失败：', error);
      res.status(500).json({ success: false, error: '取消运行失败' });
    }
  });

  // VACP 追溯端点（升级计划 §5.2）：DAG、artifact、Claim、质询、裁决与散列；非本人 404
  router.get('/:runId/trace', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      const [nodes, artifacts, claimRows, debateRows, decisionRows] = await Promise.all([
        listRunNodes(run.id),
        listRunArtifacts(run.id, learner.id),
        getLearningDatabase().db.select().from(claims).where(eq(claims.resourceId, run.id)),
        getLearningDatabase().db.select().from(debateIssues).where(eq(debateIssues.runId, run.id)),
        getLearningDatabase().db.select().from(auditDecisions).where(eq(auditDecisions.runId, run.id)).orderBy(asc(auditDecisions.round)),
      ]);
      const claimIds = claimRows.map((row) => row.id);
      const edges = claimIds.length > 0
        ? await getLearningDatabase().db.select().from(claimEvidence).where(inArray(claimEvidence.claimId, claimIds))
        : [];
      const edgesByClaim = new Map<string, Array<{ evidenceId: string; supportLevel: string }>>();
      for (const edge of edges) {
        edgesByClaim.set(edge.claimId, [
          ...(edgesByClaim.get(edge.claimId) ?? []),
          { evidenceId: edge.evidenceId, supportLevel: edge.supportLevel },
        ]);
      }
      const snapshots = {
        runStart: await getRunSnapshot(run.id, 'run_start'),
        generationEnd: await getRunSnapshot(run.id, 'generation_end'),
      };
      const claimTrace = await buildClaimTrace(run.id);
      res.json({
        success: true,
        run: {
          id: run.id, status: run.status, revisionRound: run.revisionRound, riskLevel: run.riskLevel,
          finalAssetId: run.finalAssetId, createdAt: run.createdAt, finishedAt: run.finishedAt,
        },
        plan: run.plan,
        verificationPolicy: (await getLearningDatabase().db
          .select({ policy: studyRuns.verificationPolicyJson })
          .from(studyRuns)
          .where(eq(studyRuns.id, run.id))
          .limit(1))[0]?.policy ?? null,
        nodes: nodes.map((node) => ({
          nodeKey: node.nodeKey, role: node.role, attempt: node.attempt, status: node.status,
          mandatory: node.mandatory, startedAt: node.startedAt, finishedAt: node.finishedAt,
          resultSummary: node.resultSummary,
        })),
        artifacts,
        claimGraph: claimRows.map((row) => ({
          id: row.id, runId: row.runId, attempt: row.attempt, draftArtifactId: row.draftArtifactId,
          claimType: row.claimType, logicalKey: row.logicalKey, supersedesClaimId: row.supersedesClaimId,
          text: row.text, verdict: row.verdict, critique: row.critique, factualScore: row.factualScore,
          evidence: edgesByClaim.get(row.id) ?? [],
        })),
        debateIssues: debateRows,
        auditDecisions: decisionRows,
        claimTrace,
        snapshots,
      });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] 读取追溯失败：', error);
      res.status(500).json({ success: false, error: '读取运行追溯失败' });
    }
  });

  // 运行历史（升级计划 §5.2）：当前学习者的运行列表（验证页运行选择区）
  router.get('/', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const database = getLearningDatabase();
      const limit = Number.parseInt(String(req.query['limit'] ?? ''), 10);
      const rows = (await database.db.select({
        id: studyRuns.id,
        status: studyRuns.status,
        revisionRound: studyRuns.revisionRound,
        riskLevel: studyRuns.riskLevel,
        finalAssetId: studyRuns.finalAssetId,
        requestJson: studyRuns.requestJson,
        createdAt: studyRuns.createdAt,
        finishedAt: studyRuns.finishedAt,
      }).from(studyRuns)
        .where(eq(studyRuns.learnerId, learner.id))
        .orderBy(asc(studyRuns.createdAt))
        .limit(Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 50) : 20));
      res.json({
        success: true,
        runs: rows.map((row) => ({
          id: row.id,
          status: row.status,
          revisionRound: row.revisionRound,
          riskLevel: row.riskLevel,
          finalAssetId: row.finalAssetId,
          task: (row.requestJson as { task?: string }).task ?? '',
          resourceType: (row.requestJson as { resourceType?: string }).resourceType ?? '',
          createdAt: row.createdAt,
          finishedAt: row.finishedAt,
        })).reverse(),
      });
    } catch (error) {
      console.error('[runs] 运行列表失败：', error);
      res.status(500).json({ success: false, error: '读取运行列表失败' });
    }
  });

  // 比赛证据包（总规 §8.3 + 升级计划 §5.2）：与 /verify 共用构建器
  router.get('/:runId/export', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      const payload = await buildRunExportPayload(run, learner);
      res.setHeader('Content-Disposition', `attachment; filename="run-export-${run.id}.json"`);
      res.json(payload);
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] 导出失败：', error);
      res.status(500).json({ success: false, error: '导出证据包失败' });
    }
  });

  // 离线规则复算（升级计划 §5.2）：不调用模型，校验完整性并重放门禁一致性
  router.post('/:runId/verify', async (req, res) => {
    const learner = await requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      const payload = await buildRunExportPayload(run, learner);
      const result = verifyExportIntegrity(payload as unknown as ExportPayloadLike);
      const replay = replayExport(payload as unknown as ExportPayloadLike);
      const runInfo = (payload['run'] ?? {}) as { executionManifestHash?: string | null };
      res.json({
        success: true,
        runId: run.id,
        integrity: { passed: result.passed, checks: result.checks },
        manifestHash: result.manifestHash,
        manifestMatchesOnline: runInfo.executionManifestHash
          ? result.manifestHash === runInfo.executionManifestHash
          : null,
        replay: {
          passed: replay.passed,
          attempts: replay.attempts,
          draftFinal: replay.draftFinal,
          differences: replay.differences,
        },
      });
    } catch (error) {
      if (error instanceof RunNotFoundError) {
        res.status(404).json({ success: false, error: '运行不存在' });
        return;
      }
      console.error('[runs] 离线校验失败：', error);
      res.status(500).json({ success: false, error: '离线校验失败' });
    }
  });

  return router;
}
