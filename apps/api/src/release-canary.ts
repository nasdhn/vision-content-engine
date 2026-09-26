import { randomUUID } from 'node:crypto';

import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Queue, QueueEvents, Worker } from 'bullmq';

import {
  bounded,
  checkReadiness,
  readWorkerHealth,
  RedisHeartbeatStore,
} from '@vision/observability';
import type { RuntimeConfig, SecretResolver } from '@vision/shared';

import { createRuntimeDependencies } from './runtime-dependencies.js';

function redisConnectionFor(url: string) {
  const parsed = new URL(url);
  const hostname =
    parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
      ? parsed.hostname.slice(1, -1)
      : parsed.hostname;

  return {
    host: hostname,
    port: Number(parsed.port || 6379),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    db: Number(parsed.pathname.slice(1) || 0),
    connectTimeout: 1500,
    maxRetriesPerRequest: null,
    enableOfflineQueue: false,
    retryStrategy: () => null,
    ...(parsed.protocol === 'rediss:' ? { tls: {} } : {}),
  };
}

async function checkQueueCanary(redisUrl: string) {
  const queueName = `vce-release-smoke-${randomUUID()}`;
  const nonce = randomUUID();
  const connection = redisConnectionFor(redisUrl);

  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const worker = new Worker(
    queueName,
    async (job) => {
      const data = job.data as { nonce?: unknown };

      if (job.name !== 'release-canary' || data.nonce !== nonce) {
        throw new Error('RELEASE_QUEUE_CANARY_PAYLOAD_MISMATCH');
      }

      return { nonce };
    },
    {
      connection,
      concurrency: 1,
    },
  );

  queue.on('error', () => {});
  events.on('error', () => {});
  worker.on('error', () => {});

  try {
    await bounded(
      () => Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]),
      5000,
    );

    const job = await queue.add('release-canary', { nonce });
    const result = (await job.waitUntilFinished(events, 5000)) as {
      nonce?: unknown;
    };

    if (result.nonce !== nonce) {
      throw new Error('RELEASE_QUEUE_CANARY_RESULT_MISMATCH');
    }
  } finally {
    await worker.close().catch(() => undefined);
    await queue.obliterate({ force: true }).catch(() => undefined);
    await events.close().catch(() => undefined);
    await queue.close().catch(() => undefined);
  }
}

export async function checkReleaseCanary(config: RuntimeConfig, secrets: SecretResolver) {
  const dependencies = createRuntimeDependencies(config, secrets);
  const key = `release-canary/${randomUUID()}.txt`;
  const object = {
    Bucket: config.S3_BUCKET,
    Key: key,
  };

  try {
    const deadline = Date.now() + 10_000;
    let readiness = await checkReadiness(dependencies.probes);

    while (readiness.status !== 'ready' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      readiness = await checkReadiness(dependencies.probes);
    }

    if (readiness.status !== 'ready') {
      throw new Error('RELEASE_DEPENDENCIES_NOT_READY');
    }

    await dependencies.storage.send(
      new PutObjectCommand({
        ...object,
        Body: 'Vision Content Engine release canary',
      }),
    );

    const response = await dependencies.storage.send(new GetObjectCommand(object));

    if ((await response.Body?.transformToString()) !== 'Vision Content Engine release canary') {
      throw new Error('RELEASE_STORAGE_CANARY_MISMATCH');
    }

    await checkQueueCanary(secrets.resolve('REDIS_URL'));

    if (config.VCE_ENV !== 'LOCAL') {
      const store = new RedisHeartbeatStore(async () => dependencies.redis);

      const workers = await readWorkerHealth(store);
      const unhealthy = workers.filter(
        (worker) => !worker.available || !('status' in worker) || worker.status !== 'HEALTHY',
      );

      if (unhealthy.length > 0) {
        throw new Error(
          `RELEASE_WORKERS_NOT_HEALTHY:${unhealthy.map((worker) => worker.component).join(',')}`,
        );
      }
    }

    return {
      environment: config.VCE_ENV,
      dependencies: 'ready' as const,
      storageCanary: 'pass' as const,
      redisQueueCanary: 'pass' as const,
      workerHeartbeatCheck:
        config.VCE_ENV === 'LOCAL'
          ? ('covered-by-local-runtime-smoke' as const)
          : ('pass' as const),
    };
  } finally {
    await dependencies.storage.send(new DeleteObjectCommand(object)).catch(() => undefined);

    await dependencies.close();
  }
}
