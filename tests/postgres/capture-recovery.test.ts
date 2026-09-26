import { randomUUID } from 'node:crypto';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { CaptureRecovery } from '../../apps/worker-capture/src/recovery.js';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Leases, Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';
import { createOwnedTemp } from '../../packages/media/src/index.js';

const human = {
  actorType: 'USER',
  actorId: 'phase4-recovery-fixture',
} as const;

const workerId = 'phase4-recovery-worker';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

let db: ReturnType<typeof createDatabaseClient>;

let persistence: Persistence;
let leases: Leases;
let registry: CaptureScenarioRegistry;
let recovery: CaptureRecovery;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;

  persistence = new Persistence(db);

  leases = new Leases(
    db,
    {
      durationMs: 60_000,
      heartbeatIntervalMs: 10_000,
    },
    {
      CAPTURE: 'RECONCILE',
    },
  );

  registry = new CaptureScenarioRegistry();

  recovery = new CaptureRecovery(db);
});

afterAll(async () => {
  await fixture?.close();
});

async function queuedCapture(query: string) {
  const scenario = await registry.getByKey('AGENT_QUERY_TO_RESULTS');

  await persistence.transaction(human, (unit) => unit.captures.importSeed(scenario.spec));

  const graph = await recordingGraph(db);

  await db.creativePlanVersion.update({
    where: {
      id: graph.cpv.id,
    },
    data: {
      requiredCapturesJson: [
        {
          clientKey: `capture-${randomUUID()}`,
          captureScenarioVersionId: scenario.spec.identity.captureScenarioVersionId,
          scenarioInput: {
            query,
          },
          desiredOutputs: scenario.spec.outputs.flatMap((output) =>
            output.role === 'VIDEO' || output.role === 'SCREENSHOT' || output.role === 'FRAME'
              ? [
                  {
                    role: output.role,
                    moment: output.key,
                  },
                ]
              : [],
          ),
          editorialPurpose: 'Fixture recovery proof.',
        },
      ],
    },
  });

  const queued = await persistence.transaction(human, (unit) =>
    unit.captures.queueRequired(graph.cpv.id),
  );

  const entry = queued[0];

  if (!entry) {
    throw new Error('FIXTURE_CAPTURE_REQUIRED');
  }

  return {
    scenario,
    graph,
    entry,
  };
}

async function claimExpected(expectedJobId: string) {
  const claimed = await leases.claimJob('capture', workerId);

  expect(claimed?.id).toBe(expectedJobId);

  if (!claimed) {
    throw new Error('FIXTURE_JOB_REQUIRED');
  }

  return claimed;
}

async function expireJob(id: string) {
  await db.$executeRaw`
    UPDATE "JobAttempt"
    SET
      "leaseAcquiredAt" = '2000-01-01T00:00:00Z',
      "heartbeatAt" = '2000-01-01T00:00:01Z',
      "leaseExpiresAt" = '2000-01-01T00:00:02Z'
    WHERE "id" = ${id}::uuid
  `;
}

it('quarantines an expired running capture attempt without creating a retry', async () => {
  const { entry } = await queuedCapture('entreprises à Lille');

  await claimExpected(entry.job.id);

  await persistence.transaction(
    {
      actorType: 'WORKER',
      actorId: workerId,
    },
    (unit) => unit.captures.startRun(entry.run.id),
  );

  const upload = await persistence.transaction(
    {
      actorType: 'WORKER',
      actorId: workerId,
    },
    (unit) =>
      unit.captures.beginAsset({
        captureRunId: entry.run.id,
        role: 'VIDEO',
        bucket: 'phase4-recovery-private',
        sequence: 0,
      }),
  );

  await expireJob(entry.job.id);

  const recovered = await recovery.recoverExpired();

  expect(recovered).toHaveLength(1);

  expect(recovered[0]).toMatchObject({
    job: {
      id: entry.job.id,
      status: 'FAILED',
      failureCode: 'CAPTURE_RECONCILIATION_REQUIRED',
    },
    run: {
      id: entry.run.id,
      status: 'FAILED',
      failureCode: 'CAPTURE_RECONCILIATION_REQUIRED',
      failureMessage: null,
    },
    failedAssetIds: [upload.asset.id],
  });

  expect(
    await db.asset.findUniqueOrThrow({
      where: {
        id: upload.asset.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
  });

  expect(
    await db.auditEvent.findFirst({
      where: {
        action: 'CaptureRun.reconciliationRequired',
        subjectId: entry.run.id,
      },
    }),
  ).not.toBeNull();

  /*
   * Replay of the canonical requirement
   * returns exactly the same terminal attempt.
   * No blind retry/new operation is created.
   */
  const replay = await persistence.transaction(human, (unit) =>
    unit.captures.queueRequired(entry.run.creativePlanVersionId!),
  );

  expect(replay).toHaveLength(1);

  expect(replay[0]!.run.id).toBe(entry.run.id);

  expect(replay[0]!.job.id).toBe(entry.job.id);

  expect(
    await db.captureRun.count({
      where: {
        creativePlanVersionId: entry.run.creativePlanVersionId!,
      },
    }),
  ).toBe(1);
});

it('reconciles an expired claimed job even when the CaptureRun never left PENDING', async () => {
  const { entry } = await queuedCapture('entreprises à Nice');

  await claimExpected(entry.job.id);

  await expireJob(entry.job.id);

  const recovered = await recovery.recoverExpired();

  expect(recovered).toHaveLength(1);

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: {
        id: entry.run.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    startedAt: null,
    failureCode: 'CAPTURE_RECONCILIATION_REQUIRED',
  });

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: entry.job.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_RECONCILIATION_REQUIRED',
  });
});

it('does not touch a Capture job whose lease is still valid', async () => {
  const { entry } = await queuedCapture('entreprises à Nantes');

  await claimExpected(entry.job.id);

  await persistence.transaction(
    {
      actorType: 'WORKER',
      actorId: workerId,
    },
    (unit) => unit.captures.startRun(entry.run.id),
  );

  const recovered = await recovery.recoverExpired();

  expect(recovered).toEqual([]);

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: {
        id: entry.run.id,
      },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: entry.job.id,
      },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });
});

it('cleans only quiescent capture workspaces and retains active, ambiguous or unknown owners', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capture-recovery-'));
  try {
    const terminal = await queuedCapture('entreprises à Bordeaux');
    const active = await queuedCapture('entreprises à Strasbourg');
    const ambiguous = await queuedCapture('entreprises à Toulouse');
    await db.captureRun.update({
      where: { id: terminal.entry.run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date() },
    });
    await db.captureRun.update({
      where: { id: active.entry.run.id },
      data: { status: 'RUNNING', startedAt: new Date('2000-01-01T00:00:00Z') },
    });
    await db.captureRun.update({
      where: { id: ambiguous.entry.run.id },
      data: {
        status: 'FAILED',
        failureCode: 'CAPTURE_RECONCILIATION_REQUIRED',
        finishedAt: new Date(),
      },
    });

    const terminalWorkspace = await createOwnedTemp(root, 'capture', terminal.entry.run.id);
    const activeWorkspace = await createOwnedTemp(root, 'capture', active.entry.run.id);
    const ambiguousWorkspace = await createOwnedTemp(root, 'capture', ambiguous.entry.run.id);
    const unknownWorkspace = await createOwnedTemp(root, 'capture', randomUUID());

    expect(await recovery.recoverQuiescentTemps(root)).toEqual({
      scanned: 4,
      deleted: 1,
      retained: 3,
      invalid: 0,
    });
    await expect(access(terminalWorkspace.path)).rejects.toThrow();
    await expect(access(activeWorkspace.path)).resolves.toBeUndefined();
    await expect(access(ambiguousWorkspace.path)).resolves.toBeUndefined();
    await expect(access(unknownWorkspace.path)).resolves.toBeUndefined();

    await activeWorkspace.cleanup();
    await ambiguousWorkspace.cleanup();
    await unknownWorkspace.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
