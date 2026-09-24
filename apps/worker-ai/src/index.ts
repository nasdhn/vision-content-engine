import { observeWorkerLifecycle, type WorkerProbes } from '@vision/observability';
import { StructuredLogger, observeOperation } from '@vision/observability';
import { Worker } from 'bullmq';
import type { WorkerOptions } from 'bullmq';

import type { AnalystRuntime } from '@vision/application';
import {
  WeeklyAnalysisContextBuilder,
  buildWeeklyAnalystPersistenceInput,
  restoreWeeklyAnalystOutput,
} from '@vision/application';
import { WEEKLY_ANALYSIS_QUEUE_NAME, WeeklyAnalysisQueueJobSchema } from '@vision/contracts';
import { DEFAULT_WEEKLY_ANALYSIS_LEASE, WeeklyAnalysisRepository } from '@vision/database';
import type { PrismaClient } from '@vision/database';
import type { LeaseConfig } from '@vision/domain';

function redisConnectionOptions(redisUrl: string): WorkerOptions['connection'] {
  const parsed = new URL(redisUrl);
  if (!['redis:', 'rediss:'].includes(parsed.protocol)) throw new Error('INVALID_REDIS_URL');
  const db = parsed.pathname.length > 1 ? Number(parsed.pathname.slice(1)) : undefined;
  if (db !== undefined && (!Number.isSafeInteger(db) || db < 0)) {
    throw new Error('INVALID_REDIS_DB');
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'rediss:' ? 6380 : 6379)),
    ...(parsed.username ? { username: decodeURIComponent(parsed.username) } : {}),
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
    ...(db !== undefined ? { db } : {}),
    ...(parsed.protocol === 'rediss:' ? { tls: { servername: parsed.hostname } } : {}),
  };
}

export type WeeklyAnalysisWorkerOptions = Readonly<{
  workerId: string;
  leaseConfig?: LeaseConfig;
}>;

function terminalCode(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (!/^[A-Z][A-Z0-9_:-]+$/.test(error.message)) return null;
  return error.message;
}

export class WeeklyAnalysisWorkerOrchestrator {
  private readonly repository: WeeklyAnalysisRepository;
  private readonly contextBuilder: WeeklyAnalysisContextBuilder;
  private readonly leaseConfig: LeaseConfig;

  constructor(
    private readonly db: PrismaClient,
    private readonly analyst: AnalystRuntime,
    private readonly options: WeeklyAnalysisWorkerOptions,
  ) {
    if (!options.workerId.trim()) throw new Error('OWNER_REQUIRED');
    this.leaseConfig = options.leaseConfig ?? DEFAULT_WEEKLY_ANALYSIS_LEASE;
    this.repository = new WeeklyAnalysisRepository(db, this.leaseConfig);
    this.contextBuilder = new WeeklyAnalysisContextBuilder(db);
  }

  async process(rawInput: unknown) {
    const job = WeeklyAnalysisQueueJobSchema.parse(rawInput);
    return observeOperation(
      new StructuredLogger('worker-ai'),
      {
        operationId: job.operationId,
        workflowRunId: job.workflowRunId,
        jobAttemptId: job.jobAttemptId,
      },
      () => this.processJob(job),
    );
  }

  private async processJob(job: ReturnType<typeof WeeklyAnalysisQueueJobSchema.parse>) {
    const claim = await this.repository.claim(job.jobAttemptId, this.options.workerId);

    if (claim.kind !== 'READY') return claim;

    let heartbeatFailure: unknown = null;
    const timer = setInterval(() => {
      void this.repository.heartbeat(job.jobAttemptId, claim.leaseToken).catch((error: unknown) => {
        heartbeatFailure ??= error;
      });
    }, this.leaseConfig.heartbeatIntervalMs);
    timer.unref?.();

    try {
      const checkpoint = await this.repository.readOutputCheckpoint(job.operationId);
      if (checkpoint !== null) {
        const restored = restoreWeeklyAnalystOutput(checkpoint);
        const persistenceInput = buildWeeklyAnalystPersistenceInput(
          job.operationId,
          restored.output,
          restored.metadata,
        );
        if (heartbeatFailure) throw heartbeatFailure;
        return await this.repository.complete(job.jobAttemptId, claim.leaseToken, persistenceInput);
      }

      const existingInvocation = await this.db.modelInvocation.findUnique({
        where: { id: job.operationId },
        select: { status: true },
      });
      if (existingInvocation) {
        throw new Error(
          existingInvocation.status === 'RUNNING'
            ? 'WEEKLY_ANALYSIS_INVOCATION_RECOVERY_UNAVAILABLE'
            : 'WEEKLY_ANALYSIS_CHECKPOINT_MISSING',
        );
      }

      const context = await this.contextBuilder.build(claim.payload);
      const result = await this.analyst.analyze({
        requestId: job.operationId,
        purpose: `weekly-analysis:${job.analysisOperationKey}`,
        knowledgeSnapshot: job.knowledgeSnapshot,
        knowledgeContext: context.knowledgeContext,
        input: context.input,
        validationContext: context.validationContext,
        policy: job.policy,
        budget: job.budget,
        successCheckpointMetadata: context.checkpointMetadata,
      });

      if (heartbeatFailure) throw heartbeatFailure;
      const persistenceInput = buildWeeklyAnalystPersistenceInput(
        result.modelInvocationId,
        result.output,
        context.checkpointMetadata,
      );
      return await this.repository.complete(job.jobAttemptId, claim.leaseToken, persistenceInput);
    } catch (error) {
      const code = terminalCode(error);
      if (code === 'STALE_LEASE') throw error;

      if (code) {
        try {
          await this.repository.fail(
            job.jobAttemptId,
            claim.leaseToken,
            code,
            error instanceof Error ? error.message : undefined,
          );
        } catch (failureError) {
          if (terminalCode(failureError) === 'STALE_LEASE') throw failureError;
          throw error;
        }
        return { kind: 'FAILED', jobAttemptId: job.jobAttemptId, failureCode: code } as const;
      }

      throw error;
    } finally {
      clearInterval(timer);
    }
  }
}

export function createBullMqWeeklyAnalysisWorker(input: {
  probes: WorkerProbes;
  redisUrl: string;
  orchestrator: WeeklyAnalysisWorkerOrchestrator;
  concurrency?: number;
}) {
  const worker = new Worker(
    WEEKLY_ANALYSIS_QUEUE_NAME,
    async (job) => input.orchestrator.process(job.data),
    {
      connection: redisConnectionOptions(input.redisUrl),
      ...(input.concurrency === undefined ? {} : { concurrency: input.concurrency }),
    },
  );
  worker.on('error', (error: unknown) =>
    new StructuredLogger('worker-ai').log('error', 'runtime.failed', { error }),
  );
  return observeWorkerLifecycle(worker, 'worker-ai', input.probes);
}
