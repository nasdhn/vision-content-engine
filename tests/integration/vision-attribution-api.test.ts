import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createApi } from '../../apps/api/src/app.js';
import {
  VisionAttributionIngestError,
  type VisionAttributionIngestService,
} from '../../packages/application/src/vision-attribution-ingest.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
let app: Awaited<ReturnType<typeof createApi>>;
let base: string;

const ingest = vi.fn(async (rawBody: Buffer | undefined, headers: unknown) => ({
  kind: 'INGESTED',
  rawBody: rawBody?.toString('utf8'),
  headers,
}));

beforeAll(async () => {
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    {
      auth: { accessKey, origin },
      visionAttribution: { ingest } as unknown as VisionAttributionIngestService,
    },
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});

afterAll(async () => app?.close());

it('forwards the exact raw request bytes and signing headers without local-session auth', async () => {
  const exactBody =
    '{"externalEventId":"evt-api-1","eventType":"SIGNUP","occurredAt":"2026-09-22T18:00:00Z"}\n';
  const response = await fetch(`${base}/api/internal/analytics/vision-events`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-VCE-Timestamp': '1789999999',
      'X-VCE-Signature': `v1=${'a'.repeat(64)}`,
    },
    body: exactBody,
  });
  expect(response.status).toBe(202);
  expect(ingest).toHaveBeenCalledTimes(1);
  const [raw, headers] = ingest.mock.calls[0]!;
  expect(raw?.toString('utf8')).toBe(exactBody);
  expect(headers).toEqual({ timestamp: '1789999999', signature: `v1=${'a'.repeat(64)}` });
});

it('maps authentication failures to a generic 401 without requiring CSRF', async () => {
  ingest.mockRejectedValueOnce(
    new VisionAttributionIngestError('VISION_ATTRIBUTION_AUTH_FAILED', 401),
  );
  const response = await fetch(`${base}/api/internal/analytics/vision-events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(response.status).toBe(401);
  expect(await response.text()).toContain('VISION_ATTRIBUTION_AUTH_FAILED');
});
