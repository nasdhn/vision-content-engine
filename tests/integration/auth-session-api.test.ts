import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApi, type ApiBusinessOptions } from '../../apps/api/src/app.js';

import { EnvironmentSecretResolver } from '../../packages/shared/src/secrets.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const id = randomUUID();
const routes = [
  { read: '/api/learning', write: `/api/learning/recommendations/${id}/accept`, body: {} },
  { read: '/api/analytics', write: `/api/analytics/manual/${id}/submit`, body: { views: 0 } },
  {
    read: '/api/concepts/review',
    write: `/api/concepts/${id}/decision`,
    body: { decision: 'APPROVED' },
  },
  { read: '/api/review', write: `/api/review/${id}/decision`, body: { decision: 'APPROVED' } },
  { read: '/api/distribution', write: `/api/distribution/${id}/cancel`, body: {} },
];
let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let now: number;
const read = vi.fn(async () => []);
const write = vi.fn(async () => ({ ok: true }));

beforeEach(async () => {
  now = 0;
  vi.clearAllMocks();
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    {
      auth: {
        accessKey: () =>
          new EnvironmentSecretResolver({ VCE_LOCAL_ACCESS_KEY: accessKey }, [
            'VCE_LOCAL_ACCESS_KEY',
          ]).resolve('VCE_LOCAL_ACCESS_KEY'),
        origin,
        now: () => now,
      },
      learning: { list: read, transitionRecommendation: write },
      analyticsRead: { overview: read },
      analyticsManual: { submit: write },
      concepts: { queue: read, decide: write },
      review: { queue: read, decide: write },
      distribution: { overview: read, cancel: write },
    } as unknown as ApiBusinessOptions,
  );
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
});
afterEach(async () => app?.close());

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin, ...headers },
    body: JSON.stringify(body),
  });
}

async function login(cookie?: string) {
  const response = await post('/api/session', { accessKey }, cookie ? { Cookie: cookie } : {});
  expect(response.status).toBe(201);
  expect(response.headers.get('cache-control')).toBe('no-store');
  const body = (await response.json()) as { csrf: string };
  expect(Object.keys(body)).toEqual(['csrf']);
  expect(JSON.stringify(body)).not.toContain(accessKey);
  return { cookie: response.headers.get('set-cookie')!.split(';')[0]!, csrf: body.csrf };
}

it('enforces the same session boundary across five critical domains before any business call', async () => {
  for (const route of routes) {
    expect((await fetch(`${base}${route.read}`)).status).toBe(401);
    expect((await post(route.write, route.body)).status).toBe(401);
  }
  expect(read).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  const session = await login();
  for (const route of routes) {
    expect(
      (await fetch(`${base}${route.read}`, { headers: { Cookie: session.cookie } })).status,
    ).toBe(200);
    expect(
      (
        await post(route.write, route.body, {
          Cookie: session.cookie,
          'X-CSRF-Token': session.csrf,
        })
      ).status,
    ).toBe(201);
  }
  expect(read).toHaveBeenCalledTimes(5);
  expect(write).toHaveBeenCalledTimes(5);
});

it('rejects missing, wrong and previous-session CSRF and wrong origins on every representative write', async () => {
  const previous = await login();
  const current = await login(previous.cookie);
  expect(current.cookie).not.toBe(previous.cookie);
  expect(current.csrf).not.toBe(previous.csrf);
  expect(
    (await fetch(`${base}/api/session`, { headers: { Cookie: previous.cookie } })).status,
  ).toBe(401);
  for (const route of routes) {
    for (const token of [undefined, 'incorrect', previous.csrf]) {
      const response = await post(route.write, route.body, {
        Cookie: current.cookie,
        ...(token ? { 'X-CSRF-Token': token } : {}),
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ message: 'CSRF_REJECTED' });
    }
    for (const badOrigin of ['https://external.example', 'malformed', 'null', '']) {
      const response = await post(route.write, route.body, {
        Cookie: current.cookie,
        'X-CSRF-Token': current.csrf,
        Origin: badOrigin,
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ message: 'ORIGIN_REJECTED' });
    }
  }
  expect(write).not.toHaveBeenCalled();
});

it('enforces expiry and logout server-side even when a client replays the old cookie and CSRF', async () => {
  const expired = await login();
  now = 28_800_000;
  expect((await fetch(`${base}/api/session`, { headers: { Cookie: expired.cookie } })).status).toBe(
    401,
  );
  expect(
    (await post(routes[0]!.write, {}, { Cookie: expired.cookie, 'X-CSRF-Token': expired.csrf }))
      .status,
  ).toBe(401);
  const session = await login();
  const logout = await post(
    '/api/logout',
    {},
    { Cookie: session.cookie, 'X-CSRF-Token': session.csrf },
  );
  expect(logout.status).toBe(201);
  expect(logout.headers.get('set-cookie')).toBe(
    '__Host-vce=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0',
  );
  for (const route of routes) {
    expect(
      (await fetch(`${base}${route.read}`, { headers: { Cookie: session.cookie } })).status,
    ).toBe(401);
    expect(
      (
        await post(route.write, route.body, {
          Cookie: session.cookie,
          'X-CSRF-Token': session.csrf,
        })
      ).status,
    ).toBe(401);
  }
  expect(write).not.toHaveBeenCalled();
});

it('returns generic failures for malformed credentials and limits failures independently of forwarded IPs', async () => {
  const badOrigin = await post('/api/session', { accessKey }, { Origin: 'malformed' });
  expect(badOrigin.status).toBe(403);
  for (let i = 0; i < 20; i++) {
    const response = await post(
      '/api/session',
      i % 2 ? { accessKey: 42 } : { accessKey, extra: true },
      { 'X-Forwarded-For': `192.0.2.${i}` },
    );
    expect(response.status).toBe(401);
    expect(response.headers.get('set-cookie')).toBeNull();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ message: 'AUTH_FAILED' });
  }
  const limited = await post('/api/session', { accessKey });
  expect(limited.status).toBe(429);
  expect(await limited.json()).toMatchObject({ message: 'AUTH_RATE_LIMITED' });
  now = 300_000;
  await login();
});

it('does not reflect credential material when the login body is invalid JSON', async () => {
  for (const path of ['/api/session', '/API/SESSION/?return=ignored', '/api/logout']) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: `${accessKey}!`,
    });
    expect(response.status).toBe(400);
    const body = await response.text();
    expect(body).not.toContain(accessKey.slice(0, 8));
    expect(JSON.parse(body)).toEqual({ statusCode: 400, message: 'AUTH_INVALID_INPUT' });
    expect(response.headers.get('cache-control')).toBe('no-store');
  }
});
