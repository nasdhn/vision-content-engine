import { StructuredLogger, observeOperation } from '@vision/observability';
import { Worker } from 'bullmq';
import type { WorkerOptions } from 'bullmq';
import { AnalyticsCollectionJobSchema, ANALYTICS_QUEUE_NAME } from '@vision/analytics';
import type { AnalyticsCollectionJob, StaticAnalyticsCollectorRegistry } from '@vision/analytics';
import { Persistence } from '@vision/database';
import type { PrismaClient } from '@vision/database';

export type AnalyticsWorkerOptions = Readonly<{ realProvidersEnabled: boolean }>;

function redisConnectionOptions(redisUrl: string): WorkerOptions['connection'] {
  const parsed = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) throw new Error('INVALID_REDIS_URL');
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  if (db !== undefined && (!Number.isSafeInteger(db) || db < 0))
    throw new Error('INVALID_REDIS_DB');
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'rediss:' ? 6380 : 6379)),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: { servername: parsed.hostname } } : {}),
  };
}

export class AnalyticsWorkerOrchestrator {
  private readonly persistence: Persistence;

  constructor(
    client: PrismaClient,
    private readonly collectors: StaticAnalyticsCollectorRegistry,
    private readonly options: AnalyticsWorkerOptions,
  ) {
    this.persistence = new Persistence(client);
  }

  async process(input: unknown) {
    const job = AnalyticsCollectionJobSchema.parse(input);
    return observeOperation(
      new StructuredLogger('worker-analytics'),
      {
        workflowRunId: job.workflowRunId,
        collectionOperationId: job.collectionOperationId,
        publicationId: job.publicationId,
        jobAttemptId: job.jobAttemptId,
        platform: job.platform,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(job: ReturnType<typeof AnalyticsCollectionJobSchema.parse>) {
    const collector = this.collectors.resolve(job.platform);
    if (collector.isRealProvider && !this.options.realProvidersEnabled) {
      throw new Error('REAL_ANALYTICS_PROVIDERS_DISABLED');
    }
    const begin = await this.persistence.transaction(
      { actorType: 'WORKER', actorId: 'worker-analytics' },
      (unit) => unit.analytics.beginCollection(job.jobAttemptId),
    );
    if (begin.kind !== 'READY') return begin;
    const observation = await collector.collect(begin.snapshot);
    return this.persistence.transaction(
      { actorType: 'WORKER', actorId: 'worker-analytics' },
      (unit) => unit.analytics.completeCollection(job.jobAttemptId, observation),
    );
  }
}

export function createBullMqAnalyticsWorker(input: {
  redisUrl: string;
  orchestrator: AnalyticsWorkerOrchestrator;
}) {
  const worker = new Worker<AnalyticsCollectionJob>(
    ANALYTICS_QUEUE_NAME,
    async (job) => input.orchestrator.process(job.data),
    { connection: redisConnectionOptions(input.redisUrl) },
  );
  worker.on('error', (error: unknown) =>
    new StructuredLogger('worker-analytics').log('error', 'runtime.failed', { error }),
  );
  return worker;
}
