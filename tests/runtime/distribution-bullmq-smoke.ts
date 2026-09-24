import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Queue } from 'bullmq';
import { BullMqPublishTransport } from '../../apps/control/src/index.js';
import type { PublishQueueJob } from '../../packages/publishing/src/index.js';

import {
  EnvironmentSecretResolver,
  accountCredentialResolver,
} from '../../packages/shared/src/secrets.js';

const redisUrl = new URL(process.env.REDIS_URL ?? '');
if (!['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname)) {
  throw new Error('BULLMQ_SMOKE_REQUIRES_LOCAL_REDIS');
}
const queueName = `vce-publication-smoke-${randomUUID()}`;
const queue = new Queue<PublishQueueJob>(queueName, {
  connection: {
    host: redisUrl.hostname,
    port: Number(redisUrl.port || 6379),
    ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  },
});
const transport = new BullMqPublishTransport(queue);
const outboxEventId = randomUUID();
const job: PublishQueueJob = {
  kind: 'PUBLISH',
  outboxEventId,
  publicationId: randomUUID(),
  publicationAttemptId: randomUUID(),
  operationId: randomUUID(),
};
try {
  await transport.enqueue(job);
  await transport.enqueue(job);
  const stored = await queue.getJob(`outbox-${outboxEventId}`);
  if (!stored) throw new Error('BULLMQ_JOB_NOT_FOUND');
  if (JSON.stringify(stored.data) !== JSON.stringify(job))
    throw new Error('BULLMQ_PAYLOAD_MISMATCH');
  const waiting = await queue.getWaiting();
  if (waiting.filter((item) => item.id === `outbox-${outboxEventId}`).length !== 1) {
    throw new Error('BULLMQ_DEDUPLICATION_FAILED');
  }
  if (/token|credential|secret/i.test(JSON.stringify(stored.data))) {
    throw new Error('BULLMQ_JOB_CONTAINS_SECRET_FIELD');
  }
  // Credentials stay worker-local after delivery of the canonical IDs.
  const sentinel = ['VERY', 'FAKE', 'QUEUE', 'DO_NOT_USE'].join('_');
  const resolver = accountCredentialResolver(
    new EnvironmentSecretResolver({ INSTAGRAM_ACCESS_TOKEN: sentinel }, ['INSTAGRAM_ACCESS_TOKEN']),
    'INSTAGRAM_ACCESS_TOKEN',
    'fixture-account',
  );
  const credential = await resolver.resolve('fixture-account');
  if (credential.accessToken !== sentinel) throw new Error('RUNTIME_CREDENTIAL_UNAVAILABLE');
  const reloaded = await queue.getJob(`outbox-${outboxEventId}`);
  if (!reloaded || JSON.stringify(reloaded.data).includes(sentinel))
    throw new Error('BULLMQ_CREDENTIAL_LEAK');
  console.log('PASS: BullMQ uses stable outbox job identity with one secret-free queued job.');
} finally {
  await queue.obliterate({ force: true }).catch(() => undefined);
  await transport.close();
}
