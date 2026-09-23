import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

import {
  AnalystRuntime,
  mergeDeterministicAnalystLimitations,
  validateAnalystOutput,
} from '../../packages/application/src/analyst-runtime.js';
import type { AnalystInput, AnalystOutput } from '../../packages/contracts/src/index.js';

const publicationId = randomUUID();
const patternVersionId = randomUUID();
const editingProfileVersionId = randomUUID();

const input: AnalystInput = {
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
      contentDimensions: {
        patternVersionId,
        hookType: 'RESULT_FIRST',
        editingProfileVersionId,
      },
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
};

const context = {
  deterministicConfidenceCeiling: 'WEAK_SIGNAL' as const,
  mandatoryLimitations: ['small sample'],
  allowedPrimaryMetrics: ['likes'],
  allowedMeasurementWindows: ['T_PLUS_24H'],
};

function output(overrides: Partial<AnalystOutput['insights'][number]> = {}): AnalystOutput {
  return {
    insights: [
      {
        statement: 'Dans cet échantillon, la publication a obtenu 12 likes à T+24h.',
        confidence: 'WEAK_SIGNAL',
        evidencePublicationIds: [publicationId],
        limitations: [],
        dimensions: {
          patternVersionIds: [patternVersionId],
          editingProfileVersionIds: [editingProfileVersionId],
          platforms: ['INSTAGRAM'],
        },
        ...overrides,
      },
    ],
    recommendations: [
      {
        title: 'Tester une autre accroche',
        description: 'Comparer une variante en gardant le reste constant.',
        nextTest: {
          hypothesis: 'Une autre accroche pourrait modifier les likes observés.',
          change: 'Accroche',
          keepConstant: ['CTA', 'plateforme'],
          primaryMetric: 'likes',
          measurementWindow: 'T_PLUS_24H',
        },
      },
    ],
  };
}

describe('Phase 9C Analyst hard validation', () => {
  it('accepts bounded descriptive evidence and merges deterministic limitations', () => {
    const candidate = output();
    expect(() => validateAnalystOutput(input, candidate, context)).not.toThrow();

    const merged = mergeDeterministicAnalystLimitations(candidate, context.mandatoryLimitations);
    expect(merged.insights[0]?.limitations).toEqual(['small sample']);
  });

  it('rejects confidence above the deterministic ceiling', () => {
    expect(() =>
      validateAnalystOutput(input, output({ confidence: 'FAIRLY_SOLID' }), context),
    ).toThrowError('ANALYST_CONFIDENCE_EXCEEDS_CEILING');
  });

  it('rejects unknown evidence Publication IDs', () => {
    expect(() =>
      validateAnalystOutput(input, output({ evidencePublicationIds: [randomUUID()] }), context),
    ).toThrowError('ANALYST_UNKNOWN_EVIDENCE_PUBLICATION');
  });

  it('rejects unsupported causal claims', () => {
    expect(() =>
      validateAnalystOutput(
        input,
        output({ statement: 'Cette accroche a causé la hausse des likes.' }),
        context,
      ),
    ).toThrowError('ANALYST_CAUSAL_CLAIM_FORBIDDEN');
  });

  it('rejects universal rules', () => {
    expect(() =>
      validateAnalystOutput(
        input,
        output({ statement: 'Cette structure fonctionne toujours.' }),
        context,
      ),
    ).toThrowError('ANALYST_UNIVERSAL_RULE_FORBIDDEN');
  });

  it('rejects unknown structured dimensions', () => {
    expect(() =>
      validateAnalystOutput(
        input,
        output({
          dimensions: { patternVersionIds: [randomUUID()] },
        }),
        context,
      ),
    ).toThrowError('ANALYST_UNKNOWN_PATTERN_VERSION_ID');
  });

  it('rejects unsupported next-test metric', () => {
    const candidate = output();
    candidate.recommendations[0]!.nextTest.primaryMetric = 'madeUpScore';
    expect(() => validateAnalystOutput(input, candidate, context)).toThrowError(
      'ANALYST_UNSUPPORTED_RECOMMENDATION_METRIC',
    );
  });

  it('routes ANALYST through the injected gateway with the versioned prompt', async () => {
    const generateStructured = vi.fn(async (request, contracts) => {
      const candidate = output();
      await contracts.validate(input, candidate);
      return {
        modelInvocationId: request.requestId,
        output: candidate,
        validation: {
          schema: 'PASS' as const,
          references: 'PASS' as const,
          businessRules: 'PASS' as const,
          claims: 'PASS' as const,
        },
        warnings: [],
      };
    });

    const runtime = new AnalystRuntime({ generateStructured });
    const requestId = randomUUID();
    const result = await runtime.analyze({
      requestId,
      purpose: 'phase9c-test',
      knowledgeSnapshot: {
        id: randomUUID(),
        version: 1,
        contentHash: 'a'.repeat(64),
      },
      knowledgeContext: {},
      input,
      validationContext: context,
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
        key: 'phase9c-test',
        from: '2026-01-01T00:00:00.000Z',
        to: '2027-01-01T00:00:00.000Z',
        limit: '1.00000000',
        currency: 'EUR',
      },
    });

    expect(generateStructured).toHaveBeenCalledOnce();
    const gatewayRequest = generateStructured.mock.calls[0]![0];
    expect(gatewayRequest.capability).toBe('ANALYST');
    expect(gatewayRequest.prompt).toEqual({ key: 'analyst', version: '1.0.0' });
    expect(gatewayRequest.input).toStrictEqual(input);
    expect(gatewayRequest.input).not.toHaveProperty('brandKnowledge');
    expect(result.output.insights[0]?.limitations).toContain('small sample');
  });
});
