import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { contentHash } from '../../packages/contracts/src/canonical.js';
import { LearningDashboardService } from '../../packages/application/src/learning-read.js';
import { Persistence } from '../../packages/database/src/persistence.js';
import { postgresFixture } from '../../packages/database/test/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: Awaited<ReturnType<typeof postgresFixture>>['client'];

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
});

afterAll(async () => fixture.close());

async function seed() {
  const key = 'b'.repeat(64);
  const publicationId = randomUUID();
  const patternVersionId = randomUUID();
  const templateVersionId = randomUUID();
  const editingProfileVersionId = randomUUID();

  const snapshot = await db.knowledgeSnapshot.create({
    data: {
      key: `learning-read-${randomUUID()}`,
      version: 1,
      contentHash: contentHash({ key }),
      status: 'ACTIVE',
      effectiveAt: new Date('2026-09-14T00:00:00.000Z'),
      payloadJson: {},
    },
  });

  const workflow = await db.workflowRun.create({
    data: {
      workflowType: 'WEEKLY_ANALYSIS',
      rootEntityType: 'WeeklyAnalysisOperation',
      rootEntityId: key,
      status: 'SUCCEEDED',
      currentStep: 'complete',
    },
  });
  const operationId = randomUUID();
  const job = await db.jobAttempt.create({
    data: {
      workflowRunId: workflow.id,
      queueName: 'ai',
      jobType: 'WEEKLY_ANALYSIS',
      operationId,
      attemptNumber: 1,
      status: 'SUCCEEDED',
    },
  });
  await db.outboxEvent.create({
    data: {
      eventType: 'WeeklyAnalysis.requested',
      aggregateType: 'JobAttempt',
      aggregateId: job.id,
      payloadJson: {
        schemaVersion: 'v1',
        kind: 'WEEKLY_ANALYSIS',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        operationId,
        analysisOperationKey: key,
        analysisWindow: {
          from: '2026-09-14T00:00:00.000Z',
          to: '2026-09-21T00:00:00.000Z',
        },
        measurementWindow: 'T_PLUS_24H',
        evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
        analystPromptVersion: '1.0.0',
        contextBuilderVersion: 'WEEKLY_ANALYSIS_CONTEXT_V1',
        knowledgeSnapshot: {
          id: snapshot.id,
          version: snapshot.version,
          contentHash: snapshot.contentHash,
        },
        policy: {
          capability: 'ANALYST',
          maxAttempts: 1,
          timeoutMs: 1000,
          fallbackPolicy: 'NONE',
          maxInputTokens: 10000,
          maxOutputTokens: 1000,
          maxEstimatedCost: 0.1,
        },
        budget: {
          key: `learning-read-${operationId}`,
          from: '2026-09-14T00:00:00.000Z',
          to: '2026-09-21T00:00:00.000Z',
          limit: '1.00000000',
          currency: 'EUR',
        },
      },
    },
  });

  const output = {
    insights: [
      {
        statement: 'Petit échantillon, signal descriptif.',
        confidence: 'WEAK_SIGNAL',
        evidencePublicationIds: [publicationId],
        limitations: ['Small sample.'],
        dimensions: {
          patternVersionIds: [patternVersionId],
          editingProfileVersionIds: [editingProfileVersionId],
          platforms: ['TIKTOK'],
        },
      },
    ],
    recommendations: [
      {
        title: 'Tester une accroche',
        description: 'Changer une seule variable.',
        nextTest: {
          hypothesis: 'Une accroche résultat pourrait modifier la complétion.',
          change: 'Changer uniquement l’accroche.',
          keepConstant: ['CTA', 'montage'],
          primaryMetric: 'views',
          measurementWindow: 'T_PLUS_24H',
        },
      },
    ],
  };

  const invocation = await db.modelInvocation.create({
    data: {
      purpose: 'weekly-analysis',
      promptKey: 'analyst',
      promptVersion: '1.0.0',
      promptContentHash: 'd'.repeat(64),
      knowledgeSnapshotId: snapshot.id,
      inputSchemaVersion: '1.0.0',
      outputSchemaVersion: '1.0.0',
      policyJson: { capability: 'ANALYST' },
      status: 'SUCCEEDED',
      inputHash: contentHash({ key, input: true }),
      outputHash: contentHash(output),
      attemptCount: 1,
      startedAt: new Date('2026-09-21T00:00:01.000Z'),
      finishedAt: new Date('2026-09-21T00:00:02.000Z'),
    },
  });

  const experimentContext = [
    {
      experimentId: randomUUID(),
      experimentName: 'Hook test',
      hypothesis: 'Comparer deux variantes sur views.',
      experimentStatus: 'RUNNING',
      primaryMetric: 'views',
      measurementWindow: 'T_PLUS_24H',
      readiness: 'READY',
      arms: [
        {
          armId: randomUUID(),
          label: 'A',
          conceptVersionId: null,
          publicationId,
          readiness: 'READY',
          metricValue: 120,
          platform: 'TIKTOK',
          publishedAt: '2026-09-18T12:00:00.000Z',
          collectedAt: '2026-09-19T12:00:00.000Z',
          metricSemanticsVersion: 'canonical-metrics-v1',
          limitations: [],
        },
      ],
      evidenceFrame: null,
      limitations: ['Descriptive only.'],
    },
  ];

  const evidence = {
    analysisOperationKey: key,
    evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
    analysisWindow: {
      from: '2026-09-14T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
    },
    measurementWindow: 'T_PLUS_24H',
    metric: null,
    businessOutcome: 'weekly_cross_metric_analysis',
    eligiblePublicationIds: [publicationId],
    excludedPublicationIds: [],
    exclusionReasons: {},
    sampleSize: 1,
    distinctPublishDates: ['2026-09-18'],
    contentDimensions: {
      publications: [
        {
          publicationId,
          dimensions: {
            patternVersionId,
            templateVersionId,
            editingProfileVersionId,
            durationMs: 23000,
          },
        },
      ],
    },
    metricSemantics: [
      { platform: 'TIKTOK', metric: 'views', version: 'canonical-metrics-v1', sampleSize: 1 },
    ],
    platforms: ['TIKTOK'],
    deterministicConfidenceCeiling: 'WEAK_SIGNAL',
    attributionContext: {
      websiteVisits: 2,
      signups: 1,
      activations: null,
      customers: null,
      revenueAmountMinor: 3900,
      revenueCurrency: 'EUR',
      directPublicationLinks: 1,
      inferredSignals: 1,
    },
    sourceAuthority: { WEBSITE_VISIT: 'UMAMI', SIGNUP: 'VISION_APP' },
    outlierDiagnostics: [],
    directionDiagnostics: [],
    experimentContext,
  };

  const persistence = new Persistence(db);
  const result = await persistence.transaction(
    { actorType: 'AI', actorId: 'learning-read-test' },
    (unit) =>
      unit.learning.persistValidatedAnalystOutput({
        modelInvocationId: invocation.id,
        output,
        insightContexts: [
          {
            scopeType: 'WEEKLY_ANALYSIS',
            scopeId: key,
            evidence,
            limitations: {
              deterministic: ['Small sample.'],
              analyst: [],
              dataQuality: [],
              comparability: ['Cross-platform metric equivalence is not assumed.'],
              attribution: [],
            },
          },
        ],
        recommendationInsightIndexes: [null],
      }),
  );

  const frozenInput = {
    analysisWindow: evidence.analysisWindow,
    publications: [
      {
        publicationId,
        platform: 'TIKTOK',
        publishedAt: '2026-09-18T12:00:00.000Z',
        measurementWindow: 'T_PLUS_24H',
        contentDimensions: {
          patternVersionId,
          templateVersionId,
          editingProfileVersionId,
          durationMs: 23000,
        },
        normalizedMetrics: { views: 120, completionRate: null },
        comparability: {
          comparableMetricKeys: ['views'],
          limitations: ['Cross-platform metric equivalence is not assumed.'],
        },
      },
    ],
    experiments: [],
    priorInsights: [],
    attributionSignals: evidence.attributionContext,
    minimumEvidencePolicy: {
      minimumComparableSamples: 3,
      confidenceRulesVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
    },
  };

  await db.auditEvent.create({
    data: {
      actorType: 'AI',
      actorId: 'learning-read-test',
      action: 'ModelInvocation.output_checkpointed',
      subjectType: 'ModelInvocation',
      subjectId: invocation.id,
      afterJson: {
        outputHash: contentHash(output),
        output,
        metadata: {
          schemaVersion: 'v1',
          analysisOperationKey: key,
          workflowRunId: workflow.id,
          input: frozenInput,
          validationContext: {
            deterministicConfidenceCeiling: 'WEAK_SIGNAL',
            mandatoryLimitations: ['Small sample.'],
            allowedPrimaryMetrics: ['views'],
            allowedMeasurementWindows: ['T_PLUS_24H'],
          },
          evidence,
          limitations: {
            deterministic: ['Small sample.'],
            dataQuality: [],
            comparability: ['Cross-platform metric equivalence is not assumed.'],
            attribution: [],
          },
        },
        metadataHash: contentHash({ key, metadata: true }),
      },
    },
  });

  await db.attributionEvent.create({
    data: {
      eventType: 'WEBSITE_VISIT',
      occurredAt: new Date('2026-09-18T18:00:00.000Z'),
      sourceSystem: 'UMAMI',
      externalEventId: `late-${randomUUID()}`,
      confidenceType: 'DIRECT',
    },
  });

  return { key, recommendationId: result.recommendations[0]!.id };
}

async function seedWeeklyRunWithoutCheckpoint(status: 'FAILED' | 'SUCCEEDED') {
  const key = (status === 'FAILED' ? 'c' : 'd').repeat(64);
  const snapshot = await db.knowledgeSnapshot.create({
    data: {
      key: `learning-read-missing-checkpoint-${status.toLowerCase()}-${randomUUID()}`,
      version: 1,
      contentHash: contentHash({ key, status }),
      status: 'ACTIVE',
      effectiveAt: new Date('2026-09-14T00:00:00.000Z'),
      payloadJson: {},
    },
  });
  const workflow = await db.workflowRun.create({
    data: {
      workflowType: 'WEEKLY_ANALYSIS',
      rootEntityType: 'WeeklyAnalysisOperation',
      rootEntityId: key,
      status,
      currentStep: status === 'FAILED' ? 'failed' : 'complete',
      finishedAt: new Date('2026-09-21T00:00:03.000Z'),
    },
  });
  const operationId = randomUUID();
  const job = await db.jobAttempt.create({
    data: {
      workflowRunId: workflow.id,
      queueName: 'ai',
      jobType: 'WEEKLY_ANALYSIS',
      operationId,
      attemptNumber: 1,
      status: status === 'FAILED' ? 'FAILED' : 'SUCCEEDED',
    },
  });
  await db.outboxEvent.create({
    data: {
      eventType: 'WeeklyAnalysis.requested',
      aggregateType: 'JobAttempt',
      aggregateId: job.id,
      payloadJson: {
        schemaVersion: 'v1',
        kind: 'WEEKLY_ANALYSIS',
        workflowRunId: workflow.id,
        jobAttemptId: job.id,
        operationId,
        analysisOperationKey: key,
        analysisWindow: {
          from: '2026-09-14T00:00:00.000Z',
          to: '2026-09-21T00:00:00.000Z',
        },
        measurementWindow: 'T_PLUS_24H',
        evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
        analystPromptVersion: '1.0.0',
        contextBuilderVersion: 'WEEKLY_ANALYSIS_CONTEXT_V1',
        knowledgeSnapshot: {
          id: snapshot.id,
          version: snapshot.version,
          contentHash: snapshot.contentHash,
        },
        policy: {
          capability: 'ANALYST',
          maxAttempts: 1,
          timeoutMs: 1000,
          fallbackPolicy: 'NONE',
          maxInputTokens: 10000,
          maxOutputTokens: 1000,
          maxEstimatedCost: 0.1,
        },
        budget: {
          key: `learning-read-missing-checkpoint-${operationId}`,
          from: '2026-09-14T00:00:00.000Z',
          to: '2026-09-21T00:00:00.000Z',
          limit: '1.00000000',
          currency: 'EUR',
        },
      },
    },
  });
  return { key };
}

it('exposes only successful weekly reports and fails closed on missing success provenance', async () => {
  const failed = await seedWeeklyRunWithoutCheckpoint('FAILED');
  const corruptSuccess = await seedWeeklyRunWithoutCheckpoint('SUCCEEDED');
  const service = new LearningDashboardService(db);

  const reports = await service.list();
  expect(reports.some((row) => row.analysisOperationKey === failed.key)).toBe(false);
  expect(reports.some((row) => row.analysisOperationKey === corruptSuccess.key)).toBe(true);

  await expect(service.detail(failed.key)).rejects.toThrow('LEARNING_REPORT_NOT_FOUND');
  await expect(service.detail(corruptSuccess.key)).rejects.toThrow(
    'LEARNING_REPORT_PROVENANCE_NOT_FOUND',
  );
});

it('projects the frozen weekly snapshot instead of mutable late attribution rows', async () => {
  const seeded = await seed();
  const service = new LearningDashboardService(db, () => new Date('2026-09-23T12:00:00.000Z'));
  const report = await service.detail(seeded.key);

  expect(report.businessOutcomes.websiteVisits.total).toBe(2);
  expect(report.businessOutcomes.signups.total).toBe(1);
  expect(report.businessOutcomes.revenueByCurrency).toEqual([
    { currency: 'EUR', amountMinor: '3900' },
  ]);
  expect(report.funnel.find((row) => row.stage === 'ACTIVATION')).toMatchObject({
    value: null,
    availability: 'UNAVAILABLE',
    unit: null,
  });
  expect(report.funnel.find((row) => row.stage === 'REVENUE')).toMatchObject({
    value: 3900,
    availability: 'OBSERVED',
    unit: 'minor units EUR',
  });
  expect(report.platformPerformance[0]).toMatchObject({
    platform: 'TIKTOK',
    publicationCount: 1,
  });
  expect(
    report.platformPerformance[0]!.metrics.find((row) => row.metric === 'views'),
  ).toMatchObject({
    observedValues: [120],
    comparableSampleSize: 1,
    semanticVersions: ['canonical-metrics-v1'],
  });
  expect(report.experiments[0]).toMatchObject({
    name: 'Hook test',
    primaryMetric: 'views',
    readiness: 'READY',
    arms: [{ label: 'A', metricValue: 120, readiness: 'READY' }],
  });
  expect(report.dataQuality.unavailableMetricCount).toBe(1);
  expect(report.insights[0]).toMatchObject({
    confidence: 'WEAK_SIGNAL',
    measurementWindow: 'T_PLUS_24H',
    limitations: expect.arrayContaining(['Small sample.']),
    sourceContext: {
      evidencePolicyVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
      platforms: ['TIKTOK'],
    },
  });
  expect(JSON.stringify(report)).not.toContain('"winner"');
});

it('reuses frozen 9D human lifecycle and explicit idempotent experiment proposal', async () => {
  const seeded = await seed();
  const service = new LearningDashboardService(db);
  const actor = { actorType: 'USER', actorId: 'learning-read-test' } as const;

  await service.transitionRecommendation(actor, seeded.recommendationId, 'ACCEPTED');
  expect(await db.experiment.count()).toBe(0);

  const first = await service.createExperimentProposal(actor, seeded.recommendationId);
  const second = await service.createExperimentProposal(actor, seeded.recommendationId);

  expect(first.status).toBe('DRAFT');
  expect(second.experimentId).toBe(first.experimentId);
  expect(await db.experiment.count({ where: { id: first.experimentId } })).toBe(1);
});
