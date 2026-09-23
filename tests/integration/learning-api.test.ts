import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { LearningDashboardService } from '../../packages/application/src/learning-read.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const operationKey = 'a'.repeat(64);
const recommendationId = randomUUID();

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const list = vi.fn(async () => []);
const detail = vi.fn(async () => ({
  analysisOperationKey: operationKey,
  workflowRunId: randomUUID(),
  status: 'SUCCEEDED',
  currentStep: 'complete',
  analysisWindow: { from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' },
  measurementWindow: 'T_PLUS_24H',
  createdAt: '2026-09-21T00:00:00.000Z',
  finishedAt: '2026-09-21T00:02:00.000Z',
  insightCount: 1,
  generatedAt: '2026-09-23T12:00:00.000Z',
  businessOutcomes: {
    websiteVisits: { total: 1, direct: 1, inferred: 0, unknown: 0, sourceSystem: 'UMAMI' },
    signups: {
      total: null,
      direct: null,
      inferred: null,
      unknown: null,
      sourceSystem: 'VISION_APP',
    },
    activations: {
      total: null,
      direct: null,
      inferred: null,
      unknown: null,
      sourceSystem: 'VISION_APP',
    },
    customers: {
      total: null,
      direct: null,
      inferred: null,
      unknown: null,
      sourceSystem: 'VISION_APP',
    },
    revenueEvents: {
      total: null,
      direct: null,
      inferred: null,
      unknown: null,
      sourceSystem: 'VISION_APP',
    },
    revenueByCurrency: [],
  },
  funnel: [],
  insights: [],
  recommendations: [],
  experiments: [],
  dataQuality: { issues: [], excludedPublicationCount: 0 },
}));
const transitionRecommendation = vi.fn(async (_actor, id, status) => ({ id, status }));
const createExperimentProposal = vi.fn(async () => ({
  experimentId: randomUUID(),
  status: 'DRAFT',
  campaignId: null,
}));

beforeAll(async () => {
  app = await createApi(
    { postgres: async () => {}, redis: async () => {}, storage: async () => {} },
    {
      auth: { accessKey, origin },
      learning: {
        list,
        detail,
        transitionRecommendation,
        createExperimentProposal,
      } as unknown as LearningDashboardService,
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

it('protects Learning reads and returns private no-store responses', async () => {
  expect((await fetch(`${base}/api/learning`)).status).toBe(401);

  const response = await fetch(`${base}/api/learning/${operationKey}`, {
    headers: { Cookie: cookie },
  });
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(await response.json()).toMatchObject({
    businessOutcomes: { signups: { total: null } },
  });
});

it('requires CSRF before a human Recommendation transition', async () => {
  const denied = await fetch(`${base}/api/learning/recommendations/${recommendationId}/accept`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie },
  });
  expect(denied.status).toBe(403);
  expect(transitionRecommendation).not.toHaveBeenCalled();

  const accepted = await fetch(`${base}/api/learning/recommendations/${recommendationId}/accept`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'X-CSRF-Token': csrf },
  });
  expect(accepted.status).toBe(201);
  expect(transitionRecommendation).toHaveBeenCalledWith(
    { actorType: 'USER', actorId: 'local-learning-operator' },
    recommendationId,
    'ACCEPTED',
  );
});

it('keeps experiment proposal creation as a separate CSRF-protected action', async () => {
  const response = await fetch(
    `${base}/api/learning/recommendations/${recommendationId}/create-experiment-proposal`,
    {
      method: 'POST',
      headers: {
        Origin: origin,
        Cookie: cookie,
        'X-CSRF-Token': csrf,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    },
  );
  expect(response.status).toBe(201);
  expect(createExperimentProposal).toHaveBeenCalledTimes(1);
});
