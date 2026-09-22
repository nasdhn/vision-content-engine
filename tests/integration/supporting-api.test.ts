import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { SupportingReadService } from '../../packages/application/src/supporting-read.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const assetId = randomUUID();

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;

const calendar = vi.fn(async () => ({ readOnly: true, schedulingAvailable: false, entries: [] }));
const published = vi.fn(async () => ({
  readOnly: true,
  remotePublishingAvailable: false,
  entries: [],
}));
const assetItem = {
  assetId,
  kind: 'VIDEO',
  status: 'READY',
  sourceType: 'RENDER',
  sourceEntityType: 'RenderAttempt',
  sourceEntityId: randomUUID(),
  mimeType: 'video/mp4',
  sizeBytes: '1234',
  width: 1080,
  height: 1920,
  durationMs: 10000,
  fps: 30,
  audioChannels: 2,
  sampleRate: 48000,
  createdAt: '2026-09-22T08:00:00.000Z',
  deletedAt: null,
  usage: {
    recordings: 0,
    captureRuns: 0,
    renderInputs: 0,
    templateVersions: 0,
    renderOutputs: 1,
    renderDiagnostics: 0,
    approvedRenders: 0,
    publications: 0,
  },
};
const assets = vi.fn(async () => [assetItem]);
const asset = vi.fn(async () => ({
  ...assetItem,
  derivation: { parent: null, children: [] },
}));
const patterns = vi.fn(async () => []);
const templates = vi.fn(async () => []);
const settingsSummary = vi.fn(async () => ({
  environment: 'LOCAL',
  webOrigin: origin,
  authMode: 'LOCAL_SINGLE_USER',
  storageMode: 'PRIVATE_S3_COMPATIBLE',
  publicationMutationAvailable: false,
  analyticsEvidenceAvailable: true,
  safety: {
    pauseAllPublishing: true,
    pauseAiGeneration: true,
    pauseCapture: true,
    pauseRendering: true,
    pauseAnalyticsCollection: true,
    realProvidersEnabled: false,
  },
  platformAccounts: [],
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
      supporting: {
        calendar,
        published,
        assets,
        asset,
        patterns,
        templates,
        settingsSummary,
      } as unknown as SupportingReadService,
    },
  );

  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey }),
  });
  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
});

afterAll(async () => {
  await app?.close();
});

it('protects every Phase 6E read surface with the shared session', async () => {
  for (const path of [
    'calendar',
    'published',
    'assets',
    `assets/${assetId}`,
    'patterns',
    'templates',
    'settings/summary',
  ]) {
    expect((await fetch(`${base}/api/${path}`)).status).toBe(401);
    expect((await fetch(`${base}/api/${path}`, { headers: { Cookie: cookie } })).status).toBe(200);
  }
});

it('validates asset IDs and hides raw supporting-read failures', async () => {
  expect(
    (await fetch(`${base}/api/assets/not-a-uuid`, { headers: { Cookie: cookie } })).status,
  ).toBe(400);

  patterns.mockRejectedValueOnce(new Error('raw database password should never escape'));
  const response = await fetch(`${base}/api/patterns`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(409);
  expect(await response.text()).not.toContain('password');
});
