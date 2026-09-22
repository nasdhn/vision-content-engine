import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { BullMqAnalyticsTransport } from '../../apps/control/src/index.js';
import { ANALYTICS_QUEUE_NAME } from '../../packages/analytics/src/index.js';
import type { AnalyticsCollectionJob } from '../../packages/analytics/src/index.js';

const redisUrl = new URL(process.env.REDIS_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname)) {
  throw new Error('BULLMQ_SMOKE_REQUIRES_LOCAL_REDIS');
}
const queueName = `${ANALYTICS_QUEUE_NAME}-smoke-${randomUUID()}`;
const queue = new Queue<AnalyticsCollectionJob>(queueName, {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  },
});
const transport = new BullMqAnalyticsTransport(queue);
const outboxEventId = randomUUID();
const job: AnalyticsCollectionJob = {
  schemaVersion: 'v1',
  kind: 'COLLECT_PLATFORM_METRICS',
  outboxEventId,
  workflowRunId: randomUUID(),
  jobAttemptId: randomUUID(),
  publicationId: randomUUID(),
  platformAccountId: randomUUID(),
  platform: 'YOUTUBE',
  adapterKey: 'YOUTUBE_ANALYTICS_V1',
  windowKey: 'T_PLUS_24H',
  collectionOperationId: randomUUID(),
  scheduledFor: '2026-09-23T00:00:00.000Z',
};
try {
  await transport.enqueue(job);
  await transport.enqueue(job);
  const stored = await queue.getJob(`outbox-${outboxEventId}`);
  if (!stored) throw new Error('ANALYTICS_BULLMQ_JOB_NOT_FOUND');
  if (JSON.stringify(stored.data) !== JSON.stringify(job))
    throw new Error('ANALYTICS_BULLMQ_PAYLOAD_MISMATCH');
  const waiting = await queue.getWaiting();
  if (waiting.filter((item) => item.id === `outbox-${outboxEventId}`).length !== 1) {
    throw new Error('ANALYTICS_BULLMQ_DEDUPLICATION_FAILED');
  }
  if (/token|credential|secret/i.test(JSON.stringify(stored.data))) {
    throw new Error('ANALYTICS_BULLMQ_JOB_CONTAINS_SECRET_FIELD');
  }
  console.log(
    'PASS: Analytics BullMQ uses stable outbox identity with one secret-free queued job.',
  );
} finally {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await transport.close();
}
