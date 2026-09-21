import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { CaptureWorkerOrchestrator } from '../../apps/worker-capture/src/orchestrator.js';
import type {
  CaptureExecutionResult,
  CaptureExecutorInput,
  CaptureLocalOutput,
} from '../../apps/worker-capture/src/executor.js';
import type {
  CaptureAuthStateProvider,
  CaptureFixtureManager,
} from '../../apps/worker-capture/src/fixture.js';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';
import { CaptureScenarioVersionSpecSchema } from '../../packages/contracts/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Leases, Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import type { MediaProbe, PrivateStorage } from '../../packages/media/src/index.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

const human = {
  actorType: 'USER',
  actorId: 'phase4-orchestrator-fixture',
} as const;

const leaseConfig = {
  durationMs: 60_000,
  heartbeatIntervalMs: 10_000,
};

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

let db: ReturnType<typeof createDatabaseClient>;

let persistence: Persistence;
let leases: Leases;
let registry: CaptureScenarioRegistry;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);
  leases = new Leases(db, leaseConfig, {
    CAPTURE: 'RECONCILE',
  });
  registry = new CaptureScenarioRegistry();
});

afterAll(async () => {
  await fixture?.close();
});

class CaptureMemoryStorage implements PrivateStorage {
  readonly bucket = 'phase4-orchestrator-private';

  readonly objects = new Map<string, Buffer>();

  async put(key: string, file: string) {
    if (this.objects.has(key)) {
      throw new Error('IMMUTABLE_OBJECT');
    }

    this.objects.set(key, await readFile(file));
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const bytes = this.objects.get(key);

    if (!bytes) {
      throw new Error('OBJECT_MISSING');
    }

    return (async function* () {
      yield bytes;
    })();
  }
}

const fakeVideoProbe = async (): Promise<MediaProbe> => ({
  probeVersion: 'fixture-v1',
  container: 'webm',
  durationMs: 1200,
  video: {
    codec: 'vp8',
    width: 720,
    height: 1280,
    fps: 30,
    rotationDeg: 0,
    color: {
      hdrKind: 'SDR',
    },
  },
});

const fixtureManager = {
  async prepare() {
    return {};
  },
} satisfies CaptureFixtureManager;

const authStateProvider = {
  async storageStatePath() {
    return undefined;
  },
} satisfies CaptureAuthStateProvider;

function pngFixture() {
  const bytes = Buffer.alloc(128);

  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes, 0);

  bytes.writeUInt32BE(720, 16);

  bytes.writeUInt32BE(1280, 20);

  return bytes;
}

function bytesFor(role: CaptureLocalOutput['role']) {
  if (role === 'SCREENSHOT' || role === 'FRAME') {
    return pngFixture();
  }

  if (role === 'TRACE') {
    return Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
  }

  return Buffer.alloc(256, 0x61);
}

function extensionFor(role: CaptureLocalOutput['role']) {
  if (role === 'SCREENSHOT' || role === 'FRAME') {
    return 'png';
  }

  if (role === 'TRACE') {
    return 'zip';
  }

  return 'webm';
}

async function successExecution(request: CaptureExecutorInput): Promise<CaptureExecutionResult> {
  const scenario = CaptureScenarioVersionSpecSchema.parse(request.scenario);

  const files: CaptureLocalOutput[] = [];

  for (let index = 0; index < scenario.outputs.length; index++) {
    const output = scenario.outputs[index]!;

    const path = join(
      request.outputDirectory,
      `${index}-${output.key}.${extensionFor(output.role)}`,
    );

    await writeFile(path, bytesFor(output.role), {
      mode: 0o600,
    });

    files.push({
      key: output.key,
      role: output.role,
      path,
      required: output.required,
      diagnostic: false,
    });
  }

  return {
    result: 'SUCCEEDED',
    executedStepCount: 0,
    assertions: [],
    markedMoments: [],
    files,
    warnings: [],
    diagnostics: {
      consoleErrorCount: 0,
      pageErrorCount: 0,
      requestFailureCount: 0,
    },
    runtime: {
      playwrightVersion: '1.63.0',
      browserVersion: 'fixture-browser',
      workerVersion: 'phase4-v1',
    },
  };
}

function failedExecution(): CaptureExecutionResult {
  return {
    result: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
    executedStepCount: 1,
    assertions: [
      {
        key: 'fixture-assertion',
        result: 'FAIL',
        message: 'fixture-safe-message',
      },
    ],
    markedMoments: [],
    files: [],
    warnings: [],
    diagnostics: {
      failedStepIndex: 0,
      consoleErrorCount: 0,
      pageErrorCount: 0,
      requestFailureCount: 0,
    },
    runtime: {
      playwrightVersion: '1.63.0',
      browserVersion: 'fixture-browser',
      workerVersion: 'phase4-v1',
    },
  };
}

async function failedExecutionWithDiagnostics(
  request: CaptureExecutorInput,
): Promise<CaptureExecutionResult> {
  const screenshotPath = join(request.outputDirectory, 'diagnostic-failure.png');

  const tracePath = join(request.outputDirectory, 'diagnostic-trace.zip');

  await writeFile(screenshotPath, pngFixture(), {
    mode: 0o600,
  });

  await writeFile(tracePath, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]), {
    mode: 0o600,
  });

  return {
    result: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
    executedStepCount: 1,
    assertions: [
      {
        key: 'fixture-assertion',
        result: 'FAIL',
        message: 'fixture-safe-message',
      },
    ],
    markedMoments: [],
    files: [
      {
        key: 'diagnostic-screenshot',
        role: 'SCREENSHOT',
        path: screenshotPath,
        required: false,
        diagnostic: true,
      },
      {
        key: 'diagnostic-trace',
        role: 'TRACE',
        path: tracePath,
        required: false,
        diagnostic: true,
      },
    ],
    warnings: [],
    diagnostics: {
      failedStepIndex: 0,
      currentUrl: 'https://fixture.invalid/safe',
      consoleErrorCount: 0,
      pageErrorCount: 0,
      requestFailureCount: 0,
    },
    runtime: {
      playwrightVersion: '1.63.0',
      browserVersion: 'fixture-browser',
      workerVersion: 'phase4-v1',
    },
  };
}

async function queueQueries(queries: string[]) {
  const scenario = await registry.getByKey('AGENT_QUERY_TO_RESULTS');

  await persistence.transaction(human, (unit) => unit.captures.importSeed(scenario.spec));

  const graph = await recordingGraph(db);

  const requirements = queries.map((query, index) => ({
    clientKey: `capture-query-${index}`,
    captureScenarioVersionId: scenario.spec.identity.captureScenarioVersionId,
    scenarioInput: {
      query,
    },
    desiredOutputs: scenario.spec.outputs.flatMap((output) =>
      output.role === 'SCREENSHOT' || output.role === 'VIDEO' || output.role === 'FRAME'
        ? [
            {
              role: output.role,
              moment: output.key,
            },
          ]
        : [],
    ),
    editorialPurpose: `Fixture proof ${index}`,
  }));

  /*
   * Test setup only.
   * Application code never mutates an
   * immutable CreativePlanVersion.
   */
  await db.creativePlanVersion.update({
    where: {
      id: graph.cpv.id,
    },
    data: {
      requiredCapturesJson: requirements,
    },
  });

  const queued = await persistence.transaction(human, (unit) =>
    unit.captures.queueRequired(graph.cpv.id),
  );

  return {
    scenario,
    graph,
    queued,
  };
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

it('resolves each duplicate-scenario job to the exact clientKey scenarioInput and succeeds atomically', async () => {
  const { scenario, queued } = await queueQueries(['entreprises à Lyon', 'entreprises à Paris']);

  const storage = new CaptureMemoryStorage();

  const seenInputs: Readonly<Record<string, unknown>>[] = [];

  const execute: typeof successExecution = async (request) => {
    seenInputs.push(request.input);

    return successExecution(request);
  };

  const orchestrator = new CaptureWorkerOrchestrator(
    db,
    leases,
    storage,
    fixtureManager,
    authStateProvider,
    registry,
    {
      execute,
      probe: fakeVideoProbe,
      heartbeatIntervalMs: 1000,
    },
  );

  for (let index = 0; index < queued.length; index++) {
    const outcome = await orchestrator.processOne('phase4-orchestrator-worker-success');

    expect(outcome.status).toBe('SUCCEEDED');

    if (outcome.status !== 'SUCCEEDED') {
      throw new Error('FIXTURE_SUCCESS_REQUIRED');
    }

    const queuedEntry = queued.find((entry) => entry.run.id === outcome.captureRunId);

    expect(queuedEntry).toBeDefined();

    expect(seenInputs[index]).toEqual(queuedEntry!.request.scenarioInput);

    expect(
      await db.captureRun.findUniqueOrThrow({
        where: {
          id: outcome.captureRunId,
        },
      }),
    ).toMatchObject({
      status: 'SUCCEEDED',
    });

    expect(
      await db.jobAttempt.findUniqueOrThrow({
        where: {
          id: outcome.jobAttemptId,
        },
      }),
    ).toMatchObject({
      status: 'SUCCEEDED',
    });

    const assets = await db.asset.findMany({
      where: {
        sourceType: 'CAPTURE',
        sourceEntityType: 'CaptureRun',
        sourceEntityId: outcome.captureRunId,
      },
    });

    expect(assets).toHaveLength(scenario.spec.outputs.length);

    expect(assets.every((asset) => asset.status === 'READY')).toBe(true);
  }

  expect(seenInputs).toHaveLength(2);

  expect(new Set(seenInputs.map((input) => input.query))).toEqual(
    new Set(['entreprises à Lyon', 'entreprises à Paris']),
  );

  expect(storage.objects.size).toBe(scenario.spec.outputs.length * 2);
});

it('turns a deterministic execution failure into fenced CaptureRun and JobAttempt failure', async () => {
  const { queued } = await queueQueries(['entreprises à Marseille']);

  const storage = new CaptureMemoryStorage();

  const orchestrator = new CaptureWorkerOrchestrator(
    db,
    leases,
    storage,
    fixtureManager,
    authStateProvider,
    registry,
    {
      execute: async () => failedExecution(),
      probe: fakeVideoProbe,
      heartbeatIntervalMs: 1000,
    },
  );

  const outcome = await orchestrator.processOne('phase4-orchestrator-worker-failure');

  expect(outcome).toMatchObject({
    status: 'FAILED',
    captureRunId: queued[0]!.run.id,
    jobAttemptId: queued[0]!.job.id,
    failureCode: 'CAPTURE_ASSERTION_FAILED',
  });

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: {
        id: queued[0]!.run.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
    failureMessage: null,
  });

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: queued[0]!.job.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
  });

  expect(
    await db.asset.count({
      where: {
        sourceType: 'CAPTURE',
        sourceEntityType: 'CaptureRun',
        sourceEntityId: queued[0]!.run.id,
      },
    }),
  ).toBe(0);
});

it('persists safe screenshot and trace diagnostics before failing an execution', async () => {
  const { queued } = await queueQueries(['entreprises à Toulouse']);

  const target = queued[0]!;

  const storage = new CaptureMemoryStorage();

  const orchestrator = new CaptureWorkerOrchestrator(
    db,
    leases,
    storage,
    fixtureManager,
    authStateProvider,
    registry,
    {
      execute: failedExecutionWithDiagnostics,
      probe: fakeVideoProbe,
      heartbeatIntervalMs: 1000,
    },
  );

  const outcome = await orchestrator.processOne('phase4-orchestrator-worker-diagnostics');

  expect(outcome).toMatchObject({
    status: 'FAILED',
    jobAttemptId: target.job.id,
    captureRunId: target.run.id,
    failureCode: 'CAPTURE_ASSERTION_FAILED',
  });

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: {
        id: target.run.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
    failureMessage: null,
  });

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: target.job.id,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',
    failureCode: 'CAPTURE_ASSERTION_FAILED',
  });

  const links = await db.captureRunAsset.findMany({
    where: {
      captureRunId: target.run.id,
    },
    include: {
      asset: true,
    },
  });

  expect(links).toHaveLength(2);

  expect(links.map((link) => link.role).sort()).toEqual(['SCREENSHOT', 'TRACE']);

  expect(
    links.every((link) => link.asset.status === 'READY' && link.asset.deletedAt === null),
  ).toBe(true);

  expect(links.map((link) => link.asset.mimeType).sort()).toEqual(['application/zip', 'image/png']);

  expect(storage.objects.size).toBe(2);

  const evidence = await db.auditEvent.findMany({
    where: {
      action: 'Asset.probed',
      subjectId: {
        in: links.map((link) => link.assetId),
      },
    },
  });

  expect(evidence).toHaveLength(2);

  expect(
    evidence.every((event) => {
      const value = event.afterJson;

      if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        return false;
      }

      const record = value as Record<string, unknown>;

      return record.diagnostic === true && record.verification === 'SHA256_READBACK';
    }),
  ).toBe(true);
});

it('leaves canonical state unfinished for RECONCILE when the lease is lost during external execution', async () => {
  const { queued } = await queueQueries(['entreprises à Bordeaux']);

  const storage = new CaptureMemoryStorage();

  const target = queued[0]!;

  const orchestrator = new CaptureWorkerOrchestrator(
    db,
    leases,
    storage,
    fixtureManager,
    authStateProvider,
    registry,
    {
      execute: async (request) => {
        await expireJob(target.job.id);

        return successExecution(request);
      },
      probe: fakeVideoProbe,
      heartbeatIntervalMs: 1000,
    },
  );

  await expect(orchestrator.processOne('phase4-orchestrator-worker-stale')).rejects.toThrow(
    'STALE_LEASE',
  );

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: {
        id: target.run.id,
      },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: target.job.id,
      },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });

  expect(
    await db.asset.count({
      where: {
        sourceType: 'CAPTURE',
        sourceEntityType: 'CaptureRun',
        sourceEntityId: target.run.id,
      },
    }),
  ).toBe(0);
});

it('returns IDLE when no claimable capture job remains', async () => {
  const storage = new CaptureMemoryStorage();

  const orchestrator = new CaptureWorkerOrchestrator(
    db,
    leases,
    storage,
    fixtureManager,
    authStateProvider,
    registry,
    {
      execute: successExecution,
      probe: fakeVideoProbe,
      heartbeatIntervalMs: 1000,
    },
  );

  await expect(orchestrator.processOne('phase4-orchestrator-worker-idle')).resolves.toEqual({
    status: 'IDLE',
  });
});
