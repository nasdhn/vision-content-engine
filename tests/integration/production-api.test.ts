import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { ProductionReadService } from '../../packages/application/src/production-read.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const creativePlanVersionId = randomUUID();

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;

const item = {
  creativePlanId: randomUUID(),
  creativePlanVersionId,
  version: 1,
  status: 'WAITING_FOR_INPUTS',
  title: 'Preuve produit',
  hook: 'Voici comment retrouver votre preuve.',
  campaignName: 'Vision',
  primaryFormat: 'GREEN_SCREEN',
  targetDurationMs: 15000,
  stage: 'WAITING_FOR_ME',
  nextAction: 'Fournir ou sélectionner les enregistrements requis.',
  recordings: {
    total: 1,
    pending: 0,
    readyToRecord: 1,
    uploaded: 0,
    accepted: 0,
  },
  capture: null,
  blocker: null,
  editing: null,
  render: null,
  createdAt: '2026-09-21T18:00:00.000Z',
};

const list = vi.fn(async () => [item]);
const detail = vi.fn(async () => ({
  ...item,
  script: {
    scriptVersionId: randomUUID(),
    fullText: 'Voici comment retrouver votre preuve.',
    estimatedDurationMs: 1000,
    voiceMode: 'NATURAL_USER_VOICE',
  },
  template: { key: 'GREEN_SCREEN_EXPLAINER', name: 'Green Screen', version: 1 },
  editingProfile: { key: 'GREEN_SCREEN_EXPLAINER', name: 'Green Screen', version: 1 },
  recordingRequests: [
    {
      id: randomUUID(),
      title: 'Une voix naturelle',
      type: 'VOICE',
      status: 'READY_TO_RECORD',
      takeCount: 0,
      selectedTakeCount: 0,
    },
  ],
  captures: [],
  blockers: [],
  renderDetail: null,
}));

beforeAll(async () => {
  app = await createApi(
    {
      postgres: async () => {},
      redis: async () => {},
      storage: async () => {},
    },
    {
      auth: { accessKey, origin },
      production: { list, detail } as unknown as ProductionReadService,
    },
  );

  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessKey }),
  });

  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

it('protects production list and exact-version detail with the shared session', async () => {
  expect((await fetch(`${base}/api/production`)).status).toBe(401);
  expect((await fetch(`${base}/api/production/${creativePlanVersionId}`)).status).toBe(401);

  const listResponse = await fetch(`${base}/api/production`, {
    headers: { Cookie: cookie },
  });
  const detailResponse = await fetch(`${base}/api/production/${creativePlanVersionId}`, {
    headers: { Cookie: cookie },
  });

  expect(listResponse.status).toBe(200);
  expect(await listResponse.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        creativePlanVersionId,
        stage: 'WAITING_FOR_ME',
      }),
    ]),
  );

  expect(detailResponse.status).toBe(200);
  expect(await detailResponse.json()).toMatchObject({
    creativePlanVersionId,
    recordingRequests: [
      expect.objectContaining({
        title: 'Une voix naturelle',
        status: 'READY_TO_RECORD',
      }),
    ],
  });
});

it('validates detail IDs and hides read-model internals', async () => {
  expect(
    (
      await fetch(`${base}/api/production/not-a-uuid`, {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(400);

  list.mockRejectedValueOnce(new Error('raw database connection secret'));
  const response = await fetch(`${base}/api/production`, {
    headers: { Cookie: cookie },
  });

  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('secret');
});
