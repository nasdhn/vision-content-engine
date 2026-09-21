import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { CaptureRequestSpecSchema } from '@vision/contracts';
import type { Leases, PrismaClient } from '@vision/database';
import { Persistence } from '@vision/database';
import { DomainError, invariant } from '@vision/domain';
import type { PrivateStorage } from '@vision/media';

import { CaptureAssetStager, finalizeStagedCaptureAssets } from './assets.js';
import { executeCaptureScenario } from './executor.js';
import type { CaptureAuthStateProvider, CaptureFixtureManager } from './fixture.js';

export type CaptureScenarioResolver = {
  getBySpecVersionId(id: string): Promise<{
    spec: unknown;
  }>;
};

export type CaptureWorkerOutcome =
  | {
      status: 'IDLE';
    }
  | {
      status: 'SUCCEEDED';
      jobAttemptId: string;
      captureRunId: string;
    }
  | {
      status: 'FAILED';
      jobAttemptId: string;
      captureRunId?: string;
      failureCode: string;
    };

type ClaimedCaptureJob = NonNullable<Awaited<ReturnType<Leases['claimJob']>>>;

type CaptureWorkerOptions = {
  heartbeatIntervalMs?: number;
  outputRoot?: string;
  execute?: typeof executeCaptureScenario;
  probe?: ConstructorParameters<typeof CaptureAssetStager>[2];
};

type CaptureContext = {
  runId: string;
  scenario: unknown;
  scenarioInput: Readonly<Record<string, unknown>>;
};

function stableFailureCode(error: unknown) {
  if (error instanceof DomainError) {
    return error.code;
  }

  return 'CAPTURE_WORKER_FAILED';
}

function staleLease(error: unknown) {
  return error instanceof DomainError && error.code === 'STALE_LEASE';
}

function binding(value: unknown) {
  invariant(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'CAPTURE_REQUEST_BINDING_INVALID',
  );

  const record = value as Record<string, unknown>;

  invariant(
    typeof record.clientKey === 'string' && record.clientKey.trim().length > 0,
    'CAPTURE_REQUEST_BINDING_INVALID',
  );

  invariant(
    typeof record.captureScenarioVersionId === 'string' &&
      record.captureScenarioVersionId.trim().length > 0,
    'CAPTURE_REQUEST_BINDING_INVALID',
  );

  return {
    clientKey: record.clientKey,
    captureScenarioVersionId: record.captureScenarioVersionId,
  };
}

function canonicalSpecVersionId(value: unknown) {
  invariant(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'CAPTURE_SCENARIO_SPEC_VERSION_MISSING',
  );

  const record = value as Record<string, unknown>;

  invariant(
    typeof record.specVersionId === 'string' && record.specVersionId.trim().length > 0,
    'CAPTURE_SCENARIO_SPEC_VERSION_MISSING',
  );

  return record.specVersionId;
}

export class CaptureWorkerOrchestrator {
  private readonly persistence: Persistence;
  private readonly stager: CaptureAssetStager;
  private readonly heartbeatIntervalMs: number;
  private readonly outputRoot: string;
  private readonly execute: typeof executeCaptureScenario;

  constructor(
    private readonly client: PrismaClient,
    private readonly leases: Leases,
    storage: PrivateStorage,
    private readonly fixtureManager: CaptureFixtureManager,
    private readonly authStateProvider: CaptureAuthStateProvider,
    private readonly scenarios: CaptureScenarioResolver,
    options: CaptureWorkerOptions = {},
  ) {
    this.persistence = new Persistence(client);

    this.stager = new CaptureAssetStager(client, storage, options.probe);

    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;

    invariant(
      Number.isSafeInteger(this.heartbeatIntervalMs) && this.heartbeatIntervalMs > 0,
      'CAPTURE_HEARTBEAT_INTERVAL_INVALID',
    );

    this.outputRoot = options.outputRoot ?? tmpdir();

    this.execute = options.execute ?? executeCaptureScenario;
  }

  private async resolve(job: ClaimedCaptureJob): Promise<CaptureContext> {
    invariant(job.queueName === 'capture', 'CAPTURE_JOB_QUEUE_MISMATCH');

    invariant(job.jobType === 'CAPTURE', 'CAPTURE_JOB_TYPE_INVALID');

    const run = await this.client.captureRun.findUnique({
      where: {
        operationId: job.operationId,
      },
      include: {
        captureScenarioVersion: true,
        creativePlanVersion: true,
      },
    });

    invariant(run, 'CAPTURE_RUN_NOT_FOUND');

    invariant(run.creativePlanVersionId && run.creativePlanVersion, 'CAPTURE_PLAN_REQUIRED');

    const audits = await this.client.auditEvent.findMany({
      where: {
        action: 'CaptureRun.requestBound',
        subjectType: 'CaptureRun',
        subjectId: run.id,
        subjectVersionId: run.creativePlanVersionId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    invariant(audits.length === 1, 'CAPTURE_REQUEST_BINDING_INVALID');

    const requestBinding = binding(audits[0]!.afterJson);

    const requirements = CaptureRequestSpecSchema.array().parse(
      run.creativePlanVersion.requiredCapturesJson ?? [],
    );

    const matches = requirements.filter(
      (request) => request.clientKey === requestBinding.clientKey,
    );

    invariant(matches.length === 1, 'CAPTURE_REQUEST_NOT_FOUND');

    const request = matches[0]!;

    invariant(
      request.captureScenarioVersionId === requestBinding.captureScenarioVersionId,
      'CAPTURE_REQUEST_BINDING_CONFLICT',
    );

    const specVersionId = canonicalSpecVersionId(run.captureScenarioVersion.browserConfigJson);

    invariant(
      specVersionId === request.captureScenarioVersionId,
      'CAPTURE_REQUEST_SCENARIO_MISMATCH',
    );

    const resolved = await this.scenarios.getBySpecVersionId(specVersionId);

    return {
      runId: run.id,
      scenario: resolved.spec,
      scenarioInput: request.scenarioInput,
    };
  }

  private async withHeartbeat<T>(
    jobAttemptId: string,
    leaseToken: string,
    work: () => Promise<T>,
  ): Promise<T> {
    /*
     * Heartbeat once before the external operation,
     * then continuously while it is running.
     */
    await this.leases.heartbeatJob(jobAttemptId, leaseToken);

    const controller = new AbortController();

    let heartbeatError: unknown | undefined;

    const loop = (async () => {
      while (!controller.signal.aborted) {
        try {
          await delay(this.heartbeatIntervalMs, undefined, {
            signal: controller.signal,
          });
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }

          heartbeatError = error;
          return;
        }

        try {
          await this.leases.heartbeatJob(jobAttemptId, leaseToken);
        } catch (error) {
          heartbeatError = error;
          return;
        }
      }
    })();

    try {
      const result = await work();

      if (heartbeatError) {
        throw heartbeatError;
      }

      /*
       * Final heartbeat closes the race where
       * work completes immediately before the
       * periodic heartbeat would have fired.
       */
      await this.leases.heartbeatJob(jobAttemptId, leaseToken);

      if (heartbeatError) {
        throw heartbeatError;
      }

      return result;
    } finally {
      controller.abort();

      await loop.catch((error) => {
        if (!heartbeatError) {
          heartbeatError = error;
        }
      });
    }
  }

  async processOne(workerId: string): Promise<CaptureWorkerOutcome> {
    invariant(workerId.trim().length > 0, 'OWNER_REQUIRED');

    const job = await this.leases.claimJob('capture', workerId);

    if (!job) {
      return {
        status: 'IDLE',
      };
    }

    invariant(job.leaseToken, 'STALE_LEASE');

    const leaseToken = job.leaseToken;

    const actor = {
      actorType: 'WORKER',
      actorId: workerId,
    } as const;

    let runId: string | undefined;

    let runStarted = false;

    let outputDirectory: string | undefined;

    try {
      const context = await this.resolve(job);

      runId = context.runId;

      await this.leases.heartbeatJob(job.id, leaseToken);

      await this.persistence.transaction(actor, (unit) => unit.captures.startRun(context.runId));

      runStarted = true;

      outputDirectory = await mkdtemp(join(this.outputRoot, `vision-capture-${context.runId}-`));

      const execution = await this.withHeartbeat(job.id, leaseToken, () =>
        this.execute({
          scenario: context.scenario,
          input: context.scenarioInput,
          outputDirectory: outputDirectory!,
          fixtureManager: this.fixtureManager,
          authStateProvider: this.authStateProvider,
        }),
      );

      const staged = await this.withHeartbeat(job.id, leaseToken, () =>
        this.stager.stage(actor, context.runId, context.scenario, execution, outputDirectory!),
      );

      if (execution.result === 'FAILED') {
        const failureCode = execution.failureCode ?? 'CAPTURE_EXECUTION_FAILED';

        await this.leases.finishJob(job.id, leaseToken, 'FAILED', failureCode, async (unit) => {
          await finalizeStagedCaptureAssets(unit, staged);

          await unit.captures.failRun(context.runId, failureCode);
        });

        return {
          status: 'FAILED',
          jobAttemptId: job.id,
          captureRunId: context.runId,
          failureCode,
        };
      }

      await this.leases.finishJob(job.id, leaseToken, 'SUCCEEDED', undefined, async (unit) => {
        await finalizeStagedCaptureAssets(unit, staged);

        await unit.captures.succeedRun(context.runId);
      });

      return {
        status: 'SUCCEEDED',
        jobAttemptId: job.id,
        captureRunId: context.runId,
      };
    } catch (error) {
      /*
       * A lost lease is intentionally NOT converted
       * to FAILED. CAPTURE is RECONCILE, because the
       * browser flow may already have caused a remote
       * side effect.
       */
      if (staleLease(error)) {
        throw error;
      }

      const failureCode = stableFailureCode(error);

      try {
        await this.leases.finishJob(
          job.id,
          leaseToken,
          'FAILED',
          failureCode,
          runStarted && runId
            ? async (unit) => {
                await unit.captures.failRun(runId!, failureCode);
              }
            : undefined,
        );
      } catch (finishError) {
        if (staleLease(finishError)) {
          throw finishError;
        }

        throw error;
      }

      return {
        status: 'FAILED',
        jobAttemptId: job.id,
        ...(runId
          ? {
              captureRunId: runId,
            }
          : {}),
        failureCode,
      };
    } finally {
      if (outputDirectory) {
        await rm(outputDirectory, {
          recursive: true,
          force: true,
        }).catch(() => undefined);
      }
    }
  }
}
