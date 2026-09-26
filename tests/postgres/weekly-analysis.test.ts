import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, expect, it } from 'vitest';

import { AIProviderGateway, ProviderFailure } from '../../packages/ai/src/index.js';
import {
  AnalystRuntime,
  WeeklyAnalysisContextBuilder,
} from '../../packages/application/src/index.js';
import {
  WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION,
  WEEKLY_ANALYSIS_CONTEXT_VERSION,
  WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION,
  parseWeeklyAnalysisOutboxEvent,
} from '../../packages/contracts/src/weekly-analysis.js';
import { contentHash } from '../../packages/contracts/src/canonical.js';
import {
  InvocationRepository,
  WeeklyAnalysisRepository,
} from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { WeeklyAnalysisWorkerOrchestrator } from '../../apps/worker-ai/src/index.js';
import { WeeklyAnalysisOutboxDispatcher } from '../../apps/control/src/index.js';
import { recordingGraph } from '../fixtures/recordings/support.js';
import { FakeAIProvider, reply } from '../support/ai-provider.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

const leaseConfig = { durationMs: 60_000, heartbeatIntervalMs: 10_000 } as const;

const brandPayload = {
  brand: {
    name: 'Vision',
    domain: 'urvision.fr',
    primaryLanguage: 'fr',
    market: 'FRANCE',
    tone: ['direct'],
    forbiddenTone: ['mensonger'],
  },
  product: {
    category: 'Agent IA de prospection B2B',
    description: 'Vision aide à rechercher et qualifier des entreprises.',
    features: [],
    useCases: [],
    targetCustomers: [],
    valuePropositions: [],
  },
  commercial: { pricingClaims: [], ctas: [] },
  claims: { verified: [], forbidden: [] },
  visualIdentity: { allowedAssetIds: [], notes: [] },
};

async function knowledge() {
  const id = randomUUID();
  const key = `phase9e-${randomUUID()}`;
  const hash = contentHash(brandPayload);
  await fixture.client.knowledgeSnapshot.create({
    data: {
      id,
      key,
      version: 1,
      contentHash: hash,
      status: 'ACTIVE',
      effectiveAt: new Date('2026-01-01T00:00:00.000Z'),
      payloadJson: brandPayload,
      createdBy: 'phase9e-test',
    },
  });
  return { id, version: 1, contentHash: hash };
}

async function publicationWithLikes(publishedAt: Date, likes: bigint) {
  const graph = await recordingGraph(fixture.client);
  const editingPlan = await fixture.client.editingPlan.create({
    data: { creativePlanId: graph.plan.id, status: 'READY' },
  });
  const editingPlanVersion = await fixture.client.editingPlanVersion.create({
    data: {
      editingPlanId: editingPlan.id,
      version: 1,
      creativePlanVersionId: graph.cpv.id,
      editingProfileVersionId: graph.pv.id,
      templateVersionId: graph.tv.id,
      timelineJson: {},
    },
  });
  const render = await fixture.client.render.create({
    data: { editingPlanVersionId: editingPlanVersion.id, status: 'APPROVED' },
  });
  const account = await fixture.client.platformAccount.create({
    data: {
      platform: 'INSTAGRAM',
      displayName: `Phase 9E ${randomUUID()}`,
      remoteAccountId: randomUUID(),
      status: 'ACTIVE',
    },
  });
  const publication = await fixture.client.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'API_AUTOMATED',
      status: 'PUBLISHED',
      publishedAt,
      remotePostId: randomUUID(),
      remoteUrl: `https://example.test/${randomUUID()}`,
      metadataJson: {},
    },
  });
  const operationId = randomUUID();
  const collectedAt = new Date(publishedAt.getTime() + 24 * 60 * 60 * 1000);
  const raw = await fixture.client.metricSnapshotRaw.create({
    data: {
      publicationId: publication.id,
      platform: 'INSTAGRAM',
      collectedAt,
      providerSchemaVersion: 'phase9e-fixture-v1',
      collectionMethod: 'PLATFORM_API',
      collectionOperationId: operationId,
      payloadJson: { fixture: true, windowKey: 'T_PLUS_24H' },
    },
  });
  await fixture.client.metricSnapshotNormalized.create({
    data: {
      publicationId: publication.id,
      rawSnapshotId: raw.id,
      collectedAt,
      likes,
      comparabilityJson: {
        crossPlatformViewsComparable: false,
        notes: ['Phase 9E fixture.'],
      },
      normalizerVersion: 'phase9e-fixture-normalizer-v1',
      metricSemanticsVersion: 'canonical-metrics-v1',
    },
  });
  await fixture.client.jobAttempt.create({
    data: {
      queueName: 'vce-analytics',
      jobType: 'ANALYTICS_COLLECT:INSTAGRAM_ANALYTICS_V1:T_PLUS_24H',
      operationId,
      attemptNumber: 1,
      status: 'SUCCEEDED',
    },
  });
  return publication;
}

function planInput(
  knowledgeSnapshot: Awaited<ReturnType<typeof knowledge>>,
  from: string,
  to: string,
) {
  return {
    analysisWindow: { from, to },
    measurementWindow: 'T_PLUS_24H' as const,
    evidencePolicyVersion: WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION,
    analystPromptVersion: WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION,
    contextBuilderVersion: WEEKLY_ANALYSIS_CONTEXT_VERSION,
    knowledgeSnapshot,
    policy: {
      capability: 'ANALYST' as const,
      maxAttempts: 1,
      timeoutMs: 2_000,
      fallbackPolicy: 'NONE' as const,
      maxInputTokens: 100_000,
      maxOutputTokens: 2_000,
      maxEstimatedCost: 0.1,
    },
    budget: {
      key: `phase9e-budget-${randomUUID()}`,
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
      limit: '1.00000000',
      currency: 'EUR',
    },
  };
}

async function queuedJob(jobAttemptId: string) {
  const event = await fixture.client.outboxEvent.findFirstOrThrow({
    where: {
      eventType: 'WeeklyAnalysis.requested',
      aggregateType: 'JobAttempt',
      aggregateId: jobAttemptId,
    },
  });
  return parseWeeklyAnalysisOutboxEvent(event);
}

function analystOutput(publicationId: string) {
  return {
    insights: [
      {
        statement: 'Dans cet échantillon, des likes ont été observés à T+24h.',
        confidence: 'WEAK_SIGNAL' as const,
        evidencePublicationIds: [publicationId],
        limitations: ['Échantillon limité.'],
        dimensions: { platforms: ['INSTAGRAM' as const] },
      },
    ],
    recommendations: [
      {
        title: 'Tester une variante',
        description: 'Comparer une autre accroche en gardant le reste constant.',
        nextTest: {
          hypothesis: 'Une variante pourrait modifier les likes observés.',
          change: 'Accroche',
          keepConstant: ['CTA', 'plateforme'],
          primaryMetric: 'likes',
          measurementWindow: 'T_PLUS_24H',
        },
      },
    ],
  };
}

it('freezes the weekly window before dispatch and plans the same logical run idempotently', async () => {
  const knowledgeSnapshot = await knowledge();
  const input = planInput(
    knowledgeSnapshot,
    '2026-08-31T00:00:00.000Z',
    '2026-09-07T00:00:00.000Z',
  );
  const firstRepository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const secondRepository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);

  const [first, retry] = await Promise.all([
    firstRepository.plan(input),
    secondRepository.plan(input),
  ]);

  expect(new Set([first.workflowRunId, retry.workflowRunId]).size).toBe(1);
  expect(new Set([first.jobAttemptId, retry.jobAttemptId]).size).toBe(1);
  expect(await fixture.client.workflowRun.count({ where: { id: first.workflowRunId } })).toBe(1);
  expect(
    await fixture.client.outboxEvent.count({
      where: { eventType: 'WeeklyAnalysis.requested', aggregateId: first.jobAttemptId },
    }),
  ).toBe(1);

  const job = await queuedJob(first.jobAttemptId);
  expect(job.analysisWindow).toEqual(input.analysisWindow);
  expect(job.analysisOperationKey).toBe(first.analysisOperationKey);
  expect(job.kind).toBe('WEEKLY_ANALYSIS');

  const next = await firstRepository.plan(
    planInput(knowledgeSnapshot, '2026-09-07T00:00:00.000Z', '2026-09-14T00:00:00.000Z'),
  );
  expect(next.workflowRunId).not.toBe(first.workflowRunId);
});

it('executes canonical evidence through Analyst and atomically persists durable learning once', async () => {
  const knowledgeSnapshot = await knowledge();
  const publication = await publicationWithLikes(new Date('2026-09-16T12:00:00.000Z'), 12n);
  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-09-14T00:00:00.000Z', '2026-09-21T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);

  const provider = FakeAIProvider.scripted([reply(analystOutput(publication.id))]);
  const runtime = new AnalystRuntime(
    new AIProviderGateway(new InvocationRepository(fixture.client), [provider], () => false),
  );
  const worker = new WeeklyAnalysisWorkerOrchestrator(fixture.client, runtime, {
    workerId: 'phase9e-worker',
    leaseConfig,
  });

  const result = await worker.process(job);
  expect(result.kind).toBe('SUCCEEDED');
  if (result.kind !== 'SUCCEEDED') throw new Error('TEST_SUCCESS_REQUIRED');

  expect(result.insightIds).toHaveLength(1);
  expect(result.recommendationIds).toHaveLength(1);
  expect(
    await fixture.client.insight.findUniqueOrThrow({ where: { id: result.insightIds[0]! } }),
  ).toMatchObject({ modelInvocationId: planned.operationId, scopeType: 'WEEKLY_ANALYSIS' });
  expect(
    await fixture.client.recommendation.findUniqueOrThrow({
      where: { id: result.recommendationIds[0]! },
    }),
  ).toMatchObject({ status: 'PROPOSED' });

  const invocation = await fixture.client.modelInvocation.findUniqueOrThrow({
    where: { id: planned.operationId },
  });
  expect(invocation.status).toBe('SUCCEEDED');
  expect(
    await fixture.client.auditEvent.count({
      where: { action: 'ModelInvocation.output_checkpointed', subjectId: planned.operationId },
    }),
  ).toBe(1);

  const duplicate = await worker.process(job);
  expect(duplicate.kind).toBe('ALREADY_DONE');
  expect(
    await fixture.client.insight.count({ where: { modelInvocationId: planned.operationId } }),
  ).toBe(1);

  const workflow = await fixture.client.workflowRun.findUniqueOrThrow({
    where: { id: planned.workflowRunId },
  });
  const attempt = await fixture.client.jobAttempt.findUniqueOrThrow({
    where: { id: planned.jobAttemptId },
  });
  expect(workflow.status).toBe('SUCCEEDED');
  expect(attempt.status).toBe('SUCCEEDED');
});

it('resumes from the validated output checkpoint after lease expiry without a second ModelInvocation', async () => {
  const knowledgeSnapshot = await knowledge();
  const publication = await publicationWithLikes(new Date('2026-08-26T12:00:00.000Z'), 7n);
  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-08-24T00:00:00.000Z', '2026-08-31T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);
  const claim = await repository.claim(job.jobAttemptId, 'crashed-phase9e-worker');
  expect(claim.kind).toBe('READY');
  if (claim.kind !== 'READY') throw new Error('TEST_CLAIM_REQUIRED');

  const provider = FakeAIProvider.scripted([reply(analystOutput(publication.id))]);
  const runtime = new AnalystRuntime(
    new AIProviderGateway(new InvocationRepository(fixture.client), [provider], () => false),
  );
  const context = await new WeeklyAnalysisContextBuilder(fixture.client).build(claim.payload);
  await runtime.analyze({
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

  expect(
    await fixture.client.insight.count({ where: { modelInvocationId: job.operationId } }),
  ).toBe(0);
  expect(
    await fixture.client.auditEvent.count({
      where: { action: 'ModelInvocation.output_checkpointed', subjectId: job.operationId },
    }),
  ).toBe(1);

  await fixture.client.$executeRaw`
    UPDATE "JobAttempt"
    SET "leaseAcquiredAt" = '2000-01-01T00:00:00Z',
        "heartbeatAt" = '2000-01-01T00:00:01Z',
        "leaseExpiresAt" = '2000-01-01T00:00:02Z'
    WHERE "id" = ${job.jobAttemptId}::uuid
  `;

  const restarted = new WeeklyAnalysisWorkerOrchestrator(fixture.client, runtime, {
    workerId: 'restarted-phase9e-worker',
    leaseConfig,
  });
  const result = await restarted.process(job);
  expect(result.kind).toBe('SUCCEEDED');

  expect(await fixture.client.modelInvocation.count({ where: { id: job.operationId } })).toBe(1);
  expect(
    await fixture.client.insight.count({ where: { modelInvocationId: job.operationId } }),
  ).toBe(1);
  expect(
    await fixture.client.auditEvent.count({
      where: { action: 'ModelInvocation.applied', subjectId: job.operationId },
    }),
  ).toBe(1);
});

it('keeps prior Insights as context only and never counts them in the fresh weekly sample', async () => {
  const knowledgeSnapshot = await knowledge();
  const publication = await publicationWithLikes(new Date('2026-09-30T12:00:00.000Z'), 5n);
  await fixture.client.insight.create({
    data: {
      scopeType: 'GLOBAL',
      statement: 'Signal antérieur conservé uniquement comme contexte.',
      confidence: 'WEAK_SIGNAL',
      evidenceJson: { fixture: 'prior' },
      limitationsJson: { final: ['prior-only'] },
    },
  });

  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-09-28T00:00:00.000Z', '2026-10-05T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);
  const { outboxEventId, ...requestPayload } = job;
  expect(outboxEventId).toBeTruthy();
  const context = await new WeeklyAnalysisContextBuilder(fixture.client).build(requestPayload);

  expect(context.input.publications.map((row) => row.publicationId)).toContain(publication.id);
  expect(context.input.priorInsights.length).toBeGreaterThan(0);
  expect(context.checkpointMetadata.evidence['sampleSize']).toBe(1);
  expect(context.checkpointMetadata.evidence['eligiblePublicationIds']).toEqual([publication.id]);
});

it('fails the WorkflowRun on provider failure without durable learning outputs', async () => {
  const knowledgeSnapshot = await knowledge();
  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-10-05T00:00:00.000Z', '2026-10-12T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);

  const provider = new FakeAIProvider(async () => {
    throw new ProviderFailure('PERMANENT', false);
  });
  const runtime = new AnalystRuntime(
    new AIProviderGateway(new InvocationRepository(fixture.client), [provider], () => false),
  );
  const worker = new WeeklyAnalysisWorkerOrchestrator(fixture.client, runtime, {
    workerId: 'phase9e-provider-failure',
    leaseConfig,
  });

  const recommendationCountBefore = await fixture.client.recommendation.count();
  const result = await worker.process(job);
  expect(result).toMatchObject({ kind: 'FAILED', failureCode: 'PERMANENT' });
  expect(
    await fixture.client.insight.count({ where: { modelInvocationId: planned.operationId } }),
  ).toBe(0);
  expect(await fixture.client.recommendation.count()).toBe(recommendationCountBefore);
  expect(
    await fixture.client.workflowRun.findUniqueOrThrow({ where: { id: planned.workflowRunId } }),
  ).toMatchObject({ status: 'FAILED' });
});

it('fails hard-validation output without persisting Insight or Recommendation', async () => {
  const knowledgeSnapshot = await knowledge();
  const publication = await publicationWithLikes(new Date('2026-10-14T12:00:00.000Z'), 8n);
  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-10-12T00:00:00.000Z', '2026-10-19T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);

  const invalid = analystOutput(publication.id);
  invalid.insights[0]!.statement = 'Cette accroche a causé la hausse des likes.';
  const provider = FakeAIProvider.scripted([reply(invalid)]);
  const runtime = new AnalystRuntime(
    new AIProviderGateway(new InvocationRepository(fixture.client), [provider], () => false),
  );
  const worker = new WeeklyAnalysisWorkerOrchestrator(fixture.client, runtime, {
    workerId: 'phase9e-validation-failure',
    leaseConfig,
  });

  const recommendationCountBefore = await fixture.client.recommendation.count();
  const result = await worker.process(job);
  expect(result).toMatchObject({
    kind: 'FAILED',
    failureCode: 'ANALYST_CAUSAL_CLAIM_FORBIDDEN',
  });
  expect(
    await fixture.client.insight.count({ where: { modelInvocationId: planned.operationId } }),
  ).toBe(0);
  expect(await fixture.client.recommendation.count()).toBe(recommendationCountBefore);
  expect(
    await fixture.client.auditEvent.count({
      where: { action: 'ModelInvocation.applied', subjectId: planned.operationId },
    }),
  ).toBe(0);
});

it('pauses weekly AI before outbox claim, JobAttempt claim or ModelInvocation creation', async () => {
  const knowledgeSnapshot = await knowledge();
  const repository = new WeeklyAnalysisRepository(fixture.client, leaseConfig);
  const planned = await repository.plan(
    planInput(knowledgeSnapshot, '2026-11-02T00:00:00.000Z', '2026-11-09T00:00:00.000Z'),
  );
  const job = await queuedJob(planned.jobAttemptId);
  const dispatched: unknown[] = [];
  const dispatcher = new WeeklyAnalysisOutboxDispatcher(
    fixture.client,
    leaseConfig,
    {
      enqueue: async (candidate) => {
        dispatched.push(candidate);
      },
    },
    'phase10i-weekly-dispatcher',
  );

  await expect(dispatcher.dispatchOne(true)).resolves.toEqual({ kind: 'PAUSED' });
  expect(dispatched).toHaveLength(0);
  expect(
    await fixture.client.outboxEvent.findUniqueOrThrow({ where: { id: job.outboxEventId } }),
  ).toMatchObject({
    status: 'PENDING',
    claimOwner: null,
    claimToken: null,
  });

  const provider = FakeAIProvider.scripted([reply(analystOutput(randomUUID()))]);
  const runtime = new AnalystRuntime(
    new AIProviderGateway(new InvocationRepository(fixture.client), [provider], () => false),
  );
  const worker = new WeeklyAnalysisWorkerOrchestrator(fixture.client, runtime, {
    workerId: 'phase10i-weekly-paused',
    leaseConfig,
    paused: () => true,
  });

  await expect(worker.process(job)).resolves.toEqual({ kind: 'PAUSED' });
  expect(
    await fixture.client.jobAttempt.findUniqueOrThrow({ where: { id: planned.jobAttemptId } }),
  ).toMatchObject({
    status: 'QUEUED',
    workerId: null,
    leaseToken: null,
  });
  expect(await fixture.client.modelInvocation.count({ where: { id: planned.operationId } })).toBe(
    0,
  );
});
