import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { DashboardReadService } from '../../packages/application/src/dashboard-read.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;

const summary = vi.fn(async () => ({
  generatedAt: '2026-09-21T18:00:00.000Z',
  counts: {
    needsAttention: 1,
    conceptsAwaitingReview: 2,
    activeProduction: 3,
    rendersReadyForReview: 4,
  },
  recentChanges: [],
}));

const attention = vi.fn(async () => [
  {
    id: 'recording-input:fixture',
    kind: 'RECORDING_INPUT',
    severity: 'ACTION',
    title: 'Une voix naturelle',
    reason: 'Un enregistrement humain est requis.',
    affectedEntity: { type: 'RecordingRequest', id: 'fixture' },
    createdAt: '2026-09-21T18:00:00.000Z',
    recommendedAction: 'Ouvrir la production.',
    targetRoute: '/production/fixture',
  },
]);

beforeAll(async () => {
  app = await createApi(
    {
      postgres: async () => {},
      redis: async () => {},
      storage: async () => {},
    },
    {
      auth: { accessKey, origin },
      dashboard: { summary, attention } as unknown as DashboardReadService,
    },
  );

  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(async () => {
  await app?.close();
});

async function login() {
  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessKey }),
  });

  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
}

it('protects dashboard read endpoints with the shared local session', async () => {
  expect((await fetch(`${base}/api/dashboard`)).status).toBe(401);
  expect((await fetch(`${base}/api/attention`)).status).toBe(401);

  await login();

  const dashboardResponse = await fetch(`${base}/api/dashboard`, {
    headers: { Cookie: cookie },
  });
  const attentionResponse = await fetch(`${base}/api/attention`, {
    headers: { Cookie: cookie },
  });

  expect(dashboardResponse.status).toBe(200);
  expect(attentionResponse.status).toBe(200);
  expect(await dashboardResponse.json()).toMatchObject({
    counts: {
      needsAttention: 1,
      conceptsAwaitingReview: 2,
      activeProduction: 3,
      rendersReadyForReview: 4,
    },
  });
  expect(await attentionResponse.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: 'RECORDING_INPUT',
        targetRoute: '/production/fixture',
      }),
    ]),
  );
});

it('hides read-model internals on dashboard failure', async () => {
  await login();
  summary.mockRejectedValueOnce(new Error('sensitive database details'));

  const response = await fetch(`${base}/api/dashboard`, {
    headers: { Cookie: cookie },
  });

  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('sensitive');
});
