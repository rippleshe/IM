/**
 * BullMQ 队列（docs/挑战杯技术开发总规.md §4.3）
 * jobId = runId:nodeKey:attempt —— BullMQ 按 jobId 去重，重复提交不会重复执行。
 */
import { Queue } from 'bullmq';
import IORedis from 'ioredis';

export const STUDY_RUN_QUEUE_NAME = 'study-run';

let connection: IORedis | null = null;
let queue: Queue<NodeJobData> | null = null;

export interface NodeJobData {
  runId: string;
  nodeKey: string;
  attempt: number;
}

export function nodeJobId(runId: string, nodeKey: string, attempt: number): string {
  return `${runId}:${nodeKey}:${attempt}`;
}

export function getStudyRunQueue(): Queue<NodeJobData> {
  if (!queue) {
    connection ??= new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
    queue = new Queue<NodeJobData>(STUDY_RUN_QUEUE_NAME, {
      connection,
      defaultJobOptions: { removeOnComplete: { age: 3600, count: 2000 }, removeOnFail: { age: 3600 } },
    });
  }
  return queue;
}

/** 失败最多重试 2 次（attempts = 首次 + 2 次重试） */
export async function enqueueRunNode(runId: string, nodeKey: string, attempt: number, delayMs = 0): Promise<void> {
  await getStudyRunQueue().add(
    'node',
    { runId, nodeKey, attempt },
    {
      jobId: nodeJobId(runId, nodeKey, attempt),
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      ...(delayMs > 0 ? { delay: delayMs } : {}),
    },
  );
}

/** 取消：移除该 run 所有等待/延迟中的节点 job；正在执行的行为由 DB cancel 标志兜底 */
export async function cancelRunJobs(runId: string): Promise<number> {
  const q = getStudyRunQueue();
  const jobs = await q.getJobs(['waiting', 'delayed']);
  let removed = 0;
  for (const job of jobs) {
    if (job.id?.startsWith(`${runId}:`)) {
      try {
        await job.remove();
        removed += 1;
      } catch {
        // job 可能刚被 worker 取走，交给执行器检查 cancel 标志
      }
    }
  }
  return removed;
}
