import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ConceptGenerationRepository, Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';

import knowledgeFixture from '../fixtures/phase2/knowledge.json' with { type: 'json' };

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: Awaited<ReturnType<typeof postgresFixture>>['client'];
let persistence: Persistence;
let repository: ConceptGenerationRepository;

const human = {
  actorType: 'USER',
  actorId: 'concept-generation-test',
} as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);
  repository = new ConceptGenerationRepository(db);
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

async function setup() {
  const source = await persistence.transaction(human, (unit) =>
    unit.knowledge.createSource({
      sourceType: 'MANUAL_REFERENCE',
      title: 'Concept generation fixture evidence',
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
      'concept-generation-fixture',
      '2020-01-01T00:00:00Z',
      payload,
    );

    await unit.knowledge.activate(snapshot.id);

    return snapshot;
  });

  const brief = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({
      name: 'Concept generation fixture',
      slug: randomUUID(),
      objective: 'Test durable generation planning',
    });

    return unit.createBrief(campaign.id, 'Original brief title');
  });

  await db.brief.update({
    where: {
      id: brief.id,
    },
    data: {
      status: 'READY',
      goal: 'Generate useful Vision content',
      audience: 'B2B sales teams',
      notes: 'Keep the demonstration fictional',
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
      seed: 'concept-generation-fixture',
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
      preferredProvider: 'groq',
      preferredModel: 'openai/gpt-oss-120b',
      reasoningLevel: 'low',
      maxAttempts: 1,
      timeoutMs: 30_000,
      fallbackPolicy: 'NONE',
      maxInputTokens: 20_000,
      maxOutputTokens: 1_024,
      maxEstimatedCost: 0.01,
    },
    budget: {
      key: 'concept-generation-fixture',
      from: '2020-01-01T00:00:00.000Z',
      to: '2100-01-01T00:00:00.000Z',
      limit: '0.01000000',
      currency: 'USD',
    },
  } as const;

  return {
    brief,
    knowledge,
    plan,
  };
}

describe('ConceptGenerationRepository', () => {
  it('atomically freezes the brief and plans one durable ai/AI job', async () => {
    const setupResult = await setup();

    const result = await repository.plan(setupResult.plan);

    expect(result.kind).toBe('PLANNED');

    const brief = await db.brief.findUniqueOrThrow({
      where: {
        id: setupResult.brief.id,
      },
    });

    expect(brief.status).toBe('GENERATING');

    const versions = await db.briefVersion.findMany({
      where: {
        briefId: brief.id,
      },
      orderBy: {
        version: 'asc',
      },
    });

    expect(versions).toHaveLength(1);

    expect(versions[0]).toMatchObject({
      id: result.briefVersionId,
      briefId: brief.id,
      version: 1,
      createdBy: 'concept-generation-control',
    });

    expect(versions[0]!.payloadJson).toMatchObject({
      title: 'Original brief title',
      goal: 'Generate useful Vision content',
      audience: 'B2B sales teams',
      notes: 'Keep the demonstration fictional',
      priority: 7,
      targetContentCount: 1,
    });

    const workflow = await db.workflowRun.findUniqueOrThrow({
      where: {
        id: result.workflowRunId,
      },
    });

    expect(workflow).toMatchObject({
      workflowType: 'CONCEPT_GENERATION',
      rootEntityType: 'Brief',
      rootEntityId: brief.id,
      status: 'PENDING',
      currentStep: 'request_frozen',
    });

    const job = await db.jobAttempt.findUniqueOrThrow({
      where: {
        id: result.jobAttemptId,
      },
    });

    expect(job).toMatchObject({
      workflowRunId: workflow.id,
      queueName: 'ai',
      jobType: 'AI',
      operationId: setupResult.plan.requestId,
      attemptNumber: 1,
      status: 'QUEUED',
    });

    const restored = await repository.requestForJob(job.id);

    expect(restored).toMatchObject({
      schemaVersion: 'v1',
      kind: 'CONCEPT_GENERATION',
      workflowRunId: workflow.id,
      jobAttemptId: job.id,
      requestId: setupResult.plan.requestId,
      briefId: brief.id,
      briefVersionId: versions[0]!.id,
      knowledgeSnapshotId: setupResult.knowledge.id,
      policy: setupResult.plan.policy,
      budget: setupResult.plan.budget,
    });
  });

  it('keeps the BriefVersion immutable when the mutable Brief changes later', async () => {
    const setupResult = await setup();

    const result = await repository.plan(setupResult.plan);

    await db.brief.update({
      where: {
        id: setupResult.brief.id,
      },
      data: {
        title: 'Changed after planning',
        goal: 'Changed after planning',
        notes: 'Changed after planning',
        priority: 999,
      },
    });

    const version = await db.briefVersion.findUniqueOrThrow({
      where: {
        id: result.briefVersionId,
      },
    });

    expect(version.payloadJson).toMatchObject({
      title: 'Original brief title',
      goal: 'Generate useful Vision content',
      notes: 'Keep the demonstration fictional',
      priority: 7,
    });
  });

  it('returns EXISTING for the exact same request without duplicating durable state', async () => {
    const setupResult = await setup();

    const first = await repository.plan(setupResult.plan);

    const second = await repository.plan(structuredClone(setupResult.plan));

    expect(first.kind).toBe('PLANNED');
    expect(second).toEqual({
      kind: 'EXISTING',
      workflowRunId: first.workflowRunId,
      jobAttemptId: first.jobAttemptId,
      operationId: first.operationId,
      briefVersionId: first.briefVersionId,
    });

    expect(
      await db.briefVersion.count({
        where: {
          briefId: setupResult.brief.id,
        },
      }),
    ).toBe(1);

    expect(
      await db.workflowRun.count({
        where: {
          workflowType: 'CONCEPT_GENERATION',
          rootEntityType: 'Brief',
          rootEntityId: setupResult.brief.id,
        },
      }),
    ).toBe(1);

    expect(
      await db.jobAttempt.count({
        where: {
          operationId: setupResult.plan.requestId,
          jobType: 'AI',
        },
      }),
    ).toBe(1);
  });

  it('rejects reuse of requestId with different request content', async () => {
    const setupResult = await setup();

    await repository.plan(setupResult.plan);

    await expect(
      repository.plan({
        ...setupResult.plan,
        selection: {
          ...setupResult.plan.selection,
          angle: 'A conflicting angle',
        },
      }),
    ).rejects.toThrow('CONCEPT_GENERATION_REQUEST_CONFLICT');

    expect(
      await db.briefVersion.count({
        where: {
          briefId: setupResult.brief.id,
        },
      }),
    ).toBe(1);

    expect(
      await db.workflowRun.count({
        where: {
          workflowType: 'CONCEPT_GENERATION',
        },
      }),
    ).toBe(1);

    expect(
      await db.jobAttempt.count({
        where: {
          jobType: 'AI',
        },
      }),
    ).toBe(1);
  });

  it('serializes concurrent identical requests to one durable plan', async () => {
    const setupResult = await setup();

    const outcomes = await Promise.all([
      repository.plan(structuredClone(setupResult.plan)),
      repository.plan(structuredClone(setupResult.plan)),
    ]);

    expect(outcomes.map((outcome) => outcome.kind).sort()).toEqual(['EXISTING', 'PLANNED']);

    expect(new Set(outcomes.map((outcome) => outcome.workflowRunId)).size).toBe(1);

    expect(new Set(outcomes.map((outcome) => outcome.jobAttemptId)).size).toBe(1);

    expect(new Set(outcomes.map((outcome) => outcome.briefVersionId)).size).toBe(1);

    expect(
      await db.briefVersion.count({
        where: {
          briefId: setupResult.brief.id,
        },
      }),
    ).toBe(1);

    expect(
      await db.workflowRun.count({
        where: {
          workflowType: 'CONCEPT_GENERATION',
        },
      }),
    ).toBe(1);

    expect(
      await db.jobAttempt.count({
        where: {
          jobType: 'AI',
        },
      }),
    ).toBe(1);
  });

  it('creates no planner state when an idea is not eligible', async () => {
    const setupResult = await setup();

    await expect(
      repository.plan({
        ...setupResult.plan,
        ideaIds: [randomUUID()],
      }),
    ).rejects.toThrow('CONCEPT_GENERATION_IDEA_NOT_ELIGIBLE');

    expect(
      await db.briefVersion.count({
        where: {
          briefId: setupResult.brief.id,
        },
      }),
    ).toBe(0);

    expect(
      await db.workflowRun.count({
        where: {
          workflowType: 'CONCEPT_GENERATION',
        },
      }),
    ).toBe(0);

    expect(
      await db.jobAttempt.count({
        where: {
          jobType: 'AI',
        },
      }),
    ).toBe(0);

    expect(
      await db.auditEvent.count({
        where: {
          action: 'ConceptGeneration.requestBound',
        },
      }),
    ).toBe(0);

    expect(
      await db.brief.findUniqueOrThrow({
        where: {
          id: setupResult.brief.id,
        },
      }),
    ).toHaveProperty('status', 'READY');
  });
});
