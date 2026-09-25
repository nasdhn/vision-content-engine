import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { postgresFixture } from '../../packages/database/test/support.js';
import { CapacityGuard } from '../../packages/media/src/index.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { RecordingPackService } from '../../packages/application/src/recording-pack.js';
import { RenderPayloadBuilder } from '../../packages/application/src/render-payload-builder.js';
import { RenderWorkerOrchestrator } from '../../apps/worker-render/src/orchestrator.js';
import {
  MemoryStorage,
  recordingGraph,
  human,
  chunks,
  wav,
} from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
beforeAll(async () => {
  fixture = await postgresFixture();
});
afterAll(async () => {
  await fixture?.close();
});
const quiet = new StructuredLogger('api', () => {});
const guard = (max: number, free = 1024 * 1024 * 1024) =>
  new CapacityGuard(
    { minimumFreeBytes: 10, maxUploadBytes: max, maxArtifactBytes: max },
    async () => ({ bavail: BigInt(free), bsize: 1n, blocks: BigInt(free) }),
    quiet,
  );

it('rejects uploads before consuming input, probing or creating an Asset when disk capacity is insufficient', async () => {
  const db = fixture.client;
  const graph = await recordingGraph(db);
  const storage = new MemoryStorage();
  const probe = vi.fn();
  const service = new RecordingPackService(db, storage, probe, guard(4, 0));
  let consumed = false;
  async function* input() {
    consumed = true;
    yield Buffer.from('1234');
  }
  const before = await db.asset.count();
  await expect(service.upload(human, graph.request.id, input())).rejects.toThrow(
    'INSUFFICIENT_LOCAL_CAPACITY',
  );
  expect(consumed).toBe(false);
  expect(probe).not.toHaveBeenCalled();
  expect(await db.asset.count()).toBe(before);
  expect(storage.objects.size).toBe(0);
});
it.each([-1, 0, 1])(
  'enforces configured recording limit around actual bytes, delta %s',
  async (delta) => {
    const db = fixture.client;
    const graph = await recordingGraph(db);
    const storage = new MemoryStorage();
    const service = new RecordingPackService(db, storage, undefined, guard(wav().length + delta));
    const attempt = service.upload(human, graph.request.id, chunks());
    if (delta < 0) {
      await expect(attempt).rejects.toThrow('UPLOAD_TOO_LARGE');
      expect(storage.objects.size).toBe(0);
      const takes = await db.asset.findMany({
        where: { sourceEntityType: 'RecordingRequest', sourceEntityId: graph.request.id },
      });
      expect(takes.length).toBeGreaterThan(0);
      expect(takes.every((take) => take.status === 'FAILED')).toBe(true);
    } else {
      await expect(attempt).resolves.toHaveProperty('assetId');
      expect(storage.objects.size).toBe(1);
    }
  },
);

async function renderGraph() {
  const db = fixture.client;
  const graph = await recordingGraph(db);
  const plan = await db.editingPlan.create({
    data: { creativePlanId: graph.plan.id, status: 'READY' },
  });
  const version = await db.editingPlanVersion.create({
    data: {
      editingPlanId: plan.id,
      version: 1,
      creativePlanVersionId: graph.cpv.id,
      editingProfileVersionId: graph.pv.id,
      templateVersionId: graph.tv.id,
      timelineJson: {},
    },
  });
  const render = await db.render.create({
    data: { editingPlanVersionId: version.id, status: 'QUEUED' },
  });
  const attempt = await db.renderAttempt.create({
    data: {
      renderId: render.id,
      attemptNumber: 1,
      workerVersion: 'capacity-fixture',
      rendererVersion: 'v1',
    },
  });
  return { renderId: render.id, renderAttemptId: attempt.id };
}
it('denies a render before materialization/renderer and finalizes the attempt as failed', async () => {
  const ids = await renderGraph();
  const root = await mkdtemp(join(tmpdir(), 'vce-render-capacity-test-'));
  const storage = new MemoryStorage();
  const get = vi.spyOn(storage, 'get');
  const render = vi.fn();
  try {
    const worker = new RenderWorkerOrchestrator(
      fixture.client,
      storage,
      { render },
      {
        workerId: 'fixture',
        workerVersion: 'capacity-fixture',
        storageProvider: 'S3',
        workRoot: root,
        capacity: guard(4, 0),
      },
    );
    await expect(worker.execute(ids)).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
    expect(render).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
    expect(
      await fixture.client.renderAttempt.findUnique({ where: { id: ids.renderAttemptId } }),
    ).toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_LOCAL_CAPACITY' });
    await expect(worker.execute({ ...ids, renderAttemptId: '../../foreign' })).rejects.toThrow();
    expect(await readdir(root)).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it.each(['ARTIFACT_TOO_LARGE', 'FFMPEG_FAILED'])(
  'cleans local render output after %s and never uploads it',
  async (failure) => {
    const ids = await renderGraph();
    const root = await mkdtemp(join(tmpdir(), 'vce-render-capacity-test-'));
    const storage = new MemoryStorage();
    const canonicalKey = randomUUID();
    storage.objects.set(canonicalKey, Buffer.from('canonical'));
    const build = vi.spyOn(RenderPayloadBuilder.prototype, 'build').mockResolvedValue({} as never);
    try {
      const worker = new RenderWorkerOrchestrator(
        fixture.client,
        storage,
        {
          async render(_payload, options) {
            const outputPath = join(options.workDir, 'master.mp4');
            await writeFile(outputPath, '12345');
            if (failure === 'FFMPEG_FAILED') throw new Error(failure);
            return { outputPath, diagnostics: { rendererVersion: 'v1', elapsedMs: 1, logs: [] } };
          },
        },
        {
          workerId: 'fixture',
          workerVersion: 'capacity-fixture',
          storageProvider: 'S3',
          workRoot: root,
          capacity: guard(4),
        },
      );
      await expect(worker.execute(ids)).rejects.toThrow(failure);
      expect(await readdir(root)).toEqual([]);
      expect(storage.objects.get(canonicalKey)?.toString()).toBe('canonical');
      expect(storage.objects.size).toBe(1);
      expect(
        await fixture.client.renderAttempt.findUnique({ where: { id: ids.renderAttemptId } }),
      ).toMatchObject({ status: 'FAILED', failureCode: failure });
    } finally {
      build.mockRestore();
      await rm(root, { recursive: true, force: true });
    }
  },
);
