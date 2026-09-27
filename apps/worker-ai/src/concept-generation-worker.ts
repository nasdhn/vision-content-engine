import type { AIContentService, CreatorOptions } from '@vision/application';
import { ConceptGenerationRepository, Persistence } from '@vision/database';
import type { Leases, PrismaClient, UnitOfWork } from '@vision/database';
import { DomainError, invariant } from '@vision/domain';
import { StructuredLogger, observeOperation } from '@vision/observability';

export type ConceptGenerationWorkerOutcome =
  | { status: 'IDLE' }
  | { status: 'PAUSED' }
  | {
      status: 'SUCCEEDED';
      jobAttemptId: string;
      workflowRunId: string;
      briefId: string;
      recoveredFromCheckpoint: boolean;
    }
  | {
      status: 'FAILED';
      jobAttemptId: string;
      workflowRunId: string;
      briefId: string;
      failureCode: string;
    };

export type ConceptGenerationWorkerOptions = Readonly<{
  heartbeatIntervalMs?: number;
  paused?: () => boolean;
}>;

type ClaimedAIJob = NonNullable<Awaited<ReturnType<Leases['claimJob']>>> & {
  leaseToken: string;
  workflowRunId: string;
};

function failureCode(error: unknown) {
  if (error instanceof DomainError) return error.code;

  if (error instanceof Error && /^[A-Z][A-Z0-9_:-]+$/.test(error.message)) {
    return error.message;
  }

  return 'CONCEPT_GENERATION_WORKER_FAILED';
}

function staleLease(error: unknown) {
  return (
    (error instanceof DomainError && error.code === 'STALE_LEASE') ||
    (error instanceof Error && error.message === 'STALE_LEASE')
  );
}

function creatorOptions(
  request: Awaited<ReturnType<ConceptGenerationRepository['requestForJob']>>,
): CreatorOptions {
  return {
    requestId: request.requestId,
    knowledgeSnapshotId: request.knowledgeSnapshotId,
    briefVersionId: request.briefVersionId,
    ideaIds: request.ideaIds,
    generationConstraints: request.generationConstraints,
    selection: {
      ...request.selection,
      formats: request.generationConstraints.allowedPrimaryFormats,
      platforms: request.generationConstraints.targetPlatforms,
      recent: [],
    },
    selectionPolicy: request.selectionPolicy,
    duration: request.duration,
  };
}

export class ConceptGenerationWorkerOrchestrator {
  private readonly repository: ConceptGenerationRepository;
  private readonly persistence: Persistence;
  private readonly heartbeatIntervalMs: number;
  private readonly paused: () => boolean;

  constructor(
    private readonly db: PrismaClient,
    private readonly leases: Leases,
    private readonly service: AIContentService,
    options: ConceptGenerationWorkerOptions = {},
  ) {
    this.repository = new ConceptGenerationRepository(db);
    this.persistence = new Persistence(db);
    this.heartbeatIntervalMs = options.heartbeatIntervalMs ?? 10_000;
    this.paused = options.paused ?? (() => false);

    invariant(
      Number.isSafeInteger(this.heartbeatIntervalMs) && this.heartbeatIntervalMs > 0,
      'INVALID_HEARTBEAT_INTERVAL',
    );
  }

  async processOne(workerId: string): Promise<ConceptGenerationWorkerOutcome> {
    invariant(workerId.trim().length > 0, 'OWNER_REQUIRED');

    if (this.paused()) {
      return { status: 'PAUSED' };
    }

    const claimed = await this.leases.claimJob('ai', workerId);

    if (!claimed) {
      return { status: 'IDLE' };
    }

    invariant(claimed.queueName === 'ai', 'CONCEPT_GENERATION_JOB_QUEUE_MISMATCH');
    invariant(claimed.jobType === 'AI', 'CONCEPT_GENERATION_JOB_TYPE_MISMATCH');
    invariant(claimed.workflowRunId, 'CONCEPT_GENERATION_WORKFLOW_REQUIRED');
    invariant(claimed.leaseToken, 'STALE_LEASE');

    const job = claimed as ClaimedAIJob;

    return observeOperation(
      new StructuredLogger('worker-ai'),
      {
        operationId: job.operationId,
        workflowRunId: job.workflowRunId,
        jobAttemptId: job.id,
      },
      () => this.processJob(job, workerId),
    );
  }

  private async processJob(
    job: ClaimedAIJob,
    workerId: string,
  ): Promise<ConceptGenerationWorkerOutcome> {
    const workflow = await this.db.workflowRun.findUniqueOrThrow({
      where: { id: job.workflowRunId },
    });

    invariant(
      workflow.workflowType === 'CONCEPT_GENERATION' && workflow.rootEntityType === 'Brief',
      'CONCEPT_GENERATION_WORKFLOW_REQUIRED',
    );

    const briefId = workflow.rootEntityId;

    if (workflow.status === 'PENDING') {
      await this.persistence.transaction(
        {
          actorType: 'WORKER',
          actorId: workerId,
        },
        (unit) => unit.transitionWorkflow(workflow.id, 'PENDING', 'RUNNING', 'generating'),
      );
    } else {
      invariant(workflow.status === 'RUNNING', 'CONCEPT_GENERATION_WORKFLOW_NOT_RUNNABLE');
    }

    let heartbeatFailure: unknown = null;

    await this.leases.heartbeatJob(job.id, job.leaseToken);

    const timer = setInterval(() => {
      void this.leases.heartbeatJob(job.id, job.leaseToken).catch((error: unknown) => {
        heartbeatFailure ??= error;
      });
    }, this.heartbeatIntervalMs);

    timer.unref?.();

    try {
      const request = await this.repository.requestForJob(job.id);

      invariant(
        request.workflowRunId === job.workflowRunId &&
          request.requestId === job.operationId &&
          request.briefId === briefId,
        'CONCEPT_GENERATION_REQUEST_BINDING_INVALID',
      );

      const options = creatorOptions(request);

      const onSuccess = async (unit: UnitOfWork) => {
        await unit.transitionWorkflow(job.workflowRunId, 'RUNNING', 'WAITING', 'concept_review');
        await unit.transitionBrief(briefId, 'GENERATING', 'ACTIVE');
      };

      const checkpoint = await this.repository.outputCheckpointForRequest(job.operationId);

      if (heartbeatFailure) {
        throw heartbeatFailure;
      }

      if (checkpoint) {
        await this.service.applyCreatorCheckpoint(options, checkpoint, {
          leases: this.leases,
          jobId: job.id,
          leaseToken: job.leaseToken,
          onSuccess,
        });

        return {
          status: 'SUCCEEDED',
          jobAttemptId: job.id,
          workflowRunId: job.workflowRunId,
          briefId,
          recoveredFromCheckpoint: true,
        };
      }

      const existingInvocation = await this.db.modelInvocation.findUnique({
        where: { id: job.operationId },
        select: { status: true },
      });

      if (existingInvocation) {
        throw new DomainError(
          existingInvocation.status === 'RUNNING'
            ? 'CONCEPT_GENERATION_INVOCATION_RECOVERY_UNAVAILABLE'
            : 'CONCEPT_GENERATION_CHECKPOINT_MISSING',
        );
      }

      await this.service.createConcepts(options, request.policy, request.budget, {
        leases: this.leases,
        jobId: job.id,
        leaseToken: job.leaseToken,
        onSuccess,
      });

      return {
        status: 'SUCCEEDED',
        jobAttemptId: job.id,
        workflowRunId: job.workflowRunId,
        briefId,
        recoveredFromCheckpoint: false,
      };
    } catch (error) {
      if (staleLease(error)) throw error;

      const code = failureCode(error);

      try {
        await this.leases.finishJob(job.id, job.leaseToken, 'FAILED', code, async (unit) => {
          await unit.transitionWorkflow(
            job.workflowRunId,
            'RUNNING',
            'FAILED',
            'generation_failed',
          );
          await unit.transitionBrief(briefId, 'GENERATING', 'READY');
        });
      } catch (finishError) {
        if (staleLease(finishError)) {
          throw finishError;
        }
        throw error;
      }

      return {
        status: 'FAILED',
        jobAttemptId: job.id,
        workflowRunId: job.workflowRunId,
        briefId,
        failureCode: code,
      };
    } finally {
      clearInterval(timer);
    }
  }
}
