import { observeWorkerLifecycle, type WorkerProbes } from '@vision/observability';
import { StructuredLogger, observeOperation } from '@vision/observability';
import { Worker } from 'bullmq';
import type { WorkerOptions } from 'bullmq';
import { AnalyticsCollectionJobSchema, ANALYTICS_QUEUE_NAME } from '@vision/analytics';
import type { AnalyticsCollectionJob, StaticAnalyticsCollectorRegistry } from '@vision/analytics';
import { Leases } from '@vision/database';
import type { AnalyticsRuntime, PrismaClient } from '@vision/database';

type AnalyticsLeaseConfig = ConstructorParameters<typeof Leases>[1];
type PersistedAnalyticsCollection = Awaited<ReturnType<AnalyticsRuntime['persistCollection']>>;

export type AnalyticsWorkerOptions = Readonly<{
  realProvidersEnabled: boolean;
  workerId?: string;
  leaseConfig?: AnalyticsLeaseConfig;
  paused?: () => boolean;
}>;

export const DEFAULT_ANALYTICS_JOB_LEASE = Object.freeze({
  durationMs: 60_000,
  heartbeatIntervalMs: 15_000,
}) satisfies AnalyticsLeaseConfig;

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
  private readonly leases: Leases;
  private readonly leaseConfig: AnalyticsLeaseConfig;
  private readonly workerId: string;

  constructor(
    client: PrismaClient,
    private readonly collectors: StaticAnalyticsCollectorRegistry,
    private readonly options: AnalyticsWorkerOptions,
  ) {
    this.leaseConfig = options.leaseConfig ?? DEFAULT_ANALYTICS_JOB_LEASE;
    this.workerId = options.workerId?.trim() || 'worker-analytics';
    this.leases = new Leases(client, this.leaseConfig, {});
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
    if (this.options.paused?.()) return { kind: 'PAUSED' } as const;

    const collector = this.collectors.resolve(job.platform);
    if (collector.isRealProvider && !this.options.realProvidersEnabled) {
      throw new Error('REAL_ANALYTICS_PROVIDERS_DISABLED');
    }

    const claim = await this.leases.claimJobById(job.jobAttemptId, this.workerId, 'SAFE_RETRY', {
      queueName: ANALYTICS_QUEUE_NAME,
      jobType: `ANALYTICS_COLLECT:${job.adapterKey}:${job.windowKey}`,
      operationId: job.collectionOperationId,
      workflowRunId: job.workflowRunId,
    });
    if (claim.kind !== 'READY') return claim;
    const leaseToken = claim.job.leaseToken;
    if (!leaseToken) throw new Error('ANALYTICS_LEASE_TOKEN_REQUIRED');

    let heartbeatFailure: unknown = null;
    const timer = setInterval(() => {
      void this.leases.heartbeatJob(job.jobAttemptId, leaseToken).catch((error: unknown) => {
        heartbeatFailure ??= error;
      });
    }, this.leaseConfig.heartbeatIntervalMs);
    timer.unref?.();

    try {
      const begin = await this.leases.withJobLease(job.jobAttemptId, leaseToken, (unit) =>
        unit.analytics.beginCollection(job.jobAttemptId),
      );
      if (begin.kind !== 'READY') return begin;

      const observation = await collector.collect(begin.snapshot);
      if (heartbeatFailure) throw heartbeatFailure;

      let persisted: PersistedAnalyticsCollection | undefined;
      await this.leases.finishJob(
        job.jobAttemptId,
        leaseToken,
        'SUCCEEDED',
        undefined,
        async (unit) => {
          persisted = await unit.analytics.persistCollection(job.jobAttemptId, observation);
        },
      );
      if (!persisted) throw new Error('ANALYTICS_PERSISTENCE_MISSING');
      return persisted;
    } finally {
      clearInterval(timer);
    }
  }
}

export function createBullMqAnalyticsWorker(input: {
  probes: WorkerProbes;
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
  return observeWorkerLifecycle(worker, 'worker-analytics', input.probes);
}
