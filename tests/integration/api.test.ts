import { afterAll, beforeAll, expect, it } from 'vitest';
import { createApi } from '../../apps/api/src/app.js';

let app: Awaited<ReturnType<typeof createApi>>;
let baseUrl: string;
let unavailable = false;
beforeAll(async () => {
  app = await createApi({
    postgres: async () => {
      if (unavailable) throw new Error('sensitive-provider-message');
    },
    redis: async () => {},
    storage: async () => {},
  });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});
afterAll(async () => {
  await app?.close();
});

it('serves live/ready endpoints and exposes no business routes', async () => {
  expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/readyz`)).status).toBe(200);
  expect((await fetch(`${baseUrl}/publications`)).status).toBe(404);
});
it('keeps liveness up, fails readiness with 503 and hides provider errors', async () => {
  unavailable = true;
  const response = await fetch(`${baseUrl}/readyz`);
  expect(response.status).toBe(503);
  const body = await response.text();
  expect(body).toContain('not_ready');
  expect(body).not.toContain('sensitive');
  expect((await fetch(`${baseUrl}/healthz`)).status).toBe(200);
});
