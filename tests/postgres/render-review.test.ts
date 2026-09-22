import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { RenderReviewService } from '../../packages/application/src/render-review.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { MemoryStorage, recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: Awaited<ReturnType<typeof postgresFixture>>['client'];
let storage: MemoryStorage;
let review: RenderReviewService;
let persistence: Persistence;

const human = { actorType: 'USER', actorId: 'render-reviewer' } as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
});

afterAll(async () => {
  await fixture?.close();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
  storage = new MemoryStorage();
  review = new RenderReviewService(db, storage);
  persistence = new Persistence(db);
});

async function baseReviewGraph() {
  const graph = await recordingGraph(db);
  const editingPlan = await db.editingPlan.create({
    data: { creativePlanId: graph.plan.id, status: 'READY' },
  });
  const editingPlanVersion = await db.editingPlanVersion.create({
    data: {
      editingPlanId: editingPlan.id,
      version: 1,
      creativePlanVersionId: graph.cpv.id,
      editingProfileVersionId: graph.pv.id,
      templateVersionId: graph.tv.id,
      timelineJson: {},
    },
  });
  const render = await db.render.create({
    data: { editingPlanVersionId: editingPlanVersion.id, status: 'READY_FOR_REVIEW' },
  });
  return { graph, editingPlanVersion, render };
}

async function addAttempt(
  renderId: string,
  attemptNumber: number,
  qaResult: 'PASS' | 'PASS_WITH_WARNINGS' = 'PASS_WITH_WARNINGS',
) {
  const attemptId = randomUUID();
  const bytes = Buffer.from(`private-render-${renderId}-${attemptNumber}`);
  const objectKey = `renders/${renderId}/attempts/${attemptNumber}/master.mp4`;
  const output = await db.asset.create({
    data: {
      kind: 'VIDEO',
      sourceType: 'RENDER',
      sourceEntityType: 'RenderAttempt',
      sourceEntityId: attemptId,
      storageProvider: 'S3',
      bucket: storage.bucket,
      objectKey,
      checksumSha256: createHash('sha256').update(bytes).digest('hex'),
      mimeType: 'video/mp4',
      sizeBytes: BigInt(bytes.byteLength),
      width: 1080,
      height: 1920,
      durationMs: 10_000,
      fps: 30,
      status: 'READY',
    },
  });
  storage.objects.set(objectKey, bytes);

  const attempt = await db.renderAttempt.create({
    data: {
      id: attemptId,
      renderId,
      attemptNumber,
      status: 'SUCCEEDED',
      outputAssetId: output.id,
      technicalQaJson: {
        result: 'PASS',
        probe: {
          assetId: output.id,
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          durationMs: 10_000,
          video: {
            codec: 'h264',
            width: 1080,
            height: 1920,
            fps: 30,
            pixelFormat: 'yuv420p',
            rotationDeg: 0,
            color: {
              primaries: 'bt709',
              transfer: 'bt709',
              matrix: 'bt709',
              range: 'tv',
              hdrKind: 'SDR',
            },
          },
          probeVersion: 'ffprobe-v1',
        },
        checks: [{ key: 'MASTER_DIMENSIONS', status: 'PASS' }],
        rendererVersion: 'fixture-renderer-v1',
        colorProfileKey: 'SDR_BT709_SOCIAL_V1',
        codecProfileKey: 'SOCIAL_H264_AAC_V1',
        audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
      },
      creativeQaResult: qaResult,
      creativeQaJson: {
        result: qaResult,
        evaluatedDimensions: ['PACING', 'PRODUCT_VISIBILITY'],
        notEvaluatedDimensions: [],
        issues:
          qaResult === 'PASS_WITH_WARNINGS'
            ? [
                {
                  code: 'CTA_TOO_LONG',
                  severity: 'WARNING',
                  startMs: 8_500,
                  endMs: 9_800,
                  explanation: 'Le CTA mérite une inspection humaine.',
                  suggestedFix: 'Raccourcir si nécessaire.',
                },
              ]
            : [],
        summary:
          qaResult === 'PASS_WITH_WARNINGS'
            ? 'Rendu exploitable avec un avertissement non critique.'
            : 'Rendu prêt pour review humaine.',
      },
    },
  });

  return { attempt, output, bytes };
}

it('returns oldest READY_FOR_REVIEW first and exposes QA evidence without storage identifiers', async () => {
  const first = await baseReviewGraph();
  const firstAttempt = await addAttempt(first.render.id, 1);
  await db.render.update({
    where: { id: first.render.id },
    data: { createdAt: new Date('2026-09-21T18:00:00.000Z') },
  });

  const second = await db.render.create({
    data: {
      editingPlanVersionId: first.editingPlanVersion.id,
      status: 'READY_FOR_REVIEW',
      createdAt: new Date('2026-09-21T19:00:00.000Z'),
    },
  });
  await addAttempt(second.id, 1, 'PASS');

  const queue = await review.queue();
  expect(queue.map((item) => item.renderId)).toEqual([first.render.id, second.id]);

  const detail = await review.detail(first.render.id);
  expect(detail).toMatchObject({
    renderId: first.render.id,
    decisionAllowed: true,
    creativeQa: {
      result: 'PASS_WITH_WARNINGS',
      issues: [expect.objectContaining({ code: 'CTA_TOO_LONG', startMs: 8_500 })],
    },
    technicalQa: { result: 'PASS', width: 1080, height: 1920, fps: 30 },
    lineage: {
      renderAttemptId: firstAttempt.attempt.id,
      outputAssetId: firstAttempt.output.id,
    },
  });
  expect(JSON.stringify(detail)).not.toContain(firstAttempt.output.objectKey);
  expect(JSON.stringify(detail)).not.toContain(storage.bucket);
});

it('serves only checksum-verified private bytes resolved from render lineage', async () => {
  const graph = await baseReviewGraph();
  const attempt = await addAttempt(graph.render.id, 1);

  const media = await review.media(human, graph.render.id);
  expect(media.bytes).toEqual(attempt.bytes);
  expect(media.mimeType).toBe('video/mp4');

  storage.corrupt = true;
  await expect(review.media(human, graph.render.id)).rejects.toThrow('ASSET_NOT_AVAILABLE');
});

it('requires a structured dashboard rejection reason and persists reason plus comment', async () => {
  const graph = await baseReviewGraph();
  await addAttempt(graph.render.id, 1);

  await expect(review.decide(human, graph.render.id, { decision: 'REJECTED' })).rejects.toThrow(
    'RENDER_REJECTION_REASON_REQUIRED',
  );

  const result = await review.decide(human, graph.render.id, {
    decision: 'REJECTED',
    reasonCode: 'CUTS_TOO_MECHANICAL',
    comment: '  Les cuts doivent respirer davantage.  ',
  });

  expect(result).toMatchObject({
    renderId: graph.render.id,
    decision: 'REJECTED',
    reasonCode: 'CUTS_TOO_MECHANICAL',
    comment: 'Les cuts doivent respirer davantage.',
  });
  expect(await db.render.findUniqueOrThrow({ where: { id: graph.render.id } })).toMatchObject({
    status: 'REJECTED',
    approvedAssetId: null,
  });
  expect(
    await db.approval.findFirstOrThrow({
      where: { renderId: graph.render.id, subjectType: 'RENDER' },
    }),
  ).toMatchObject({
    decision: 'REJECTED',
    reasonCode: 'CUTS_TOO_MECHANICAL',
    comment: 'Les cuts doivent respirer davantage.',
  });
});

it('approves only the latest successful QA-reviewed output and never accepts an older output', async () => {
  const graph = await baseReviewGraph();
  const older = await addAttempt(graph.render.id, 1, 'PASS');
  const latest = await addAttempt(graph.render.id, 2, 'PASS_WITH_WARNINGS');

  await expect(
    persistence.transaction(human, (unit) =>
      unit.decideRender(graph.render.id, 'APPROVED', older.output.id),
    ),
  ).rejects.toThrow('RENDER_OUTPUT_MISMATCH');

  const decision = await review.decide(human, graph.render.id, { decision: 'APPROVED' });
  expect(decision).toMatchObject({ decision: 'APPROVED', reasonCode: null, comment: null });
  expect(await db.render.findUniqueOrThrow({ where: { id: graph.render.id } })).toMatchObject({
    status: 'APPROVED',
    approvedAssetId: latest.output.id,
  });

  const approvedDetail = await review.detail(graph.render.id);
  expect(approvedDetail.decisionAllowed).toBe(false);
  expect(approvedDetail.lineage.outputAssetId).toBe(latest.output.id);
  expect(approvedDetail.lineage.approvedAssetId).toBe(latest.output.id);
});
