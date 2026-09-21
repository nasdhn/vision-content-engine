import { afterAll, beforeAll, expect, it } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence, createDatabaseClient } from '../../packages/database/src/index.js';
import { RecordingPackService } from '../../packages/application/src/recording-pack.js';
import {
  MemoryStorage,
  chunks,
  human,
  recordingGraph,
  requestSpec,
  wav,
} from '../fixtures/recordings/support.js';
let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let other: ReturnType<typeof createDatabaseClient>;
let p: Persistence;
let storage: MemoryStorage;
let service: RecordingPackService;
beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  other = createDatabaseClient(fixture.url);
  p = new Persistence(db);
  storage = new MemoryStorage();
  service = new RecordingPackService(db, storage);
});
afterAll(async () => {
  await other?.$disconnect();
  await fixture?.close();
});
async function uploaded() {
  const graph = await recordingGraph(db);
  const take = await service.upload(human, graph.request.id, chunks());
  return { ...graph, take };
}
const request = (id: string) => db.recordingRequest.findUniqueOrThrow({ where: { id } });
it('prepares exact requirements idempotently and preserves complete recording instructions', async () => {
  const g = await recordingGraph(db);
  const [a, b] = await Promise.all([
    service.prepare(human, g.cpv.id),
    service.prepare(human, g.cpv.id),
  ]);
  expect(a[0]?.id).toBe(b[0]?.id);
  const packs = await service.packs();
  expect(packs.find((p) => p.versionId === g.cpv.id)?.requests[0]).toMatchObject({
    text: g.sv.fullText,
    targetDurationSec: 1,
    status: 'READY_TO_RECORD',
  });
  expect((await db.creativePlan.findUniqueOrThrow({ where: { id: g.plan.id } })).status).toBe(
    'WAITING_FOR_INPUTS',
  );
});
it('ingests/probes/verifies original bytes, pins asset and exposes authenticated preview', async () => {
  const g = await uploaded();
  const a = await db.asset.findUniqueOrThrow({ where: { id: g.take.assetId } });
  expect(a).toMatchObject({
    status: 'READY',
    kind: 'AUDIO',
    mimeType: 'audio/wav',
    durationMs: 500,
    sampleRate: 16000,
    audioChannels: 1,
    checksumSha256: createHash('sha256').update(wav()).digest('hex'),
  });
  expect(storage.objects.get(a.objectKey)).toEqual(wav());
  expect((await service.preview(human, a.id)).bytes).toEqual(wav());
  expect((await request(g.request.id)).status).toBe('UPLOADED');
});
it('ACCEPTED with two selected takes stays ACCEPTED when one is rejected', async () => {
  const g = await uploaded();
  const second = await service.upload(human, g.request.id, chunks());
  await service.select(human, g.take.id, 'SELECTED');
  await service.select(human, second.id, 'SELECTED');
  expect(await service.select(human, g.take.id, 'REJECTED')).toMatchObject({ ready: true });
  expect((await request(g.request.id)).status).toBe('ACCEPTED');
});
it.each(['REJECTED', 'UPLOADED'] as const)(
  'losing the last selected take via %s reopens and makes future inputs unready, then reselects',
  async (status) => {
    const g = await uploaded();
    await service.select(human, g.take.id, 'SELECTED');
    expect(await service.select(human, g.take.id, status)).toMatchObject({
      ready: false,
      recordingsReady: false,
    });
    expect(await request(g.request.id)).toMatchObject({ status: 'UPLOADED', completedAt: null });
    expect((await db.creativePlan.findUniqueOrThrow({ where: { id: g.plan.id } })).status).toBe(
      'WAITING_FOR_INPUTS',
    );
    expect(await service.select(human, g.take.id, 'SELECTED')).toMatchObject({ ready: true });
    expect((await request(g.request.id)).status).toBe('ACCEPTED');
  },
);
it('selection change leaves exact immutable plan, script, render input and original asset unchanged', async () => {
  const g = await uploaded();
  await service.select(human, g.take.id, 'SELECTED');
  const render = await p.transaction(human, async (u) => {
    const editing = await u.createEditingPlan(g.plan.id);
    const epv = await u.versions.editingPlanVersion({
      editingPlanId: editing.id,
      creativePlanVersionId: g.cpv.id,
      templateVersionId: g.tv.id,
      editingProfileVersionId: g.pv.id,
      timelineJson: { assetId: g.take.assetId },
    });
    return u.requestRender(epv.id);
  });
  await db.renderInputAsset.create({
    data: { renderId: render.id, assetId: g.take.assetId, role: 'VOICE' },
  });
  const snapshot = async () => ({
    versions: await db.creativePlanVersion.findMany({ where: { creativePlanId: g.plan.id } }),
    script: await db.scriptVersion.findUnique({ where: { id: g.sv.id } }),
    render: await db.render.findUnique({ where: { id: render.id } }),
    inputs: await db.renderInputAsset.findMany({ where: { renderId: render.id } }),
    asset: await db.asset.findUnique({ where: { id: g.take.assetId } }),
  });
  const before = await snapshot();
  await service.select(human, g.take.id, 'REJECTED');
  expect(await snapshot()).toEqual(before);
});
it('concurrent select/reject serialize across separate PostgreSQL connections', async () => {
  const g = await uploaded();
  const b = await service.upload(human, g.request.id, chunks());
  const second = new RecordingPackService(other, storage);
  await service.select(human, g.take.id, 'SELECTED');
  await Promise.all([
    service.select(human, g.take.id, 'REJECTED'),
    second.select(human, b.id, 'SELECTED'),
  ]);
  expect((await request(g.request.id)).status).toBe('ACCEPTED');
  await Promise.all([
    service.select(human, b.id, 'REJECTED'),
    second.select(human, b.id, 'SELECTED'),
  ]);
  const selected = await db.recording.count({
    where: {
      recordingRequestId: g.request.id,
      status: 'SELECTED',
      asset: { status: 'READY', deletedAt: null },
    },
  });
  expect((await request(g.request.id)).status === 'ACCEPTED').toBe(selected > 0);
});
it('two simultaneous uploads allocate unique increasing take numbers without losing selection', async () => {
  const g = await uploaded();
  await service.select(human, g.take.id, 'SELECTED');
  const b = new RecordingPackService(other, storage);
  const rows = await Promise.all([
    service.upload(human, g.request.id, chunks()),
    b.upload(human, g.request.id, chunks()),
  ]);
  expect(rows.map((r) => r.takeNumber).sort()).toEqual([2, 3]);
  expect((await request(g.request.id)).status).toBe('ACCEPTED');
});
it('failure rolls back selection, request, readiness, audit and outbox together', async () => {
  const g = await uploaded();
  await service.select(human, g.take.id, 'SELECTED');
  const snapshot = async () => ({
    take: await db.recording.findUnique({ where: { id: g.take.id } }),
    request: await request(g.request.id),
    plan: await db.creativePlan.findUnique({ where: { id: g.plan.id } }),
    audit: await db.auditEvent.count(),
    outbox: await db.outboxEvent.count(),
  });
  const before = await snapshot();
  await expect(
    p.transaction(human, async (u) => {
      await u.recordings.select(g.take.id, 'REJECTED');
      throw new Error('injected-rollback');
    }),
  ).rejects.toThrow('injected-rollback');
  expect(await snapshot()).toEqual(before);
});
it('does not declare a plan ready while required captures remain unfulfilled', async () => {
  const g = await recordingGraph(db, true);
  const t = await service.upload(human, g.request.id, chunks());
  expect(await service.select(human, t.id, 'SELECTED')).toMatchObject({
    recordingsReady: true,
    capturesReady: false,
    ready: false,
  });
});
it('rejects untrusted selection and invalid assets without mutation', async () => {
  const g = await uploaded();
  await expect(service.select({ actorType: 'AI' }, g.take.id, 'SELECTED')).rejects.toThrow(
    'HUMAN_APPROVAL_REQUIRED',
  );
  await p.transaction(human, (u) => u.recordings.quarantine(g.take.assetId));
  await expect(service.select(human, g.take.id, 'SELECTED')).rejects.toThrow(
    'INVALID_RECORDING_ASSET',
  );
});
it.each(['put', 'get', 'corrupt'] as const)(
  'fails closed on storage %s failure and keeps an identifiable failed asset',
  async (mode) => {
    const g = await recordingGraph(db);
    const s = new MemoryStorage();
    s.failPut = mode === 'put';
    s.failGet = mode === 'get';
    s.corrupt = mode === 'corrupt';
    await expect(
      new RecordingPackService(db, s).upload(human, g.request.id, chunks()),
    ).rejects.toThrow();
    expect(await db.recording.count({ where: { recordingRequestId: g.request.id } })).toBe(0);
    const asset = await db.asset.findFirstOrThrow({ where: { sourceEntityId: g.request.id } });
    expect(asset.status).toBe('FAILED');
    expect(
      JSON.stringify(await db.auditEvent.findMany({ where: { subjectId: asset.id } })),
    ).not.toContain('sensitive');
  },
);
it.each(['checksum', 'unreadable', 'empty', 'disconnect'] as const)(
  'rejects %s upload without publishing a ready take',
  async (mode) => {
    const g = await recordingGraph(db);
    async function* broken() {
      yield wav().subarray(0, 100);
      throw new Error('socket closed');
    }
    await expect(
      service.upload(
        human,
        g.request.id,
        mode === 'disconnect'
          ? broken()
          : chunks(
              mode === 'unreadable'
                ? Buffer.from('not media')
                : mode === 'empty'
                  ? Buffer.alloc(0)
                  : wav(),
            ),
        mode === 'checksum' ? '0'.repeat(64) : undefined,
      ),
    ).rejects.toThrow();
    expect(await db.recording.count({ where: { recordingRequestId: g.request.id } })).toBe(0);
  },
);
it('missing original invalidates future readiness without changing historical selection rows', async () => {
  const g = await uploaded();
  await service.select(human, g.take.id, 'SELECTED');
  const a = await db.asset.findUniqueOrThrow({ where: { id: g.take.assetId } });
  storage.objects.delete(a.objectKey);
  await expect(service.preview(human, a.id)).rejects.toThrow('ASSET_NOT_AVAILABLE');
  expect((await request(g.request.id)).status).toBe('UPLOADED');
  expect(await p.transaction(human, (u) => u.recordings.refresh(g.cpv.id))).toMatchObject({
    ready: false,
  });
});
it('recovers interrupted uploads conservatively, rejects late completion and retains tracked orphan bytes', async () => {
  const g = await recordingGraph(db);
  const a = await p.transaction(human, (u) =>
    u.recordings.beginUpload(g.request.id, storage.bucket),
  );
  storage.objects.set(a.objectKey, wav());
  await db.asset.update({
    where: { id: a.id },
    data: { createdAt: new Date('2000-01-01T00:00:00Z') },
  });
  expect(await service.recoverInterrupted()).toBeGreaterThanOrEqual(1);
  await expect(
    p.transaction(human, (u) => u.recordings.finishUpload(a.id, {} as never, {})),
  ).rejects.toThrow('UPLOAD_ALREADY_FINALIZED');
  expect(storage.objects.has(a.objectKey)).toBe(true);
  expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('FAILED');
});

it('marks canonical capture requirements ready automatically after the matching CaptureRun succeeds', async () => {
  const g = await recordingGraph(db);

  const scenario = await db.captureScenario.create({
    data: {
      key: `fixture-capture-${randomUUID()}`,
      name: 'Fixture capture readiness',
      status: 'ACTIVE',
    },
  });

  const canonicalCaptureScenarioVersionId = randomUUID();

  const scenarioVersion = await db.captureScenarioVersion.create({
    data: {
      captureScenarioId: scenario.id,
      version: 1,
      targetEnvironment: 'fixture',
      stepsJson: [],
      inputSchemaJson: {},
      outputSpecJson: [],
      browserConfigJson: {
        specVersionId: canonicalCaptureScenarioVersionId,
      },
    },
  });

  const next = await p.transaction(human, async (u) => {
    const version = await u.versions.creativePlanVersion({
      creativePlanId: g.plan.id,
      scriptVersionId: g.sv.id,
      primaryFormat: 'VOICE',
      templateVersionId: g.tv.id,
      editingProfileVersionId: g.pv.id,
      scenePlanJson: {},
      requiredRecordingsJson: [],
      requiredCapturesJson: [
        {
          clientKey: 'capture-positive',
          captureScenarioVersionId: canonicalCaptureScenarioVersionId,
          scenarioInput: {},
          desiredOutputs: [],
          editorialPurpose: 'Prove capture readiness integration.',
        },
      ],
      requiredAssetsJson: [],
    });

    await u.recordings.prepare(version.id);

    return version;
  });

  expect(await p.transaction(human, (u) => u.recordings.refresh(next.id))).toMatchObject({
    ready: false,
    recordingsReady: true,
    capturesReady: false,
    assetsReady: true,
  });

  expect(
    await db.creativePlan.findUniqueOrThrow({
      where: { id: g.plan.id },
    }),
  ).toMatchObject({
    status: 'WAITING_FOR_INPUTS',
  });

  const run = await p.transaction(human, (u) =>
    u.captures.beginRun({
      captureScenarioVersionId: scenarioVersion.id,
      creativePlanVersionId: next.id,
      operationId: randomUUID(),
    }),
  );

  await p.transaction(human, (u) => u.captures.startRun(run.id));

  await p.transaction(human, (u) => u.captures.succeedRun(run.id));

  /*
   * No manual recordings.refresh() here.
   *
   * succeedRun() itself must have refreshed the CreativePlan
   * in the same transaction.
   */
  expect(
    await db.creativePlan.findUniqueOrThrow({
      where: { id: g.plan.id },
    }),
  ).toMatchObject({
    status: 'READY_FOR_EDITING',
  });

  /*
   * Read-only confirmation after the automatic transition.
   */
  expect(await p.transaction(human, (u) => u.recordings.refresh(next.id))).toMatchObject({
    ready: true,
    recordingsReady: true,
    capturesReady: true,
    assetsReady: true,
  });
});

it('old-version selection cannot mark a newer CreativePlanVersion ready', async () => {
  const g = await uploaded();
  const next = await p.transaction(human, async (u) => {
    const v = await u.versions.creativePlanVersion({
      creativePlanId: g.plan.id,
      scriptVersionId: g.sv.id,
      primaryFormat: 'VOICE',
      templateVersionId: g.tv.id,
      editingProfileVersionId: g.pv.id,
      scenePlanJson: {},
      requiredRecordingsJson: [requestSpec],
      requiredCapturesJson: [],
      requiredAssetsJson: [],
    });
    await u.recordings.prepare(v.id);
    return v;
  });
  await service.select(human, g.take.id, 'SELECTED');
  expect((await db.creativePlan.findUniqueOrThrow({ where: { id: g.plan.id } })).status).toBe(
    'WAITING_FOR_INPUTS',
  );
  expect(await p.transaction(human, (u) => u.recordings.refresh(next.id))).toMatchObject({
    ready: false,
  });
  expect((await request(g.request.id)).status).toBe('ACCEPTED');
});
it('quarantining a historical original keeps archived root status and immutable versions intact', async () => {
  const g = await uploaded();
  await service.select(human, g.take.id, 'SELECTED');
  await db.creativePlan.update({ where: { id: g.plan.id }, data: { status: 'ARCHIVED' } });
  await p.transaction(human, (u) => u.recordings.quarantine(g.take.assetId));
  expect((await request(g.request.id)).status).toBe('UPLOADED');
  expect((await db.creativePlan.findUniqueOrThrow({ where: { id: g.plan.id } })).status).toBe(
    'ARCHIVED',
  );
  expect(await db.creativePlanVersion.findUnique({ where: { id: g.cpv.id } })).toEqual(g.cpv);
});

it('cannot finalize an unprobed asset as READY through the persistence API', async () => {
  const g = await recordingGraph(db);
  const a = await p.transaction(human, (u) =>
    u.recordings.beginUpload(g.request.id, storage.bucket),
  );
  await expect(
    p.transaction(human, (u) => u.recordings.finishUpload(a.id, {} as never, {})),
  ).rejects.toThrow();
  expect((await db.asset.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('UPLOADING');
  expect(await db.recording.count({ where: { assetId: a.id } })).toBe(0);
});

it('concurrent quarantine and selection cannot retain ACCEPTED without a valid selected asset', async () => {
  const g = await uploaded();
  await Promise.allSettled([
    service.select(human, g.take.id, 'SELECTED'),
    new Persistence(other).transaction(human, (u) => u.recordings.quarantine(g.take.assetId)),
  ]);
  expect((await request(g.request.id)).status).toBe('UPLOADED');
  expect((await db.asset.findUniqueOrThrow({ where: { id: g.take.assetId } })).status).toBe(
    'QUARANTINED',
  );
  expect((await db.creativePlan.findUniqueOrThrow({ where: { id: g.plan.id } })).status).toBe(
    'WAITING_FOR_INPUTS',
  );
});
