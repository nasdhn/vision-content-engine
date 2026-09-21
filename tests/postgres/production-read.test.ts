import { afterAll, beforeAll, expect, it } from 'vitest';

import { ProductionReadService } from '../../packages/application/src/production-read.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let service: ProductionReadService;

beforeAll(async () => {
  fixture = await postgresFixture();
  service = new ProductionReadService(fixture.client);
});

afterAll(async () => {
  await fixture?.close();
});

it('derives Waiting for me from the canonical Recording Pack state', async () => {
  const graph = await recordingGraph(fixture.client);

  const list = await service.list();
  const detail = await service.detail(graph.cpv.id);

  expect(list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        creativePlanVersionId: graph.cpv.id,
        stage: 'WAITING_FOR_ME',
        recordings: expect.objectContaining({
          total: 1,
          readyToRecord: 1,
        }),
      }),
    ]),
  );

  expect(detail).toMatchObject({
    creativePlanVersionId: graph.cpv.id,
    stage: 'WAITING_FOR_ME',
    recordingRequests: [
      expect.objectContaining({
        id: graph.request.id,
        title: 'Une voix naturelle',
        status: 'READY_TO_RECORD',
        takeCount: 0,
        selectedTakeCount: 0,
      }),
    ],
  });

  expect(detail.nextAction).toContain('enregistrements');
});

it('returns operational codes but never raw capture/render failure messages', async () => {
  const graph = await recordingGraph(fixture.client);
  const detail = await service.detail(graph.cpv.id);
  const serialized = JSON.stringify(detail);

  expect(serialized).not.toContain('failureMessage');
  expect(serialized).not.toContain('objectKey');
  expect(serialized).not.toContain('bucket');
});
