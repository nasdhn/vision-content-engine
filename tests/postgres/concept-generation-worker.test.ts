import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AIProviderGateway } from '../../packages/ai/src/index.js';
import type { ProviderRequest } from '../../packages/ai/src/index.js';
import { AIContentService } from '../../packages/application/src/index.js';
import type { CreatorOptions } from '../../packages/application/src/index.js';
import { CreatorInputSchema } from '../../packages/contracts/src/index.js';
import {
  ConceptGenerationRepository,
  InvocationRepository,
  Leases,
  Persistence,
} from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { ConceptGenerationWorkerOrchestrator } from '../../apps/worker-ai/src/concept-generation-worker.js';
import { FakeAIProvider, reply } from '../support/ai-provider.js';

import knowledgeFixture from '../fixtures/phase2/knowledge.json' with { type: 'json' };
import outputFixture from '../fixtures/phase2/creator-output.json' with { type: 'json' };

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: Awaited<ReturnType<typeof postgresFixture>>['client'];
let persistence: Persistence;

const human = {
  actorType: 'USER',
  actorId: 'concept-generation-worker-test',
} as const;

const leaseConfig = {
  durationMs: 60_000,
  heartbeatIntervalMs: 10_000,
} as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);
});

afterAll(async () => {
  await fixture?.close();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<
    {
      tablename: string;
    }[]
  >`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_prisma_migrations'
  `;

  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
});

function generated(request: ProviderRequest) {
  const input = CreatorInputSchema.parse(request.envelope.input);
  const output = structuredClone(outputFixture);

  output.concepts[0]!.selectedPatternVersionId = input.patternCandidates[0]!.patternVersionId;

  return output;
}

function application(provider: FakeAIProvider) {
  const gateway = new AIProviderGateway(new InvocationRepository(db), [provider], () => false);

  return new AIContentService(db, gateway);
}

async function setup(provider: FakeAIProvider) {
  const source = await persistence.transaction(human, (unit) =>
    unit.knowledge.createSource({
      sourceType: 'MANUAL_REFERENCE',
      title: 'Generation worker fixture evidence',
      metadataJson: {
        fixture: true,
      },
    }),
  );

  const rawKnowledge = structuredClone(knowledgeFixture);

  const {
    id: _id,
    key: _key,
    version: _version,
    contentHash: _contentHash,
    effectiveAt: _effectiveAt,
    ...payload
  } = rawKnowledge;

  void [_id, _key, _version, _contentHash, _effectiveAt];

  payload.claims.verified[0]!.sourceIds = [source.id];

  const knowledge = await persistence.transaction(human, async (unit) => {
    const snapshot = await unit.knowledge.createSnapshot(
      'concept-generation-worker-fixture',
      '2020-01-01T00:00:00Z',
      payload,
    );

    await unit.knowledge.activate(snapshot.id);

    return snapshot;
  });

  const brief = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({
      name: 'Generation worker fixture',
      slug: randomUUID(),
      objective: 'Test durable concept generation worker',
    });

    return unit.createBrief(campaign.id, 'Generation worker brief');
  });

  await db.brief.update({
    where: {
      id: brief.id,
    },
    data: {
      status: 'READY',
      goal: 'Generate useful Vision content',
      audience: 'B2B sales teams',
      notes: 'Keep examples fictional',
      priority: 7,
      topics: ['prospecting'],
      productAreas: ['lead-generation'],
      mustMention: ['Vision'],
      mustAvoid: ['guaranteed results'],
      preferredFormats: ['PROBLEM_SOLUTION'],
      targetPlatforms: ['INSTAGRAM'],
      targetContentCount: 1,
    },
  });

  const service = application(provider);
  await service.seedPatterns(human);

  const plan = {
    requestId: randomUUID(),
    briefId: brief.id,
    knowledgeSnapshotId: knowledge.id,
    ideaIds: [],
    generationConstraints: {
      requestedConceptCount: 1,
      targetPlatforms: ['INSTAGRAM'],
      allowedPrimaryFormats: ['PROBLEM_SOLUTION'],
      diversity: {},
      explorationPolicy: {
        mode: 'BALANCED',
      },
    },
    selection: {
      audience: 'B2B sales teams',
      useCase: 'Lead qualification',
      topic: 'Prospecting',
      angle: 'Manual to automated workflow',
      proofType: 'Product demonstration',
      productProof: true,
      humanPresence: true,
      externalEvidence: true,
      excludeIds: [],
    },
    selectionPolicy: {
      mode: 'BALANCED',
      seed: 'concept-generation-worker-fixture',
      limit: 3,
      explorationSlots: 1,
      fatiguePenalty: 1,
    },
    duration: {
      minDurationSec: 5,
      maxDurationSec: 60,
    },
    policy: {
      capability: 'CREATOR',
      maxAttempts: 1,
      timeoutMs: 30_000,
      fallbackPolicy: 'NONE',
      maxInputTokens: 100_000,
      maxOutputTokens: 2_000,
      maxEstimatedCost: 0.5,
    },
    budget: {
      key: 'concept-generation-worker-fixture',
      from: '2020-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      limit: '10',
      currency: 'EUR',
    },
  } as const;

  const repository = new ConceptGenerationRepository(db);

  const planned = await repository.plan(plan);

  return {
    brief,
    plan,
    planned,
    repository,
    service,
  };
}

function optionsFromRequest(
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

describe('ConceptGenerationWorkerOrchestrator', () => {
  it('claims a planned ai/AI job and reaches the human concept-review gate atomically', async () => {
    const provider = new FakeAIProvider(async (request) => reply(generated(request)));

    const setupResult = await setup(provider);

    const leases = new Leases(db, leaseConfig, { AI: 'SAFE_RETRY' });

    const worker = new ConceptGenerationWorkerOrchestrator(db, leases, setupResult.service, {
      heartbeatIntervalMs: 1_000,
    });

    const outcome = await worker.processOne('generation-worker-one');

    expect(outcome).toMatchObject({
      status: 'SUCCEEDED',
      jobAttemptId: setupResult.planned.jobAttemptId,
      workflowRunId: setupResult.planned.workflowRunId,
      briefId: setupResult.brief.id,
      recoveredFromCheckpoint: false,
    });

    expect(provider.calls).toHaveLength(1);

    expect(
      await db.jobAttempt.findUniqueOrThrow({
        where: {
          id: setupResult.planned.jobAttemptId,
        },
      }),
    ).toHaveProperty('status', 'SUCCEEDED');

    expect(
      await db.workflowRun.findUniqueOrThrow({
        where: {
          id: setupResult.planned.workflowRunId,
        },
      }),
    ).toMatchObject({
      status: 'WAITING',
      currentStep: 'concept_review',
    });

    expect(
      await db.brief.findUniqueOrThrow({
        where: { id: setupResult.brief.id },
      }),
    ).toHaveProperty('status', 'ACTIVE');

    expect(await db.conceptVersion.count()).toBe(1);

    expect(await worker.processOne('generation-worker-one')).toEqual({ status: 'IDLE' });
  });

  it('fails the workflow and restores the Brief to READY on terminal generation failure', async () => {
    const provider = new FakeAIProvider(async () => reply({ invalid: true }));

    const setupResult = await setup(provider);

    const leases = new Leases(db, leaseConfig, { AI: 'SAFE_RETRY' });

    const worker = new ConceptGenerationWorkerOrchestrator(db, leases, setupResult.service);

    const outcome = await worker.processOne('generation-worker-failure');

    expect(outcome.status).toBe('FAILED');

    expect(
      await db.jobAttempt.findUniqueOrThrow({
        where: {
          id: setupResult.planned.jobAttemptId,
        },
      }),
    ).toHaveProperty('status', 'FAILED');

    expect(
      await db.workflowRun.findUniqueOrThrow({
        where: {
          id: setupResult.planned.workflowRunId,
        },
      }),
    ).toMatchObject({
      status: 'FAILED',
      currentStep: 'generation_failed',
    });

    expect(
      await db.brief.findUniqueOrThrow({
        where: { id: setupResult.brief.id },
      }),
    ).toHaveProperty('status', 'READY');

    expect(await db.conceptVersion.count()).toBe(0);
  });

  it('recovers an expired ai/AI job from its durable checkpoint before touching the provider again', async () => {
    const firstProvider = new FakeAIProvider(async (request) => {
      const job = await db.jobAttempt.findFirstOrThrow({
        where: {
          queueName: 'ai',
          jobType: 'AI',
        },
      });

      await db.$executeRaw`
          UPDATE "JobAttempt"
          SET "leaseAcquiredAt" =
                '2000-01-01T00:00:00Z',
              "heartbeatAt" =
                '2000-01-01T00:00:01Z',
              "leaseExpiresAt" =
                '2000-01-01T00:00:02Z'
          WHERE id = ${job.id}::uuid
        `;

      return reply(generated(request));
    });

    const setupResult = await setup(firstProvider);

    const leases = new Leases(db, leaseConfig, { AI: 'SAFE_RETRY' });

    const crashedClaim = await leases.claimJob('ai', 'crashed-generation-worker');

    expect(crashedClaim?.id).toBe(setupResult.planned.jobAttemptId);

    const request = await setupResult.repository.requestForJob(setupResult.planned.jobAttemptId);

    await expect(
      setupResult.service.createConcepts(
        optionsFromRequest(request),
        request.policy,
        request.budget,
        {
          leases,
          jobId: setupResult.planned.jobAttemptId,
          leaseToken: crashedClaim!.leaseToken!,
        },
      ),
    ).rejects.toThrow('STALE_LEASE');

    expect(firstProvider.calls).toHaveLength(1);
    expect(await db.conceptVersion.count()).toBe(0);

    expect(
      await setupResult.repository.outputCheckpointForRequest(setupResult.plan.requestId),
    ).not.toBeNull();

    const costCountBefore = await db.costEntry.count();

    const invocationCountBefore = await db.modelInvocation.count();

    const recoveryProvider = new FakeAIProvider(async () => {
      throw new Error('RECOVERY_PROVIDER_MUST_NOT_RUN');
    });

    const worker = new ConceptGenerationWorkerOrchestrator(
      db,
      leases,
      application(recoveryProvider),
    );

    const outcome = await worker.processOne('recovery-generation-worker');

    expect(outcome).toMatchObject({
      status: 'SUCCEEDED',
      jobAttemptId: setupResult.planned.jobAttemptId,
      recoveredFromCheckpoint: true,
    });

    expect(recoveryProvider.calls).toHaveLength(0);

    expect(await db.costEntry.count()).toBe(costCountBefore);

    expect(await db.modelInvocation.count()).toBe(invocationCountBefore);

    expect(
      await db.modelInvocationAttempt.count({
        where: {
          modelInvocationId: setupResult.plan.requestId,
        },
      }),
    ).toBe(1);

    expect(await db.conceptVersion.count()).toBe(1);

    expect(
      await db.jobAttempt.findUniqueOrThrow({
        where: {
          id: setupResult.planned.jobAttemptId,
        },
      }),
    ).toHaveProperty('status', 'SUCCEEDED');

    expect(
      await db.workflowRun.findUniqueOrThrow({
        where: {
          id: setupResult.planned.workflowRunId,
        },
      }),
    ).toMatchObject({
      status: 'WAITING',
      currentStep: 'concept_review',
    });

    expect(
      await db.brief.findUniqueOrThrow({
        where: { id: setupResult.brief.id },
      }),
    ).toHaveProperty('status', 'ACTIVE');
  });
});
