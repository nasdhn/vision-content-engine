import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { randomBytes, randomUUID } from 'node:crypto';

import { createApi } from '../../apps/api/src/app.js';
import type { RenderReviewService } from '../../packages/application/src/render-review.js';

const accessKey = randomBytes(32).toString('hex');
const origin = 'http://localhost:5174';
const renderId = randomUUID();
const creativePlanVersionId = randomUUID();
const mediaBytes = Buffer.from('private-render-master');

let app: Awaited<ReturnType<typeof createApi>>;
let base: string;
let cookie: string;
let csrf: string;

const item = {
  renderId,
  status: 'READY_FOR_REVIEW',
  title: 'Preuve produit',
  hook: 'La preuve avant la promesse.',
  creativePlanVersionId,
  creativePlanVersion: 3,
  primaryFormat: 'GREEN_SCREEN',
  targetDurationMs: 10_000,
  creativeQaResult: 'PASS_WITH_WARNINGS' as const,
  creativeQaSummary: 'Rendu exploitable avec un avertissement non critique.',
  issueCount: 1,
  createdAt: '2026-09-21T20:00:00.000Z',
};

const queue = vi.fn(async () => [item]);
const detail = vi.fn(async () => ({
  ...item,
  decisionAllowed: true,
  concept: {
    angle: 'Résultat d’abord',
    audience: 'Freelances',
    objective: 'Montrer Vision',
    hypothesis: null,
    rationale: null,
  },
  script: {
    fullText: 'Voici la preuve.',
    estimatedDurationMs: 10_000,
    voiceMode: 'NATURAL_USER_VOICE',
  },
  cta: { text: 'Tester Vision' },
  platformIntent: null,
  creativeQa: {
    result: 'PASS_WITH_WARNINGS' as const,
    summary: item.creativeQaSummary,
    evaluatedDimensions: ['PACING'],
    notEvaluatedDimensions: [],
    issues: [
      {
        code: 'CTA_TOO_LONG',
        severity: 'WARNING' as const,
        startMs: 8_000,
        endMs: 9_000,
        explanation: 'Inspecter le CTA.',
        suggestedFix: null,
      },
    ],
  },
  technicalQa: {
    result: 'PASS' as const,
    durationMs: 10_000,
    width: 1080,
    height: 1920,
    fps: 30,
    rendererVersion: 'fixture',
    colorProfileKey: 'SDR_BT709_SOCIAL_V1',
    codecProfileKey: 'SOCIAL_H264_AAC_V1',
    audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    checks: [],
  },
  lineage: {
    editingPlanVersionId: randomUUID(),
    creativePlanVersionId,
    renderAttemptId: randomUUID(),
    attemptNumber: 1,
    outputAssetId: randomUUID(),
    approvedAssetId: null,
  },
  previousDecision: null,
}));
const media = vi.fn(async () => ({
  bytes: mediaBytes,
  mimeType: 'video/mp4',
  checksumSha256: 'a'.repeat(64),
  sizeBytes: mediaBytes.byteLength,
}));
const decide = vi.fn(async (_actor, id, input) => ({
  approvalId: randomUUID(),
  renderId: id,
  decision: input.decision,
  reasonCode: input.reasonCode ?? null,
  comment: input.comment ?? null,
  createdAt: '2026-09-21T20:00:00.000Z',
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
      review: { queue, detail, media, decide } as unknown as RenderReviewService,
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
  csrf = ((await response.json()) as { csrf: string }).csrf;
});

afterAll(async () => {
  await app?.close();
});

it('protects final review queue, detail and render-scoped media with the shared session', async () => {
  expect((await fetch(`${base}/api/review`)).status).toBe(401);
  expect((await fetch(`${base}/api/review/${renderId}`)).status).toBe(401);
  expect((await fetch(`${base}/api/review/${renderId}/media`)).status).toBe(401);

  const queueResponse = await fetch(`${base}/api/review`, { headers: { Cookie: cookie } });
  expect(queueResponse.status).toBe(200);
  expect(await queueResponse.json()).toEqual([
    expect.objectContaining({ renderId, status: 'READY_FOR_REVIEW' }),
  ]);

  const detailResponse = await fetch(`${base}/api/review/${renderId}`, {
    headers: { Cookie: cookie },
  });
  expect(detailResponse.status).toBe(200);
  expect(await detailResponse.json()).toMatchObject({ renderId, decisionAllowed: true });

  const mediaResponse = await fetch(`${base}/api/review/${renderId}/media`, {
    headers: { Cookie: cookie, Range: 'bytes=2-7' },
  });
  expect(mediaResponse.status).toBe(206);
  expect(mediaResponse.headers.get('accept-ranges')).toBe('bytes');
  expect(mediaResponse.headers.get('content-range')).toBe(`bytes 2-7/${mediaBytes.byteLength}`);
  expect(Buffer.from(await mediaResponse.arrayBuffer())).toEqual(mediaBytes.subarray(2, 8));
});

it('requires CSRF and never accepts a client-selected render asset', async () => {
  const withoutCsrf = await fetch(`${base}/api/review/${renderId}/decision`, {
    method: 'POST',
    headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision: 'REJECTED', reasonCode: 'PACING_TOO_SLOW' }),
  });
  expect(withoutCsrf.status).toBe(403);

  const clientAsset = await fetch(`${base}/api/review/${renderId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'APPROVED',
      outputAssetId: randomUUID(),
    }),
  });
  expect(clientAsset.status).toBe(400);

  const response = await fetch(`${base}/api/review/${renderId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      decision: 'REJECTED',
      reasonCode: 'PACING_TOO_SLOW',
      comment: 'Raccourcir les respirations longues.',
    }),
  });
  expect(response.status).toBe(201);
  expect(decide).toHaveBeenCalledWith(
    { actorType: 'USER', actorId: 'local-creative-director' },
    renderId,
    {
      decision: 'REJECTED',
      reasonCode: 'PACING_TOO_SLOW',
      comment: 'Raccourcir les respirations longues.',
    },
  );
});

it('rejects unknown rejection reasons before application mutation', async () => {
  const before = decide.mock.calls.length;
  const response = await fetch(`${base}/api/review/${renderId}/decision`, {
    method: 'POST',
    headers: {
      Origin: origin,
      Cookie: cookie,
      'X-CSRF-Token': csrf,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ decision: 'REJECTED', reasonCode: 'MADE_UP_REASON' }),
  });
  expect(response.status).toBe(400);
  expect(decide.mock.calls).toHaveLength(before);
});
