import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { ConceptReviewService } from '../../packages/application/src/concept-review.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const conceptVersionId = randomUUID();

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const queue = vi.fn(async () => [
  {
    conceptId: randomUUID(),
    conceptVersionId,
    version: 1,
    title: 'Une preuve avant la promesse',
    hook: 'Montrez le résultat avant de parler de l’outil.',
    angle: 'Résultat d’abord',
    audience: 'Freelances',
    objective: 'Prospection',
    hypothesis: 'La preuve retient mieux.',
    rationale: 'Démonstration directe.',
    createdAt: '2026-09-21T18:00:00.000Z',
    pattern: null,
    brief: {
      id: randomUUID(),
      title: 'Vision',
      goal: null,
      audience: null,
      campaign: { id: randomUUID(), name: 'Vision', slug: 'vision' },
    },
  },
]);

const detail = vi.fn(async () => ({
  ...(await queue())[0],
  status: 'AWAITING_REVIEW',
  latestConceptVersionId: conceptVersionId,
  isLatest: true,
  decisionAllowed: true,
  previousDecision: null,
}));

const decide = vi.fn(async (_actor, versionId, input) => ({
  approvalId: randomUUID(),
  conceptVersionId: versionId,
  decision: input.decision,
  reasonCode: input.reasonCode ?? null,
  comment: input.comment ?? null,
  createdAt: '2026-09-21T18:00:00.000Z',
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
      concepts: { queue, detail, decide } as unknown as ConceptReviewService,
    },
  );

  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  const response = await fetch(`${base}/api/session`, {
    method: 'POST',
    headers: {
      Origin: origin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ accessKey }),
  });

  cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  csrf = ((await response.json()) as { csrf: string }).csrf;
});

afterAll(async () => {
  await app?.close();
});

it('protects concept review reads with the shared session', async () => {
  expect((await fetch(`${base}/api/concepts/review`)).status).toBe(401);

  const response = await fetch(`${base}/api/concepts/review`, {
    headers: { Cookie: cookie },
  });

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        conceptVersionId,
        title: 'Une preuve avant la promesse',
      }),
    ]),
  );

  const detailResponse = await fetch(`${base}/api/concepts/${conceptVersionId}`, {
    headers: { Cookie: cookie },
  });

  expect(detailResponse.status).toBe(200);
  expect(await detailResponse.json()).toMatchObject({
    conceptVersionId,
    decisionAllowed: true,
  });
});

it('requires CSRF for decisions and passes the exact shown version to the application service', async () => {
  const withoutCsrf = await fetch(`${base}/api/concepts/${conceptVersionId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision: 'REJECTED', reasonCode: 'HOOK_WEAK' }),
  });

  expect(withoutCsrf.status).toBe(403);
  expect(decide).not.toHaveBeenCalled();

  const response = await fetch(`${base}/api/concepts/${conceptVersionId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'REJECTED',
      reasonCode: 'HOOK_WEAK',
      comment: 'Accroche trop abstraite.',
    }),
  });

  expect(response.status).toBe(201);
  expect(decide).toHaveBeenCalledWith(
    { actorType: 'USER', actorId: 'local-creative-director' },
    conceptVersionId,
    {
      decision: 'REJECTED',
      reasonCode: 'HOOK_WEAK',
      comment: 'Accroche trop abstraite.',
    },
  );
});

it('rejects unknown reason codes before application mutation', async () => {
  const callsBefore = decide.mock.calls.length;

  const response = await fetch(`${base}/api/concepts/${conceptVersionId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'REJECTED',
      reasonCode: 'MADE_UP_REASON',
    }),
  });

  expect(response.status).toBe(400);
  expect(decide.mock.calls).toHaveLength(callsBefore);
});
