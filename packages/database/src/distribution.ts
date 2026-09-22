import {
  assertInstant,
  assertPublicationRetry,
  assertPublicationTransition,
  invariant,
} from '@vision/domain';
import { assertSchedulingCapabilities, parsePublicationMetadata } from '@vision/publishing';
import { Prisma } from './generated/prisma/client.js';
import type {
  Platform,
  PublicationDeliveryMode,
  PublicationResponseClass,
} from './generated/prisma/client.js';
import { audit, changed, databaseTime, emit, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import { validatePublication } from './lineage.js';

export type PublishAttemptResult = Readonly<{
  responseClass: PublicationResponseClass;
  remotePostId?: string;
  remoteUrl?: string;
  remoteRequestId?: string;
  responseMetadata?: Readonly<Record<string, unknown>>;
  failureCode?: string;
  failureMessage?: string;
}>;

export type ReconciliationResult =
  | Readonly<{ kind: 'PUBLISHED'; remotePostId: string; remoteUrl?: string }>
  | Readonly<{ kind: 'FAILED'; failureCode: string }>
  | Readonly<{ kind: 'UNKNOWN' }>
  | Readonly<{ kind: 'ABSENT_RETRY_ELIGIBLE' }>;

export type DistributionSnapshot = Readonly<{
  publicationId: string;
  operationId: string;
  platform: Platform;
  deliveryMode: PublicationDeliveryMode;
  scheduledAt: string | null;
  metadata: ReturnType<typeof parsePublicationMetadata>;
  account: Readonly<{
    id: string;
    remoteAccountId: string;
    capabilities: ReturnType<typeof assertSchedulingCapabilities>;
  }>;
  execution: Readonly<{
    attemptId: string | null;
    attemptNumber: number | null;
    remoteRequestId: string | null;
    remotePostId: string | null;
    responseMetadata: unknown;
  }>;
  media: Readonly<{
    assetId: string;
    checksumSha256: string;
    sizeBytes: string;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    fps: number | null;
    audioChannels: number | null;
    sampleRate: number | null;
  }>;
}>;

function safeFailureCode(error: unknown) {
  if (error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)) return error.message;
  return 'PUBLISH_PREFLIGHT_FAILED';
}

function boundedMessage(value: string) {
  return value.slice(0, 500);
}

function jsonRecord(value: Readonly<Record<string, unknown>>) {
  return structuredClone(value) as Prisma.InputJsonValue;
}

export class Distribution {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  private async snapshot(publicationId: string): Promise<DistributionSnapshot> {
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
      include: { platformAccount: true, mediaAsset: true },
    });
    invariant(publication.mediaAssetId && publication.mediaAsset, 'EXACT_MEDIA_REQUIRED');
    invariant(publication.platformAccount.status === 'ACTIVE', 'PLATFORM_ACCOUNT_NOT_ACTIVE');
    await validatePublication(
      this.tx,
      publication.renderId,
      publication.mediaAssetId,
      publication.platformAccount.platform,
    );
    const metadata = parsePublicationMetadata(
      publication.platformAccount.platform,
      publication.metadataJson,
    );
    const capabilities = assertSchedulingCapabilities({
      platform: publication.platformAccount.platform,
      deliveryMode: publication.deliveryMode,
      credentialsConfigured: publication.platformAccount.credentialsRef !== null,
      capabilities: publication.platformAccount.capabilitiesJson,
      metadata,
    });
    const latestAttempt = await this.tx.publicationAttempt.findFirst({
      where: { publicationId: publication.id },
      orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
    });
    const asset = publication.mediaAsset;
    invariant(
      asset.status === 'READY' &&
        asset.deletedAt === null &&
        asset.checksumSha256 !== null &&
        asset.sizeBytes !== null &&
        asset.sizeBytes > 0n,
      'MEDIA_PREFLIGHT_FAILED',
    );
    return Object.freeze({
      publicationId: publication.id,
      operationId: publication.operationId,
      platform: publication.platformAccount.platform,
      deliveryMode: publication.deliveryMode,
      scheduledAt: publication.scheduledAt?.toISOString() ?? null,
      metadata,
      account: Object.freeze({
        id: publication.platformAccount.id,
        remoteAccountId: publication.platformAccount.remoteAccountId,
        capabilities,
      }),
      execution: Object.freeze({
        attemptId: latestAttempt?.id ?? null,
        attemptNumber: latestAttempt?.attemptNumber ?? null,
        remoteRequestId: latestAttempt?.remoteRequestId ?? null,
        remotePostId: latestAttempt?.remotePostId ?? null,
        responseMetadata: latestAttempt?.responseMetadataJson ?? null,
      }),
      media: Object.freeze({
        assetId: asset.id,
        checksumSha256: asset.checksumSha256,
        sizeBytes: asset.sizeBytes.toString(),
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        durationMs: asset.durationMs,
        fps: asset.fps,
        audioChannels: asset.audioChannels,
        sampleRate: asset.sampleRate,
      }),
    });
  }

  async schedule(publicationId: string, scheduledAt: Date) {
    assertInstant(scheduledAt);
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
    });
    assertPublicationTransition(publication.deliveryMode, publication.status, 'SCHEDULED');
    await this.snapshot(publicationId);
    const row = await this.tx.publication.update({
      where: { id: publicationId },
      data: { status: 'SCHEDULED', scheduledAt },
    });
    await changed(this.tx, this.actor, 'Publication.scheduled', 'Publication', publicationId);
    return row;
  }

  async cancel(publicationId: string) {
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
    });
    assertPublicationTransition(publication.deliveryMode, publication.status, 'CANCELLED');
    const row = await this.tx.publication.update({
      where: { id: publicationId },
      data: { status: 'CANCELLED' },
    });
    await changed(this.tx, this.actor, 'Publication.cancelled', 'Publication', publicationId);
    return row;
  }

  async dispatchNextDue(
    options: Readonly<{ pauseAllPublishing: boolean; excludePublicationIds?: readonly string[] }>,
  ) {
    if (options.pauseAllPublishing) return { kind: 'PAUSED' } as const;
    const excluded = options.excludePublicationIds ?? [];
    const rows =
      excluded.length === 0
        ? await this.tx.$queryRaw<{ id: string }[]>`
          SELECT "id"
          FROM "Publication"
          WHERE "status" = 'SCHEDULED'
            AND "scheduledAt" IS NOT NULL
            AND "scheduledAt" <= clock_timestamp()
          ORDER BY "scheduledAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1`
        : await this.tx.$queryRaw<{ id: string }[]>(Prisma.sql`
          SELECT "id"
          FROM "Publication"
          WHERE "status" = 'SCHEDULED'
            AND "scheduledAt" IS NOT NULL
            AND "scheduledAt" <= clock_timestamp()
            AND NOT ("id" = ANY(${[...excluded]}::uuid[]))
          ORDER BY "scheduledAt", "id"
          FOR UPDATE SKIP LOCKED
          LIMIT 1`);
    const selected = rows[0];
    if (!selected) return { kind: 'NONE' } as const;
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: selected.id },
      include: { platformAccount: true },
    });
    try {
      await this.snapshot(publication.id);
    } catch (error) {
      return {
        kind: 'BLOCKED',
        publicationId: publication.id,
        failureCode: safeFailureCode(error),
      } as const;
    }
    if (publication.deliveryMode === 'MANUAL_HANDOFF') {
      assertPublicationTransition(
        publication.deliveryMode,
        publication.status,
        'READY_FOR_MANUAL_PUBLISH',
      );
      await this.tx.publication.update({
        where: { id: publication.id },
        data: { status: 'READY_FOR_MANUAL_PUBLISH' },
      });
      await changed(
        this.tx,
        this.actor,
        'Publication.ready_for_manual_publish',
        'Publication',
        publication.id,
      );
      await emit(this.tx, {
        eventType: 'Publication.manual.ready',
        aggregateType: 'Publication',
        aggregateId: publication.id,
        payloadJson: { publicationId: publication.id, operationId: publication.operationId },
      });
      return { kind: 'MANUAL_READY', publicationId: publication.id } as const;
    }
    assertPublicationTransition(publication.deliveryMode, publication.status, 'PUBLISHING');
    const latest = await this.tx.publicationAttempt.findFirst({
      where: { publicationId: publication.id },
      orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
    });
    const attempt = await this.tx.publicationAttempt.create({
      data: {
        publicationId: publication.id,
        attemptNumber: (latest?.attemptNumber ?? 0) + 1,
      },
    });
    await this.tx.publication.update({
      where: { id: publication.id },
      data: { status: 'PUBLISHING' },
    });
    await changed(this.tx, this.actor, 'Publication.publishing', 'Publication', publication.id);
    const outbox = await emit(this.tx, {
      eventType: 'Publication.publish.requested',
      aggregateType: 'Publication',
      aggregateId: publication.id,
      payloadJson: {
        publicationId: publication.id,
        publicationAttemptId: attempt.id,
        operationId: publication.operationId,
      },
    });
    return {
      kind: 'PUBLISH_QUEUED',
      publicationId: publication.id,
      publicationAttemptId: attempt.id,
      outboxEventId: outbox.id,
    } as const;
  }

  async completeManual(publicationId: string, remoteUrl?: string) {
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
      include: { platformAccount: true },
    });
    invariant(publication.platformAccount.platform === 'TIKTOK', 'TIKTOK_MANUAL_ONLY');
    invariant(publication.deliveryMode === 'MANUAL_HANDOFF', 'MANUAL_HANDOFF_REQUIRED');
    assertPublicationTransition(publication.deliveryMode, publication.status, 'PUBLISHED');
    await this.snapshot(publicationId);
    const now = await databaseTime(this.tx);
    const row = await this.tx.publication.update({
      where: { id: publicationId },
      data: {
        status: 'PUBLISHED',
        publishedAt: now,
        ...(remoteUrl !== undefined ? { remoteUrl } : {}),
      },
    });
    await changed(
      this.tx,
      this.actor,
      'Publication.manual_completed',
      'Publication',
      publicationId,
    );
    return row;
  }

  async beginAttempt(publicationAttemptId: string) {
    const attempt = await this.tx.publicationAttempt.findUniqueOrThrow({
      where: { id: publicationAttemptId },
    });
    await lock(this.tx, 'Publication', attempt.publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: attempt.publicationId },
    });
    if (attempt.status === 'RUNNING') {
      if (publication.status === 'PUBLISHING') {
        const now = await databaseTime(this.tx);
        await this.tx.publicationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: 'FAILED',
            finishedAt: now,
            responseClass: 'UNKNOWN_SIDE_EFFECT',
            failureCode: 'AMBIGUOUS_REDELIVERY',
          },
        });
        assertPublicationTransition(
          publication.deliveryMode,
          publication.status,
          'PUBLISHING_UNKNOWN',
        );
        await this.tx.publication.update({
          where: { id: publication.id },
          data: { status: 'PUBLISHING_UNKNOWN' },
        });
        await changed(
          this.tx,
          this.actor,
          'Publication.publishing_unknown',
          'Publication',
          publication.id,
        );
        await this.emitReconciliation(publication.id, publication.operationId);
      }
      return { kind: 'UNKNOWN_REDELIVERY', publicationId: publication.id } as const;
    }
    if (attempt.status !== 'QUEUED' || publication.status !== 'PUBLISHING') {
      return { kind: 'SKIP', publicationId: publication.id } as const;
    }
    let snapshot: DistributionSnapshot;
    try {
      snapshot = await this.snapshot(publication.id);
    } catch (error) {
      const now = await databaseTime(this.tx);
      const failureCode = safeFailureCode(error);
      await this.tx.publicationAttempt.update({
        where: { id: attempt.id },
        data: {
          status: 'FAILED',
          finishedAt: now,
          responseClass: 'PERMANENT_FAILURE',
          failureCode,
        },
      });
      assertPublicationTransition(publication.deliveryMode, publication.status, 'FAILED');
      await this.tx.publication.update({
        where: { id: publication.id },
        data: { status: 'FAILED' },
      });
      await changed(this.tx, this.actor, 'Publication.failed', 'Publication', publication.id);
      return { kind: 'FAILED_PREFLIGHT', publicationId: publication.id, failureCode } as const;
    }
    const now = await databaseTime(this.tx);
    await this.tx.publicationAttempt.update({
      where: { id: attempt.id },
      data: { status: 'RUNNING', startedAt: now },
    });
    await audit(
      this.tx,
      this.actor,
      'PublicationAttempt.running',
      'PublicationAttempt',
      attempt.id,
    );
    return { kind: 'READY', attemptNumber: attempt.attemptNumber, snapshot } as const;
  }

  async recordAttemptPreparation(
    publicationAttemptId: string,
    preparation: Readonly<{
      remoteRequestId?: string;
      responseMetadata?: Readonly<Record<string, unknown>>;
    }>,
  ) {
    const attempt = await this.tx.publicationAttempt.findUniqueOrThrow({
      where: { id: publicationAttemptId },
    });
    await lock(this.tx, 'Publication', attempt.publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: attempt.publicationId },
    });
    invariant(
      attempt.status === 'RUNNING' && publication.status === 'PUBLISHING',
      'STALE_PUBLICATION_ATTEMPT',
    );
    const data: Prisma.PublicationAttemptUpdateInput = {};
    if (preparation.remoteRequestId !== undefined) {
      data.remoteRequestId = preparation.remoteRequestId;
    }
    if (preparation.responseMetadata !== undefined) {
      data.responseMetadataJson = jsonRecord(preparation.responseMetadata);
    }
    const row = await this.tx.publicationAttempt.update({
      where: { id: attempt.id },
      data,
    });
    await audit(
      this.tx,
      this.actor,
      'PublicationAttempt.prepared',
      'PublicationAttempt',
      attempt.id,
    );
    return row;
  }

  async finishAttempt(
    publicationAttemptId: string,
    result: PublishAttemptResult,
    options: Readonly<{ maxAttempts: number; retryDelayMs: number }>,
  ) {
    invariant(
      Number.isSafeInteger(options.maxAttempts) && options.maxAttempts >= 1,
      'INVALID_PUBLISH_MAX_ATTEMPTS',
    );
    invariant(
      Number.isSafeInteger(options.retryDelayMs) && options.retryDelayMs >= 0,
      'INVALID_RETRY_DELAY',
    );
    const attempt = await this.tx.publicationAttempt.findUniqueOrThrow({
      where: { id: publicationAttemptId },
    });
    await lock(this.tx, 'Publication', attempt.publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: attempt.publicationId },
    });
    if (attempt.status !== 'RUNNING' || publication.status !== 'PUBLISHING') {
      return { kind: 'SKIP', publicationId: publication.id } as const;
    }
    const now = await databaseTime(this.tx);
    const remotePostId = 'remotePostId' in result ? result.remotePostId : undefined;
    const failureCode = 'failureCode' in result ? result.failureCode : undefined;
    const failureMessage = 'failureMessage' in result ? result.failureMessage : undefined;
    const attemptData: Prisma.PublicationAttemptUpdateInput = {
      finishedAt: now,
      responseClass: result.responseClass,
    };
    if (result.remoteRequestId !== undefined) attemptData.remoteRequestId = result.remoteRequestId;
    if (remotePostId !== undefined) attemptData.remotePostId = remotePostId;
    if (result.responseMetadata !== undefined) {
      attemptData.responseMetadataJson = jsonRecord(result.responseMetadata);
    }
    if (failureCode !== undefined) attemptData.failureCode = failureCode;
    if (failureMessage !== undefined) attemptData.failureMessage = boundedMessage(failureMessage);
    if (result.responseClass === 'SUCCESS') {
      invariant(result.remotePostId, 'REMOTE_POST_ID_REQUIRED');
      attemptData.status = 'SUCCEEDED';
      await this.tx.publicationAttempt.update({
        where: { id: attempt.id },
        data: attemptData,
      });
      assertPublicationTransition(publication.deliveryMode, publication.status, 'PUBLISHED');
      await this.tx.publication.update({
        where: { id: publication.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: now,
          remotePostId: result.remotePostId,
          remoteUrl: result.remoteUrl ?? null,
        },
      });
      await changed(this.tx, this.actor, 'Publication.published', 'Publication', publication.id);
      return { kind: 'PUBLISHED', publicationId: publication.id } as const;
    }
    attemptData.status = 'FAILED';
    await this.tx.publicationAttempt.update({
      where: { id: attempt.id },
      data: attemptData,
    });
    if (result.responseClass === 'UNKNOWN_SIDE_EFFECT') {
      assertPublicationTransition(
        publication.deliveryMode,
        publication.status,
        'PUBLISHING_UNKNOWN',
      );
      await this.tx.publication.update({
        where: { id: publication.id },
        data: { status: 'PUBLISHING_UNKNOWN' },
      });
      await changed(
        this.tx,
        this.actor,
        'Publication.publishing_unknown',
        'Publication',
        publication.id,
      );
      const outbox = await this.emitReconciliation(publication.id, publication.operationId);
      return {
        kind: 'PUBLISHING_UNKNOWN',
        publicationId: publication.id,
        outboxEventId: outbox.id,
      } as const;
    }
    if (
      (result.responseClass === 'TRANSIENT_FAILURE' || result.responseClass === 'RATE_LIMITED') &&
      attempt.attemptNumber < options.maxAttempts
    ) {
      const next = await this.tx.publicationAttempt.create({
        data: { publicationId: publication.id, attemptNumber: attempt.attemptNumber + 1 },
      });
      const outbox = await emit(this.tx, {
        eventType: 'Publication.publish.requested',
        aggregateType: 'Publication',
        aggregateId: publication.id,
        payloadJson: {
          publicationId: publication.id,
          publicationAttemptId: next.id,
          operationId: publication.operationId,
        },
        availableAt: new Date(now.getTime() + options.retryDelayMs),
      });
      await audit(this.tx, this.actor, 'Publication.retryQueued', 'Publication', publication.id);
      return {
        kind: 'RETRY_QUEUED',
        publicationId: publication.id,
        publicationAttemptId: next.id,
        outboxEventId: outbox.id,
      } as const;
    }
    assertPublicationTransition(publication.deliveryMode, publication.status, 'FAILED');
    await this.tx.publication.update({ where: { id: publication.id }, data: { status: 'FAILED' } });
    await changed(this.tx, this.actor, 'Publication.failed', 'Publication', publication.id);
    return { kind: 'FAILED', publicationId: publication.id } as const;
  }

  async requestReconciliation(publicationId: string) {
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
    });
    invariant(publication.status === 'PUBLISHING_UNKNOWN', 'RECONCILIATION_REQUIRED');
    return this.emitReconciliation(publication.id, publication.operationId);
  }

  async beginReconciliation(publicationId: string) {
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
    });
    if (publication.status !== 'PUBLISHING_UNKNOWN') {
      return { kind: 'SKIP', publicationId } as const;
    }
    try {
      return { kind: 'READY', snapshot: await this.snapshot(publicationId) } as const;
    } catch (error) {
      return {
        kind: 'BLOCKED',
        publicationId,
        failureCode: safeFailureCode(error),
      } as const;
    }
  }

  async finishReconciliation(publicationId: string, result: ReconciliationResult) {
    await lock(this.tx, 'Publication', publicationId);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
    });
    if (publication.status !== 'PUBLISHING_UNKNOWN') {
      return { kind: 'SKIP', publicationId } as const;
    }
    if (result.kind === 'UNKNOWN') {
      await audit(
        this.tx,
        this.actor,
        'Publication.reconciliationUnknown',
        'Publication',
        publicationId,
      );
      return { kind: 'UNKNOWN', publicationId } as const;
    }
    if (result.kind === 'PUBLISHED') {
      const now = await databaseTime(this.tx);
      assertPublicationTransition(publication.deliveryMode, publication.status, 'PUBLISHED');
      await this.tx.publication.update({
        where: { id: publicationId },
        data: {
          status: 'PUBLISHED',
          publishedAt: now,
          remotePostId: result.remotePostId,
          remoteUrl: result.remoteUrl ?? null,
        },
      });
      await changed(this.tx, this.actor, 'Publication.published', 'Publication', publicationId);
      return { kind: 'PUBLISHED', publicationId } as const;
    }
    if (result.kind === 'FAILED') {
      assertPublicationTransition(publication.deliveryMode, publication.status, 'FAILED');
      await this.tx.publication.update({
        where: { id: publicationId },
        data: { status: 'FAILED' },
      });
      await audit(
        this.tx,
        this.actor,
        'Publication.reconciliationFailed',
        'Publication',
        publicationId,
      );
      return { kind: 'FAILED', publicationId } as const;
    }
    assertPublicationRetry(publication.status, true);
    assertPublicationTransition(publication.deliveryMode, publication.status, 'PUBLISHING');
    const latest = await this.tx.publicationAttempt.findFirst({
      where: { publicationId },
      orderBy: [{ attemptNumber: 'desc' }, { id: 'desc' }],
    });
    const attempt = await this.tx.publicationAttempt.create({
      data: { publicationId, attemptNumber: (latest?.attemptNumber ?? 0) + 1 },
    });
    await this.tx.publication.update({
      where: { id: publicationId },
      data: { status: 'PUBLISHING' },
    });
    await changed(this.tx, this.actor, 'Publication.publishing', 'Publication', publicationId);
    const outbox = await emit(this.tx, {
      eventType: 'Publication.publish.requested',
      aggregateType: 'Publication',
      aggregateId: publicationId,
      payloadJson: {
        publicationId,
        publicationAttemptId: attempt.id,
        operationId: publication.operationId,
      },
    });
    return {
      kind: 'RETRY_QUEUED',
      publicationId,
      publicationAttemptId: attempt.id,
      outboxEventId: outbox.id,
    } as const;
  }

  private emitReconciliation(publicationId: string, operationId: string) {
    return emit(this.tx, {
      eventType: 'Publication.reconcile.requested',
      aggregateType: 'Publication',
      aggregateId: publicationId,
      payloadJson: { publicationId, operationId },
    });
  }
}
