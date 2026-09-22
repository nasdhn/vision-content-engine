import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { ManualHandoffService } from '../../packages/application/src/manual-handoff.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const publicationId = randomUUID();
const mediaBytes = Buffer.from('private-manual-tiktok-media');

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const detailValue = {
  publicationId,
  accountName: 'Vision TikTok',
  status: 'READY_FOR_MANUAL_PUBLISH',
  scheduledAt: '2026-09-22T10:00:00.000Z',
  captionPreview: 'Vision transforme la recherche.',
  hashtagCount: 2,
  commercialDisclosureReminder: true,
  completionAllowed: true,
  publishedAt: null,
  remoteUrl: null,
  metadata: {
    caption: 'Vision transforme la recherche.',
    hashtags: ['Vision', 'ProspectionB2B'],
    ctaNotes: null,
    coverRecommendation: null,
    commercialDisclosureReminder: true,
  },
  media: {
    assetId: randomUUID(),
    mimeType: 'video/mp4',
    sizeBytes: String(mediaBytes.byteLength),
    width: 1080,
    height: 1920,
    durationMs: 12000,
  },
};

const queue = vi.fn(async () => [detailValue]);
const detail = vi.fn(async () => detailValue);
const media = vi.fn(async () => ({
  bytes: mediaBytes,
  mimeType: 'video/mp4',
  sizeBytes: mediaBytes.byteLength,
}));
const complete = vi.fn(async () => ({
  ...detailValue,
  status: 'PUBLISHED',
  completionAllowed: false,
  publishedAt: '2026-09-22T10:05:00.000Z',
  remoteUrl: 'https://www.tiktok.com/@vision/video/123',
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
      manualHandoff: { queue, detail, media, complete } as unknown as ManualHandoffService,
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

afterAll(async () => {
  await app?.close();
});

it('protects the TikTok manual queue, detail and private media with the shared session', async () => {
  expect((await fetch(`${base}/api/manual-publish`)).status).toBe(401);
  expect(
    (await fetch(`${base}/api/manual-publish/${publicationId}`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200);

  const mediaResponse = await fetch(`${base}/api/manual-publish/${publicationId}/media`, {
    headers: { Cookie: cookie, Range: 'bytes=0-6' },
  });
  expect(mediaResponse.status).toBe(206);
  expect(mediaResponse.headers.get('cache-control')).toContain('private');
  expect(Buffer.from(await mediaResponse.arrayBuffer()).toString()).toBe('private');

  const download = await fetch(`${base}/api/manual-publish/${publicationId}/download`, {
    headers: { Cookie: cookie },
  });
  expect(download.status).toBe(200);
  expect(download.headers.get('content-disposition')).toContain(
    `vision-tiktok-${publicationId}.mp4`,
  );
});

it('requires CSRF and validates the optional HTTPS remote URL before manual completion', async () => {
  const withoutCsrf = await fetch(`${base}/api/manual-publish/${publicationId}/complete`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  expect(withoutCsrf.status).toBe(403);

  const invalid = await fetch(`${base}/api/manual-publish/${publicationId}/complete`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ remoteUrl: 'http://example.test/not-secure' }),
  });
  expect(invalid.status).toBe(400);

  const response = await fetch(`${base}/api/manual-publish/${publicationId}/complete`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ remoteUrl: 'https://www.tiktok.com/@vision/video/123' }),
  });
  expect(response.status).toBe(201);
  expect(complete).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    publicationId,
    'https://www.tiktok.com/@vision/video/123',
  );
});

it('rejects malformed publication IDs before calling the application service', async () => {
  const response = await fetch(`${base}/api/manual-publish/not-a-uuid`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(400);
});
