import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';
import { createApi } from '../../apps/api/src/app.js';
import type { RecordingPackService } from '../../packages/application/src/recording-pack.js';
const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
let app: Awaited<ReturnType<typeof createApi>>, base: string, cookie: string, csrf: string;
const packs = vi.fn(async () => []);
const select = vi.fn(async () => ({ ready: false }));
beforeAll(async () => {
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    { accessKey, origin, service: { packs, select } as unknown as RecordingPackService },
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
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey }),
  });
  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  csrf = ((await response.json()) as { csrf: string }).csrf;
  return response;
}
it('protects business routes and previews without leaking storage identifiers', async () => {
  expect((await fetch(`${base}/api/recording-packs`)).status).toBe(401);
  expect((await fetch(`${base}/api/assets/${randomUUID()}/preview`)).status).toBe(401);
  expect(packs).not.toHaveBeenCalled();
});
it('creates a secure HttpOnly same-site authenticated session', async () => {
  const r = await login();
  expect(r.status).toBe(201);
  expect(r.headers.get('set-cookie')).toMatch(/HttpOnly; Secure; SameSite=Strict/);
  expect((await fetch(`${base}/api/recording-packs`, { headers: { Cookie: cookie } })).status).toBe(
    200,
  );
});
it('rejects both cross-origin and missing-CSRF writes before application mutation', async () => {
  await login();
  for (const headers of [
    { Origin: 'http://evil.invalid', 'X-CSRF-Token': csrf },
    { Origin: origin },
  ]) {
    const r = await fetch(`${base}/api/recordings/${randomUUID()}/selection`, {
      method: 'POST',
      headers: { ...headers, Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'SELECTED' }),
    });
    expect(r.status).toBe(403);
  }
  expect(select).not.toHaveBeenCalled();
});
it('uses the authenticated actor, validates IDs, and hides internal errors', async () => {
  await login();
  const takeId = randomUUID();
  const headers = {
    Origin: origin,
    'X-CSRF-Token': csrf,
    Cookie: cookie,
    'Content-Type': 'application/json',
  };
  expect(
    (
      await fetch(`${base}/api/recordings/${takeId}/selection`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ status: 'REJECTED' }),
      })
    ).status,
  ).toBe(201);
  expect(select).toHaveBeenCalledWith(
    { actorType: 'USER', actorId: 'local-creative-director' },
    takeId,
    'REJECTED',
  );
  expect(
    (
      await fetch(`${base}/api/recordings/not-uuid/selection`, {
        method: 'POST',
        headers,
        body: '{}',
      })
    ).status,
  ).toBe(400);
  packs.mockRejectedValueOnce(new Error('sensitive SQL credentials'));
  const r = await fetch(`${base}/api/recording-packs`, { headers });
  expect(r.status).toBe(409);
  expect(await r.text()).not.toContain('sensitive');
});
it('revokes session on logout and rate-limits bad login attempts', async () => {
  await login();
  await fetch(`${base}/api/logout`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf },
  });
  expect((await fetch(`${base}/api/recording-packs`, { headers: { Cookie: cookie } })).status).toBe(
    401,
  );
  let response: Response | undefined;
  for (let i = 0; i < 21; i++)
    response = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: '{}',
    });
  expect(response?.status).toBe(429);
});
