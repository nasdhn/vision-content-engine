import {
  CONCEPT_GENERATION_JOB_TYPE,
  CONCEPT_GENERATION_QUEUE_NAME,
  CONCEPT_GENERATION_REQUEST_BOUND_ACTION,
  ConceptGenerationOutputCheckpointSchema,
  ConceptGenerationPlanSchema,
  ConceptGenerationRequestPayloadSchema,
} from '@vision/contracts';
import { assertNoSecrets, contentHash } from '@vision/contracts/canonical';
import { invariant } from '@vision/domain';

import type { PrismaClient, Prisma } from './generated/prisma/client.js';
import { changed, lock } from './transaction.js';
import { Versions } from './versions.js';

const systemActor = {
  actorType: 'SYSTEM',
  actorId: 'concept-generation-control',
} as const;

function json(value: unknown): Prisma.InputJsonValue {
  assertNoSecrets(value);
  contentHash(value);

  return structuredClone(value) as Prisma.InputJsonValue;
}

function persistedPlan(payload: ReturnType<typeof ConceptGenerationRequestPayloadSchema.parse>) {
  const {
    schemaVersion: _schemaVersion,
    kind: _kind,
    workflowRunId: _workflowRunId,
    jobAttemptId: _jobAttemptId,
    briefVersionId: _briefVersionId,
    ...plan
  } = payload;

  void [_schemaVersion, _kind, _workflowRunId, _jobAttemptId, _briefVersionId];

  return plan;
}

export class ConceptGenerationRepository {
  constructor(private readonly db: PrismaClient) {}

  async plan(rawInput: unknown) {
    const input = ConceptGenerationPlanSchema.parse(rawInput);

    assertNoSecrets(input);

    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`concept-generation-request:${input.requestId}`},
            0
          )
        )
      `;

      const existingJob = await tx.jobAttempt.findUnique({
        where: {
          operationId_attemptNumber_jobType: {
            operationId: input.requestId,
            attemptNumber: 1,
            jobType: CONCEPT_GENERATION_JOB_TYPE,
          },
        },
        include: {
          workflowRun: true,
        },
      });

      if (existingJob) {
        invariant(
          existingJob.queueName === CONCEPT_GENERATION_QUEUE_NAME,
          'CONCEPT_GENERATION_JOB_QUEUE_CONFLICT',
        );

        invariant(
          existingJob.workflowRun?.workflowType === 'CONCEPT_GENERATION' &&
            existingJob.workflowRun.rootEntityType === 'Brief',
          'CONCEPT_GENERATION_WORKFLOW_CONFLICT',
        );

        const bindings = await tx.auditEvent.findMany({
          where: {
            action: CONCEPT_GENERATION_REQUEST_BOUND_ACTION,
            subjectType: 'JobAttempt',
            subjectId: existingJob.id,
          },
          orderBy: [
            {
              createdAt: 'asc',
            },
            {
              id: 'asc',
            },
          ],
        });

        invariant(bindings.length === 1, 'CONCEPT_GENERATION_REQUEST_BINDING_INVALID');

        const payload = ConceptGenerationRequestPayloadSchema.parse(bindings[0]!.afterJson);

        invariant(
          payload.jobAttemptId === existingJob.id &&
            payload.workflowRunId === existingJob.workflowRun.id &&
            payload.requestId === existingJob.operationId &&
            payload.briefId === existingJob.workflowRun.rootEntityId &&
            bindings[0]!.subjectVersionId === payload.briefVersionId,
          'CONCEPT_GENERATION_REQUEST_BINDING_INVALID',
        );

        invariant(
          contentHash(persistedPlan(payload)) === contentHash(input),
          'CONCEPT_GENERATION_REQUEST_CONFLICT',
        );

        return {
          kind: 'EXISTING',
          workflowRunId: payload.workflowRunId,
          jobAttemptId: payload.jobAttemptId,
          operationId: payload.requestId,
          briefVersionId: payload.briefVersionId,
        } as const;
      }

      await lock(tx, 'Brief', input.briefId, 'CONCEPT_GENERATION_BRIEF_NOT_FOUND');

      const brief = await tx.brief.findUniqueOrThrow({
        where: {
          id: input.briefId,
        },
      });

      invariant(
        brief.status === 'READY' || brief.status === 'ACTIVE',
        'CONCEPT_GENERATION_BRIEF_NOT_READY',
      );

      const knowledge = await tx.knowledgeSnapshot.findUniqueOrThrow({
        where: {
          id: input.knowledgeSnapshotId,
        },
      });

      invariant(knowledge.status === 'ACTIVE', 'CONCEPT_GENERATION_KNOWLEDGE_NOT_ACTIVE');

      if (input.ideaIds.length > 0) {
        const ideas = await tx.idea.findMany({
          where: {
            id: {
              in: input.ideaIds,
            },
            status: 'ACTIVE',
            OR: [
              {
                briefId: brief.id,
              },
              {
                briefId: null,
              },
            ],
          },
          select: {
            id: true,
          },
        });

        invariant(ideas.length === input.ideaIds.length, 'CONCEPT_GENERATION_IDEA_NOT_ELIGIBLE');
      }

      const briefVersion = await new Versions(tx, systemActor).briefVersion({
        briefId: brief.id,
        createdBy: systemActor.actorId,
        payloadJson: json({
          title: brief.title,
          goal: brief.goal,
          audience: brief.audience,
          notes: brief.notes,
          priority: brief.priority,
          topics: brief.topics,
          productAreas: brief.productAreas,
          mustMention: brief.mustMention,
          mustAvoid: brief.mustAvoid,
          preferredFormats: brief.preferredFormats,
          targetPlatforms: brief.targetPlatforms,
          targetContentCount: brief.targetContentCount,
        }),
      });

      const workflow = await tx.workflowRun.create({
        data: {
          workflowType: 'CONCEPT_GENERATION',
          rootEntityType: 'Brief',
          rootEntityId: brief.id,
          status: 'PENDING',
          currentStep: 'request_frozen',
        },
      });

      const job = await tx.jobAttempt.create({
        data: {
          workflowRunId: workflow.id,
          queueName: CONCEPT_GENERATION_QUEUE_NAME,
          jobType: CONCEPT_GENERATION_JOB_TYPE,
          operationId: input.requestId,
          attemptNumber: 1,
          status: 'QUEUED',
        },
      });

      const payload = ConceptGenerationRequestPayloadSchema.parse({
        schemaVersion: 'v1',
        kind: 'CONCEPT_GENERATION',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        briefVersionId: briefVersion.id,
        ...input,
      });

      await tx.auditEvent.create({
        data: {
          ...systemActor,
          action: CONCEPT_GENERATION_REQUEST_BOUND_ACTION,
          subjectType: 'JobAttempt',
          subjectId: job.id,
          subjectVersionId: briefVersion.id,
          afterJson: json(payload),
        },
      });

      await tx.brief.update({
        where: {
          id: brief.id,
        },
        data: {
          status: 'GENERATING',
        },
      });

      await changed(
        tx,
        systemActor,
        'WorkflowRun.concept_generation_planned',
        'WorkflowRun',
        workflow.id,
      );

      await changed(tx, systemActor, 'JobAttempt.queued', 'JobAttempt', job.id);

      await changed(tx, systemActor, 'Brief.generating', 'Brief', brief.id, briefVersion.id);

      return {
        kind: 'PLANNED',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        operationId: input.requestId,
        briefVersionId: briefVersion.id,
      } as const;
    });
  }

  async outputCheckpointForRequest(requestId: string) {
    const events = await this.db.auditEvent.findMany({
      where: {
        action: 'ModelInvocation.output_checkpointed',
        subjectType: 'ModelInvocation',
        subjectId: requestId,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    invariant(events.length <= 1, 'CONCEPT_GENERATION_CHECKPOINT_CONFLICT');

    const event = events[0];

    if (!event) {
      return null;
    }

    const checkpoint = ConceptGenerationOutputCheckpointSchema.parse(event.afterJson);

    invariant(
      checkpoint.metadata.requestId === requestId,
      'CONCEPT_GENERATION_CHECKPOINT_REQUEST_MISMATCH',
    );

    invariant(
      contentHash(checkpoint.output) === checkpoint.outputHash,
      'CONCEPT_GENERATION_CHECKPOINT_OUTPUT_MISMATCH',
    );

    invariant(
      contentHash(checkpoint.metadata) === checkpoint.metadataHash,
      'CONCEPT_GENERATION_CHECKPOINT_METADATA_MISMATCH',
    );

    return checkpoint;
  }

  async requestForJob(jobAttemptId: string) {
    const job = await this.db.jobAttempt.findUniqueOrThrow({
      where: {
        id: jobAttemptId,
      },
      include: {
        workflowRun: true,
      },
    });

    invariant(
      job.queueName === CONCEPT_GENERATION_QUEUE_NAME &&
        job.jobType === CONCEPT_GENERATION_JOB_TYPE,
      'CONCEPT_GENERATION_JOB_REQUIRED',
    );

    invariant(
      job.workflowRun?.workflowType === 'CONCEPT_GENERATION' &&
        job.workflowRun.rootEntityType === 'Brief',
      'CONCEPT_GENERATION_WORKFLOW_REQUIRED',
    );

    const bindings = await this.db.auditEvent.findMany({
      where: {
        action: CONCEPT_GENERATION_REQUEST_BOUND_ACTION,
        subjectType: 'JobAttempt',
        subjectId: job.id,
      },
      orderBy: [
        {
          createdAt: 'asc',
        },
        {
          id: 'asc',
        },
      ],
    });

    invariant(bindings.length === 1, 'CONCEPT_GENERATION_REQUEST_BINDING_INVALID');

    const payload = ConceptGenerationRequestPayloadSchema.parse(bindings[0]!.afterJson);

    invariant(
      payload.jobAttemptId === job.id &&
        payload.workflowRunId === job.workflowRun.id &&
        payload.requestId === job.operationId &&
        payload.briefId === job.workflowRun.rootEntityId &&
        bindings[0]!.subjectVersionId === payload.briefVersionId,
      'CONCEPT_GENERATION_REQUEST_BINDING_INVALID',
    );

    return payload;
  }
}
