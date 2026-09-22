import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { AnalyticsReadService } from '../../packages/application/src/analytics-read.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

it('projects funnel, publication metrics, freshness and attribution without merging inferred evidence', async () => {
  const graph = await recordingGraph(fixture.client);
  const concept = await fixture.client.concept.findUniqueOrThrow({
    where: { id: graph.cv.conceptId },
    include: { brief: true },
  });
  const editingPlan = await fixture.client.editingPlan.create({
    data: { creativePlanId: graph.plan.id, status: 'READY' },
  });
  const editingPlanVersion = await fixture.client.editingPlanVersion.create({
    data: {
      editingPlanId: editingPlan.id,
      version: 1,
      creativePlanVersionId: graph.cpv.id,
      editingProfileVersionId: graph.pv.id,
      templateVersionId: graph.tv.id,
      timelineJson: {},
    },
  });
  const render = await fixture.client.render.create({
    data: { editingPlanVersionId: editingPlanVersion.id, status: 'APPROVED' },
  });
  const account = await fixture.client.platformAccount.create({
    data: {
      platform: 'INSTAGRAM',
      displayName: 'Vision Analytics Fixture',
      remoteAccountId: randomUUID(),
      status: 'ACTIVE',
    },
  });
  const publishedAt = new Date('2026-09-20T12:00:00.000Z');
  const publication = await fixture.client.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'API_AUTOMATED',
      status: 'PUBLISHED',
      publishedAt,
      remotePostId: randomUUID(),
      remoteUrl: 'https://example.test/analytics-read',
      metadataJson: {},
    },
  });

  const collectionOperationId = randomUUID();
  const raw = await fixture.client.metricSnapshotRaw.create({
    data: {
      publicationId: publication.id,
      platform: 'INSTAGRAM',
      collectedAt: new Date('2026-09-21T12:00:00.000Z'),
      providerSchemaVersion: 'fixture-instagram-v1',
      collectionMethod: 'PLATFORM_API',
      collectionOperationId,
      payloadJson: { fixture: true },
    },
  });
  await fixture.client.metricSnapshotNormalized.create({
    data: {
      publicationId: publication.id,
      rawSnapshotId: raw.id,
      collectedAt: raw.collectedAt,
      views: 1000n,
      likes: 0n,
      comments: null,
      shares: 11n,
      availabilityJson: {
        status: 'AVAILABLE',
        unavailableMetrics: ['comments'],
        notes: ['Commentaires non observés.'],
      },
      comparabilityJson: {
        crossPlatformViewsComparable: false,
        notes: ['Ne pas comparer automatiquement ces vues aux vues YouTube.'],
      },
      normalizerVersion: 'fixture-normalizer-v1',
      metricSemanticsVersion: 'canonical-metrics-v1',
    },
  });

  const workflow = await fixture.client.workflowRun.create({
    data: {
      workflowType: 'ANALYTICS',
      rootEntityType: 'PublicationAnalytics',
      rootEntityId: publication.id,
      status: 'SUCCEEDED',
    },
  });
  await fixture.client.jobAttempt.create({
    data: {
      workflowRunId: workflow.id,
      queueName: 'vce-analytics',
      jobType: 'ANALYTICS_COLLECT:INSTAGRAM_ANALYTICS_V1:T_PLUS_24H',
      operationId: collectionOperationId,
      attemptNumber: 1,
      status: 'SUCCEEDED',
    },
  });
  await fixture.client.jobAttempt.create({
    data: {
      workflowRunId: workflow.id,
      queueName: 'vce-analytics',
      jobType: 'ANALYTICS_COLLECT:INSTAGRAM_ANALYTICS_V1:T_PLUS_72H',
      operationId: randomUUID(),
      attemptNumber: 1,
      status: 'FAILED',
      failureCode: 'AUTH_REQUIRED',
    },
  });

  await fixture.client.attributionEvent.createMany({
    data: [
      {
        publicationId: publication.id,
        campaignId: concept.brief.campaignId,
        eventType: 'WEBSITE_VISIT',
        occurredAt: new Date('2026-09-21T12:05:00.000Z'),
        sourceSystem: 'UMAMI',
        externalEventId: randomUUID(),
        confidenceType: 'DIRECT',
      },
      {
        publicationId: publication.id,
        campaignId: concept.brief.campaignId,
        eventType: 'WEBSITE_VISIT',
        occurredAt: new Date('2026-09-21T12:06:00.000Z'),
        sourceSystem: 'UMAMI',
        externalEventId: randomUUID(),
        confidenceType: 'INFERRED',
      },
      {
        eventType: 'WEBSITE_VISIT',
        occurredAt: new Date('2026-09-21T12:07:00.000Z'),
        sourceSystem: 'UMAMI',
        externalEventId: randomUUID(),
        confidenceType: 'UNKNOWN',
      },
      {
        publicationId: publication.id,
        campaignId: concept.brief.campaignId,
        eventType: 'SIGNUP',
        occurredAt: new Date('2026-09-21T12:08:00.000Z'),
        sourceSystem: 'VISION_APP',
        externalEventId: randomUUID(),
        confidenceType: 'DIRECT',
      },
      {
        publicationId: publication.id,
        campaignId: concept.brief.campaignId,
        eventType: 'REVENUE',
        occurredAt: new Date('2026-09-21T12:09:00.000Z'),
        sourceSystem: 'VISION_APP',
        externalEventId: randomUUID(),
        confidenceType: 'DIRECT',
        valueAmountMinor: 1250n,
        valueCurrency: 'EUR',
      },
      {
        publicationId: publication.id,
        campaignId: concept.brief.campaignId,
        eventType: 'SIGNUP',
        occurredAt: new Date('2026-09-21T12:10:00.000Z'),
        sourceSystem: 'MANUAL',
        externalEventId: randomUUID(),
        confidenceType: 'DIRECT',
      },
    ],
  });

  const experiment = await fixture.client.experiment.create({
    data: {
      campaignId: concept.brief.campaignId,
      name: 'Hook fixture',
      hypothesis: 'La preuve produit augmente la rétention.',
      primaryMetric: 'views',
      status: 'RUNNING',
      startedAt: new Date('2026-09-20T12:00:00.000Z'),
    },
  });
  await fixture.client.experimentArm.create({
    data: {
      experimentId: experiment.id,
      label: 'Preuve produit',
      publicationId: publication.id,
      variablesJson: { hook: 'result-first' },
    },
  });

  const service = new AnalyticsReadService(
    fixture.client,
    () => new Date('2026-09-22T12:00:00.000Z'),
  );
  const result = await service.overview();

  expect(result.funnel.websiteVisits).toEqual({ total: 3, direct: 1, inferred: 1, unknown: 1 });
  expect(result.funnel.signups).toEqual({ total: 1, direct: 1, inferred: 0, unknown: 0 });
  expect(result.funnel.revenueByCurrency).toContainEqual({
    currency: 'EUR',
    amountMinor: '1250',
    eventCount: 1,
  });
  expect(result.attribution).toEqual({ total: 5, direct: 3, inferred: 1, unknown: 1 });

  const item = result.publications.find((row) => row.publicationId === publication.id);
  expect(item).toMatchObject({
    platform: 'INSTAGRAM',
    title: 'fixture',
    campaignName: 'fixture',
    measurement: {
      windowKey: 'T_PLUS_24H',
      windowLabel: 'T+24H',
      availabilityStatus: 'AVAILABLE',
      metrics: { views: '1000', likes: '0', comments: null, shares: '11' },
    },
    attribution: { total: 4, direct: 3, inferred: 1, unknown: 0 },
  });
  expect(item?.measurement?.comparabilityNotes).toContain(
    'Ne pas comparer automatiquement ces vues aux vues YouTube.',
  );
  expect(result.quality.states).toContainEqual({ code: 'AUTH_REQUIRED', count: 1 });
  expect(result.platforms).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        platform: 'INSTAGRAM',
        publishedCount: 1,
        measuredCount: 1,
        attribution: { total: 4, direct: 3, inferred: 1, unknown: 0 },
      }),
    ]),
  );
  expect(result.experiments).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: experiment.id,
        name: 'Hook fixture',
        primaryMetric: 'views',
        arms: [expect.objectContaining({ label: 'Preuve produit', publicationId: publication.id })],
      }),
    ]),
  );
});
