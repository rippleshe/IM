/**
 * StudyRun API 路由（docs/挑战杯技术开发总规.md §3、§4）
 * 202 建库 → SSE 增量事件（Last-Event-ID 续传）→ 快照 → 取消。
 * learnerId 一律从 HttpOnly Cookie 会话推导，URL 与请求体不作为授权依据。
 */
import express from 'express';
import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { AuthenticatedLearner } from '../../src/learning/identity.js';
import { identityStore, learningStore } from '../study-context.js';
import { getLearningDatabase } from '../db/client.js';
import { auditDecisions, claims, claimEvidence, debateIssues } from '../db/schema.js';
import { formatSseEvent } from './protocol.js';
import { PlanningError, parseStudyRunRequest, planStudyRun } from './planner.js';
import {
  RunNotFoundError,
  appendRunEvent,
  createStudyRun,
  enqueueRootNodes,
  getRunForLearner,
  listEventsSince,
  listRunNodes,
  requestCancelRun,
} from './service.js';
import { cancelRunJobs } from './queue.js';
import { createRunSubscriber } from './events.js';

type RequireLearner = (req: express.Request, res: express.Response) => AuthenticatedLearner | null;

/** 编排信号来自学习状态的确定性推导；BKT 上线后由置信度直接驱动（总规 §5、§7） */
function derivePlannerSignals(learnerId: string): { profileUncertainty: number; knowledgeRisk: number; evidenceCoverageHint: 'sparse' | 'normal' | 'rich' } {
  const profile = learningStore.getProfile(learnerId);
  const knowledgeRisk = profile.accuracy === null || profile.accuracy === undefined
    ? 0.2
    : Math.max(0, Math.min(1, 1 - profile.accuracy));
  const hasHistory = profile.studyMinutes > 0 || profile.assetsCount > 0;
  const profileUncertainty = hasHistory ? 0.35 : 0.6;
  return { profileUncertainty, knowledgeRisk, evidenceCoverageHint: 'normal' };
}

export function createRunsRouter(requireLearner: RequireLearner): express.Router {
  const router = express.Router();

  router.post('/', async (req, res) => {
    const learner = requireLearner(req, res);
    if (!learner) return;
    try {
      const request = parseStudyRunRequest(req.body);
      const runId = `study-run-${randomUUID()}`;
      const plan = planStudyRun(runId, request, derivePlannerSignals(learner.id));
      const run = await createStudyRun({ runId, learnerId: learner.id, request, plan });
      learningStore.saveChatMessage(learner.id, 'user', request.task, {
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
    const learner = requireLearner(req, res);
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
    const learner = requireLearner(req, res);
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
    const learner = requireLearner(req, res);
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

  // 比赛证据包（总规 §8.3）：画像→诊断→DAG 事件→结论→EvidencePack→声明图→资源→反馈→画像变化
  router.get('/:runId/export', async (req, res) => {
    const learner = requireLearner(req, res);
    if (!learner) return;
    try {
      const run = await getRunForLearner(learner.id, req.params.runId);
      const [nodes, events] = await Promise.all([listRunNodes(run.id), listEventsSince(run.id, 0)]);
      const database = getLearningDatabase();
      const [claimRows, debateRows, decisionRows] = await Promise.all([
        database.db.select().from(claims).where(eq(claims.resourceId, run.id)),
        database.db.select().from(debateIssues).where(eq(debateIssues.runId, run.id)),
        database.db.select().from(auditDecisions).where(eq(auditDecisions.runId, run.id)).orderBy(asc(auditDecisions.round)),
      ]);
      const claimIds = claimRows.map((row) => row.id);
      const edges = claimIds.length > 0
        ? await database.db.select().from(claimEvidence)
        : [];
      const edgesByClaim = new Map<string, Array<{ evidenceId: string; supportLevel: string }>>();
      for (const edge of edges) {
        if (!claimIds.includes(edge.claimId)) continue;
        edgesByClaim.set(edge.claimId, [
          ...(edgesByClaim.get(edge.claimId) ?? []),
          { evidenceId: edge.evidenceId, supportLevel: edge.supportLevel },
        ]);
      }
      const finalAsset = run.finalAssetId ? learningStore.getAsset(learner.id, run.finalAssetId) : null;
      const feedback = finalAsset ? learningStore.getAssetFeedback(learner.id, finalAsset.id) : null;
      const chatMessages = learningStore.listChatMessages(learner.id, 200, 'study')
        .filter((message) => message.metadata['runId'] === run.id);
      const onboarding = identityStore.getOnboarding(learner.id);

      const payload = {
        exportedAt: new Date().toISOString(),
        learner: {
          id: learner.id,
          loginName: learner.loginName,
          onboarding,
        },
        initialLearnerState: {
          skillStates: learningStore.getSkillStates(learner.id),
          diagnostic: learningStore.getLatestDiagnosticSession(learner.id),
        },
        request: run.request,
        plan: run.plan,
        run: {
          id: run.id, status: run.status, revisionRound: run.revisionRound, riskLevel: run.riskLevel,
          finalAssetId: run.finalAssetId, createdAt: run.createdAt, startedAt: run.startedAt, finishedAt: run.finishedAt,
        },
        dagNodes: nodes,
        events,
        agentConclusions: chatMessages.filter((message) => message.metadata['kind'] === 'agent'),
        evidenceChain: {
          claims: claimRows.map((row) => ({
            id: row.id, text: row.text, verdict: row.verdict,
            critique: row.critique, factualScore: row.factualScore,
            evidence: edgesByClaim.get(row.id) ?? [],
          })),
          debateIssues: debateRows,
          auditDecisions: decisionRows,
        },
        finalAsset,
        learningFeedback: feedback,
      };
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

  return router;
}
