import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

const human = {
  actorType: 'USER',
  actorId: 'phase4-fixture-user',
} as const;

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);
});

afterAll(async () => {
  await fixture?.close();
});

function captureMetadata(
  role: 'SCREENSHOT' | 'VIDEO' | 'FRAME' | 'TRACE' | 'LOG' | 'OTHER',
  sequence: number,
) {
  const checksumSha256 = String((sequence % 9) + 1).repeat(64);

  if (role === 'VIDEO') {
    return {
      kind: 'VIDEO' as const,
      checksumSha256,
      mimeType: 'video/webm',
      sizeBytes: 1000n,
      durationMs: 1000,
      width: 1440,
      height: 1000,
      fps: 30,
      audioChannels: null,
      sampleRate: null,
    };
  }

  if (role === 'SCREENSHOT' || role === 'FRAME') {
    return {
      kind: 'IMAGE' as const,
      checksumSha256,
      mimeType: 'image/png',
      sizeBytes: 500n,
      durationMs: null,
      width: 1440,
      height: 1000,
      fps: null,
      audioChannels: null,
      sampleRate: null,
    };
  }

  return {
    kind: 'OTHER' as const,
    checksumSha256,
    mimeType: role === 'TRACE' ? 'application/zip' : 'application/octet-stream',
    sizeBytes: 300n,
    durationMs: null,
    width: null,
    height: null,
    fps: null,
    audioChannels: null,
    sampleRate: null,
  };
}

async function persistRequiredOutputs(
  runId: string,
  outputs: Array<{
    key: string;
    role: 'SCREENSHOT' | 'VIDEO' | 'FRAME' | 'TRACE' | 'LOG' | 'OTHER';
    required: boolean;
  }>,
) {
  for (const [sequence, output] of outputs.entries()) {
    if (!output.required) continue;

    const created = await persistence.transaction(human, (unit) =>
      unit.captures.beginAsset({
        captureRunId: runId,
        role: output.role,
        bucket: 'phase4-fixture-private',
        sequence,
      }),
    );

    await persistence.transaction(human, (unit) =>
      unit.captures.finishAsset(created.asset.id, captureMetadata(output.role, sequence), {
        assetId: created.asset.id,
        outputKey: output.key,
        diagnostic: false,
        verification: 'SHA256_READBACK',
        technical: {
          fixture: true,
        },
      }),
    );
  }
}

async function seed() {
  const scenarios = await new CaptureScenarioRegistry().list();

  const mappings = [];

  for (const scenario of scenarios) {
    mappings.push(
      await persistence.transaction(human, (unit) => unit.captures.importSeed(scenario.spec)),
    );
  }

  return { scenarios, mappings };
}

it('imports the five canonical scenarios idempotently without rewriting versions', async () => {
  const first = await seed();
  const second = await seed();

  expect(await db.captureScenario.count()).toBe(5);
  expect(await db.captureScenarioVersion.count()).toBe(5);

  expect(
    await db.captureScenario.count({
      where: { status: 'ACTIVE' },
    }),
  ).toBe(5);

  expect(second.mappings).toEqual(first.mappings);

  for (const mapping of first.mappings) {
    const version = await db.captureScenarioVersion.findUniqueOrThrow({
      where: { id: mapping.captureScenarioVersionId },
    });

    expect(version.version).toBe(1);
    expect(version.browserConfigJson).toMatchObject({
      specVersionId: mapping.specVersionId,
    });
  }
});

it('creates CaptureRun idempotently by operationId and rejects conflicting replay', async () => {
  const { mappings } = await seed();

  const operationId = randomUUID();

  const first = await persistence.transaction(human, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mappings[0]!.captureScenarioVersionId,
      operationId,
    }),
  );

  const replay = await persistence.transaction(human, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mappings[0]!.captureScenarioVersionId,
      operationId,
    }),
  );

  expect(replay.id).toBe(first.id);
  expect(await db.captureRun.count()).toBe(1);

  await expect(
    persistence.transaction(human, (unit) =>
      unit.captures.beginRun({
        captureScenarioVersionId: mappings[1]!.captureScenarioVersionId,
        operationId,
      }),
    ),
  ).rejects.toThrow('CAPTURE_OPERATION_CONFLICT');

  expect(await db.captureRun.count()).toBe(1);
});

it('moves a CaptureRun through PENDING → RUNNING → SUCCEEDED with database timestamps', async () => {
  const { mappings, scenarios } = await seed();

  const run = await persistence.transaction(human, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mappings[0]!.captureScenarioVersionId,
      operationId: randomUUID(),
    }),
  );

  expect(run).toMatchObject({
    status: 'PENDING',
    startedAt: null,
    finishedAt: null,
  });

  const running = await persistence.transaction(human, (unit) => unit.captures.startRun(run.id));

  expect(running.status).toBe('RUNNING');
  expect(running.startedAt).toBeInstanceOf(Date);
  expect(running.finishedAt).toBeNull();

  await persistRequiredOutputs(run.id, scenarios[0]!.spec.outputs);

  const succeeded = await persistence.transaction(human, (unit) =>
    unit.captures.succeedRun(run.id),
  );

  expect(succeeded.status).toBe('SUCCEEDED');
  expect(succeeded.finishedAt).toBeInstanceOf(Date);

  await expect(
    persistence.transaction(human, (unit) => unit.captures.succeedRun(run.id)),
  ).rejects.toThrow('CAPTURE_RUN_STALE_STATE');
});

it('refuses SUCCEEDED while required capture outputs are missing', async () => {
  const { mappings } = await seed();

  const run = await persistence.transaction(human, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mappings[0]!.captureScenarioVersionId,
      operationId: randomUUID(),
    }),
  );

  await persistence.transaction(human, (unit) => unit.captures.startRun(run.id));

  await expect(
    persistence.transaction(human, (unit) => unit.captures.succeedRun(run.id)),
  ).rejects.toThrow('CAPTURE_REQUIRED_OUTPUT_MISSING');

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: { id: run.id },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });
});

it('fails a running CaptureRun with a stable code and no arbitrary diagnostic text', async () => {
  const { mappings } = await seed();

  const run = await persistence.transaction(human, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mappings[0]!.captureScenarioVersionId,
      operationId: randomUUID(),
    }),
  );

  await persistence.transaction(human, (unit) => unit.captures.startRun(run.id));

  const failed = await persistence.transaction(human, (unit) =>
    unit.captures.failRun(run.id, 'CAPTURE_ASSERTION_FAILED'),
  );

  expect(failed).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
    failureMessage: null,
  });

  expect(failed.finishedAt).toBeInstanceOf(Date);
});

it('queues duplicate-scenario capture requests idempotently with distinct clientKey bindings and canonical readiness', async () => {
  const { mappings, scenarios } = await seed();

  const graph = await recordingGraph(db);

  const scenario = scenarios[0]!;
  const mapping = mappings[0]!;

  const canonicalSpecVersionId = scenario.spec.identity.captureScenarioVersionId;

  const requirements = [
    {
      clientKey: 'proof-search-lyon',
      captureScenarioVersionId: canonicalSpecVersionId,
      scenarioInput: {
        query: 'entreprises à Lyon',
      },
      desiredOutputs: [
        {
          role: 'SCREENSHOT' as const,
          moment: 'results-visible',
        },
      ],
      editorialPurpose: 'Montrer une première preuve produit.',
    },
    {
      clientKey: 'proof-search-paris',
      captureScenarioVersionId: canonicalSpecVersionId,
      scenarioInput: {
        query: 'entreprises à Paris',
      },
      desiredOutputs: [
        {
          role: 'SCREENSHOT' as const,
          moment: 'results-visible',
        },
      ],
      editorialPurpose: 'Montrer une seconde preuve produit.',
    },
  ];

  /*
   * Test-fixture setup only:
   * CreativePlanVersion is immutable in application code.
   */
  await db.creativePlanVersion.update({
    where: {
      id: graph.cpv.id,
    },
    data: {
      requiredCapturesJson: requirements,
    },
  });

  const first = await persistence.transaction(human, (unit) =>
    unit.captures.queueRequired(graph.cpv.id),
  );

  expect(first).toHaveLength(2);

  expect(new Set(first.map((entry) => entry.run.id)).size).toBe(2);

  expect(
    first.every((entry) => entry.run.captureScenarioVersionId === mapping.captureScenarioVersionId),
  ).toBe(true);

  expect(
    first.every(
      (entry) =>
        entry.run.operationId === entry.job.operationId &&
        entry.job.queueName === 'capture' &&
        entry.job.jobType === 'CAPTURE' &&
        entry.job.status === 'QUEUED',
    ),
  ).toBe(true);

  expect(first.map((entry) => entry.clientKey)).toEqual([
    'proof-search-lyon',
    'proof-search-paris',
  ]);

  const bindings = await db.auditEvent.findMany({
    where: {
      action: 'CaptureRun.requestBound',
      subjectType: 'CaptureRun',
      subjectVersionId: graph.cpv.id,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  expect(bindings).toHaveLength(2);

  expect(bindings.map((binding) => binding.afterJson)).toEqual([
    {
      clientKey: 'proof-search-lyon',
      captureScenarioVersionId: canonicalSpecVersionId,
    },
    {
      clientKey: 'proof-search-paris',
      captureScenarioVersionId: canonicalSpecVersionId,
    },
  ]);

  const replay = await persistence.transaction(human, (unit) =>
    unit.captures.queueRequired(graph.cpv.id),
  );

  expect(replay.map((entry) => entry.run.id)).toEqual(first.map((entry) => entry.run.id));

  expect(replay.map((entry) => entry.job.id)).toEqual(first.map((entry) => entry.job.id));

  expect(
    await db.captureRun.count({
      where: {
        creativePlanVersionId: graph.cpv.id,
      },
    }),
  ).toBe(2);

  expect(
    await db.jobAttempt.count({
      where: {
        operationId: {
          in: first.map((entry) => entry.run.operationId),
        },
        jobType: 'CAPTURE',
      },
    }),
  ).toBe(2);

  for (const [index, entry] of first.entries()) {
    await persistence.transaction(human, (unit) => unit.captures.startRun(entry.run.id));

    await persistRequiredOutputs(entry.run.id, scenario.spec.outputs);

    await persistence.transaction(human, (unit) => unit.captures.succeedRun(entry.run.id));

    const readiness = await persistence.transaction(human, (unit) =>
      unit.recordings.refresh(graph.cpv.id),
    );

    expect(readiness.capturesReady).toBe(index === 1);
  }
});
