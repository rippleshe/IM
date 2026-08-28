/**
 * BullMQ Worker 入口（docs/挑战杯技术开发总规.md §2.3）
 * 独立进程消费 study-run 队列；与 api 共享 study-runtime / study-context / runs 模块。
 * 启动：pnpm worker（需 DATABASE_URL 与 REDIS_URL，见 .env.example）
 */
import 'dotenv/config';
import { Worker } from 'bullmq';
import IORedis from 'ioredis';
import { processStudyRunNode } from './runs/executor.js';
import { STUDY_RUN_QUEUE_NAME } from './runs/queue.js';

const connection = new IORedis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });

const worker = new Worker(STUDY_RUN_QUEUE_NAME, async (job) => processStudyRunNode(job), {
  connection,
  concurrency: 4,
});

worker.on('completed', (job) => {
  console.log(`[worker] ✔ ${job.id}`);
});

worker.on('failed', (job, error) => {
  console.error(`[worker] ✘ ${job?.id ?? 'unknown'}: ${error.message}`);
});

worker.on('error', (error) => {
  console.error(`[worker] worker 错误：${error.message}`);
});

console.log(`[worker] study-run 队列消费中（并发 ${worker.opts.concurrency ?? 1}）`);

async function shutdown(): Promise<void> {
  console.log('[worker] 正在优雅退出…');
  await worker.close();
  await connection.quit();
  process.exit(0);
}

process.on('SIGINT', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
