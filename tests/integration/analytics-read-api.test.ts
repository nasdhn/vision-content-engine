import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createApi } from '../../apps/api/src/app.js';
import type { AnalyticsReadService } from '../../packages/application/src/analytics-read.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;

const overview = vi.fn(async () => ({
  generatedAt: '2026-09-22T18:00:00.000Z',
  funnel: {
    websiteVisits: { total: 3, direct: 1, inferred: 1, unknown: 1 },
    signups: { total: 1, direct: 1, inferred: 0, unknown: 0 },
    activations: { total: 0, direct: 0, inferred: 0, unknown: 0 },
    customers: { total: 0, direct: 0, inferred: 0, unknown: 0 },
    revenueEvents: { total: 0, direct: 0, inferred: 0, unknown: 0 },
    revenueByCurrency: [],
  },
  attribution: { total: 4, direct: 2, inferred: 1, unknown: 1 },
  freshness: { latestEvidenceAt: null, ageSeconds: null, publicationsWithoutMeasurement: 0 },
  quality: { states: [] },
  platforms: [],
  publications: [],
  experiments: [],
}));

beforeAll(async () => {
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    {
      auth: { accessKey, origin },
      analyticsRead: { overview } as unknown as AnalyticsReadService,
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
});

afterAll(async () => app?.close());

it('protects the Analytics read model with the local session and disables caching', async () => {
  expect((await fetch(`${base}/api/analytics`)).status).toBe(401);

  const response = await fetch(`${base}/api/analytics`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({
    funnel: { websiteVisits: { total: 3, direct: 1, inferred: 1, unknown: 1 } },
    attribution: { direct: 2, inferred: 1, unknown: 1 },
  });
  expect(overview).toHaveBeenCalledTimes(1);
});
