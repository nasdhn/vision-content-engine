import 'dotenv/config';

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import { RenderReviewService } from '../packages/application/src/render-review.js';
import { contentHash } from '../packages/contracts/src/canonical.js';
import { Persistence } from '../packages/database/src/index.js';
import { postgresFixture } from '../packages/database/test/support.js';
import { s3Fixture } from '../packages/media/test/s3-fixture.js';
import {
  assertLocalBootstrap,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';
import { recordingGraph } from '../tests/fixtures/recordings/support.js';

const exec = promisify(execFile);

export const HUMAN_REVIEW_CANARY_CONFIRMATION = 'APPROVE_DISPOSABLE_HUMAN_REVIEW_CANARY';

const human = {
  actorType: 'USER',
  actorId: 'phase11d2-human-reviewer',
} as const;

const ai = {
  actorType: 'AI',
  actorId: 'phase11d2-creative-qa-fixture',
} as const;

export function assertHumanReviewCanaryConfirmation(value: string): void {
  if (value !== HUMAN_REVIEW_CANARY_CONFIRMATION) {
    throw new Error('HUMAN_REVIEW_CANARY_CONFIRMATION_INVALID');
  }
}

export function assertHumanReviewCanaryEnvironment(config: RuntimeConfig): void {
  assertLocalBootstrap(config);

  if (
    !config.PAUSE_RENDERING ||
    !config.PAUSE_CAPTURE ||
    !config.PAUSE_AI_GENERATION ||
    !config.PAUSE_ALL_PUBLISHING ||
    !config.PAUSE_ANALYTICS_COLLECTION ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false'
  ) {
    throw new Error('HUMAN_REVIEW_CANARY_ENVIRONMENT_INVALID');
  }
}

export function parseHumanReviewCanaryArgs(rawArgs: readonly string[]) {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  if (
    args.length !== 4 ||
    args[0] !== '--confirm' ||
    args[2] !== '--output-dir' ||
    typeof args[1] !== 'string' ||
    typeof args[3] !== 'string'
  ) {
    throw new Error('HUMAN_REVIEW_CANARY_USAGE_INVALID');
  }

  if (!isAbsolute(args[3])) {
    throw new Error('HUMAN_REVIEW_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  }

  return {
    confirmation: args[1],
    outputDirectory: args[3],
  };
}

async function ffmpegMaster(path: string) {
  await exec(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostdin',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:size=1080x1920:rate=30:duration=0.4',
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
      '-an',
      path,
    ],
    {
      timeout: 120_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
}

async function executeCanary(config: RuntimeConfig, confirmation: string, outputDirectory: string) {
  assertHumanReviewCanaryEnvironment(config);
  assertHumanReviewCanaryConfirmation(confirmation);

  const workspace = await mkdtemp(join(tmpdir(), 'vce-phase11d2-human-review-'));

  let database: Awaited<ReturnType<typeof postgresFixture>> | undefined;

  let storage: Awaited<ReturnType<typeof s3Fixture>> | undefined;

  try {
    database = await postgresFixture();
    storage = await s3Fixture(process.env);

    const db = database.client;
    const persistence = new Persistence(db);
    const review = new RenderReviewService(db, storage.store);

    const masterPath = join(workspace, 'master.mp4');
    await ffmpegMaster(masterPath);

    const masterBytes = await readFile(masterPath);
    const masterStat = await stat(masterPath);
    const masterSha256 = createHash('sha256').update(masterBytes).digest('hex');

    const graph = await recordingGraph(db);

    const editingPlan = await db.editingPlan.create({
      data: {
        creativePlanId: graph.plan.id,
        status: 'READY',
      },
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
      data: {
        editingPlanVersionId: editingPlanVersion.id,
        status: 'CREATIVE_QA',
      },
    });

    const attemptId = randomUUID();
    const objectKey = `renders/${render.id}/attempts/1/master.mp4`;

    storage.track(objectKey);

    await storage.store.put(objectKey, masterPath, masterStat.size, 'video/mp4');

    const asset = await db.asset.create({
      data: {
        kind: 'VIDEO',
        sourceType: 'RENDER',
        sourceEntityType: 'RenderAttempt',
        sourceEntityId: attemptId,
        storageProvider: 'S3',
        bucket: storage.bucket,
        objectKey,
        checksumSha256: masterSha256,
        mimeType: 'video/mp4',
        sizeBytes: BigInt(masterStat.size),
        width: 1080,
        height: 1920,
        durationMs: 400,
        fps: 30,
        status: 'READY',
      },
    });

    const technicalQa = {
      result: 'PASS',
      probe: {
        assetId: asset.id,
        container: 'mov,mp4,m4a,3gp,3g2,mj2',
        durationMs: 400,
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
      checks: [
        {
          key: 'PHASE11D2_PRIVATE_MASTER',
          status: 'PASS',
        },
      ],
      rendererVersion: 'phase11d2-fixture-v1',
      colorProfileKey: 'SDR_BT709_SOCIAL_V1',
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    };

    const attempt = await db.renderAttempt.create({
      data: {
        id: attemptId,
        renderId: render.id,
        attemptNumber: 1,
        status: 'SUCCEEDED',
        outputAssetId: asset.id,
        technicalQaJson: technicalQa,
      },
    });

    const creativeQa = {
      result: 'PASS',
      evaluatedDimensions: ['PACING', 'PRODUCT_VISIBILITY'],
      notEvaluatedDimensions: [],
      issues: [],
      summary: 'Deterministic Phase 11D fixture accepted for Human Review transition proof.',
    } as const;

    const knowledgePayload = {
      fixture: 'phase11d2-human-review',
    };

    const knowledge = await db.knowledgeSnapshot.create({
      data: {
        key: `phase11d2-${randomUUID()}`,
        version: 1,
        contentHash: contentHash(knowledgePayload),
        status: 'ACTIVE',
        effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
        payloadJson: knowledgePayload,
      },
    });

    const invocation = await db.modelInvocation.create({
      data: {
        purpose: 'phase11d2-human-review-canary',
        promptKey: 'creative-qa',
        promptVersion: '1.0.0',
        promptContentHash: contentHash({
          fixture: 'creative-qa-v1',
        }),
        knowledgeSnapshotId: knowledge.id,
        inputSchemaVersion: '1.0.0',
        outputSchemaVersion: '1.0.0',
        policyJson: {
          capability: 'CREATIVE_QA',
          fixture: true,
          externalProviderCalled: false,
        },
        status: 'SUCCEEDED',
        inputHash: contentHash({
          renderAttemptId: attempt.id,
        }),
        outputHash: contentHash(creativeQa),
        startedAt: new Date(),
        finishedAt: new Date(),
        validationJson: {
          schema: 'PASS',
          references: 'PASS',
          businessRules: 'PASS',
          claims: 'PASS',
          fixture: true,
        },
      },
    });

    await persistence.transaction(ai, async (unit) => {
      await unit.consumeInvocation(invocation.id, creativeQa);

      await unit.applyCreativeQa(attempt.id, invocation.id, creativeQa);
    });

    const ready = await db.render.findUniqueOrThrow({
      where: { id: render.id },
    });

    assert.equal(ready.status, 'READY_FOR_REVIEW');

    const queue = await review.queue();

    assert.equal(queue.length, 1);
    assert.equal(queue[0]?.renderId, render.id);

    const detailBefore = await review.detail(render.id);

    assert.equal(detailBefore.decisionAllowed, true);
    assert.equal(detailBefore.lineage.outputAssetId, asset.id);
    assert.equal(detailBefore.creativeQa.result, 'PASS');
    assert.equal(detailBefore.technicalQa.result, 'PASS');

    const media = await review.media(human, render.id);

    assert.equal(media.checksumSha256, masterSha256);
    assert.equal(media.sizeBytes, masterBytes.byteLength);
    assert.deepEqual(media.bytes, masterBytes);

    assert.equal(await db.publication.count(), 0);

    const decision = await review.decide(human, render.id, {
      decision: 'APPROVED',
    });

    assert.equal(decision.decision, 'APPROVED');

    const approved = await db.render.findUniqueOrThrow({
      where: { id: render.id },
    });

    assert.equal(approved.status, 'APPROVED');
    assert.equal(approved.approvedAssetId, asset.id);

    const approval = await db.approval.findFirstOrThrow({
      where: {
        renderId: render.id,
        subjectType: 'RENDER',
      },
    });

    assert.equal(approval.actorType, 'USER');
    assert.equal(approval.decision, 'APPROVED');

    assert.equal(await db.publication.count(), 0);

    const evidence = {
      schemaVersion: 1,
      canary: 'PHASE_11D_2_DISPOSABLE_HUMAN_REVIEW',
      result: 'SUCCEEDED',
      stateTransition: {
        beforeCreativeQa: 'CREATIVE_QA',
        afterCreativeQa: 'READY_FOR_REVIEW',
        afterHumanDecision: 'APPROVED',
      },
      review: {
        queueContainedRender: true,
        decisionAllowedBefore: true,
        privateMasterRead: true,
        privateMasterChecksumVerified: true,
        exactOutputAssetApproved: true,
        humanApprovalPersisted: true,
      },
      master: {
        fileSizeBytes: masterBytes.byteLength,
        sha256: masterSha256,
        width: 1080,
        height: 1920,
        durationMs: 400,
        fps: 30,
      },
      creativeQa: {
        result: 'PASS',
        deterministicFixture: true,
        realProviderCalled: false,
        externalProviderCostUsd: 0,
      },
      safety: {
        publicationCount: 0,
        publishingAdapterInvoked: false,
        captureInvoked: false,
        rendererInvoked: false,
        analyticsInvoked: false,
        remoteSideEffect: false,
      },
    } as const;

    await import('node:fs/promises').then(({ mkdir, writeFile }) =>
      mkdir(outputDirectory, {
        recursive: true,
        mode: 0o700,
      }).then(async () => {
        const existing = await import('node:fs/promises').then(({ readdir }) =>
          readdir(outputDirectory),
        );

        if (existing.length !== 0) {
          throw new Error('HUMAN_REVIEW_CANARY_OUTPUT_DIRECTORY_NOT_EMPTY');
        }

        await writeFile(
          join(outputDirectory, 'canary-evidence.json'),
          `${JSON.stringify(evidence, null, 2)}\n`,
          { mode: 0o600 },
        );
      }),
    );

    return evidence;
  } finally {
    try {
      await storage?.close();
    } finally {
      try {
        await database?.close();
      } finally {
        await rm(workspace, {
          recursive: true,
          force: true,
        });
      }
    }
  }
}

async function main() {
  const args = parseHumanReviewCanaryArgs(process.argv.slice(2));

  const evidence = await executeCanary(
    parseConfig(process.env),
    args.confirmation,
    args.outputDirectory,
  );

  console.log('===== PHASE 11D-2 DISPOSABLE HUMAN REVIEW CANARY =====');
  console.log(`result=${evidence.result}`);
  console.log(`beforeCreativeQa=${evidence.stateTransition.beforeCreativeQa}`);
  console.log(`afterCreativeQa=${evidence.stateTransition.afterCreativeQa}`);
  console.log(`afterHumanDecision=${evidence.stateTransition.afterHumanDecision}`);
  console.log(`privateMasterRead=${evidence.review.privateMasterRead}`);
  console.log(`privateMasterChecksumVerified=${evidence.review.privateMasterChecksumVerified}`);
  console.log(`humanApprovalPersisted=${evidence.review.humanApprovalPersisted}`);
  console.log(`exactOutputAssetApproved=${evidence.review.exactOutputAssetApproved}`);
  console.log(`publicationCount=${evidence.safety.publicationCount}`);
  console.log(`realCreativeQaProviderCalled=${evidence.creativeQa.realProviderCalled}`);
  console.log(`externalProviderCostUsd=${evidence.creativeQa.externalProviderCostUsd}`);
  console.log(`remoteSideEffect=${evidence.safety.remoteSideEffect}`);
  console.log('PASS: disposable Human Review canary completed.');
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11D2_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );
    process.exitCode = 1;
  });
}
