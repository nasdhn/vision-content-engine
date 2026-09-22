import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApi } from '../../apps/api/src/app.js';
import type { TikTokManualAnalyticsService } from '../../packages/application/src/tiktok-manual-analytics.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const jobAttemptId = randomUUID();
let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const overview = vi.fn(async () => ({
  generatedAt: '2026-09-22T12:00:00.000Z',
  collectionMethod: 'MANUAL_ENTRY',
  summary: { due: 1, overdue: 0, upcoming: 2, completed: 0 },
  prompts: [],
}));
const submit = vi.fn(async () => ({ kind: 'COLLECTED', rawSnapshotId: randomUUID() }));

beforeAll(async () => {
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    {
      auth: { accessKey, origin },
      analyticsManual: { overview, submit } as unknown as TikTokManualAnalyticsService,
    },
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  const login = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey }),
  });
  cookie = login.headers.get('set-cookie')!.split(';')[0]!;
  csrf = ((await login.json()) as { csrf: string }).csrf;
});

afterAll(async () => app?.close());

it('protects the TikTok manual analytics overview with the local session', async () => {
  expect((await fetch(`${base}/api/analytics/manual`)).status).toBe(401);
  const response = await fetch(`${base}/api/analytics/manual`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ collectionMethod: 'MANUAL_ENTRY' });
});

it('requires CSRF and forwards only the exact manual prompt id plus body', async () => {
  const noCsrf = await fetch(`${base}/api/analytics/manual/${jobAttemptId}/submit`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ views: 123 }),
  });
  expect(noCsrf.status).toBe(403);

  const response = await fetch(`${base}/api/analytics/manual/${jobAttemptId}/submit`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ views: 123, likes: 0 }),
  });
  expect(response.status).toBe(201);
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    jobAttemptId,
    { views: 123, likes: 0 },
  );
});

it('rejects malformed prompt identifiers before the service', async () => {
  const response = await fetch(`${base}/api/analytics/manual/not-a-uuid/submit`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ views: 1 }),
  });
  expect(response.status).toBe(400);
});
