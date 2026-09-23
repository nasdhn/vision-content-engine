import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ExperimentEvidenceService } from '../../packages/application/src/experiment-evidence.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

it('analyzes exact ExperimentArm publication membership without mutating Experiment primaryMetric/status', async () => {
  const graph = await recordingGraph(fixture.client);
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
      displayName: 'Phase 9B Fixture',
      remoteAccountId: randomUUID(),
      status: 'ACTIVE',
    },
  });

  async function publicationWithLikes(
    publishedAt: Date,
    likes24h: bigint | null,
    likes72h: bigint,
  ) {
    const publication = await fixture.client.publication.create({
      data: {
        renderId: render.id,
        platformAccountId: account.id,
        deliveryMode: 'API_AUTOMATED',
        status: 'PUBLISHED',
        publishedAt,
        remotePostId: randomUUID(),
        remoteUrl: `https://example.test/${randomUUID()}`,
        metadataJson: {},
      },
    });

    for (const [windowKey, likes, hours] of [
      ['T_PLUS_24H', likes24h, 24],
      ['T_PLUS_72H', likes72h, 72],
    ] as const) {
      const operationId = randomUUID();
      const collectedAt = new Date(publishedAt.getTime() + hours * 60 * 60 * 1000);
      const raw = await fixture.client.metricSnapshotRaw.create({
        data: {
          publicationId: publication.id,
          platform: 'INSTAGRAM',
          collectedAt,
          providerSchemaVersion: 'phase9b-fixture-v1',
          collectionMethod: 'PLATFORM_API',
          collectionOperationId: operationId,
          payloadJson: { fixture: true, windowKey },
        },
      });
      await fixture.client.metricSnapshotNormalized.create({
        data: {
          publicationId: publication.id,
          rawSnapshotId: raw.id,
          collectedAt,
          likes,
          comparabilityJson: {
            crossPlatformViewsComparable: false,
            notes: ['Phase 9B fixture.'],
          },
          normalizerVersion: 'phase9b-fixture-normalizer-v1',
          metricSemanticsVersion: 'canonical-metrics-v1',
        },
      });
      await fixture.client.jobAttempt.create({
        data: {
          queueName: 'vce-analytics',
          jobType: `ANALYTICS_COLLECT:INSTAGRAM_ANALYTICS_V1:${windowKey}`,
          operationId,
          attemptNumber: 1,
          status: 'SUCCEEDED',
        },
      });
    }

    return publication;
  }

  const publicationA = await publicationWithLikes(new Date('2026-09-10T12:00:00.000Z'), 9n, 999n);
  const publicationB = await publicationWithLikes(new Date('2026-09-11T12:00:00.000Z'), 0n, 777n);

  const experiment = await fixture.client.experiment.create({
    data: {
      name: 'Phase 9B exact membership',
      hypothesis: 'Arm A may show a higher observed likes count at T+24h.',
      primaryMetric: 'likes',
      status: 'RUNNING',
    },
  });

  const exactConceptVersion = await fixture.client.creativePlanVersion.findUniqueOrThrow({
    where: { id: graph.cpv.id },
    select: {
      scriptVersion: {
        select: {
          conceptVersionId: true,
        },
      },
    },
  });

  await fixture.client.experimentArm.createMany({
    data: [
      {
        experimentId: experiment.id,
        label: 'A',
        publicationId: publicationA.id,
        variablesJson: { hook: 'A' },
      },
      {
        experimentId: experiment.id,
        label: 'B',
        publicationId: publicationB.id,
        variablesJson: { hook: 'B' },
      },
      {
        experimentId: experiment.id,
        label: 'C-not-published-yet',
        conceptVersionId: exactConceptVersion.scriptVersion.conceptVersionId,
        variablesJson: { hook: 'C' },
      },
    ],
  });

  const service = new ExperimentEvidenceService(fixture.client);
  const result = await service.analyze({
    experimentId: experiment.id,
    measurementWindow: 'T_PLUS_24H',
    analysisWindow: {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    },
    confoundersDocumented: true,
    confounders: ['same platform fixture'],
  });

  expect(result).not.toBeNull();
  expect(result?.primaryMetric).toBe('likes');
  expect(result?.readiness).toBe('READY');
  expect(result?.arms.map((arm) => [arm.label, arm.metricValue, arm.readiness])).toEqual([
    ['A', 9, 'READY'],
    ['B', 0, 'READY'],
    ['C-not-published-yet', null, 'PUBLICATION_NOT_ASSIGNED'],
  ]);
  expect(result?.arms.find((arm) => arm.label === 'A')?.metricValue).not.toBe(999);
  expect(result?.arms.find((arm) => arm.label === 'B')?.metricValue).not.toBe(777);
  expect('winner' in (result ?? {})).toBe(false);

  const after = await fixture.client.experiment.findUniqueOrThrow({
    where: { id: experiment.id },
    select: { primaryMetric: true, status: true },
  });
  expect(after).toEqual({ primaryMetric: 'likes', status: 'RUNNING' });
});
