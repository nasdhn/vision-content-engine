import { randomUUID } from 'node:crypto';
import {
  AnalyticsObservationSchema,
  MANUAL_TIKTOK_WINDOWS,
  adapterKeyFor,
  collectionDueAt,
  collectionOperationIdFor,
  collectionWindowsFor,
  normalizeTikTokManualMetrics,
  parseManualTikTokJobType,
  rawPayloadHash,
  attributionHintsForUmamiEvent,
  platformHintForUmamiEvent,
  umamiEventKind,
  UMAMI_ATTRIBUTION_POLICY_VERSION,
  UMAMI_PROVIDER_SCHEMA_VERSION,
  UmamiInferencePolicySchema,
} from '@vision/analytics';
import type {
  AnalyticsCollectionSnapshot,
  AnalyticsWindowKey,
  UmamiEventRow,
  UmamiInferencePolicy,
} from '@vision/analytics';
import { invariant } from '@vision/domain';
import { assertNoSecrets } from '@vision/contracts/canonical';
import type { Prisma } from './generated/prisma/client.js';
import { audit, databaseTime, emit, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';

export type VisionAttributionInput = Readonly<{
  externalEventId: string;
  eventType: 'SIGNUP' | 'ACTIVATION' | 'CUSTOMER' | 'REVENUE';
  occurredAt: Date;
  userId?: string;
  trackingCode?: string;
  campaignTrackingCode?: string;
  valueAmountMinor?: number;
  valueCurrency?: string;
  metadata?: Record<string, unknown>;
}>;

export type UmamiImportInput = Readonly<{
  row: UmamiEventRow;
  inferencePolicy: UmamiInferencePolicy;
}>;

function json(value: unknown) {
  assertNoSecrets(value);
  return structuredClone(value) as Prisma.InputJsonValue;
}

function parseJobType(jobType: string) {
  const match = /^ANALYTICS_COLLECT:([^:]+):(T_PLUS_(?:1H|6H|24H|72H|7D|30D))$/.exec(jobType);
  invariant(match, 'INVALID_ANALYTICS_JOB_TYPE');
  return { adapterKey: match[1]!, windowKey: match[2]! as AnalyticsWindowKey };
}

export class AnalyticsRuntime {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  async planPublication(publicationId: string) {
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`analytics:${publicationId}`}, 0))`;
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
      include: { platformAccount: true },
    });
    invariant(
      publication.status === 'PUBLISHED' && publication.publishedAt,
      'PUBLICATION_NOT_PUBLISHED',
    );
    invariant(publication.remotePostId, 'REMOTE_POST_ID_REQUIRED');

    const platform = publication.platformAccount.platform;

    const existing = await this.tx.workflowRun.findFirst({
      where: {
        workflowType: 'ANALYTICS',
        rootEntityType: 'PublicationAnalytics',
        rootEntityId: publication.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      include: { jobAttempts: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } },
    });
    if (existing) {
      return {
        kind: 'EXISTING',
        publicationId,
        workflowRunId: existing.id,
        jobAttemptIds: existing.jobAttempts.map((row) => row.id),
      } as const;
    }

    if (platform === 'TIKTOK') {
      const now = await databaseTime(this.tx);
      const workflow = await this.tx.workflowRun.create({
        data: {
          workflowType: 'ANALYTICS',
          rootEntityType: 'PublicationAnalytics',
          rootEntityId: publication.id,
          status: 'WAITING',
          currentStep: 'manual_measurement_windows',
          startedAt: now,
        },
      });
      const jobAttemptIds: string[] = [];
      for (const window of MANUAL_TIKTOK_WINDOWS) {
        const operationId = collectionOperationIdFor({
          publicationId: publication.id,
          adapterKey: 'TIKTOK_MANUAL_V1',
          windowKey: window.key,
          collectionMethod: 'MANUAL_ENTRY',
        });
        const job = await this.tx.jobAttempt.create({
          data: {
            workflowRunId: workflow.id,
            queueName: 'vce-analytics-manual',
            jobType: `ANALYTICS_MANUAL:TIKTOK:${window.key}`,
            operationId,
            attemptNumber: 1,
            status: 'QUEUED',
          },
        });
        jobAttemptIds.push(job.id);
      }
      await audit(
        this.tx,
        this.actor,
        'Analytics.manualPromptsPlanned',
        'Publication',
        publication.id,
      );
      return {
        kind: 'MANUAL_PLANNED',
        publicationId,
        workflowRunId: workflow.id,
        jobAttemptIds,
      } as const;
    }

    const adapterKey = adapterKeyFor(platform);
    const windows = collectionWindowsFor(platform, 'PLATFORM_API');
    invariant(windows.length > 0, 'ANALYTICS_WINDOWS_UNAVAILABLE');
    const now = await databaseTime(this.tx);
    const workflow = await this.tx.workflowRun.create({
      data: {
        workflowType: 'ANALYTICS',
        rootEntityType: 'PublicationAnalytics',
        rootEntityId: publication.id,
        status: 'WAITING',
        currentStep: 'measurement_windows',
        startedAt: now,
      },
    });

    const jobAttemptIds: string[] = [];
    for (const window of windows) {
      const operationId = collectionOperationIdFor({
        publicationId: publication.id,
        adapterKey,
        windowKey: window.key,
        collectionMethod: 'PLATFORM_API',
      });
      const scheduledFor = collectionDueAt(publication.publishedAt, window);
      const job = await this.tx.jobAttempt.create({
        data: {
          workflowRunId: workflow.id,
          queueName: 'vce-analytics',
          jobType: `ANALYTICS_COLLECT:${adapterKey}:${window.key}`,
          operationId,
          attemptNumber: 1,
          status: 'QUEUED',
        },
      });
      const payload = {
        schemaVersion: 'v1',
        kind: 'COLLECT_PLATFORM_METRICS',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        publicationId: publication.id,
        platformAccountId: publication.platformAccountId,
        platform,
        adapterKey,
        windowKey: window.key,
        collectionOperationId: operationId,
        scheduledFor: scheduledFor.toISOString(),
      } as const;
      await emit(this.tx, {
        eventType: 'Analytics.collection.requested',
        aggregateType: 'JobAttempt',
        aggregateId: job.id,
        payloadJson: json(payload),
        availableAt: scheduledFor,
      });
      jobAttemptIds.push(job.id);
    }

    await audit(this.tx, this.actor, 'Analytics.collectionPlanned', 'Publication', publication.id);
    return { kind: 'PLANNED', publicationId, workflowRunId: workflow.id, jobAttemptIds } as const;
  }

  async beginCollection(jobAttemptId: string) {
    await lock(this.tx, 'JobAttempt', jobAttemptId);
    const job = await this.tx.jobAttempt.findUniqueOrThrow({
      where: { id: jobAttemptId },
      include: { workflowRun: true },
    });
    invariant(
      job.workflowRun && job.workflowRun.workflowType === 'ANALYTICS',
      'ANALYTICS_WORKFLOW_REQUIRED',
    );
    if (job.status === 'SUCCEEDED') return { kind: 'ALREADY_DONE', jobAttemptId } as const;
    invariant(job.status === 'QUEUED' || job.status === 'RUNNING', 'ANALYTICS_JOB_NOT_RUNNABLE');
    invariant(job.workflowRun.rootEntityType === 'PublicationAnalytics', 'INVALID_ANALYTICS_ROOT');
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: job.workflowRun.rootEntityId },
      include: { platformAccount: true },
    });
    invariant(
      publication.status === 'PUBLISHED' && publication.publishedAt,
      'PUBLICATION_NOT_PUBLISHED',
    );
    invariant(publication.remotePostId, 'REMOTE_POST_ID_REQUIRED');
    const { adapterKey, windowKey } = parseJobType(job.jobType);
    const event = await this.tx.outboxEvent.findFirstOrThrow({
      where: {
        eventType: 'Analytics.collection.requested',
        aggregateType: 'JobAttempt',
        aggregateId: job.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    const payload = event.payloadJson as Record<string, unknown>;
    invariant(
      payload['scheduledFor'] && typeof payload['scheduledFor'] === 'string',
      'SCHEDULED_FOR_REQUIRED',
    );
    invariant(
      job.operationId === payload['collectionOperationId'],
      'COLLECTION_OPERATION_MISMATCH',
    );
    const now = await databaseTime(this.tx);
    await this.tx.jobAttempt.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        startedAt: job.startedAt ?? now,
        workerId: 'worker-analytics',
        leaseToken: randomUUID(),
        leaseAcquiredAt: now,
        heartbeatAt: now,
        leaseExpiresAt: new Date(now.getTime() + 60_000),
      },
    });
    await this.tx.workflowRun.update({
      where: { id: job.workflowRun.id },
      data: { status: 'RUNNING', currentStep: windowKey },
    });
    const snapshot: AnalyticsCollectionSnapshot = Object.freeze({
      publicationId: publication.id,
      platformAccountId: publication.platformAccountId,
      platform: publication.platformAccount.platform,
      remotePostId: publication.remotePostId,
      publishedAt: publication.publishedAt.toISOString(),
      adapterKey,
      windowKey,
      scheduledFor: payload['scheduledFor'],
      collectionOperationId: job.operationId,
    });
    return { kind: 'READY', snapshot } as const;
  }

  async completeCollection(jobAttemptId: string, input: unknown) {
    const observation = AnalyticsObservationSchema.parse(input);
    await lock(this.tx, 'JobAttempt', jobAttemptId);
    const job = await this.tx.jobAttempt.findUniqueOrThrow({
      where: { id: jobAttemptId },
      include: { workflowRun: true },
    });
    invariant(
      job.workflowRun && job.workflowRun.workflowType === 'ANALYTICS',
      'ANALYTICS_WORKFLOW_REQUIRED',
    );
    const publicationId = job.workflowRun.rootEntityId;
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: publicationId },
      include: { platformAccount: true },
    });
    const existingRaw = await this.tx.metricSnapshotRaw.findUnique({
      where: { collectionOperationId: job.operationId },
      include: { normalizedSnapshots: true },
    });
    if (existingRaw) {
      await this.tx.jobAttempt.updateMany({
        where: { id: job.id, status: { not: 'SUCCEEDED' } },
        data: { status: 'SUCCEEDED', finishedAt: await databaseTime(this.tx) },
      });
      return {
        kind: 'EXISTING',
        rawSnapshotId: existingRaw.id,
        normalizedSnapshotId: existingRaw.normalizedSnapshots[0]?.id ?? null,
      } as const;
    }
    invariant(job.status === 'RUNNING' || job.status === 'QUEUED', 'ANALYTICS_JOB_NOT_RUNNABLE');
    const now = await databaseTime(this.tx);
    const raw = await this.tx.metricSnapshotRaw.create({
      data: {
        publicationId,
        platform: publication.platformAccount.platform,
        collectedAt: new Date(observation.collectedAt),
        providerSchemaVersion: observation.providerSchemaVersion,
        collectionMethod: 'PLATFORM_API',
        collectionOperationId: job.operationId,
        payloadJson: json(observation.rawPayload),
        payloadHash: rawPayloadHash(observation.rawPayload),
      },
    });
    const normalized = await this.tx.metricSnapshotNormalized.create({
      data: {
        publicationId,
        rawSnapshotId: raw.id,
        collectedAt: new Date(observation.collectedAt),
        ...observation.metrics,
        ...(observation.otherMetrics === null
          ? {}
          : { otherMetricsJson: json(observation.otherMetrics) }),
        availabilityJson: json(observation.availability),
        comparabilityJson: json(observation.comparability),
        normalizerVersion: observation.normalizerVersion,
        metricSemanticsVersion: observation.metricSemanticsVersion,
      },
    });
    await this.tx.jobAttempt.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', finishedAt: now },
    });
    const remaining = await this.tx.jobAttempt.count({
      where: { workflowRunId: job.workflowRun.id, status: { not: 'SUCCEEDED' } },
    });
    await this.tx.workflowRun.update({
      where: { id: job.workflowRun.id },
      data:
        remaining === 0
          ? { status: 'SUCCEEDED', currentStep: 'complete', finishedAt: now }
          : { status: 'WAITING', currentStep: 'measurement_windows' },
    });
    await audit(this.tx, this.actor, 'Analytics.snapshotCollected', 'MetricSnapshotRaw', raw.id);
    return {
      kind: 'COLLECTED',
      rawSnapshotId: raw.id,
      normalizedSnapshotId: normalized.id,
      payloadHash: raw.payloadHash,
    } as const;
  }
  async completeManualTikTok(jobAttemptId: string, input: unknown) {
    await lock(this.tx, 'JobAttempt', jobAttemptId);
    const job = await this.tx.jobAttempt.findUniqueOrThrow({
      where: { id: jobAttemptId },
      include: { workflowRun: true },
    });
    invariant(
      job.workflowRun && job.workflowRun.workflowType === 'ANALYTICS',
      'ANALYTICS_WORKFLOW_REQUIRED',
    );
    invariant(job.queueName === 'vce-analytics-manual', 'MANUAL_ANALYTICS_JOB_REQUIRED');
    const windowKey = parseManualTikTokJobType(job.jobType);
    const publication = await this.tx.publication.findUniqueOrThrow({
      where: { id: job.workflowRun.rootEntityId },
      include: { platformAccount: true },
    });
    invariant(
      publication.status === 'PUBLISHED' && publication.publishedAt,
      'PUBLICATION_NOT_PUBLISHED',
    );
    invariant(publication.platformAccount.platform === 'TIKTOK', 'TIKTOK_PUBLICATION_REQUIRED');
    const existingRaw = await this.tx.metricSnapshotRaw.findUnique({
      where: { collectionOperationId: job.operationId },
      include: { normalizedSnapshots: true },
    });
    if (existingRaw) {
      return {
        kind: 'EXISTING',
        rawSnapshotId: existingRaw.id,
        normalizedSnapshotId: existingRaw.normalizedSnapshots[0]?.id ?? null,
      } as const;
    }
    invariant(job.status === 'QUEUED', 'MANUAL_ANALYTICS_JOB_NOT_PENDING');
    const now = await databaseTime(this.tx);
    const dueAt = collectionDueAt(
      publication.publishedAt,
      MANUAL_TIKTOK_WINDOWS.find((window) => window.key === windowKey)!,
    );
    invariant(now.getTime() >= dueAt.getTime(), 'MANUAL_SNAPSHOT_NOT_DUE');
    const observation = normalizeTikTokManualMetrics(input, now);
    const raw = await this.tx.metricSnapshotRaw.create({
      data: {
        publicationId: publication.id,
        platform: 'TIKTOK',
        collectedAt: now,
        providerSchemaVersion: observation.providerSchemaVersion,
        collectionMethod: 'MANUAL_ENTRY',
        collectionOperationId: job.operationId,
        payloadJson: json(observation.rawPayload),
        payloadHash: rawPayloadHash(observation.rawPayload),
      },
    });
    const normalized = await this.tx.metricSnapshotNormalized.create({
      data: {
        publicationId: publication.id,
        rawSnapshotId: raw.id,
        collectedAt: now,
        ...observation.metrics,
        availabilityJson: json(observation.availability),
        comparabilityJson: json(observation.comparability),
        normalizerVersion: observation.normalizerVersion,
        metricSemanticsVersion: observation.metricSemanticsVersion,
      },
    });
    await this.tx.jobAttempt.update({
      where: { id: job.id },
      data: { status: 'SUCCEEDED', startedAt: now, finishedAt: now },
    });
    const remaining = await this.tx.jobAttempt.count({
      where: { workflowRunId: job.workflowRun.id, status: { not: 'SUCCEEDED' } },
    });
    await this.tx.workflowRun.update({
      where: { id: job.workflowRun.id },
      data:
        remaining === 0
          ? { status: 'SUCCEEDED', currentStep: 'complete', finishedAt: now }
          : { status: 'WAITING', currentStep: 'manual_measurement_windows' },
    });
    await audit(
      this.tx,
      this.actor,
      'Analytics.manualSnapshotEntered',
      'MetricSnapshotRaw',
      raw.id,
    );
    return {
      kind: 'COLLECTED',
      rawSnapshotId: raw.id,
      normalizedSnapshotId: normalized.id,
      windowKey,
      payloadHash: raw.payloadHash,
    } as const;
  }

  async ingestVisionAttribution(input: VisionAttributionInput) {
    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`vision-attribution:${input.externalEventId}`}, 0))`;
    invariant(
      !(await this.tx.attributionEvent.findUnique({
        where: {
          sourceSystem_externalEventId: {
            sourceSystem: 'VISION_APP',
            externalEventId: input.externalEventId,
          },
        },
      })),
      'VISION_ATTRIBUTION_REPLAY',
    );

    let publicationId: string | null = null;
    let campaignId: string | null = null;
    let confidenceType: 'DIRECT' | 'UNKNOWN' = 'UNKNOWN';
    let source = 'vision_signed_ingest';

    if (input.trackingCode) {
      const publication = await this.tx.publication.findUnique({
        where: { trackingCode: input.trackingCode },
        select: {
          id: true,
          render: {
            select: {
              editingPlanVersion: {
                select: {
                  creativePlanVersion: {
                    select: {
                      creativePlan: {
                        select: {
                          concept: { select: { brief: { select: { campaignId: true } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      invariant(publication, 'VISION_ATTRIBUTION_TRACKING_CODE_NOT_FOUND');
      publicationId = publication.id;
      campaignId =
        publication.render.editingPlanVersion.creativePlanVersion.creativePlan.concept.brief
          .campaignId;
      confidenceType = 'DIRECT';
      source = 'publication_tracking_code';
    }

    const metadata = {
      ...(input.metadata ?? {}),
      ...(input.campaignTrackingCode ? { campaignTrackingCode: input.campaignTrackingCode } : {}),
    };
    const row = await this.tx.attributionEvent.create({
      data: {
        publicationId,
        campaignId,
        eventType: input.eventType,
        occurredAt: input.occurredAt,
        source,
        sourceSystem: 'VISION_APP',
        externalEventId: input.externalEventId,
        confidenceType,
        ...(input.userId ? { userId: input.userId } : {}),
        ...(input.valueAmountMinor !== undefined
          ? { valueAmountMinor: BigInt(input.valueAmountMinor) }
          : {}),
        ...(input.valueCurrency !== undefined ? { valueCurrency: input.valueCurrency } : {}),
        ...(Object.keys(metadata).length > 0 ? { metadataJson: json(metadata) } : {}),
      },
    });
    await audit(
      this.tx,
      this.actor,
      'Analytics.visionAttributionIngested',
      'AttributionEvent',
      row.id,
    );
    return {
      kind: 'INGESTED',
      attributionEventId: row.id,
      externalEventId: row.externalEventId,
      confidenceType: row.confidenceType,
      publicationId: row.publicationId,
      campaignId: row.campaignId,
    } as const;
  }

  async ingestUmamiEvent(input: UmamiImportInput) {
    const policy = UmamiInferencePolicySchema.parse(input.inferencePolicy);
    const row = input.row;
    const lockKey = `umami-event:${row.id}`;
    await this.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    const existingAttribution = await this.tx.attributionEvent.findUnique({
      where: {
        sourceSystem_externalEventId: {
          sourceSystem: 'UMAMI',
          externalEventId: row.id,
        },
      },
    });
    if (existingAttribution) {
      return {
        kind: 'EXISTING',
        evidenceKind: 'WEBSITE_VISIT',
        evidenceId: existingAttribution.id,
        confidenceType: existingAttribution.confidenceType,
      } as const;
    }

    const existingObservation = await this.tx.auditEvent.findFirst({
      where: {
        action: 'Analytics.umamiMarketingObservationImported',
        subjectType: 'UmamiEvent',
        subjectId: row.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (existingObservation) {
      return {
        kind: 'EXISTING',
        evidenceKind: 'WEB_MARKETING_OBSERVATION',
        evidenceId: existingObservation.id,
        confidenceType: null,
      } as const;
    }

    const hints = attributionHintsForUmamiEvent(row);
    const baseMetadata = {
      providerSchemaVersion: UMAMI_PROVIDER_SCHEMA_VERSION,
      attributionPolicyVersion: UMAMI_ATTRIBUTION_POLICY_VERSION,
      botExclusionApplied: false,
      rawEvent: row,
      attributionHints: hints,
    };

    if (umamiEventKind(row) === 'WEB_MARKETING_OBSERVATION') {
      const created = await this.tx.auditEvent.create({
        data: {
          ...this.actor,
          action: 'Analytics.umamiMarketingObservationImported',
          subjectType: 'UmamiEvent',
          subjectId: row.id,
          metadataJson: json(baseMetadata),
        },
      });
      return {
        kind: 'IMPORTED',
        evidenceKind: 'WEB_MARKETING_OBSERVATION',
        evidenceId: created.id,
        confidenceType: null,
      } as const;
    }

    let publicationId: string | null = null;
    let campaignId: string | null = null;
    let confidenceType: 'DIRECT' | 'INFERRED' | 'UNKNOWN' = 'UNKNOWN';
    let source = 'umami_unknown';

    if (hints.trackingCode) {
      const publication = await this.tx.publication.findUnique({
        where: { trackingCode: hints.trackingCode },
        select: {
          id: true,
          render: {
            select: {
              editingPlanVersion: {
                select: {
                  creativePlanVersion: {
                    select: {
                      creativePlan: {
                        select: {
                          concept: { select: { brief: { select: { campaignId: true } } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      });
      if (publication) {
        publicationId = publication.id;
        campaignId =
          publication.render.editingPlanVersion.creativePlanVersion.creativePlan.concept.brief
            .campaignId;
        confidenceType = 'DIRECT';
        source = 'umami_utm_content_tracking_code';
      }
    }

    if (confidenceType === 'UNKNOWN' && policy.enabled && hints.utmContent === null) {
      const platform = platformHintForUmamiEvent(row);
      if (platform) {
        const occurredAt = new Date(row.createdAt);
        const lowerBound = new Date(occurredAt.getTime() - policy.maxAgeMinutes * 60_000);
        const candidates = await this.tx.publication.findMany({
          where: {
            status: 'PUBLISHED',
            publishedAt: { gte: lowerBound, lte: occurredAt },
            platformAccount: { platform },
          },
          orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
          take: 2,
          select: {
            id: true,
            render: {
              select: {
                editingPlanVersion: {
                  select: {
                    creativePlanVersion: {
                      select: {
                        creativePlan: {
                          select: {
                            concept: { select: { brief: { select: { campaignId: true } } } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        });
        if (candidates.length === 1) {
          const publication = candidates[0]!;
          publicationId = publication.id;
          campaignId =
            publication.render.editingPlanVersion.creativePlanVersion.creativePlan.concept.brief
              .campaignId;
          confidenceType = 'INFERRED';
          source = 'umami_platform_temporal_inference';
        }
      }
    }

    const created = await this.tx.attributionEvent.create({
      data: {
        publicationId,
        campaignId,
        eventType: 'WEBSITE_VISIT',
        occurredAt: new Date(row.createdAt),
        source,
        sourceSystem: 'UMAMI',
        externalEventId: row.id,
        confidenceType,
        externalVisitorId: row.sessionId,
        metadataJson: json({
          ...baseMetadata,
          inferencePolicy: policy,
          countsAsWebsiteVisit: true,
        }),
      },
    });
    await audit(
      this.tx,
      this.actor,
      'Analytics.umamiVisitImported',
      'AttributionEvent',
      created.id,
    );
    return {
      kind: 'IMPORTED',
      evidenceKind: 'WEBSITE_VISIT',
      evidenceId: created.id,
      confidenceType: created.confidenceType,
      publicationId: created.publicationId,
      campaignId: created.campaignId,
    } as const;
  }
}
