import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  EditingPlanSpecSchema,
  TemplateRuntimeContractSchema,
} from '../packages/contracts/src/index.js';

import { Persistence, type PrismaClient } from '../packages/database/src/index.js';

import { postgresFixture } from '../packages/database/test/support.js';

import { probeFile, type PrivateStorage } from '../packages/media/src/index.js';

import { s3Fixture } from '../packages/media/test/s3-fixture.js';

import {
  assertLocalBootstrap,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';

import {
  RemotionVideoRenderer,
  RenderWorkerOrchestrator,
} from '../apps/worker-render/src/index.js';

import { human, recordingGraph } from '../tests/fixtures/recordings/support.js';

import { DURABLE_RENDER_CANARY_FIXTURE_VERSION } from './phase11c3-durable-render-canary.js';

const exec = promisify(execFile);

export const DURABLE_RENDER_CANARY_CONFIRMATION = 'EXECUTE_DISPOSABLE_DURABLE_RENDER_CANARY';

const WORKER_VERSION = 'phase11c3-durable-render-canary-v1';

type S3Fixture = Awaited<ReturnType<typeof s3Fixture>>;

type ExecuteArgs = Readonly<{
  confirmation: string;
  outputDirectory: string;
}>;

type StoredInputs = Readonly<{
  product: {
    id: string;
  };
  presenter: {
    id: string;
  };
  voice: {
    id: string;
  };
}>;

type DurableExecutionEvidence = Readonly<{
  schemaVersion: 1;
  canary: 'PHASE_11C_3B_DISPOSABLE_DURABLE_RENDER';
  fixtureVersion: string;
  result: 'SUCCEEDED';
  durable: {
    renderStatus: 'CREATIVE_QA';
    renderAttemptStatus: 'SUCCEEDED';
    jobAttemptStatus: 'SUCCEEDED';
    outputAssetStatus: 'READY';
    technicalQa: 'PASS';
  };
  lineage: {
    inputAssetCount: 3;
    outputAssetLinked: true;
    privateObjectVerified: true;
  };
  master: {
    fileName: 'master.mp4';
    fileSizeBytes: number;
    sha256: string;
    width: number;
    height: number;
    durationMs: number | null;
    fps: number | null;
    audioChannels: number | null;
    sampleRate: number | null;
  };
  cleanup: {
    disposableDatabaseDestroyed: true;
    disposableBucketDestroyed: true;
    workerTempDestroyed: true;
  };
  safety: {
    environment: 'LOCAL';
    disposablePostgresOnly: true;
    disposableS3BucketOnly: true;
    aiProviderInvoked: false;
    captureInvoked: false;
    analyticsInvoked: false;
    publishingAdapterInvoked: false;
    externalProviderCostUsd: 0;
    remoteSideEffect: false;
  };
}>;

function fail(code: string): never {
  throw new Error(code);
}

export function assertDurableRenderCanaryConfirmation(value: string): void {
  if (value !== DURABLE_RENDER_CANARY_CONFIRMATION) {
    fail('DURABLE_RENDER_CANARY_CONFIRMATION_INVALID');
  }
}

export function assertDurableRenderExecutionEnvironment(config: RuntimeConfig): void {
  assertLocalBootstrap(config);

  if (
    !config.PAUSE_RENDERING ||
    !config.PAUSE_CAPTURE ||
    !config.PAUSE_AI_GENERATION ||
    !config.PAUSE_ALL_PUBLISHING ||
    !config.PAUSE_ANALYTICS_COLLECTION ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false'
  ) {
    fail('DURABLE_RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  }
}

export function parseDurableRenderExecuteArgs(rawArgs: readonly string[]): ExecuteArgs {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  if (
    args.length !== 4 ||
    args[0] !== '--confirm' ||
    args[2] !== '--output-dir' ||
    typeof args[1] !== 'string' ||
    typeof args[3] !== 'string'
  ) {
    fail('DURABLE_RENDER_CANARY_EXECUTE_USAGE_INVALID');
  }

  if (!isAbsolute(args[3])) {
    fail('DURABLE_RENDER_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  }

  return {
    confirmation: args[1],
    outputDirectory: args[3],
  };
}

async function ffmpeg(args: readonly string[]): Promise<void> {
  await exec('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], {
    timeout: 120_000,
    maxBuffer: 4 * 1024 * 1024,
  });
}

async function generateSyntheticInputs(root: string) {
  const product = join(root, 'product.mp4');
  const presenter = join(root, 'presenter.mp4');
  const voice = join(root, 'voice.wav');

  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=1080x1920:rate=30:duration=1.2',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-color_primaries',
    'bt709',
    '-color_trc',
    'bt709',
    '-colorspace',
    'bt709',
    '-color_range',
    'tv',
    '-x264-params',
    'colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off',
    '-an',
    product,
  ]);

  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'color=c=0x00ff00:size=540x960:rate=30:duration=1.2',
    '-vf',
    'drawbox=x=150:y=180:w=240:h=600:color=red@1:t=fill',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-an',
    presenter,
  ]);

  await ffmpeg([
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=48000:duration=1.2',
    '-ac',
    '2',
    '-c:a',
    'pcm_s16le',
    voice,
  ]);

  return {
    product,
    presenter,
    voice,
  } as const;
}

async function sha256Path(path: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path))
    .digest('hex');
}

async function readPrivateObject(storage: PrivateStorage, key: string): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for await (const chunk of await storage.get(key)) {
    chunks.push(Buffer.from(chunk));
  }

  return Buffer.concat(chunks);
}

async function createStoredAsset(
  db: PrismaClient,
  storage: S3Fixture,
  input: Readonly<{
    path: string;
    kind: 'VIDEO' | 'AUDIO';
    mimeType: string;
  }>,
) {
  const file = await stat(input.path);
  const probe = await probeFile(input.path);
  const checksumSha256 = await sha256Path(input.path);
  const objectKey = storage.key();

  await storage.store.put(objectKey, input.path, file.size, input.mimeType);

  return db.asset.create({
    data: {
      kind: input.kind,
      storageProvider: 'S3',
      bucket: storage.bucket,
      objectKey,
      checksumSha256,
      mimeType: input.mimeType,
      sizeBytes: BigInt(file.size),
      ...(probe.video
        ? {
            width: probe.video.width,
            height: probe.video.height,
            durationMs: probe.durationMs ?? undefined,
            fps: probe.video.fps,
          }
        : {}),
      ...(probe.audio
        ? {
            durationMs: probe.durationMs ?? undefined,
            audioChannels: probe.audio.channels,
            sampleRate: probe.audio.sampleRate,
          }
        : {}),
      status: 'READY',
      sourceType: 'SYSTEM',
      sourceEntityType: 'Phase11C3DurableRenderCanary',
    },
  });
}

async function buildDurableLineage(db: PrismaClient, assets: StoredInputs) {
  const base = await recordingGraph(db);

  const templateRoot = await db.template.create({
    data: {
      key: randomUUID(),
      name: 'phase11c3 durable canary',
    },
  });

  const profileRoot = await db.editingProfile.create({
    data: {
      key: randomUUID(),
      name: 'phase11c3 durable canary',
    },
  });

  const templateVersionId = randomUUID();

  const templateContract = TemplateRuntimeContractSchema.parse({
    templateVersionId,
    compositionKey: 'green-screen-explainer-v1',
    rendererApiVersion: 'v1',
    supportedCanvas: {
      width: 1080,
      height: 1920,
      allowedFps: [30],
    },
    supportedLayers: ['BACKGROUND', 'PRODUCT', 'PRESENTER', 'TEXT', 'CAPTION'],
    requiredSlots: [],
    optionalSlots: [],
    supportedMotionPresetKeys: ['CUT', 'RESULT_POP'],
    supportedTransitionPresetKeys: ['CUT'],
    supportedChromaKeyProfileKeys: ['GREENSCREEN_STANDARD_V1'],
    supportedColorProfileKeys: ['SDR_BT709_SOCIAL_V1'],
    supportedCodecProfileKeys: ['SOCIAL_H264_AAC_V1'],
    supportedAudioProfileKeys: ['SOCIAL_VOICE_MASTER_V1'],
    assetDependencies: [],
  });

  const plan = EditingPlanSpecSchema.parse({
    masterDurationMs: 1200,
    selectedAssets: [
      {
        assetId: assets.product.id,
        role: 'PRODUCT_CAPTURE',
        sourceInMs: 0,
        sourceOutMs: 1200,
        reason: 'Synthetic durable product fixture.',
      },
      {
        assetId: assets.presenter.id,
        role: 'PRESENTER',
        sourceInMs: 0,
        sourceOutMs: 1200,
        reason: 'Synthetic durable presenter fixture.',
      },
      {
        assetId: assets.voice.id,
        role: 'VOICE',
        sourceInMs: 0,
        sourceOutMs: 1200,
        reason: 'Synthetic durable voice fixture.',
      },
    ],
    timeline: [
      {
        id: 'product',
        startMs: 0,
        endMs: 1200,
        layer: 'PRODUCT',
        zIndex: 10,
        source: {
          type: 'ASSET',
          assetId: assets.product.id,
        },
        composition: {
          opacity: 1,
          region: {
            x: 0,
            y: 0,
            width: 1,
            height: 1,
          },
          scaleMode: 'CROP',
        },
        purpose: 'Exercise durable product rendering.',
      },
    ],
    productFocus: [],
    captions: [
      {
        id: 'caption',
        startMs: 120,
        endMs: 1080,
        text: 'Vision trouve les bons prospects',
        timingSource: 'SPEECH_ALIGNED',
        emphasisRanges: [
          {
            start: 0,
            end: 6,
            kind: 'KEYWORD',
          },
        ],
      },
    ],
    onScreenText: [
      {
        id: 'result',
        startMs: 100,
        endMs: 1000,
        text: 'PREUVE PRODUIT',
        role: 'RESULT',
        region: {
          x: 0.12,
          y: 0.08,
          width: 0.76,
          height: 0.12,
        },
        motionPresetKey: 'RESULT_POP',
      },
    ],
    presenter: [
      {
        assetId: assets.presenter.id,
        startMs: 0,
        endMs: 1200,
        region: {
          x: 0.58,
          y: 0.38,
          width: 0.38,
          height: 0.52,
        },
        side: 'RIGHT',
        gestureDirection: 'LEFT',
        chromaKeyProfileKey: 'GREENSCREEN_STANDARD_V1',
      },
    ],
    audio: {
      voice: {
        assetId: assets.voice.id,
        gainDb: 0,
      },
      sfx: [],
    },
    transitions: [],
    renderSettings: {
      width: 1080,
      height: 1920,
      fps: 30,
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    },
    rationale: {
      hookStrategy: 'Durable canary fixture.',
      pacingStrategy: 'Durable canary fixture.',
      attentionStrategy: 'Durable canary fixture.',
      proofStrategy: 'Durable canary fixture.',
      endingStrategy: 'Durable canary fixture.',
    },
  });

  const persistence = new Persistence(db);

  const versionLineage = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      id: templateVersionId,
      templateId: templateRoot.id,
      inputSchemaJson: {},
      capabilitiesJson: templateContract,
      rendererVersion: 'v1',
    });

    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profileRoot.id,
    });

    const creativePlanVersion = await unit.versions.creativePlanVersion({
      creativePlanId: base.plan.id,
      scriptVersionId: base.sv.id,
      targetDurationMs: 1200,
      primaryFormat: 'VOICE',
      templateVersionId: templateVersion.id,
      editingProfileVersionId: profileVersion.id,
      scenePlanJson: {},
      requiredRecordingsJson: [],
      requiredCapturesJson: [],
      requiredAssetsJson: [],
    });

    return {
      templateVersion,
      profileVersion,
      creativePlanVersion,
    };
  });

  const editingPlan = await db.editingPlan.create({
    data: {
      creativePlanId: base.plan.id,
      status: 'READY',
    },
  });

  const editingPlanVersion = await persistence.transaction(human, (unit) =>
    unit.versions.editingPlanVersion({
      editingPlanId: editingPlan.id,
      creativePlanVersionId: versionLineage.creativePlanVersion.id,
      editingProfileVersionId: versionLineage.profileVersion.id,
      templateVersionId: versionLineage.templateVersion.id,
      planSpecJson: plan,
      timelineJson: plan.timeline,
      captionPlanJson: plan.captions,
      audioPlanJson: plan.audio,
      visualFocusJson: plan.productFocus,
      transitionPlanJson: plan.transitions,
      greenScreenPlanJson: plan.presenter,
      renderSettingsJson: plan.renderSettings,
    }),
  );

  const render = await persistence.transaction(human, (unit) =>
    unit.requestRender(editingPlanVersion.id),
  );

  const attempt = await persistence.transaction(human, async (unit) => {
    await unit.transitionRender(render.id, 'REQUESTED', 'QUEUED');

    return unit.createRenderAttempt(render.id, WORKER_VERSION);
  });

  return {
    render,
    attempt,
  };
}

function technicalQaPassed(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).result === 'PASS'
  );
}

async function runDisposableDurableCanary() {
  const fixtureRoot = await mkdtemp(join(tmpdir(), 'vce-phase11c3-durable-'));

  let database: Awaited<ReturnType<typeof postgresFixture>> | undefined;

  let storage: S3Fixture | undefined;

  let successful:
    | {
        master: Buffer;
        evidence: Omit<DurableExecutionEvidence, 'cleanup'>;
      }
    | undefined;

  try {
    database = await postgresFixture();

    storage = await s3Fixture(process.env);

    const generated = await generateSyntheticInputs(fixtureRoot);

    const [product, presenter, voice] = await Promise.all([
      createStoredAsset(database.client, storage, {
        path: generated.product,
        kind: 'VIDEO',
        mimeType: 'video/mp4',
      }),
      createStoredAsset(database.client, storage, {
        path: generated.presenter,
        kind: 'VIDEO',
        mimeType: 'video/mp4',
      }),
      createStoredAsset(database.client, storage, {
        path: generated.voice,
        kind: 'AUDIO',
        mimeType: 'audio/wav',
      }),
    ]);

    const lineage = await buildDurableLineage(database.client, {
      product,
      presenter,
      voice,
    });

    const expectedOutputKey =
      `renders/${lineage.render.id}` + `/attempts/${lineage.attempt.attemptNumber}` + '/master.mp4';

    storage.track(expectedOutputKey);

    const workRoot = join(fixtureRoot, 'worker');

    await mkdir(workRoot, {
      recursive: true,
      mode: 0o700,
    });

    const orchestrator = new RenderWorkerOrchestrator(
      database.client,
      storage.store,
      new RemotionVideoRenderer(),
      {
        workerId: 'phase11c3-durable-canary',
        workerVersion: WORKER_VERSION,
        storageProvider: 'S3',
        workRoot,
      },
    );

    const outcome = await orchestrator.execute({
      renderId: lineage.render.id,
      renderAttemptId: lineage.attempt.id,
    });

    if ('kind' in outcome) {
      fail('DURABLE_RENDER_CANARY_UNEXPECTED_PAUSE');
    }

    const [renderRow, attemptRow, outputAsset, jobRow] = await Promise.all([
      database.client.render.findUniqueOrThrow({
        where: {
          id: lineage.render.id,
        },
      }),
      database.client.renderAttempt.findUniqueOrThrow({
        where: {
          id: lineage.attempt.id,
        },
      }),
      database.client.asset.findUniqueOrThrow({
        where: {
          id: outcome.outputAssetId,
        },
      }),
      database.client.jobAttempt.findUniqueOrThrow({
        where: {
          operationId_attemptNumber_jobType: {
            operationId: lineage.render.operationId,
            attemptNumber: lineage.attempt.attemptNumber,
            jobType: 'RENDER',
          },
        },
      }),
    ]);

    assert.equal(renderRow.status, 'CREATIVE_QA');

    assert.equal(attemptRow.status, 'SUCCEEDED');

    assert.equal(jobRow.status, 'SUCCEEDED');

    assert.equal(outputAsset.status, 'READY');

    assert.equal(attemptRow.outputAssetId, outputAsset.id);

    assert.equal(outputAsset.objectKey, expectedOutputKey);

    assert.equal(outputAsset.bucket, storage.bucket);

    assert.equal(outputAsset.storageProvider, 'S3');

    assert.ok(
      technicalQaPassed(attemptRow.technicalQaJson),
      'DURABLE_RENDER_CANARY_TECHNICAL_QA_NOT_PASS',
    );

    assert.ok(outputAsset.checksumSha256, 'DURABLE_RENDER_CANARY_OUTPUT_CHECKSUM_MISSING');

    assert.ok(outputAsset.sizeBytes, 'DURABLE_RENDER_CANARY_OUTPUT_SIZE_MISSING');

    const master = await readPrivateObject(storage.store, outputAsset.objectKey);

    const masterSha256 = createHash('sha256').update(master).digest('hex');

    assert.equal(masterSha256, outputAsset.checksumSha256);

    assert.equal(master.byteLength, Number(outputAsset.sizeBytes));

    successful = {
      master,
      evidence: {
        schemaVersion: 1,
        canary: 'PHASE_11C_3B_DISPOSABLE_DURABLE_RENDER',
        fixtureVersion: DURABLE_RENDER_CANARY_FIXTURE_VERSION,
        result: 'SUCCEEDED',
        durable: {
          renderStatus: 'CREATIVE_QA',
          renderAttemptStatus: 'SUCCEEDED',
          jobAttemptStatus: 'SUCCEEDED',
          outputAssetStatus: 'READY',
          technicalQa: 'PASS',
        },
        lineage: {
          inputAssetCount: 3,
          outputAssetLinked: true,
          privateObjectVerified: true,
        },
        master: {
          fileName: 'master.mp4',
          fileSizeBytes: master.byteLength,
          sha256: masterSha256,
          width: outputAsset.width ?? 0,
          height: outputAsset.height ?? 0,
          durationMs: outputAsset.durationMs,
          fps: outputAsset.fps,
          audioChannels: outputAsset.audioChannels,
          sampleRate: outputAsset.sampleRate,
        },
        safety: {
          environment: 'LOCAL',
          disposablePostgresOnly: true,
          disposableS3BucketOnly: true,
          aiProviderInvoked: false,
          captureInvoked: false,
          analyticsInvoked: false,
          publishingAdapterInvoked: false,
          externalProviderCostUsd: 0,
          remoteSideEffect: false,
        },
      },
    };
  } finally {
    try {
      await storage?.close();
    } finally {
      try {
        await database?.close();
      } finally {
        await rm(fixtureRoot, {
          recursive: true,
          force: true,
        });
      }
    }
  }

  if (!successful) {
    fail('DURABLE_RENDER_CANARY_NO_SUCCESS_EVIDENCE');
  }

  return {
    master: successful.master,
    evidence: {
      ...successful.evidence,
      cleanup: {
        disposableDatabaseDestroyed: true,
        disposableBucketDestroyed: true,
        workerTempDestroyed: true,
      },
    } satisfies DurableExecutionEvidence,
  };
}

export async function executeReviewedDurableRenderCanary(
  options: Readonly<{
    config: RuntimeConfig;
    confirmation: string;
    outputDirectory: string;
  }>,
) {
  assertDurableRenderExecutionEnvironment(options.config);

  assertDurableRenderCanaryConfirmation(options.confirmation);

  if (!isAbsolute(options.outputDirectory)) {
    fail('DURABLE_RENDER_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  }

  await mkdir(options.outputDirectory, {
    recursive: true,
    mode: 0o700,
  });

  const existing = await readdir(options.outputDirectory);

  if (existing.length !== 0) {
    fail('DURABLE_RENDER_CANARY_OUTPUT_DIRECTORY_NOT_EMPTY');
  }

  const result = await runDisposableDurableCanary();

  const masterPath = join(options.outputDirectory, 'master.mp4');

  const manifestPath = join(options.outputDirectory, 'canary-evidence.json');

  await writeFile(masterPath, result.master, { mode: 0o600 });

  await writeFile(manifestPath, `${JSON.stringify(result.evidence, null, 2)}\n`, { mode: 0o600 });

  return {
    evidence: result.evidence,
    masterPath,
    manifestPath,
  } as const;
}

async function main() {
  const args = parseDurableRenderExecuteArgs(process.argv.slice(2));

  const result = await executeReviewedDurableRenderCanary({
    config: parseConfig(process.env),
    confirmation: args.confirmation,
    outputDirectory: args.outputDirectory,
  });

  console.log('===== PHASE 11C-3B DISPOSABLE DURABLE RENDER CANARY =====');
  console.log(`result=${result.evidence.result}`);
  console.log(`renderStatus=${result.evidence.durable.renderStatus}`);
  console.log(`renderAttemptStatus=${result.evidence.durable.renderAttemptStatus}`);
  console.log(`jobAttemptStatus=${result.evidence.durable.jobAttemptStatus}`);
  console.log(`outputAssetStatus=${result.evidence.durable.outputAssetStatus}`);
  console.log(`technicalQa=${result.evidence.durable.technicalQa}`);
  console.log(`privateObjectVerified=${result.evidence.lineage.privateObjectVerified}`);
  console.log(`masterBytes=${result.evidence.master.fileSizeBytes}`);
  console.log(`masterSha256=${result.evidence.master.sha256}`);
  console.log(`disposableDatabaseDestroyed=${result.evidence.cleanup.disposableDatabaseDestroyed}`);
  console.log(`disposableBucketDestroyed=${result.evidence.cleanup.disposableBucketDestroyed}`);
  console.log(`remoteSideEffect=${result.evidence.safety.remoteSideEffect}`);
  console.log(`masterPath=${result.masterPath}`);
  console.log(`manifestPath=${result.manifestPath}`);
  console.log('PASS: disposable durable Render canary completed.');
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11C3B_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );
    process.exitCode = 1;
  });
}
