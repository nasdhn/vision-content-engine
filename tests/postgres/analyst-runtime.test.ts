import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { AIProviderGateway } from '../../packages/ai/src/index.js';
import { AnalystRuntime } from '../../packages/application/src/analyst-runtime.js';
import { contentHash } from '../../packages/contracts/src/canonical.js';
import { InvocationRepository } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { FakeAIProvider, reply } from '../support/ai-provider.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

it('executes ANALYST through the production AI gateway with fake provider and persists ModelInvocation', async () => {
  const payload = {
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
    commercial: {
      pricingClaims: [],
      ctas: [],
    },
    claims: {
      verified: [],
      forbidden: [],
    },
    visualIdentity: {
      allowedAssetIds: [],
      notes: [],
    },
  };

  const knowledgeId = randomUUID();
  const knowledgeHash = contentHash(payload);
  const effectiveAt = new Date('2026-01-01T00:00:00.000Z');
  const key = `phase9c-${randomUUID()}`;

  await fixture.client.knowledgeSnapshot.create({
    data: {
      id: knowledgeId,
      key,
      version: 1,
      contentHash: knowledgeHash,
      status: 'ACTIVE',
      effectiveAt,
      payloadJson: payload,
      createdBy: 'phase9c-test',
    },
  });

  const knowledgeContext = {
    ...payload,
    id: knowledgeId,
    key,
    version: 1,
    contentHash: knowledgeHash,
    effectiveAt: effectiveAt.toISOString(),
  };

  const publicationId = randomUUID();
  const provider = FakeAIProvider.scripted([
    reply({
      insights: [
        {
          statement: 'Dans cet échantillon, 12 likes ont été observés à T+24h.',
          confidence: 'WEAK_SIGNAL',
          evidencePublicationIds: [publicationId],
          limitations: [],
          dimensions: { platforms: ['INSTAGRAM'] },
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
    }),
  ]);

  const gateway = new AIProviderGateway(
    new InvocationRepository(fixture.client),
    [provider],
    () => false,
  );
  const runtime = new AnalystRuntime(gateway);
  const requestId = randomUUID();

  const result = await runtime.analyze({
    requestId,
    purpose: 'Phase 9C PostgreSQL fake Analyst',
    knowledgeSnapshot: {
      id: knowledgeId,
      version: 1,
      contentHash: knowledgeHash,
    },
    knowledgeContext,
    input: {
      analysisWindow: {
        from: '2026-09-01T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      },
      publications: [
        {
          publicationId,
          platform: 'INSTAGRAM',
          publishedAt: '2026-09-10T12:00:00.000Z',
          measurementWindow: 'T_PLUS_24H',
          contentDimensions: {},
          normalizedMetrics: { likes: 12 },
          comparability: {
            comparableMetricKeys: ['likes'],
            limitations: ['small sample'],
          },
        },
      ],
      experiments: [],
      priorInsights: [],
      attributionSignals: {},
      minimumEvidencePolicy: {
        minimumComparableSamples: 3,
        confidenceRulesVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
      },
    },
    validationContext: {
      deterministicConfidenceCeiling: 'WEAK_SIGNAL',
      mandatoryLimitations: ['small sample'],
      allowedPrimaryMetrics: ['likes'],
      allowedMeasurementWindows: ['T_PLUS_24H'],
    },
    policy: {
      capability: 'ANALYST',
      preferredProvider: 'deterministic-fixture',
      preferredModel: 'fixture-v1',
      maxAttempts: 1,
      timeoutMs: 1000,
      fallbackPolicy: 'NONE',
      maxInputTokens: 100000,
      maxOutputTokens: 2000,
      maxEstimatedCost: 0.1,
    },
    budget: {
      key: `phase9c-${requestId}`,
      from: '2026-01-01T00:00:00.000Z',
      to: '2027-01-01T00:00:00.000Z',
      limit: '1.00000000',
      currency: 'EUR',
    },
  });

  expect(result.modelInvocationId).toBe(requestId);
  expect(result.output.insights[0]?.limitations).toContain('small sample');
  expect(provider.calls).toHaveLength(1);
  expect(provider.calls[0]?.envelope.capability).toBe('ANALYST');
  expect(provider.calls[0]?.envelope.input).not.toHaveProperty('brandKnowledge');

  const invocation = await fixture.client.modelInvocation.findUniqueOrThrow({
    where: { id: requestId },
    select: {
      policyJson: true,
      promptKey: true,
      promptVersion: true,
      status: true,
      attemptCount: true,
    },
  });

  expect(invocation).toMatchObject({
    promptKey: 'analyst',
    promptVersion: '1.0.0',
    status: 'SUCCEEDED',
    attemptCount: 1,
  });
  expect(invocation.policyJson).toMatchObject({ capability: 'ANALYST' });
});
