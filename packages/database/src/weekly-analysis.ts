import { randomUUID } from 'node:crypto';

import {
  WEEKLY_ANALYSIS_JOB_TYPE,
  WEEKLY_ANALYSIS_OUTBOX_EVENT,
  WEEKLY_ANALYSIS_QUEUE_NAME,
  WeeklyAnalysisPlanSchema,
  WeeklyAnalysisRequestPayloadSchema,
  weeklyAnalysisOperationKeyFor,
} from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import { invariant, leaseConfig } from '@vision/domain';
import type { LeaseConfig } from '@vision/domain';

import type { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { Learning } from './learning.js';
import { audit, changed, databaseTime, emit, lock } from './transaction.js';

const systemActor = { actorType: 'SYSTEM', actorId: 'weekly-analysis-control' } as const;
const aiActor = { actorType: 'AI', actorId: 'weekly-analysis' } as const;

export const DEFAULT_WEEKLY_ANALYSIS_LEASE = Object.freeze({
  durationMs: 120_000,
  heartbeatIntervalMs: 30_000,
}) satisfies LeaseConfig;

function json(value: unknown): Prisma.InputJsonValue {
  contentHash(value);
  return structuredClone(value) as Prisma.InputJsonValue;
}

export class WeeklyAnalysisRepository {
  private readonly lease: LeaseConfig;

  constructor(
    private readonly db: PrismaClient,
    config: LeaseConfig = DEFAULT_WEEKLY_ANALYSIS_LEASE,
  ) {
    this.lease = leaseConfig(config);
  }

  async plan(rawInput: unknown) {
    const input = WeeklyAnalysisPlanSchema.parse(rawInput);
    const analysisOperationKey = weeklyAnalysisOperationKeyFor(input);

    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`weekly-analysis:${analysisOperationKey}`}, 0)
        )
      `;

      const existing = await tx.workflowRun.findFirst({
        where: {
          workflowType: 'WEEKLY_ANALYSIS',
          rootEntityType: 'WeeklyAnalysisOperation',
          rootEntityId: analysisOperationKey,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        include: {
          jobAttempts: {
            where: { jobType: WEEKLY_ANALYSIS_JOB_TYPE },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
        },
      });

      if (existing) {
        const job = existing.jobAttempts[0];
        invariant(job, 'WEEKLY_ANALYSIS_JOB_MISSING');
        return {
          kind: 'EXISTING',
          analysisOperationKey,
          workflowRunId: existing.id,
          jobAttemptId: job.id,
          operationId: job.operationId,
        } as const;
      }

      const knowledge = await tx.knowledgeSnapshot.findUniqueOrThrow({
        where: { id: input.knowledgeSnapshot.id },
      });
      invariant(knowledge.status === 'ACTIVE', 'WEEKLY_ANALYSIS_KNOWLEDGE_NOT_ACTIVE');
      invariant(
        knowledge.version === input.knowledgeSnapshot.version &&
          knowledge.contentHash === input.knowledgeSnapshot.contentHash,
        'WEEKLY_ANALYSIS_KNOWLEDGE_MISMATCH',
      );

      const now = await databaseTime(tx);
      const workflow = await tx.workflowRun.create({
        data: {
          workflowType: 'WEEKLY_ANALYSIS',
          rootEntityType: 'WeeklyAnalysisOperation',
          rootEntityId: analysisOperationKey,
          status: 'PENDING',
          currentStep: 'window_frozen',
        },
      });

      const operationId = randomUUID();
      const job = await tx.jobAttempt.create({
        data: {
          workflowRunId: workflow.id,
          queueName: WEEKLY_ANALYSIS_QUEUE_NAME,
          jobType: WEEKLY_ANALYSIS_JOB_TYPE,
          operationId,
          attemptNumber: 1,
          status: 'QUEUED',
        },
      });

      const payload = WeeklyAnalysisRequestPayloadSchema.parse({
        schemaVersion: 'v1',
        kind: WEEKLY_ANALYSIS_JOB_TYPE,
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        operationId,
        analysisOperationKey,
        ...input,
      });

      await emit(tx, {
        eventType: WEEKLY_ANALYSIS_OUTBOX_EVENT,
        aggregateType: 'JobAttempt',
        aggregateId: job.id,
        payloadJson: json(payload),
        availableAt: now,
      });

      await changed(
        tx,
        systemActor,
        'WorkflowRun.weekly_analysis_planned',
        'WorkflowRun',
        workflow.id,
      );
      await audit(tx, systemActor, 'WeeklyAnalysis.window_frozen', 'WorkflowRun', workflow.id);

      return {
        kind: 'PLANNED',
        analysisOperationKey,
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        operationId,
      } as const;
    });
  }

  async claim(jobAttemptId: string, workerId: string) {
    invariant(workerId.trim(), 'OWNER_REQUIRED');

    return this.db.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', jobAttemptId, 'WEEKLY_ANALYSIS_JOB_NOT_FOUND');
      const job = await tx.jobAttempt.findUniqueOrThrow({
        where: { id: jobAttemptId },
        include: { workflowRun: true },
      });

      invariant(
        job.queueName === WEEKLY_ANALYSIS_QUEUE_NAME && job.jobType === WEEKLY_ANALYSIS_JOB_TYPE,
        'WEEKLY_ANALYSIS_JOB_REQUIRED',
      );
      invariant(
        job.workflowRun?.workflowType === 'WEEKLY_ANALYSIS' &&
          job.workflowRun.rootEntityType === 'WeeklyAnalysisOperation',
        'WEEKLY_ANALYSIS_WORKFLOW_REQUIRED',
      );

      if (job.status === 'SUCCEEDED' && job.workflowRun.status === 'SUCCEEDED') {
        return { kind: 'ALREADY_DONE', jobAttemptId } as const;
      }
      if (job.status === 'FAILED' || job.status === 'CANCELLED') {
        return { kind: 'TERMINAL', jobAttemptId, status: job.status } as const;
      }

      const now = await databaseTime(tx);
      if (
        job.status === 'RUNNING' &&
        job.leaseExpiresAt !== null &&
        job.leaseExpiresAt.getTime() > now.getTime()
      ) {
        return { kind: 'BUSY', jobAttemptId } as const;
      }

      invariant(
        job.status === 'QUEUED' || job.status === 'RUNNING',
        'WEEKLY_ANALYSIS_JOB_NOT_RUNNABLE',
      );
      const recovered = job.status === 'RUNNING';

      const event = await tx.outboxEvent.findFirstOrThrow({
        where: {
          eventType: WEEKLY_ANALYSIS_OUTBOX_EVENT,
          aggregateType: 'JobAttempt',
          aggregateId: job.id,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      const payload = WeeklyAnalysisRequestPayloadSchema.parse(event.payloadJson);

      invariant(payload.workflowRunId === job.workflowRun.id, 'WEEKLY_ANALYSIS_WORKFLOW_MISMATCH');
      invariant(payload.jobAttemptId === job.id, 'WEEKLY_ANALYSIS_JOB_MISMATCH');
      invariant(payload.operationId === job.operationId, 'WEEKLY_ANALYSIS_OPERATION_MISMATCH');
      invariant(
        payload.analysisOperationKey === job.workflowRun.rootEntityId,
        'WEEKLY_ANALYSIS_KEY_MISMATCH',
      );

      const leaseToken = randomUUID();
      await tx.jobAttempt.update({
        where: { id: job.id },
        data: {
          status: 'RUNNING',
          workerId,
          leaseToken,
          leaseAcquiredAt: now,
          heartbeatAt: now,
          leaseExpiresAt: new Date(now.getTime() + this.lease.durationMs),
          startedAt: job.startedAt ?? now,
        },
      });
      await tx.workflowRun.update({
        where: { id: job.workflowRun.id },
        data: {
          status: 'RUNNING',
          currentStep: 'collect_evidence',
          startedAt: job.workflowRun.startedAt ?? now,
        },
      });

      await audit(
        tx,
        { actorType: 'WORKER', actorId: workerId },
        recovered ? 'JobAttempt.recovered' : 'JobAttempt.claimed',
        'JobAttempt',
        job.id,
      );

      return { kind: 'READY', recovered, leaseToken, payload } as const;
    });
  }

  async heartbeat(jobAttemptId: string, leaseToken: string) {
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', jobAttemptId, 'STALE_LEASE');
      const updated = await tx.$executeRaw`
        WITH t AS MATERIALIZED (
          SELECT clock_timestamp()::timestamptz(3) AS now
        )
        UPDATE "JobAttempt"
        SET "heartbeatAt" = t.now,
            "leaseExpiresAt" =
              t.now + ${this.lease.durationMs}::double precision * interval '1 millisecond'
        FROM t
        WHERE "id" = ${jobAttemptId}::uuid
          AND "status" = 'RUNNING'
          AND "leaseToken" = ${leaseToken}::uuid
          AND "leaseExpiresAt" > t.now
      `;
      invariant(updated === 1, 'STALE_LEASE');
    });
  }

  async readOutputCheckpoint(modelInvocationId: string) {
    const event = await this.db.auditEvent.findFirst({
      where: {
        action: 'ModelInvocation.output_checkpointed',
        subjectType: 'ModelInvocation',
        subjectId: modelInvocationId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return event?.afterJson ?? null;
  }

  async fail(
    jobAttemptId: string,
    leaseToken: string,
    failureCode: string,
    failureMessage?: string,
  ) {
    invariant(failureCode.trim(), 'FAILURE_CODE_REQUIRED');

    return this.db.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', jobAttemptId, 'STALE_LEASE');
      const owners = await tx.$queryRaw<{ workerId: string; workflowRunId: string | null }[]>`
        SELECT "workerId", "workflowRunId"
        FROM "JobAttempt"
        WHERE "id" = ${jobAttemptId}::uuid
          AND "status" = 'RUNNING'
          AND "leaseToken" = ${leaseToken}::uuid
          AND "leaseExpiresAt" > clock_timestamp()
      `;
      const owner = owners[0];
      invariant(owner?.workerId && owner.workflowRunId, 'STALE_LEASE');
      const now = await databaseTime(tx);

      const job = await tx.jobAttempt.update({
        where: { id: jobAttemptId },
        data: {
          status: 'FAILED',
          finishedAt: now,
          failureCode,
          ...(failureMessage ? { failureMessage: failureMessage.slice(0, 2_000) } : {}),
        },
      });
      await tx.workflowRun.update({
        where: { id: owner.workflowRunId },
        data: { status: 'FAILED', currentStep: 'failed', finishedAt: now },
      });

      const workerActor = { actorType: 'WORKER', actorId: owner.workerId } as const;
      await changed(tx, workerActor, 'JobAttempt.failed', 'JobAttempt', job.id);
      await changed(tx, workerActor, 'WorkflowRun.failed', 'WorkflowRun', owner.workflowRunId);
      return job;
    });
  }

  async complete(jobAttemptId: string, leaseToken: string, persistenceInput: unknown) {
    return this.db.$transaction(async (tx) => {
      await lock(tx, 'JobAttempt', jobAttemptId, 'STALE_LEASE');
      const owners = await tx.$queryRaw<{ workerId: string; workflowRunId: string | null }[]>`
        SELECT "workerId", "workflowRunId"
        FROM "JobAttempt"
        WHERE "id" = ${jobAttemptId}::uuid
          AND "status" = 'RUNNING'
          AND "leaseToken" = ${leaseToken}::uuid
          AND "leaseExpiresAt" > clock_timestamp()
      `;
      const owner = owners[0];
      invariant(owner?.workerId && owner.workflowRunId, 'STALE_LEASE');

      const workflow = await tx.workflowRun.findUniqueOrThrow({
        where: { id: owner.workflowRunId },
      });
      invariant(
        workflow.workflowType === 'WEEKLY_ANALYSIS' &&
          workflow.rootEntityType === 'WeeklyAnalysisOperation' &&
          workflow.status === 'RUNNING',
        'WEEKLY_ANALYSIS_WORKFLOW_REQUIRED',
      );

      const durable = await new Learning(tx, aiActor).persistValidatedAnalystOutput(
        persistenceInput,
      );
      const now = await databaseTime(tx);

      const job = await tx.jobAttempt.update({
        where: { id: jobAttemptId },
        data: { status: 'SUCCEEDED', finishedAt: now },
      });
      await tx.workflowRun.update({
        where: { id: workflow.id },
        data: { status: 'SUCCEEDED', currentStep: 'complete', finishedAt: now },
      });

      const workerActor = { actorType: 'WORKER', actorId: owner.workerId } as const;
      await changed(tx, workerActor, 'JobAttempt.succeeded', 'JobAttempt', job.id);
      await changed(tx, workerActor, 'WorkflowRun.succeeded', 'WorkflowRun', workflow.id);

      return {
        kind: 'SUCCEEDED',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        insightIds: durable.insights.map((row) => row.id),
        recommendationIds: durable.recommendations.map((row) => row.id),
      } as const;
    });
  }
}
