import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { DashboardReadService } from '../../packages/application/src/dashboard-read.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let service: DashboardReadService;

beforeAll(async () => {
  fixture = await postgresFixture();
  service = new DashboardReadService(fixture.client);
});

afterAll(async () => {
  await fixture?.close();
});

it('derives dashboard counts and human-input attention from canonical production state', async () => {
  const graph = await recordingGraph(fixture.client);
  const summary = await service.summary();
  const attention = await service.attention();

  expect(summary.counts).toMatchObject({
    needsAttention: 1,
    conceptsAwaitingReview: 0,
    activeProduction: 1,
    rendersReadyForReview: 0,
  });

  expect(attention).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'RECORDING_INPUT',
        title: 'Une voix naturelle',
        affectedEntity: {
          type: 'RecordingRequest',
          id: graph.request.id,
        },
        targetRoute: `/production/${graph.cpv.id}`,
      }),
    ]),
  );
});

it('surfaces operational failures without leaking raw stored error strings', async () => {
  const workflowId = randomUUID();
  const aggregateId = randomUUID();

  await fixture.client.workflowRun.create({
    data: {
      id: workflowId,
      workflowType: 'CREATIVE_PRODUCTION',
      rootEntityType: 'CreativePlanVersion',
      rootEntityId: aggregateId,
      status: 'FAILED',
    },
  });

  await fixture.client.outboxEvent.create({
    data: {
      eventType: 'fixture.failed',
      aggregateType: 'CreativePlanVersion',
      aggregateId,
      payloadJson: {},
      status: 'FAILED',
      lastError: 'sensitive-provider-secret',
    },
  });

  await fixture.client.platformAccount.create({
    data: {
      platform: 'YOUTUBE',
      displayName: 'YouTube Vision',
      remoteAccountId: randomUUID(),
      status: 'REAUTH_REQUIRED',
    },
  });

  const attention = await service.attention();
  const serialized = JSON.stringify(attention);

  expect(attention).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'WORKFLOW_FAILED',
        targetRoute: `/production/${aggregateId}`,
      }),
      expect.objectContaining({
        kind: 'OUTBOX_FAILED',
      }),
      expect.objectContaining({
        kind: 'PLATFORM_ACCOUNT',
        targetRoute: '/distribution',
      }),
    ]),
  );
  expect(serialized).not.toContain('sensitive-provider-secret');
});
