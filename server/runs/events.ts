/**
 * run 事件分发（docs/挑战杯技术开发总规.md §4.3）
 * PostgreSQL run_events 是事件事实；Redis 只做实时分发，断线用 Last-Event-ID 从库回放。
 */
import IORedis from 'ioredis';
import type { RunEvent } from './protocol.js';

let publisher: IORedis | null = null;

function redisUrl(): string {
  return process.env['REDIS_URL'] ?? 'redis://localhost:6379';
}

export function getRedisPublisher(): IORedis {
  publisher ??= new IORedis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: false });
  return publisher;
}

export function createRunSubscriber(): IORedis {
  return new IORedis(redisUrl(), { maxRetriesPerRequest: null, lazyConnect: false });
}

export function runEventChannel(runId: string): string {
  return `run:${runId}`;
}

export function publishRunEvent(runId: string, event: RunEvent): void {
  getRedisPublisher().publish(runEventChannel(runId), JSON.stringify(event)).catch(() => {
    // 分发失败不阻塞执行：事件已持久化，前端可用快照/回放兜底
  });
}
