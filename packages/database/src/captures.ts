import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { CaptureRequestSpecSchema, CaptureScenarioVersionSpecSchema } from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';
import type { Prisma } from './generated/prisma/client.js';
import { changed, databaseTime, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';
import { Versions } from './versions.js';
import { Recordings } from './recordings.js';

type CaptureSpec = z.infer<typeof CaptureScenarioVersionSpecSchema>;

const captureAssetRole = z.enum(['SCREENSHOT', 'VIDEO', 'FRAME', 'TRACE', 'LOG', 'OTHER']);

const captureRequestSpecs = z.array(CaptureRequestSpecSchema);

const persistedCaptureBrowserConfig = z
  .object({
    specVersionId: z.string().uuid(),
  })
  .passthrough();

const captureRequestBinding = z
  .object({
    clientKey: z.string().min(1),
    captureScenarioVersionId: z.string().uuid(),
  })
  .strict();

function canonicalSpecVersionId(browserConfigJson: Prisma.JsonValue | null) {
  const parsed = persistedCaptureBrowserConfig.safeParse(browserConfigJson);

  invariant(parsed.success, 'CAPTURE_SCENARIO_SPEC_VERSION_MISSING');

  return parsed.data.specVersionId;
}

const captureAssetMetadata = z
  .object({
    kind: z.enum(['IMAGE', 'VIDEO', 'OTHER']),
    checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    mimeType: z.string().min(1),
    sizeBytes: z.bigint().positive(),
    durationMs: z.number().int().positive().nullable(),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    fps: z.number().positive().nullable(),
    audioChannels: z.number().int().positive().nullable(),
    sampleRate: z.number().int().positive().nullable(),
  })
  .strict();

const captureAssetEvidence = z
  .object({
    assetId: z.string().uuid(),
    outputKey: z.string().min(1),
    diagnostic: z.boolean(),
    verification: z.literal('SHA256_READBACK'),
    technical: z.record(z.string(), z.unknown()),
  })
  .strict();

const persistedOutputSpecs = z.array(
  z
    .object({
      role: captureAssetRole,
      required: z.boolean(),
    })
    .passthrough(),
);

export type CaptureAssetMetadata = z.infer<typeof captureAssetMetadata>;

function persistedVersion(spec: CaptureSpec) {
  return {
    targetEnvironment: spec.environment.environmentKey,
    stepsJson: spec.steps as Prisma.InputJsonValue,
    inputSchemaJson: spec.inputSchema as Prisma.InputJsonValue,
    outputSpecJson: spec.outputs as Prisma.InputJsonValue,
    browserConfigJson: {
      specVersionId: spec.identity.captureScenarioVersionId,
      environment: spec.environment,
      auth: spec.auth,
      browser: spec.browser,
      fixturePolicy: spec.fixturePolicy,
      safety: spec.safety,
      timeouts: spec.timeouts,
    } as Prisma.InputJsonObject,
  };
}

function persistedHash(value: {
  targetEnvironment: string;
  stepsJson: Prisma.JsonValue;
  inputSchemaJson: Prisma.JsonValue | null;
  outputSpecJson: Prisma.JsonValue | null;
  browserConfigJson: Prisma.JsonValue | null;
}) {
  return contentHash({
    targetEnvironment: value.targetEnvironment,
    stepsJson: value.stepsJson,
    inputSchemaJson: value.inputSchemaJson,
    outputSpecJson: value.outputSpecJson,
    browserConfigJson: value.browserConfigJson,
  });
}

export class Captures {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  async importSeed(input: unknown) {
    assertHuman(this.actor);

    const spec = CaptureScenarioVersionSpecSchema.parse(input);
    const expected = persistedVersion(spec);

    await this.tx
      .$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('capture-seed-import', 0))`;

    let root = await this.tx.captureScenario.findUnique({
      where: { key: spec.identity.scenarioKey },
      include: { versions: true },
    });

    if (root) {
      invariant(root.name === spec.identity.name, 'CAPTURE_SCENARIO_IDENTITY_MISMATCH');

      const existing = root.versions.find((version) => version.version === spec.identity.version);

      invariant(existing, 'CAPTURE_SEED_VERSION_CONFLICT');

      invariant(
        persistedHash(existing) ===
          contentHash({
            targetEnvironment: expected.targetEnvironment,
            stepsJson: expected.stepsJson,
            inputSchemaJson: expected.inputSchemaJson,
            outputSpecJson: expected.outputSpecJson,
            browserConfigJson: expected.browserConfigJson,
          }),
        'CAPTURE_SEED_CONTENT_CONFLICT',
      );

      return {
        specVersionId: spec.identity.captureScenarioVersionId,
        captureScenarioVersionId: existing.id,
        captureScenarioId: root.id,
      };
    }

    invariant(spec.identity.version === 1, 'CAPTURE_SEED_INITIAL_VERSION_REQUIRED');

    root = await this.tx.captureScenario.create({
      data: {
        key: spec.identity.scenarioKey,
        name: spec.identity.name,
      },
      include: { versions: true },
    });

    await changed(this.tx, this.actor, 'CaptureScenario.created', 'CaptureScenario', root.id);

    const version = await new Versions(this.tx, this.actor).captureScenarioVersion({
      captureScenarioId: root.id,
      targetEnvironment: expected.targetEnvironment,
      stepsJson: expected.stepsJson,
      inputSchemaJson: expected.inputSchemaJson,
      outputSpecJson: expected.outputSpecJson,
      browserConfigJson: expected.browserConfigJson,
      createdBy: this.actor.actorId!,
    });

    await this.tx.captureScenario.update({
      where: { id: root.id },
      data: { status: 'ACTIVE' },
    });

    await changed(
      this.tx,
      this.actor,
      'CaptureScenario.activated',
      'CaptureScenario',
      root.id,
      version.id,
    );

    return {
      specVersionId: spec.identity.captureScenarioVersionId,
      captureScenarioVersionId: version.id,
      captureScenarioId: root.id,
    };
  }

  async beginRun(input: {
    captureScenarioVersionId: string;
    creativePlanVersionId?: string;
    operationId: string;
  }) {
    await this.tx.$executeRaw`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`capture-operation:${input.operationId}`}, 0)
      )
    `;

    const existing = await this.tx.captureRun.findUnique({
      where: { operationId: input.operationId },
    });

    if (existing) {
      invariant(
        existing.captureScenarioVersionId === input.captureScenarioVersionId &&
          existing.creativePlanVersionId === (input.creativePlanVersionId ?? null),
        'CAPTURE_OPERATION_CONFLICT',
      );
      return existing;
    }

    const scenario = await this.tx.captureScenarioVersion.findUniqueOrThrow({
      where: { id: input.captureScenarioVersionId },
      include: { captureScenario: true },
    });

    invariant(scenario.captureScenario.status === 'ACTIVE', 'CAPTURE_SCENARIO_NOT_ACTIVE');

    if (input.creativePlanVersionId) {
      const plan = await this.tx.creativePlanVersion.findUniqueOrThrow({
        where: { id: input.creativePlanVersionId },
      });

      const requirements = captureRequestSpecs.parse(plan.requiredCapturesJson ?? []);

      const specVersionId = canonicalSpecVersionId(scenario.browserConfigJson);

      const required = requirements.some(
        (requirement) => requirement.captureScenarioVersionId === specVersionId,
      );

      invariant(required, 'CAPTURE_NOT_REQUIRED_BY_PLAN');
    }

    const run = await this.tx.captureRun.create({
      data: {
        captureScenarioVersionId: input.captureScenarioVersionId,
        ...(input.creativePlanVersionId
          ? { creativePlanVersionId: input.creativePlanVersionId }
          : {}),
        operationId: input.operationId,
      },
    });

    await changed(this.tx, this.actor, 'CaptureRun.created', 'CaptureRun', run.id);

    return run;
  }

  async queueRequired(creativePlanVersionId: string) {
    const plan = await this.tx.creativePlanVersion.findUniqueOrThrow({
      where: {
        id: creativePlanVersionId,
      },
    });

    await lock(this.tx, 'CreativePlan', plan.creativePlanId);

    const requirements = captureRequestSpecs.parse(plan.requiredCapturesJson ?? []);

    invariant(
      new Set(requirements.map((requirement) => requirement.clientKey)).size ===
        requirements.length,
      'DUPLICATE_CAPTURE_KEY',
    );

    const scenarioVersions = await this.tx.captureScenarioVersion.findMany({
      include: {
        captureScenario: true,
      },
    });

    const bySpecVersionId = new Map<string, (typeof scenarioVersions)[number]>();

    for (const version of scenarioVersions) {
      if (version.captureScenario.status !== 'ACTIVE') {
        continue;
      }

      const specVersionId = canonicalSpecVersionId(version.browserConfigJson);

      invariant(!bySpecVersionId.has(specVersionId), 'CAPTURE_SCENARIO_SPEC_VERSION_DUPLICATE');

      bySpecVersionId.set(specVersionId, version);
    }

    const existingAudits = await this.tx.auditEvent.findMany({
      where: {
        action: 'CaptureRun.requestBound',
        subjectType: 'CaptureRun',
        subjectVersionId: creativePlanVersionId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    const existingBindings = existingAudits.map((audit) => ({
      audit,
      binding: captureRequestBinding.parse(audit.afterJson),
    }));

    const queued = [];

    for (const requirement of requirements) {
      const matches = existingBindings.filter(
        ({ binding }) => binding.clientKey === requirement.clientKey,
      );

      invariant(matches.length <= 1, 'CAPTURE_REQUEST_BINDING_CONFLICT');

      const existing = matches[0];

      if (existing) {
        invariant(
          existing.binding.captureScenarioVersionId === requirement.captureScenarioVersionId,
          'CAPTURE_REQUEST_BINDING_CONFLICT',
        );

        const run = await this.tx.captureRun.findUniqueOrThrow({
          where: {
            id: existing.audit.subjectId,
          },
          include: {
            captureScenarioVersion: true,
          },
        });

        invariant(
          run.creativePlanVersionId === creativePlanVersionId &&
            canonicalSpecVersionId(run.captureScenarioVersion.browserConfigJson) ===
              requirement.captureScenarioVersionId,
          'CAPTURE_REQUEST_BINDING_CONFLICT',
        );

        const job = await this.tx.jobAttempt.findUniqueOrThrow({
          where: {
            operationId_attemptNumber_jobType: {
              operationId: run.operationId,
              attemptNumber: 1,
              jobType: 'CAPTURE',
            },
          },
        });

        invariant(job.queueName === 'capture', 'CAPTURE_JOB_QUEUE_MISMATCH');

        queued.push({
          clientKey: requirement.clientKey,
          request: requirement,
          run,
          job,
        });

        continue;
      }

      const scenarioVersion = bySpecVersionId.get(requirement.captureScenarioVersionId);

      invariant(scenarioVersion, 'CAPTURE_SCENARIO_VERSION_NOT_IMPORTED');

      const operationId = randomUUID();

      const run = await this.beginRun({
        captureScenarioVersionId: scenarioVersion.id,
        creativePlanVersionId,
        operationId,
      });

      const job = await this.tx.jobAttempt.create({
        data: {
          queueName: 'capture',
          jobType: 'CAPTURE',
          operationId,
          attemptNumber: 1,
        },
      });

      await changed(this.tx, this.actor, 'JobAttempt.queued', 'JobAttempt', job.id);

      await this.tx.auditEvent.create({
        data: {
          ...this.actor,
          action: 'CaptureRun.requestBound',
          subjectType: 'CaptureRun',
          subjectId: run.id,
          subjectVersionId: creativePlanVersionId,
          afterJson: {
            clientKey: requirement.clientKey,
            captureScenarioVersionId: requirement.captureScenarioVersionId,
          },
        },
      });

      queued.push({
        clientKey: requirement.clientKey,
        request: requirement,
        run,
        job,
      });
    }

    return queued;
  }

  async reconcileExpiredJob(jobAttemptId: string) {
    invariant(this.actor.actorType === 'SYSTEM', 'CAPTURE_RECOVERY_SYSTEM_REQUIRED');

    await lock(this.tx, 'JobAttempt', jobAttemptId);

    const job = await this.tx.jobAttempt.findUniqueOrThrow({
      where: {
        id: jobAttemptId,
      },
    });

    invariant(
      job.queueName === 'capture' && job.jobType === 'CAPTURE',
      'CAPTURE_RECOVERY_JOB_INVALID',
    );

    const now = await databaseTime(this.tx);

    /*
     * Recovery candidates are discovered outside
     * this transaction. Re-check after the lock:
     * another owner/recovery may have completed it.
     */
    if (job.status !== 'RUNNING' || !job.leaseExpiresAt || job.leaseExpiresAt > now) {
      return null;
    }

    const run = await this.tx.captureRun.findUnique({
      where: {
        operationId: job.operationId,
      },
    });

    invariant(run, 'CAPTURE_RUN_NOT_FOUND');

    await lock(this.tx, 'CaptureRun', run.id);

    const currentRun = await this.tx.captureRun.findUniqueOrThrow({
      where: {
        id: run.id,
      },
    });

    invariant(
      currentRun.status === 'PENDING' || currentRun.status === 'RUNNING',
      'CAPTURE_RECONCILIATION_STATE_CONFLICT',
    );

    const failureCode = 'CAPTURE_RECONCILIATION_REQUIRED';

    const uploadingAssets = await this.tx.asset.findMany({
      where: {
        sourceType: 'CAPTURE',
        sourceEntityType: 'CaptureRun',
        sourceEntityId: currentRun.id,
        status: 'UPLOADING',
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    for (const asset of uploadingAssets) {
      await lock(this.tx, 'Asset', asset.id);

      const failed = await this.tx.asset.updateMany({
        where: {
          id: asset.id,
          status: 'UPLOADING',
        },
        data: {
          status: 'FAILED',
        },
      });

      if (failed.count === 1) {
        await this.tx.auditEvent.create({
          data: {
            ...this.actor,
            action: 'Asset.captureFailed',
            subjectType: 'Asset',
            subjectId: asset.id,
            afterJson: {
              code: failureCode,
            },
          },
        });

        await changed(this.tx, this.actor, 'Asset.failed', 'Asset', asset.id);
      }
    }

    const failedRun = await this.tx.captureRun.update({
      where: {
        id: currentRun.id,
      },
      data: {
        status: 'FAILED',
        finishedAt: now,
        failureCode,
        failureMessage: null,
      },
    });

    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'CaptureRun.reconciliationRequired',
        subjectType: 'CaptureRun',
        subjectId: currentRun.id,
        afterJson: {
          code: failureCode,
          jobAttemptId: job.id,
        },
      },
    });

    await changed(this.tx, this.actor, 'CaptureRun.failed', 'CaptureRun', currentRun.id);

    const failedJob = await this.tx.jobAttempt.update({
      where: {
        id: job.id,
      },
      data: {
        status: 'FAILED',
        finishedAt: now,
        failureCode,
      },
    });

    await changed(this.tx, this.actor, 'JobAttempt.failed', 'JobAttempt', job.id);

    return {
      job: failedJob,
      run: failedRun,
      failedAssetIds: uploadingAssets.map((asset) => asset.id),
    };
  }

  async startRun(id: string) {
    await lock(this.tx, 'CaptureRun', id);

    const run = await this.tx.captureRun.findUniqueOrThrow({ where: { id } });
    invariant(run.status === 'PENDING', 'CAPTURE_RUN_STALE_STATE');

    const now = await databaseTime(this.tx);

    const updated = await this.tx.captureRun.update({
      where: { id },
      data: {
        status: 'RUNNING',
        startedAt: now,
      },
    });

    await changed(this.tx, this.actor, 'CaptureRun.running', 'CaptureRun', id);

    return updated;
  }

  async beginAsset(input: {
    captureRunId: string;
    role: z.infer<typeof captureAssetRole>;
    bucket: string;
    sequence?: number;
  }) {
    const role = captureAssetRole.parse(input.role);

    invariant(input.bucket.trim().length > 0, 'CAPTURE_ASSET_BUCKET_REQUIRED');

    if (input.sequence !== undefined) {
      invariant(
        Number.isSafeInteger(input.sequence) && input.sequence >= 0,
        'CAPTURE_ASSET_SEQUENCE_INVALID',
      );
    }

    await lock(this.tx, 'CaptureRun', input.captureRunId);

    const run = await this.tx.captureRun.findUniqueOrThrow({
      where: { id: input.captureRunId },
    });

    invariant(run.status === 'RUNNING', 'CAPTURE_RUN_STALE_STATE');

    const asset = await this.tx.asset.create({
      data: {
        kind: 'OTHER',
        sourceType: 'CAPTURE',
        sourceEntityType: 'CaptureRun',
        sourceEntityId: run.id,
        storageProvider: 'S3',
        bucket: input.bucket,
        objectKey: `captures/${run.id}/${role.toLowerCase()}/` + randomUUID(),
        status: 'UPLOADING',
      },
    });

    const link = await this.tx.captureRunAsset.create({
      data: {
        captureRunId: run.id,
        assetId: asset.id,
        role,
        ...(input.sequence !== undefined ? { sequence: input.sequence } : {}),
      },
    });

    await changed(this.tx, this.actor, 'Asset.uploadStarted', 'Asset', asset.id);

    return { asset, link };
  }

  async finishAsset(
    assetId: string,
    metadata: CaptureAssetMetadata,
    evidence: Prisma.InputJsonValue,
  ) {
    const source = await this.tx.asset.findUniqueOrThrow({
      where: { id: assetId },
    });

    invariant(
      source.sourceType === 'CAPTURE' &&
        source.sourceEntityType === 'CaptureRun' &&
        source.sourceEntityId,
      'CAPTURE_ASSET_SOURCE_MISMATCH',
    );

    await lock(this.tx, 'CaptureRun', source.sourceEntityId);
    await lock(this.tx, 'Asset', assetId);

    const current = await this.tx.asset.findUniqueOrThrow({
      where: { id: assetId },
      include: {
        captureRunAssets: true,
      },
    });

    invariant(current.status === 'UPLOADING', 'CAPTURE_ASSET_ALREADY_FINALIZED');

    const link = current.captureRunAssets.find(
      (candidate) => candidate.captureRunId === source.sourceEntityId,
    );

    invariant(link, 'CAPTURE_ASSET_LINEAGE_INVALID');

    const run = await this.tx.captureRun.findUniqueOrThrow({
      where: { id: source.sourceEntityId },
    });

    invariant(run.status === 'RUNNING', 'CAPTURE_RUN_STALE_STATE');

    const checked = captureAssetMetadata.parse(metadata);
    const checkedEvidence = captureAssetEvidence.parse(evidence);

    invariant(checkedEvidence.assetId === assetId, 'CAPTURE_ASSET_EVIDENCE_MISMATCH');

    if (link.role === 'VIDEO') {
      invariant(
        checked.kind === 'VIDEO' &&
          checked.mimeType.startsWith('video/') &&
          checked.durationMs !== null &&
          checked.width !== null &&
          checked.height !== null &&
          checked.fps !== null,
        'CAPTURE_VIDEO_METADATA_REQUIRED',
      );
    }

    if (link.role === 'SCREENSHOT' || link.role === 'FRAME') {
      invariant(
        checked.kind === 'IMAGE' &&
          checked.mimeType === 'image/png' &&
          checked.width !== null &&
          checked.height !== null,
        'CAPTURE_IMAGE_METADATA_REQUIRED',
      );
    }

    if (link.role === 'TRACE') {
      invariant(
        checked.kind === 'OTHER' && checked.mimeType === 'application/zip',
        'CAPTURE_TRACE_METADATA_INVALID',
      );
    }

    const asset = await this.tx.asset.update({
      where: { id: assetId },
      data: {
        ...checked,
        status: 'READY',
      },
    });

    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'Asset.probed',
        subjectType: 'Asset',
        subjectId: assetId,
        afterJson: evidence,
      },
    });

    await changed(this.tx, this.actor, 'Asset.ready', 'Asset', assetId);

    return { asset, link };
  }

  async failAsset(assetId: string, failureCode: string) {
    invariant(failureCode.trim().length > 0, 'CAPTURE_ASSET_FAILURE_CODE_REQUIRED');

    const source = await this.tx.asset.findUniqueOrThrow({
      where: { id: assetId },
    });

    invariant(
      source.sourceType === 'CAPTURE' &&
        source.sourceEntityType === 'CaptureRun' &&
        source.sourceEntityId,
      'CAPTURE_ASSET_SOURCE_MISMATCH',
    );

    await lock(this.tx, 'CaptureRun', source.sourceEntityId);
    await lock(this.tx, 'Asset', assetId);

    const result = await this.tx.asset.updateMany({
      where: {
        id: assetId,
        status: 'UPLOADING',
      },
      data: {
        status: 'FAILED',
      },
    });

    if (result.count) {
      await this.tx.auditEvent.create({
        data: {
          ...this.actor,
          action: 'Asset.captureFailed',
          subjectType: 'Asset',
          subjectId: assetId,
          afterJson: {
            code: failureCode,
          },
        },
      });

      await changed(this.tx, this.actor, 'Asset.failed', 'Asset', assetId);
    }

    return result.count === 1;
  }

  async succeedRun(id: string) {
    await lock(this.tx, 'CaptureRun', id);

    const run = await this.tx.captureRun.findUniqueOrThrow({
      where: { id },
      include: {
        captureScenarioVersion: true,
        assets: {
          include: {
            asset: true,
          },
        },
      },
    });

    invariant(run.status === 'RUNNING', 'CAPTURE_RUN_STALE_STATE');

    const outputs = persistedOutputSpecs.parse(run.captureScenarioVersion.outputSpecJson ?? []);

    for (const [sequence, output] of outputs.entries()) {
      if (!output.required) continue;

      const matching = run.assets.find(
        (link) =>
          link.role === output.role &&
          link.sequence === sequence &&
          link.asset.status === 'READY' &&
          link.asset.deletedAt === null,
      );

      invariant(matching, 'CAPTURE_REQUIRED_OUTPUT_MISSING');
    }

    const now = await databaseTime(this.tx);

    const updated = await this.tx.captureRun.update({
      where: { id },
      data: {
        status: 'SUCCEEDED',
        finishedAt: now,
        failureCode: null,
        failureMessage: null,
      },
    });

    await changed(this.tx, this.actor, 'CaptureRun.succeeded', 'CaptureRun', id);

    if (run.creativePlanVersionId) {
      await new Recordings(this.tx, this.actor).refresh(run.creativePlanVersionId);
    }

    return updated;
  }

  async failRun(id: string, failureCode: string) {
    await lock(this.tx, 'CaptureRun', id);

    invariant(failureCode.trim().length > 0, 'CAPTURE_FAILURE_CODE_REQUIRED');

    const run = await this.tx.captureRun.findUniqueOrThrow({ where: { id } });
    invariant(run.status === 'RUNNING', 'CAPTURE_RUN_STALE_STATE');

    const now = await databaseTime(this.tx);

    const updated = await this.tx.captureRun.update({
      where: { id },
      data: {
        status: 'FAILED',
        finishedAt: now,
        failureCode,
        failureMessage: null,
      },
    });

    await changed(this.tx, this.actor, 'CaptureRun.failed', 'CaptureRun', id);

    return updated;
  }
}
