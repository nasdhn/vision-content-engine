import { StructuredLogger, observeOperation } from '@vision/observability';
import { Queue } from 'bullmq';
import {
  ANALYTICS_OUTBOX_EVENT_TYPES,
  ANALYTICS_QUEUE_NAME,
  parseAnalyticsOutboxEvent,
} from '@vision/analytics';
import type { AnalyticsCollectionJob } from '@vision/analytics';
import type { JobsOptions, QueueOptions } from 'bullmq';
import { Leases, Persistence, WeeklyAnalysisRepository } from '@vision/database';
import type { PrismaClient } from '@vision/database';
import type { LeaseConfig } from '@vision/domain';
import type { RuntimeConfig } from '@vision/shared';
import { latestCompletedUtcWeek } from '@vision/application';
import {
  WEEKLY_ANALYSIS_OUTBOX_EVENT_TYPES,
  WEEKLY_ANALYSIS_QUEUE_NAME,
  parseWeeklyAnalysisOutboxEvent,
} from '@vision/contracts';
import type { WeeklyAnalysisPlan, WeeklyAnalysisQueueJob } from '@vision/contracts';
import { DISTRIBUTION_OUTBOX_EVENT_TYPES, parseDistributionOutboxEvent } from '@vision/publishing';
import type { PlatformPublisher, PublishQueueJob, PublisherRegistry } from '@vision/publishing';

export const PUBLISH_QUEUE_NAME = 'vce-publication';

export interface PublishJobTransport {
  enqueue(job: PublishQueueJob): Promise<void>;
}

function redisConnectionOptions(redisUrl: string): QueueOptions['connection'] {
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

export class BullMqPublishTransport implements PublishJobTransport {
  constructor(private readonly queue: Queue<PublishQueueJob>) {
    queue.on('error', (error: unknown) =>
      new StructuredLogger('control').log('error', 'runtime.failed', { error }),
    );
  }

  async enqueue(job: PublishQueueJob) {
    return observeOperation(
      new StructuredLogger('control'),
      { outboxEventId: job.outboxEventId, operationId: job.operationId },
      () => this.enqueueJob(job),
      'outbox',
    );
  }

  private async enqueueJob(job: PublishQueueJob) {
    const options: JobsOptions = {
      jobId: `outbox-${job.outboxEventId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false,
    };
    await this.queue.add(job.kind, job, options);
  }

  static fromRedisUrl(redisUrl: string) {
    return new BullMqPublishTransport(
      new Queue<PublishQueueJob>(PUBLISH_QUEUE_NAME, {
        connection: redisConnectionOptions(redisUrl),
      }),
    );
  }

  async close() {
    await this.queue.close();
  }
}

export class DistributionOutboxDispatcher {
  private readonly leases: Leases;

  constructor(
    client: PrismaClient,
    leaseConfig: LeaseConfig,
    private readonly transport: PublishJobTransport,
    private readonly owner: string,
    private readonly maxDispatchAttempts = 5,
  ) {
    if (!owner.trim()) throw new Error('OWNER_REQUIRED');
    if (!Number.isSafeInteger(maxDispatchAttempts) || maxDispatchAttempts < 1) {
      throw new Error('INVALID_DISPATCH_ATTEMPTS');
    }
    this.leases = new Leases(client, leaseConfig, {});
  }

  async dispatchOne(pauseAllPublishing = false) {
    if (pauseAllPublishing) return { kind: 'PAUSED' } as const;
    const event = await this.leases.claimOutbox(this.owner, DISTRIBUTION_OUTBOX_EVENT_TYPES);
    if (!event) return { kind: 'NONE' } as const;
    const token = event.claimToken;
    if (!token) throw new Error('OUTBOX_CLAIM_TOKEN_REQUIRED');
    let job: PublishQueueJob;
    try {
      job = parseDistributionOutboxEvent(event);
    } catch {
      await this.leases.finishOutbox(event.id, token, 'FAILED', 'INVALID_DISTRIBUTION_OUTBOX');
      return { kind: 'FAILED', outboxEventId: event.id } as const;
    }
    try {
      await this.transport.enqueue(job);
      await this.leases.finishOutbox(event.id, token, 'DISPATCHED');
      return { kind: 'DISPATCHED', outboxEventId: event.id, job } as const;
    } catch {
      if (event.attemptCount >= this.maxDispatchAttempts) {
        await this.leases.finishOutbox(event.id, token, 'FAILED', 'PUBLISH_QUEUE_ENQUEUE_FAILED');
        return { kind: 'FAILED', outboxEventId: event.id } as const;
      }
      return { kind: 'RETRY_AFTER_LEASE', outboxEventId: event.id } as const;
    }
  }
}

export class DistributionControl {
  private readonly persistence: Persistence;

  constructor(client: PrismaClient) {
    this.persistence = new Persistence(client);
  }

  dispatchDueOne(pauseAllPublishing: boolean, excludePublicationIds: readonly string[] = []) {
    return this.persistence.transaction({ actorType: 'SYSTEM', actorId: 'control' }, (unit) =>
      unit.distribution.dispatchNextDue({ pauseAllPublishing, excludePublicationIds }),
    );
  }

  dispatchDueFromConfig(config: RuntimeConfig) {
    return this.dispatchDueOne(config.PAUSE_ALL_PUBLISHING);
  }

  async dispatchDueBatch(pauseAllPublishing: boolean, limit = 25) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('INVALID_DISTRIBUTION_BATCH_SIZE');
    }
    const results: Awaited<ReturnType<DistributionControl['dispatchDueOne']>>[] = [];
    const excluded: string[] = [];
    for (let index = 0; index < limit; index += 1) {
      const result = await this.dispatchDueOne(pauseAllPublishing, excluded);
      results.push(result);
      if (result.kind === 'NONE' || result.kind === 'PAUSED') break;
      if (result.kind === 'BLOCKED') excluded.push(result.publicationId);
    }
    return results;
  }
}

export type AccountHealthControlOptions = Readonly<{
  realProvidersEnabled: boolean;
}>;

export class PlatformAccountHealthControl {
  private readonly persistence: Persistence;

  constructor(
    private readonly client: PrismaClient,
    private readonly publishers: PublisherRegistry,
    private readonly options: AccountHealthControlOptions,
  ) {
    this.persistence = new Persistence(client);
  }

  async refreshOne(accountId: string) {
    const snapshot = await this.persistence.transaction(
      { actorType: 'SYSTEM', actorId: 'control-account-health' },
      (unit) => unit.distribution.platformAccountForHealth(accountId),
    );
    let publisher: PlatformPublisher;
    try {
      publisher = this.publishers.resolve(snapshot.platform);
    } catch {
      return { kind: 'UNSUPPORTED', accountId } as const;
    }
    if (!publisher.checkAccount) return { kind: 'UNSUPPORTED', accountId } as const;
    if (publisher.isRealProvider && !this.options.realProvidersEnabled) {
      return { kind: 'PAUSED', accountId } as const;
    }
    const result = await publisher.checkAccount(snapshot);
    const applied = await this.persistence.transaction(
      { actorType: 'SYSTEM', actorId: 'control-account-health' },
      (unit) => unit.distribution.applyPlatformAccountHealth(accountId, result),
    );
    return { kind: 'CHECKED', accountId, result, applied } as const;
  }

  async refreshBatch(limit = 25) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('INVALID_ACCOUNT_HEALTH_BATCH_SIZE');
    }
    const accounts = await this.client.platformAccount.findMany({
      where: { status: { in: ['ACTIVE', 'ERROR'] } },
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    const results = [];
    for (const account of accounts) results.push(await this.refreshOne(account.id));
    return results;
  }
}

export interface AnalyticsJobTransport {
  enqueue(job: AnalyticsCollectionJob): Promise<void>;
}

export class BullMqAnalyticsTransport implements AnalyticsJobTransport {
  constructor(private readonly queue: Queue<AnalyticsCollectionJob>) {
    queue.on('error', (error: unknown) =>
      new StructuredLogger('control').log('error', 'runtime.failed', { error }),
    );
  }

  async enqueue(job: AnalyticsCollectionJob) {
    return observeOperation(
      new StructuredLogger('control'),
      { outboxEventId: job.outboxEventId, collectionOperationId: job.collectionOperationId },
      () => this.enqueueJob(job),
      'outbox',
    );
  }

  private async enqueueJob(job: AnalyticsCollectionJob) {
    const options: JobsOptions = {
      jobId: `outbox-${job.outboxEventId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false,
    };
    await this.queue.add(job.kind, job, options);
  }

  static fromRedisUrl(redisUrl: string) {
    return new BullMqAnalyticsTransport(
      new Queue<AnalyticsCollectionJob>(ANALYTICS_QUEUE_NAME, {
        connection: redisConnectionOptions(redisUrl),
      }),
    );
  }

  async close() {
    await this.queue.close();
  }
}

export class AnalyticsOutboxDispatcher {
  private readonly leases: Leases;

  constructor(
    client: PrismaClient,
    leaseConfig: LeaseConfig,
    private readonly transport: AnalyticsJobTransport,
    private readonly owner: string,
    private readonly maxDispatchAttempts = 5,
  ) {
    if (!owner.trim()) throw new Error('OWNER_REQUIRED');
    if (!Number.isSafeInteger(maxDispatchAttempts) || maxDispatchAttempts < 1) {
      throw new Error('INVALID_DISPATCH_ATTEMPTS');
    }
    this.leases = new Leases(client, leaseConfig, {});
  }

  async dispatchOne() {
    const event = await this.leases.claimOutbox(this.owner, ANALYTICS_OUTBOX_EVENT_TYPES);
    if (!event) return { kind: 'NONE' } as const;
    const token = event.claimToken;
    if (!token) throw new Error('OUTBOX_CLAIM_TOKEN_REQUIRED');
    let job: AnalyticsCollectionJob;
    try {
      job = parseAnalyticsOutboxEvent(event);
    } catch {
      await this.leases.finishOutbox(event.id, token, 'FAILED', 'INVALID_ANALYTICS_OUTBOX');
      return { kind: 'FAILED', outboxEventId: event.id } as const;
    }
    try {
      await this.transport.enqueue(job);
      await this.leases.finishOutbox(event.id, token, 'DISPATCHED');
      return { kind: 'DISPATCHED', outboxEventId: event.id, job } as const;
    } catch {
      if (event.attemptCount >= this.maxDispatchAttempts) {
        await this.leases.finishOutbox(event.id, token, 'FAILED', 'ANALYTICS_QUEUE_ENQUEUE_FAILED');
        return { kind: 'FAILED', outboxEventId: event.id } as const;
      }
      return { kind: 'RETRY_AFTER_LEASE', outboxEventId: event.id } as const;
    }
  }
}

export class AnalyticsControl {
  private readonly persistence: Persistence;

  constructor(private readonly client: PrismaClient) {
    this.persistence = new Persistence(client);
  }

  planPublication(publicationId: string) {
    return this.persistence.transaction(
      { actorType: 'SYSTEM', actorId: 'control-analytics' },
      (unit) => unit.analytics.planPublication(publicationId),
    );
  }

  async planEligibleBatch(limit = 25) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('INVALID_ANALYTICS_BATCH_SIZE');
    }
    const publications = await this.client.publication.findMany({
      where: { status: 'PUBLISHED', publishedAt: { not: null } },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: limit,
      select: { id: true },
    });
    const results = [];
    for (const publication of publications)
      results.push(await this.planPublication(publication.id));
    return results;
  }
}
export interface WeeklyAnalysisJobTransport {
  enqueue(job: WeeklyAnalysisQueueJob): Promise<void>;
}

export class BullMqWeeklyAnalysisTransport implements WeeklyAnalysisJobTransport {
  constructor(private readonly queue: Queue<WeeklyAnalysisQueueJob>) {
    queue.on('error', (error: unknown) =>
      new StructuredLogger('control').log('error', 'runtime.failed', { error }),
    );
  }

  async enqueue(job: WeeklyAnalysisQueueJob) {
    return observeOperation(
      new StructuredLogger('control'),
      { outboxEventId: job.outboxEventId, operationId: job.operationId },
      () => this.enqueueJob(job),
      'outbox',
    );
  }

  private async enqueueJob(job: WeeklyAnalysisQueueJob) {
    const options: JobsOptions = {
      jobId: `outbox-${job.outboxEventId}`,
      attempts: 3,
      backoff: { type: 'exponential', delay: 1_000 },
      removeOnComplete: false,
      removeOnFail: false,
    };
    await this.queue.add(job.kind, job, options);
  }

  static fromRedisUrl(redisUrl: string) {
    return new BullMqWeeklyAnalysisTransport(
      new Queue<WeeklyAnalysisQueueJob>(WEEKLY_ANALYSIS_QUEUE_NAME, {
        connection: redisConnectionOptions(redisUrl),
      }),
    );
  }

  async close() {
    await this.queue.close();
  }
}

export class WeeklyAnalysisOutboxDispatcher {
  private readonly leases: Leases;

  constructor(
    client: PrismaClient,
    leaseConfig: LeaseConfig,
    private readonly transport: WeeklyAnalysisJobTransport,
    private readonly owner: string,
    private readonly maxDispatchAttempts = 5,
  ) {
    if (!owner.trim()) throw new Error('OWNER_REQUIRED');
    if (!Number.isSafeInteger(maxDispatchAttempts) || maxDispatchAttempts < 1) {
      throw new Error('INVALID_DISPATCH_ATTEMPTS');
    }
    this.leases = new Leases(client, leaseConfig, {});
  }

  async dispatchOne() {
    const event = await this.leases.claimOutbox(this.owner, WEEKLY_ANALYSIS_OUTBOX_EVENT_TYPES);
    if (!event) return { kind: 'NONE' } as const;
    const token = event.claimToken;
    if (!token) throw new Error('OUTBOX_CLAIM_TOKEN_REQUIRED');

    let job: WeeklyAnalysisQueueJob;
    try {
      job = parseWeeklyAnalysisOutboxEvent(event);
    } catch {
      await this.leases.finishOutbox(event.id, token, 'FAILED', 'INVALID_WEEKLY_ANALYSIS_OUTBOX');
      return { kind: 'FAILED', outboxEventId: event.id } as const;
    }

    try {
      await this.transport.enqueue(job);
      await this.leases.finishOutbox(event.id, token, 'DISPATCHED');
      return { kind: 'DISPATCHED', outboxEventId: event.id, job } as const;
    } catch {
      if (event.attemptCount >= this.maxDispatchAttempts) {
        await this.leases.finishOutbox(
          event.id,
          token,
          'FAILED',
          'WEEKLY_ANALYSIS_QUEUE_ENQUEUE_FAILED',
        );
        return { kind: 'FAILED', outboxEventId: event.id } as const;
      }
      return { kind: 'RETRY_AFTER_LEASE', outboxEventId: event.id } as const;
    }
  }
}

export class WeeklyAnalysisControl {
  private readonly repository: WeeklyAnalysisRepository;

  constructor(private readonly client: PrismaClient) {
    this.repository = new WeeklyAnalysisRepository(client);
  }

  planWindow(input: WeeklyAnalysisPlan) {
    return this.repository.plan(input);
  }

  async planLatestCompletedWeek(input: Omit<WeeklyAnalysisPlan, 'analysisWindow'>) {
    const rows = await this.client.$queryRaw<{ now: Date }[]>`
      SELECT clock_timestamp()::timestamptz(3) AS now
    `;
    const now = rows[0]?.now;
    if (!now) throw new Error('DATABASE_CLOCK_UNAVAILABLE');
    return this.repository.plan({
      ...input,
      analysisWindow: latestCompletedUtcWeek(now),
    });
  }
}
