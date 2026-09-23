import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { contentHash } from '../../packages/contracts/src/canonical.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence, createDatabaseClient } from '../../packages/database/src/index.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let second: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
let secondPersistence: Persistence;

const ai = { actorType: 'AI', actorId: 'validated-analyst-application' } as const;
const human = { actorType: 'USER', actorId: 'learning-reviewer' } as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  second = createDatabaseClient(fixture.url);
  persistence = new Persistence(db);
  secondPersistence = new Persistence(second);
});

afterAll(async () => {
  await second?.$disconnect();
  await fixture?.close();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
});

function analystOutput(publicationId = randomUUID()) {
  return {
    insights: [
      {
        statement: 'Dans cet échantillon, la valeur observée est supérieure.',
        confidence: 'WEAK_SIGNAL',
        evidencePublicationIds: [publicationId],
        limitations: ['small sample', 'manual TikTok analytics'],
        dimensions: {
          platforms: ['TIKTOK'],
        },
      },
    ],
    recommendations: [
      {
        title: 'Tester une variation de hook',
        description: 'Proposition de test borné, sans mutation automatique de stratégie.',
        nextTest: {
          hypothesis: 'Une variation du hook peut être comparée sur le prochain échantillon.',
          change: 'Modifier uniquement le hook.',
          keepConstant: ['format', 'CTA', 'editing profile'],
          primaryMetric: 'views',
          measurementWindow: 'T_PLUS_24H',
        },
      },
    ],
  };
}

function insightContext(publicationId: string, operationKey = randomUUID()) {
  return {
    scopeType: 'GLOBAL',
    evidence: {
      analysisOperationKey: operationKey,
      evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
      analysisWindow: {
        from: '2026-09-14T00:00:00.000Z',
        to: '2026-09-21T00:00:00.000Z',
      },
      measurementWindow: 'T_PLUS_24H',
      metric: 'views',
      businessOutcome: null,
      eligiblePublicationIds: [publicationId],
      excludedPublicationIds: [],
      exclusionReasons: {},
      sampleSize: 1,
      distinctPublishDates: ['2026-09-20'],
      contentDimensions: { platform: 'TIKTOK' },
      metricSemantics: { views: 'platform-native-v1' },
      platforms: ['TIKTOK'],
      deterministicConfidenceCeiling: 'WEAK_SIGNAL',
      attributionContext: { directPublicationLinks: null },
      sourceAuthority: { analytics: 'TIKTOK_MANUAL' },
      outlierDiagnostics: { dominant: false },
      directionDiagnostics: { consistent: false },
    },
    limitations: {
      deterministic: ['small sample'],
      analyst: ['manual TikTok analytics'],
      dataQuality: [],
      comparability: [],
      attribution: [],
    },
  };
}

async function modelInvocation(output: ReturnType<typeof analystOutput>) {
  const knowledgePayload = { fixture: 'phase9d' };
  const snapshot = await db.knowledgeSnapshot.create({
    data: {
      key: randomUUID(),
      version: 1,
      contentHash: contentHash(knowledgePayload),
      status: 'ACTIVE',
      effectiveAt: new Date('2026-09-21T00:00:00.000Z'),
      payloadJson: knowledgePayload,
    },
  });

  return db.modelInvocation.create({
    data: {
      purpose: 'phase9d-learning-fixture',
      promptKey: 'analyst',
      promptVersion: '1.0.0',
      promptContentHash: '9d5ae587e6b095c2d6eeb337fe622e86e26188559298aa558441ca14373a7d68',
      knowledgeSnapshotId: snapshot.id,
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      policyJson: { capability: 'ANALYST' },
      status: 'SUCCEEDED',
      inputHash: contentHash({ fixture: 'input', id: randomUUID() }),
      outputHash: contentHash(output),
      attemptCount: 1,
      startedAt: new Date('2026-09-21T00:00:01.000Z'),
      finishedAt: new Date('2026-09-21T00:00:02.000Z'),
    },
  });
}

async function persistOne() {
  const publicationId = randomUUID();
  const output = analystOutput(publicationId);
  const invocation = await modelInvocation(output);
  const result = await persistence.transaction(ai, (unit) =>
    unit.learning.persistValidatedAnalystOutput({
      modelInvocationId: invocation.id,
      output,
      insightContexts: [insightContext(publicationId)],
      recommendationInsightIndexes: [0],
    }),
  );
  return { publicationId, output, invocation, result };
}

it('persists traceable append-only Insights and PROPOSED Recommendations from the exact Analyst invocation', async () => {
  const first = await persistOne();
  const insight = await db.insight.findUniqueOrThrow({
    where: { id: first.result.insights[0]!.id },
  });
  const recommendation = await db.recommendation.findUniqueOrThrow({
    where: { id: first.result.recommendations[0]!.id },
  });

  expect(insight.modelInvocationId).toBe(first.invocation.id);
  expect(insight.statement).toBe(first.output.insights[0]!.statement);
  expect(insight.confidence).toBe('WEAK_SIGNAL');

  const evidence = insight.evidenceJson as Record<string, unknown>;
  expect(Object.keys(evidence)).toEqual(
    expect.arrayContaining([
      'analysisOperationKey',
      'evidencePolicyVersion',
      'analysisWindow',
      'measurementWindow',
      'metric',
      'businessOutcome',
      'eligiblePublicationIds',
      'excludedPublicationIds',
      'exclusionReasons',
      'sampleSize',
      'distinctPublishDates',
      'contentDimensions',
      'metricSemantics',
      'platforms',
      'deterministicConfidenceCeiling',
      'attributionContext',
      'sourceAuthority',
      'outlierDiagnostics',
      'directionDiagnostics',
    ]),
  );

  expect(insight.limitationsJson).toMatchObject({
    deterministic: ['small sample'],
    analyst: ['manual TikTok analytics'],
    dataQuality: [],
    comparability: [],
    attribution: [],
    final: ['small sample', 'manual TikTok analytics'],
  });

  expect(recommendation).toMatchObject({
    insightId: insight.id,
    status: 'PROPOSED',
    title: first.output.recommendations[0]!.title,
    description: first.output.recommendations[0]!.description,
  });
  expect(recommendation.recommendedTestJson).toEqual(first.output.recommendations[0]!.nextTest);

  await expect(
    persistence.transaction(ai, (unit) =>
      unit.learning.persistValidatedAnalystOutput({
        modelInvocationId: first.invocation.id,
        output: first.output,
        insightContexts: [insightContext(first.publicationId)],
        recommendationInsightIndexes: [0],
      }),
    ),
  ).rejects.toThrow('INVOCATION_ALREADY_APPLIED');

  expect(await db.insight.count()).toBe(1);
  expect(await db.recommendation.count()).toBe(1);

  const secondPublicationId = randomUUID();
  const secondOutput = analystOutput(secondPublicationId);
  secondOutput.insights[0]!.statement =
    'Nouvel Insight append-only pour une conclusion qui évolue.';
  const secondInvocation = await modelInvocation(secondOutput);
  const secondResult = await persistence.transaction(ai, (unit) =>
    unit.learning.persistValidatedAnalystOutput({
      modelInvocationId: secondInvocation.id,
      output: secondOutput,
      insightContexts: [insightContext(secondPublicationId)],
      recommendationInsightIndexes: [0],
    }),
  );

  expect(secondResult.insights[0]!.id).not.toBe(insight.id);
  expect(await db.insight.count()).toBe(2);
  expect((await db.insight.findUniqueOrThrow({ where: { id: insight.id } })).statement).toBe(
    first.output.insights[0]!.statement,
  );

  const applied = await db.auditEvent.findUniqueOrThrow({
    where: {
      id: (
        await db.auditEvent.findFirstOrThrow({
          where: {
            action: 'ModelInvocation.applied',
            subjectType: 'ModelInvocation',
            subjectId: first.invocation.id,
          },
        })
      ).id,
    },
  });
  expect(applied.afterJson).toMatchObject({
    gatewayOutputHash: first.invocation.outputHash,
    insightIds: [insight.id],
    recommendationIds: [recommendation.id],
  });
});

it('enforces the frozen human Recommendation lifecycle and ACCEPTED alone creates no Experiment', async () => {
  const acceptedFixture = await persistOne();
  const acceptedId = acceptedFixture.result.recommendations[0]!.id;

  await expect(
    persistence.transaction({ actorType: 'SYSTEM', actorId: 'system' }, (unit) =>
      unit.learning.transitionRecommendation(acceptedId, 'ACCEPTED'),
    ),
  ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');

  expect(
    (
      await persistence.transaction(human, (unit) =>
        unit.learning.transitionRecommendation(acceptedId, 'ACCEPTED'),
      )
    ).status,
  ).toBe('ACCEPTED');
  expect(await db.experiment.count()).toBe(0);

  expect(
    (
      await persistence.transaction(human, (unit) =>
        unit.learning.transitionRecommendation(acceptedId, 'EXECUTED'),
      )
    ).status,
  ).toBe('EXECUTED');

  const rejectedFixture = await persistOne();
  const rejectedId = rejectedFixture.result.recommendations[0]!.id;
  expect(
    (
      await persistence.transaction(human, (unit) =>
        unit.learning.transitionRecommendation(rejectedId, 'REJECTED'),
      )
    ).status,
  ).toBe('REJECTED');

  await expect(
    persistence.transaction(human, (unit) =>
      unit.learning.transitionRecommendation(rejectedId, 'ACCEPTED'),
    ),
  ).rejects.toThrow('INVALID_RECOMMENDATION_TRANSITION');

  const actions = await db.auditEvent.findMany({
    where: {
      subjectType: 'Recommendation',
      subjectId: { in: [acceptedId, rejectedId] },
      action: {
        in: ['Recommendation.accepted', 'Recommendation.rejected', 'Recommendation.executed'],
      },
    },
    orderBy: [{ action: 'asc' }],
  });
  expect(actions.map((event) => event.action).sort()).toEqual([
    'Recommendation.accepted',
    'Recommendation.executed',
    'Recommendation.rejected',
  ]);
});

it('creates one explicit DRAFT Experiment proposal idempotently under concurrent retries', async () => {
  const persisted = await persistOne();
  const recommendationId = persisted.result.recommendations[0]!.id;

  await persistence.transaction(human, (unit) =>
    unit.learning.transitionRecommendation(recommendationId, 'ACCEPTED'),
  );
  expect(await db.experiment.count()).toBe(0);

  const [first, secondResult] = await Promise.all([
    persistence.transaction(human, (unit) =>
      unit.learning.createExperimentProposal(recommendationId),
    ),
    secondPersistence.transaction(human, (unit) =>
      unit.learning.createExperimentProposal(recommendationId),
    ),
  ]);

  expect(secondResult.id).toBe(first.id);
  expect(first).toMatchObject({
    status: 'DRAFT',
    name: persisted.output.recommendations[0]!.title,
    hypothesis: persisted.output.recommendations[0]!.nextTest.hypothesis,
    primaryMetric: persisted.output.recommendations[0]!.nextTest.primaryMetric,
  });
  expect(await db.experiment.count()).toBe(1);
  expect(
    (await db.recommendation.findUniqueOrThrow({ where: { id: recommendationId } })).status,
  ).toBe('ACCEPTED');

  expect(
    await db.auditEvent.count({
      where: {
        action: 'Experiment.proposal_created',
        subjectType: 'Recommendation',
        subjectId: recommendationId,
      },
    }),
  ).toBe(1);

  expect(await db.concept.count()).toBe(0);
  expect(await db.publication.count()).toBe(0);
  expect(await db.patternVersion.count()).toBe(0);
  expect(await db.editingProfileVersion.count()).toBe(0);
  expect(await db.templateVersion.count()).toBe(0);
});

it('requires explicit acceptance before creating an Experiment proposal', async () => {
  const persisted = await persistOne();
  const recommendationId = persisted.result.recommendations[0]!.id;

  await expect(
    persistence.transaction(human, (unit) =>
      unit.learning.createExperimentProposal(recommendationId),
    ),
  ).rejects.toThrow('RECOMMENDATION_NOT_ACCEPTED');

  expect(await db.experiment.count()).toBe(0);
  expect(
    await db.auditEvent.count({
      where: {
        action: 'Experiment.proposal_created',
        subjectType: 'Recommendation',
        subjectId: recommendationId,
      },
    }),
  ).toBe(0);
});
