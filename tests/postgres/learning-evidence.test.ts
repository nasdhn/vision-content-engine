import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { EvidenceComparabilityService } from '../../packages/application/src/learning-evidence.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

it('loads the exact canonical analytics window from PostgreSQL and preserves observed zero versus NULL', async () => {
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
      displayName: 'Phase 9A Fixture',
      remoteAccountId: randomUUID(),
      status: 'ACTIVE',
    },
  });

  async function publicationWithLikes(input: {
    publishedAt: Date;
    likes24h: bigint | null;
    likes72h: bigint | null;
  }) {
    const publication = await fixture.client.publication.create({
      data: {
        renderId: render.id,
        platformAccountId: account.id,
        deliveryMode: 'API_AUTOMATED',
        status: 'PUBLISHED',
        publishedAt: input.publishedAt,
        remotePostId: randomUUID(),
        remoteUrl: `https://example.test/${randomUUID()}`,
        metadataJson: {},
      },
    });

    for (const [windowKey, likes, hours] of [
      ['T_PLUS_24H', input.likes24h, 24],
      ['T_PLUS_72H', input.likes72h, 72],
    ] as const) {
      const operationId = randomUUID();
      const collectedAt = new Date(input.publishedAt.getTime() + hours * 60 * 60 * 1000);
      const raw = await fixture.client.metricSnapshotRaw.create({
        data: {
          publicationId: publication.id,
          platform: 'INSTAGRAM',
          collectedAt,
          providerSchemaVersion: 'phase9a-fixture-v1',
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
            notes: ['Fixture Phase 9A.'],
          },
          normalizerVersion: 'phase9a-fixture-normalizer-v1',
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

  const observedZero = await publicationWithLikes({
    publishedAt: new Date('2026-09-10T12:00:00.000Z'),
    likes24h: 0n,
    likes72h: 99n,
  });
  const unavailable = await publicationWithLikes({
    publishedAt: new Date('2026-09-11T12:00:00.000Z'),
    likes24h: null,
    likes72h: 50n,
  });

  const service = new EvidenceComparabilityService(fixture.client);
  const frame = await service.metricFrame({
    analysisWindow: {
      from: new Date('2026-09-01T00:00:00.000Z'),
      to: new Date('2026-10-01T00:00:00.000Z'),
    },
    measurementWindow: 'T_PLUS_24H',
    metricKey: 'likes',
    platform: 'INSTAGRAM',
    confoundersDocumented: true,
    confounders: ['fixture publications'],
  });

  expect(frame.eligible).toContainEqual(
    expect.objectContaining({
      publicationId: observedZero.id,
      metricValue: 0,
    }),
  );
  expect(frame.eligible).not.toContainEqual(
    expect.objectContaining({
      publicationId: observedZero.id,
      metricValue: 99,
    }),
  );
  expect(frame.excluded).toContainEqual({
    publicationId: unavailable.id,
    reason: 'METRIC_UNAVAILABLE',
  });
  expect(frame.comparabilityLimitations).toContain(
    'Unavailable metrics remain NULL and were excluded rather than converted to zero.',
  );
  expect(frame.deterministicConfidenceCeiling).toBe('WEAK_SIGNAL');
});
