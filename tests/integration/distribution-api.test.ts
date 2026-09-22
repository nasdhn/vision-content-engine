import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { DistributionOperationsService } from '../../packages/application/src/distribution-operations.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const publicationId = randomUUID();
const accountId = randomUUID();

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const overview = vi.fn(async () => ({
  generatedAt: '2026-09-22T12:00:00.000Z',
  safety: { realProvidersEnabled: false },
  accounts: [],
  publications: [],
}));
const requestReconciliation = vi.fn(async () => ({ id: randomUUID() }));
const reschedule = vi.fn(async () => ({ id: publicationId, status: 'SCHEDULED' }));
const cancel = vi.fn(async () => ({ id: publicationId, status: 'CANCELLED' }));
const refreshAccount = vi.fn(async () => ({ result: { kind: 'ACTIVE' } }));

beforeAll(async () => {
  app = await createApi(
    {
      postgres: async () => {},
      redis: async () => {},
      storage: async () => {},
    },
    {
      auth: { accessKey, origin },
      distribution: {
        overview,
        requestReconciliation,
        reschedule,
        cancel,
        refreshAccount,
      } as unknown as DistributionOperationsService,
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

function write(path: string, body: unknown = {}) {
  return fetch(`${base}/api/${path}`, {
    method: 'POST',
    headers: {
      Cookie: cookie,
      Origin: origin,
      'Content-Type': 'application/json',
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify(body),
  });
}

it('protects the distribution overview with the shared local session', async () => {
  expect((await fetch(`${base}/api/distribution`)).status).toBe(401);
  const response = await fetch(`${base}/api/distribution`, { headers: { Cookie: cookie } });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ safety: { realProvidersEnabled: false } });
});

it('requires CSRF for every operator mutation and routes only safe actions', async () => {
  const withoutCsrf = await fetch(`${base}/api/distribution/${publicationId}/reconcile`, {
    method: 'POST',
    headers: { Cookie: cookie, Origin: origin, 'Content-Type': 'application/json' },
    body: '{}',
  });
  expect(withoutCsrf.status).toBe(403);

  expect((await write(`distribution/${publicationId}/reconcile`)).status).toBe(201);
  expect((await write(`distribution/${publicationId}/cancel`)).status).toBe(201);
  expect(
    (
      await write(`distribution/${publicationId}/reschedule`, {
        scheduledAt: '2026-09-23T08:00:00.000Z',
      })
    ).status,
  ).toBe(201);
  expect((await write(`distribution/accounts/${accountId}/refresh`)).status).toBe(201);

  expect(requestReconciliation).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    publicationId,
  );
  expect(reschedule).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    publicationId,
    new Date('2026-09-23T08:00:00.000Z'),
  );
  expect(cancel).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    publicationId,
  );
  expect(refreshAccount).toHaveBeenCalledWith(
    expect.objectContaining({ actorType: 'USER' }),
    accountId,
  );
});

it('rejects malformed identifiers and reschedule timestamps before the service', async () => {
  expect((await write('distribution/not-a-uuid/reconcile')).status).toBe(400);
  expect(
    (
      await write(`distribution/${publicationId}/reschedule`, {
        scheduledAt: 'tomorrow morning',
      })
    ).status,
  ).toBe(400);
});
