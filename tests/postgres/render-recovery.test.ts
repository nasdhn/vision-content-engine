import { afterAll, beforeAll, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { RenderWorkerOrchestrator } from '../../apps/worker-render/src/orchestrator.js';
import type { VideoRenderer } from '../../packages/application/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { CapacityGuard } from '../../packages/media/src/index.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { MemoryStorage, human, recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const quiet = new StructuredLogger('worker-render', () => {});
const policy = {
  minimumFreeBytes: 10,
  maxUploadBytes: 1024,
  maxArtifactBytes: 1024,
} as const;
const healthyStats = {
  bavail: 1024n * 1024n * 1024n,
  bsize: 1n,
  blocks: 1024n * 1024n * 1024n,
};

async function renderGraph(workerVersion = 'render-recovery-v1') {
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
  const persistence = new Persistence(db);
  const attempt = await persistence.transaction(human, (unit) =>
    unit.createRenderAttempt(render.id, workerVersion),
  );
  const job = await db.jobAttempt.findUniqueOrThrow({
    where: {
      operationId_attemptNumber_jobType: {
        operationId: render.operationId,
        attemptNumber: attempt.attemptNumber,
        jobType: 'RENDER',
      },
    },
  });
  return { render, attempt, job };
}

async function waitForRunning(id: string, workerId: string) {
  for (let i = 0; i < 100; i++) {
    const job = await fixture.client.jobAttempt.findUniqueOrThrow({ where: { id } });
    if (job.status === 'RUNNING' && job.workerId === workerId) return job;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('RENDER_JOB_DID_NOT_START');
}

function worker(input: {
  workerId: string;
  root: string;
  capacity: CapacityGuard;
  render?: VideoRenderer['render'];
}) {
  return new RenderWorkerOrchestrator(
    fixture.client,
    new MemoryStorage(),
    {
      render:
        input.render ??
        (async () => {
          throw new Error('UNEXPECTED_RENDER');
        }),
    },
    {
      workerId: input.workerId,
      workerVersion: 'render-recovery-v1',
      storageProvider: 'S3',
      workRoot: input.root,
      capacity: input.capacity,
      leaseConfig: { durationMs: 60_000, heartbeatIntervalMs: 15_000 },
    },
  );
}

it('creates one durable Render JobAttempt with the exact RenderAttempt identity', async () => {
  const { render, attempt, job } = await renderGraph();
  expect(job).toMatchObject({
    queueName: 'render',
    jobType: 'RENDER',
    operationId: render.operationId,
    attemptNumber: attempt.attemptNumber,
    status: 'QUEUED',
    workflowRunId: null,
  });
  expect(
    await fixture.client.outboxEvent.findFirstOrThrow({
      where: { eventType: 'JobAttempt.queued', aggregateType: 'JobAttempt', aggregateId: job.id },
    }),
  ).toMatchObject({ aggregateId: job.id });
});

it('fails closed before claim mutation when the paired Render job identity is inconsistent', async () => {
  const { render, attempt, job } = await renderGraph();
  const root = await mkdtemp(join(tmpdir(), 'vce-render-identity-test-'));
  await fixture.client.jobAttempt.update({
    where: { id: job.id },
    data: { queueName: 'other-render-queue' },
  });

  try {
    await expect(
      worker({
        workerId: 'render-identity',
        root,
        capacity: new CapacityGuard(policy, async () => healthyStats, quiet),
      }).execute({ renderId: render.id, renderAttemptId: attempt.id }),
    ).rejects.toThrow('JOB_CLAIM_IDENTITY_MISMATCH');
    expect(
      await fixture.client.jobAttempt.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ status: 'QUEUED', workerId: null, leaseToken: null });
    expect(
      await fixture.client.renderAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).toMatchObject({ status: 'QUEUED' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('rejects concurrent execution of the same RenderAttempt while its durable lease is live', async () => {
  const { render, attempt, job } = await renderGraph();
  const root = await mkdtemp(join(tmpdir(), 'vce-render-fencing-test-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const capacity = new CapacityGuard(
    policy,
    async () => {
      if (reads++ === 0) await gate;
      return healthyStats;
    },
    quiet,
  );
  const first = worker({ workerId: 'render-one', root, capacity });
  const second = worker({ workerId: 'render-two', root, capacity });

  try {
    const running = first.execute({ renderId: render.id, renderAttemptId: attempt.id });
    const claimed = await waitForRunning(job.id, 'render-one');
    await expect(
      second.execute({ renderId: render.id, renderAttemptId: attempt.id }),
    ).rejects.toThrow('RENDER_JOB_BUSY');
    expect(
      await fixture.client.jobAttempt.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({ workerId: 'render-one', leaseToken: claimed.leaseToken, status: 'RUNNING' });

    release();
    await expect(running).rejects.toThrow();
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

it('allows an expired SAFE_RETRY takeover and fences the stale Render worker from canonical writes', async () => {
  const { render, attempt, job } = await renderGraph();
  const root = await mkdtemp(join(tmpdir(), 'vce-render-recovery-test-'));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reads = 0;
  const firstCapacity = new CapacityGuard(
    policy,
    async () => {
      if (reads++ === 0) await gate;
      return healthyStats;
    },
    quiet,
  );
  const deniedCapacity = new CapacityGuard(
    policy,
    async () => ({ bavail: 0n, bsize: 1n, blocks: 0n }),
    quiet,
  );
  const first = worker({ workerId: 'render-stale', root, capacity: firstCapacity });
  const recovered = worker({ workerId: 'render-recovered', root, capacity: deniedCapacity });

  try {
    const staleOutcome = first.execute({ renderId: render.id, renderAttemptId: attempt.id }).then(
      (result) => ({ kind: 'resolved' as const, result }),
      (error: unknown) => ({ kind: 'rejected' as const, error }),
    );
    await waitForRunning(job.id, 'render-stale');
    await fixture.client.$executeRaw`
      UPDATE "JobAttempt"
      SET "leaseAcquiredAt" = '2000-01-01T00:00:00Z',
          "heartbeatAt" = '2000-01-01T00:00:01Z',
          "leaseExpiresAt" = '2000-01-01T00:00:02Z'
      WHERE "id" = ${job.id}::uuid
    `;

    await expect(
      recovered.execute({ renderId: render.id, renderAttemptId: attempt.id }),
    ).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');

    expect(
      await fixture.client.jobAttempt.findUniqueOrThrow({ where: { id: job.id } }),
    ).toMatchObject({
      workerId: 'render-recovered',
      status: 'FAILED',
      failureCode: 'INSUFFICIENT_LOCAL_CAPACITY',
    });
    expect(
      await fixture.client.renderAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_LOCAL_CAPACITY' });
    expect(
      await fixture.client.render.findUniqueOrThrow({ where: { id: render.id } }),
    ).toMatchObject({ status: 'FAILED' });

    release();
    const stale = await staleOutcome;
    expect(stale.kind).toBe('rejected');
    if (stale.kind !== 'rejected') throw new Error('EXPECTED_STALE_LEASE_REJECTION');
    expect(stale.error).toBeInstanceOf(Error);
    expect((stale.error as Error).message).toBe('STALE_LEASE');

    expect(
      await fixture.client.renderAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).toMatchObject({ status: 'FAILED', failureCode: 'INSUFFICIENT_LOCAL_CAPACITY' });
  } finally {
    release();
    await rm(root, { recursive: true, force: true });
  }
});

it('treats a redelivered successful Render job as already done without invoking the renderer', async () => {
  const { render, attempt, job } = await renderGraph();
  const root = await mkdtemp(join(tmpdir(), 'vce-render-redelivery-test-'));
  let renderCalls = 0;
  const renderer: VideoRenderer['render'] = async () => {
    renderCalls++;
    throw new Error('UNEXPECTED_RENDER');
  };
  const asset = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'fixture-private',
      objectKey: `renders/${render.id}/attempts/${attempt.attemptNumber}/master.mp4`,
      status: 'READY',
      sourceType: 'RENDER',
      sourceEntityType: 'RenderAttempt',
      sourceEntityId: attempt.id,
    },
  });
  await fixture.client.renderAttempt.update({
    where: { id: attempt.id },
    data: {
      status: 'SUCCEEDED',
      outputAssetId: asset.id,
      technicalQaJson: { result: 'PASS' },
    },
  });
  await fixture.client.render.update({
    where: { id: render.id },
    data: { status: 'CREATIVE_QA' },
  });
  await fixture.client.jobAttempt.update({
    where: { id: job.id },
    data: { status: 'SUCCEEDED' },
  });

  try {
    const result = await worker({
      workerId: 'render-redelivery',
      root,
      capacity: new CapacityGuard(policy, async () => healthyStats, quiet),
      render: renderer,
    }).execute({ renderId: render.id, renderAttemptId: attempt.id });

    expect(result).toMatchObject({
      renderId: render.id,
      renderAttemptId: attempt.id,
      outputAssetId: asset.id,
      diagnostics: { replayed: true },
    });
    expect(renderCalls).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
