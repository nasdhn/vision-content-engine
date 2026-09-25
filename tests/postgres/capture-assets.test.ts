import { randomUUID } from 'node:crypto';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';

import {
  CaptureAssetStager,
  finalizeStagedCaptureAssets,
} from '../../apps/worker-capture/src/assets.js';
import type {
  CaptureExecutionResult,
  CaptureLocalOutput,
} from '../../apps/worker-capture/src/executor.js';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Leases, Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import type { MediaProbe, PrivateStorage } from '../../packages/media/src/index.js';

const human = {
  actorType: 'USER',
  actorId: 'phase4-capture-asset-fixture',
} as const;

const worker = {
  actorType: 'WORKER',
  actorId: 'phase4-capture-worker',
} as const;

type RegisteredScenario = Awaited<ReturnType<CaptureScenarioRegistry['list']>>[number];

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

let db: ReturnType<typeof createDatabaseClient>;

let persistence: Persistence;
let leases: Leases;

const leaseConfig = {
  durationMs: 60000,
  heartbeatIntervalMs: 10000,
};

const directories = new Set<string>();

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);

  leases = new Leases(db, leaseConfig, {
    CAPTURE: 'RECONCILE',
  });
});

afterEach(async () => {
  await Promise.all(
    [...directories].map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );

  directories.clear();
});

afterAll(async () => {
  await fixture?.close();
});

class CaptureMemoryStorage implements PrivateStorage {
  readonly bucket = 'phase4-capture-private';

  readonly objects = new Map<string, Buffer>();

  corruptReads = false;
  failPutAt?: number;

  private putCount = 0;

  async put(key: string, file: string) {
    this.putCount++;

    if (this.failPutAt === this.putCount) {
      throw new Error('fixture-storage-put-failed');
    }

    if (this.objects.has(key)) {
      throw new Error('IMMUTABLE_OBJECT');
    }

    this.objects.set(key, await readFile(file));
  }

  async get(key: string): Promise<AsyncIterable<Uint8Array>> {
    const stored = this.objects.get(key);

    if (!stored) {
      throw new Error('OBJECT_MISSING');
    }

    const bytes = this.corruptReads ? Buffer.alloc(stored.length) : stored;

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

async function outputDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'vce-capture-assets-'));

  directories.add(directory);

  return directory;
}

async function writeScenarioOutputs(scenario: RegisteredScenario, directory: string) {
  const files: CaptureLocalOutput[] = [];

  for (let index = 0; index < scenario.spec.outputs.length; index++) {
    const output = scenario.spec.outputs[index]!;

    const path = join(directory, `${index}-${output.key}.${extensionFor(output.role)}`);

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

  return files;
}

function executionResult(files: CaptureLocalOutput[]): CaptureExecutionResult {
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

async function exists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function scenarioAndRun() {
  const scenarios = await new CaptureScenarioRegistry().list();

  const scenario = scenarios.find((candidate) => candidate.spec.outputs.length >= 2);

  if (!scenario) {
    throw new Error('FIXTURE_SCENARIO_WITH_TWO_OUTPUTS_REQUIRED');
  }

  const mapping = await persistence.transaction(human, (unit) =>
    unit.captures.importSeed(scenario.spec),
  );

  const run = await persistence.transaction(worker, (unit) =>
    unit.captures.beginRun({
      captureScenarioVersionId: mapping.captureScenarioVersionId,
      operationId: randomUUID(),
    }),
  );

  await persistence.transaction(worker, (unit) => unit.captures.startRun(run.id));

  return {
    scenario,
    run,
  };
}

async function captureJob() {
  return persistence.transaction(human, (unit) =>
    unit.enqueueJob({
      queueName: 'capture',
      jobType: 'CAPTURE',
      operationId: randomUUID(),
      attemptNumber: 1,
    }),
  );
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

it('atomically finalizes Capture assets and the CaptureRun behind a valid job lease', async () => {
  const { scenario, run } = await scenarioAndRun();

  const directory = await outputDirectory();

  const files = await writeScenarioOutputs(scenario, directory);

  const storage = new CaptureMemoryStorage();

  const stager = new CaptureAssetStager(db, storage, fakeVideoProbe);

  const staged = await stager.stage(
    worker,
    run.id,
    scenario.spec,
    executionResult(files),
    directory,
  );

  const job = await captureJob();

  const claim = await leases.claimJob('capture', worker.actorId);

  expect(claim?.id).toBe(job.id);

  if (!claim?.leaseToken) {
    throw new Error('FIXTURE_LEASE_TOKEN_REQUIRED');
  }

  const finished = await leases.finishJob(
    job.id,
    claim.leaseToken,
    'SUCCEEDED',
    undefined,
    async (unit) => {
      await finalizeStagedCaptureAssets(unit, staged);

      await unit.captures.succeedRun(run.id);
    },
  );

  expect(finished.status).toBe('SUCCEEDED');

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: { id: run.id },
    }),
  ).toMatchObject({
    status: 'SUCCEEDED',
  });

  const assets = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
  });

  expect(assets).toHaveLength(staged.length);

  expect(assets.every((asset) => asset.status === 'READY')).toBe(true);
});

it('rejects a stale Capture worker before any final Asset or CaptureRun write', async () => {
  const { scenario, run } = await scenarioAndRun();

  const directory = await outputDirectory();

  const files = await writeScenarioOutputs(scenario, directory);

  const storage = new CaptureMemoryStorage();

  const stager = new CaptureAssetStager(db, storage, fakeVideoProbe);

  const staged = await stager.stage(
    worker,
    run.id,
    scenario.spec,
    executionResult(files),
    directory,
  );

  const job = await captureJob();

  const claim = await leases.claimJob('capture', worker.actorId);

  expect(claim?.id).toBe(job.id);

  if (!claim?.leaseToken) {
    throw new Error('FIXTURE_LEASE_TOKEN_REQUIRED');
  }

  await expireJob(job.id);

  let callbackInvoked = false;

  await expect(
    leases.finishJob(job.id, claim.leaseToken, 'SUCCEEDED', undefined, async (unit) => {
      callbackInvoked = true;

      await finalizeStagedCaptureAssets(unit, staged);

      await unit.captures.succeedRun(run.id);
    }),
  ).rejects.toThrow('STALE_LEASE');

  expect(callbackInvoked).toBe(false);

  expect(
    await db.captureRun.findUniqueOrThrow({
      where: { id: run.id },
    }),
  ).toMatchObject({
    status: 'RUNNING',
    finishedAt: null,
  });

  const assets = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
  });

  expect(assets).toHaveLength(staged.length);

  expect(assets.every((asset) => asset.status === 'UPLOADING')).toBe(true);

  expect(
    await db.jobAttempt.findUniqueOrThrow({
      where: { id: job.id },
    }),
  ).toMatchObject({
    status: 'RUNNING',
  });
});

it('stages verified private bytes and only makes Capture assets READY during finalization', async () => {
  const { scenario, run } = await scenarioAndRun();

  const directory = await outputDirectory();

  const files = await writeScenarioOutputs(scenario, directory);

  const storage = new CaptureMemoryStorage();

  const stager = new CaptureAssetStager(db, storage, fakeVideoProbe);

  const staged = await stager.stage(
    worker,
    run.id,
    scenario.spec,
    executionResult(files),
    directory,
  );

  expect(staged).toHaveLength(files.length);

  // A stager may inspect caller-owned paths but cannot authorize their deletion.
  expect(await exists(directory)).toBe(true);

  const beforeFinalize = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  expect(beforeFinalize).toHaveLength(files.length);

  expect(beforeFinalize.every((asset) => asset.status === 'UPLOADING')).toBe(true);

  for (const asset of beforeFinalize) {
    expect(storage.objects.has(asset.objectKey)).toBe(true);
  }

  await persistence.transaction(worker, (unit) => finalizeStagedCaptureAssets(unit, staged));

  const ready = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
  });

  expect(ready.every((asset) => asset.status === 'READY')).toBe(true);

  const succeeded = await persistence.transaction(worker, (unit) =>
    unit.captures.succeedRun(run.id),
  );

  expect(succeeded.status).toBe('SUCCEEDED');
});

it('fails closed when durable read-back bytes do not match the local checksum', async () => {
  const { scenario, run } = await scenarioAndRun();

  const directory = await outputDirectory();

  const files = await writeScenarioOutputs(scenario, directory);

  const storage = new CaptureMemoryStorage();

  storage.corruptReads = true;

  const stager = new CaptureAssetStager(db, storage, fakeVideoProbe);

  await expect(
    stager.stage(worker, run.id, scenario.spec, executionResult(files), directory),
  ).rejects.toThrow('STORED_OBJECT_CHECKSUM_MISMATCH');

  // A stager may inspect caller-owned paths but cannot authorize their deletion.
  expect(await exists(directory)).toBe(true);

  const assets = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
  });

  expect(assets.length).toBe(1);

  expect(assets.every((asset) => asset.status === 'FAILED')).toBe(true);

  expect(
    await db.asset.count({
      where: {
        sourceEntityId: run.id,
        status: 'UPLOADING',
      },
    }),
  ).toBe(0);
});

it('fails every begun Capture asset when a later output cannot be stored', async () => {
  const { scenario, run } = await scenarioAndRun();

  const directory = await outputDirectory();

  const files = await writeScenarioOutputs(scenario, directory);

  const storage = new CaptureMemoryStorage();

  storage.failPutAt = 2;

  const stager = new CaptureAssetStager(db, storage, fakeVideoProbe);

  await expect(
    stager.stage(worker, run.id, scenario.spec, executionResult(files), directory),
  ).rejects.toThrow('CAPTURE_ASSET_STAGE_FAILED');

  // A stager may inspect caller-owned paths but cannot authorize their deletion.
  expect(await exists(directory)).toBe(true);

  const assets = await db.asset.findMany({
    where: {
      sourceType: 'CAPTURE',
      sourceEntityType: 'CaptureRun',
      sourceEntityId: run.id,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  expect(assets).toHaveLength(2);

  expect(assets.every((asset) => asset.status === 'FAILED')).toBe(true);

  expect(
    await db.asset.count({
      where: {
        sourceEntityId: run.id,
        status: 'UPLOADING',
      },
    }),
  ).toBe(0);
});
