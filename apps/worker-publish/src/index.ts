import { Worker } from 'bullmq';
import type { WorkerOptions } from 'bullmq';
import { Persistence } from '@vision/database';
import type { PrismaClient } from '@vision/database';
import type { RuntimeConfig } from '@vision/shared';
import {
  DEFAULT_PUBLISH_RETRY_POLICY,
  ProviderPublishError,
  PublishQueueJobSchema,
  providerPublishFailure,
  retryDelayMs,
} from '@vision/publishing';
import type {
  PlatformPublisher,
  PublisherRegistry,
  PublishQueueJob,
  PublishRetryPolicy,
  PublishResult,
} from '@vision/publishing';

export const PUBLISH_QUEUE_NAME = 'vce-publication';

export type PublishWorkerOptions = Readonly<{
  pauseAllPublishing: boolean;
  realProvidersEnabled: boolean;
  retryPolicy?: PublishRetryPolicy;
  random?: () => number;
}>;

export function publishWorkerOptionsFromConfig(config: RuntimeConfig): PublishWorkerOptions {
  return Object.freeze({
    pauseAllPublishing: config.PAUSE_ALL_PUBLISHING,
    realProvidersEnabled: false,
  });
}

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

function assertPublisherAllowed(publisher: PlatformPublisher, options: PublishWorkerOptions) {
  if (options.pauseAllPublishing) throw new Error('PUBLISHING_PAUSED');
  if (publisher.isRealProvider && !options.realProvidersEnabled) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'REAL_PROVIDERS_DISABLED',
    });
  }
}

export class PublishWorkerOrchestrator {
  private readonly persistence: Persistence;
  private readonly retryPolicy: PublishRetryPolicy;
  private readonly random: () => number;

  constructor(
    client: PrismaClient,
    private readonly publishers: PublisherRegistry,
    private readonly options: PublishWorkerOptions,
  ) {
    this.persistence = new Persistence(client);
    this.retryPolicy = options.retryPolicy ?? DEFAULT_PUBLISH_RETRY_POLICY;
    this.random = options.random ?? Math.random;
  }

  async process(input: unknown) {
    const job = PublishQueueJobSchema.parse(input);
    if (this.options.pauseAllPublishing) return { kind: 'PAUSED' } as const;
    if (job.kind === 'PUBLISH') return this.publish(job);
    return this.reconcile(job);
  }

  private async publish(job: Extract<PublishQueueJob, { kind: 'PUBLISH' }>) {
    const begin = await this.persistence.transaction(
      { actorType: 'WORKER', actorId: 'worker-publish' },
      (unit) => unit.distribution.beginAttempt(job.publicationAttemptId),
    );
    if (begin.kind !== 'READY') return begin;
    const publisher = this.publishers.resolve(begin.snapshot.platform);
    let result: PublishResult;
    try {
      assertPublisherAllowed(publisher, this.options);
      const preparation = await publisher.prepare(begin.snapshot);
      await this.persistence.transaction(
        { actorType: 'WORKER', actorId: 'worker-publish' },
        (unit) => unit.distribution.recordAttemptPreparation(job.publicationAttemptId, preparation),
      );
      result = await publisher.publish(begin.snapshot, preparation);
    } catch (error) {
      result =
        providerPublishFailure(error) ??
        ({
          responseClass: 'UNKNOWN_SIDE_EFFECT',
          failureCode: 'UNCLASSIFIED_PROVIDER_ERROR',
        } as const);
    }
    const delay =
      result.responseClass === 'TRANSIENT_FAILURE' || result.responseClass === 'RATE_LIMITED'
        ? retryDelayMs(this.retryPolicy, begin.attemptNumber, result.retryAfterMs, this.random)
        : 0;
    return this.persistence.transaction(
      { actorType: 'WORKER', actorId: 'worker-publish' },
      (unit) =>
        unit.distribution.finishAttempt(job.publicationAttemptId, result, {
          maxAttempts: this.retryPolicy.maxAttempts,
          retryDelayMs: delay,
        }),
    );
  }

  private async reconcile(job: Extract<PublishQueueJob, { kind: 'RECONCILE' }>) {
    const begin = await this.persistence.transaction(
      { actorType: 'WORKER', actorId: 'worker-publish' },
      (unit) => unit.distribution.beginReconciliation(job.publicationId),
    );
    if (begin.kind !== 'READY') return begin;
    const publisher = this.publishers.resolve(begin.snapshot.platform);
    assertPublisherAllowed(publisher, this.options);
    try {
      const result = await publisher.reconcile(begin.snapshot);
      return this.persistence.transaction(
        { actorType: 'WORKER', actorId: 'worker-publish' },
        (unit) => unit.distribution.finishReconciliation(job.publicationId, result),
      );
    } catch {
      return { kind: 'RECONCILIATION_ERROR', publicationId: job.publicationId } as const;
    }
  }
}

export function createBullMqPublishWorker(input: {
  redisUrl: string;
  orchestrator: PublishWorkerOrchestrator;
}) {
  return new Worker<PublishQueueJob>(
    PUBLISH_QUEUE_NAME,
    async (job) => input.orchestrator.process(job.data),
    { connection: redisConnectionOptions(input.redisUrl) },
  );
}

export * from './instagram-asset-lease.js';
export * from './youtube-asset-source.js';
