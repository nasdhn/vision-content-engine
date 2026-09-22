import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { ManualHandoffService } from '../../packages/application/src/manual-handoff.js';
import { RenderReviewService } from '../../packages/application/src/render-review.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { MemoryStorage, recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: Awaited<ReturnType<typeof postgresFixture>>['client'];
let storage: MemoryStorage;
let persistence: Persistence;
let review: RenderReviewService;
let manual: ManualHandoffService;

const human = { actorType: 'USER', actorId: 'manual-publisher' } as const;
const system = { actorType: 'SYSTEM', actorId: 'phase7-control' } as const;

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
  persistence = new Persistence(db);
  review = new RenderReviewService(db, storage);
  manual = new ManualHandoffService(db, storage);
});

async function readyManualPublication() {
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

  const attemptId = randomUUID();
  const bytes = Buffer.from(`manual-tiktok-${render.id}`);
  const objectKey = `renders/${render.id}/attempts/1/master.mp4`;
  const asset = await db.asset.create({
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
      durationMs: 12_000,
      fps: 30,
      status: 'READY',
    },
  });
  storage.objects.set(objectKey, bytes);
  await db.renderAttempt.create({
    data: {
      id: attemptId,
      renderId: render.id,
      attemptNumber: 1,
      status: 'SUCCEEDED',
      outputAssetId: asset.id,
      technicalQaJson: {
        result: 'PASS',
        probe: {
          assetId: asset.id,
          container: 'mov,mp4,m4a,3gp,3g2,mj2',
          durationMs: 12_000,
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
      creativeQaResult: 'PASS',
      creativeQaJson: {
        result: 'PASS',
        evaluatedDimensions: ['PACING', 'PRODUCT_VISIBILITY'],
        notEvaluatedDimensions: [],
        issues: [],
        summary: 'Rendu prêt pour publication manuelle.',
      },
    },
  });
  await review.decide(human, render.id, { decision: 'APPROVED' });

  const account = await db.platformAccount.create({
    data: {
      platform: 'TIKTOK',
      displayName: 'Vision TikTok',
      remoteAccountId: `manual-${randomUUID()}`,
      status: 'ACTIVE',
    },
  });

  const publication = await persistence.transaction(human, (unit) =>
    unit.createPublication({
      renderId: render.id,
      platformAccountId: account.id,
      mediaAssetId: asset.id,
      deliveryMode: 'MANUAL_HANDOFF',
      metadataJson: {
        schemaVersion: 'tiktok-manual-handoff-v1',
        platform: 'TIKTOK',
        caption: 'Vision trouve les prospects pendant que vous vendez.',
        hashtags: ['Vision', 'ProspectionB2B'],
        ctaNotes: 'Tester Vision depuis le profil.',
        coverRecommendation: 'Afficher le résultat dès la première frame.',
        commercialDisclosureReminder: true,
      },
    }),
  );

  await persistence.transaction(human, (unit) =>
    unit.distribution.schedule(publication.id, new Date('2000-01-01T00:00:00.000Z')),
  );
  const due = await persistence.transaction(system, (unit) =>
    unit.distribution.dispatchNextDue({ pauseAllPublishing: false }),
  );
  expect(due).toMatchObject({ kind: 'MANUAL_READY', publicationId: publication.id });

  return { publication, asset, bytes };
}

it('exposes a private exact TikTok handoff and completes it without a fake PublicationAttempt', async () => {
  const graph = await readyManualPublication();

  const queue = await manual.queue();
  expect(queue).toHaveLength(1);
  expect(queue[0]).toMatchObject({
    publicationId: graph.publication.id,
    accountName: 'Vision TikTok',
    status: 'READY_FOR_MANUAL_PUBLISH',
    hashtagCount: 2,
    commercialDisclosureReminder: true,
  });

  const detail = await manual.detail(graph.publication.id);
  expect(detail).toMatchObject({
    completionAllowed: true,
    metadata: {
      caption: 'Vision trouve les prospects pendant que vous vendez.',
      hashtags: ['Vision', 'ProspectionB2B'],
    },
    media: { assetId: graph.asset.id, mimeType: 'video/mp4' },
  });
  expect(JSON.stringify(detail)).not.toContain(graph.asset.objectKey);
  expect(JSON.stringify(detail)).not.toContain(storage.bucket);

  const media = await manual.media(human, graph.publication.id);
  expect(media.bytes).toEqual(graph.bytes);

  const completed = await manual.complete(
    human,
    graph.publication.id,
    'https://www.tiktok.com/@vision/video/123456789',
  );
  expect(completed).toMatchObject({
    status: 'PUBLISHED',
    completionAllowed: false,
    remoteUrl: 'https://www.tiktok.com/@vision/video/123456789',
  });
  expect(completed.publishedAt).toBeTruthy();
  expect(
    await db.publicationAttempt.count({ where: { publicationId: graph.publication.id } }),
  ).toBe(0);
  expect(
    await db.auditEvent.findFirst({
      where: {
        subjectType: 'Publication',
        subjectId: graph.publication.id,
        action: 'Publication.manual_completed',
      },
    }),
  ).toBeTruthy();
});

it('fails closed on corrupted private media and refuses duplicate manual completion', async () => {
  const graph = await readyManualPublication();
  storage.corrupt = true;
  await expect(manual.media(human, graph.publication.id)).rejects.toThrow(
    'STORED_OBJECT_CHECKSUM_MISMATCH',
  );
  storage.corrupt = false;

  await manual.complete(human, graph.publication.id);
  await expect(manual.complete(human, graph.publication.id)).rejects.toThrow(
    'INVALID_PUBLICATION_TRANSITION',
  );
});
