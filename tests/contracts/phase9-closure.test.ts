import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AUTHORITATIVE_ATTRIBUTION_SOURCE,
  EVIDENCE_CONFIDENCE_LEVELS,
  EVIDENCE_POLICY_RUNTIME_V1,
  EvidenceComparabilityService,
  buildEvidenceFrame,
  nullSafeRate,
} from '../../packages/application/src/learning-evidence.js';
import { buildExperimentEvidenceAnalysis } from '../../packages/application/src/experiment-evidence.js';
import {
  AnalystRuntime,
  validateAnalystOutput,
} from '../../packages/application/src/analyst-runtime.js';
import { LearningDashboardService } from '../../packages/application/src/learning-read.js';
import { Learning } from '../../packages/database/src/learning.js';
import { WeeklyAnalysisRepository } from '../../packages/database/src/weekly-analysis.js';
import { AnalystInputSchema, AnalystOutputSchema } from '../../packages/contracts/src/analyst.js';
import {
  WEEKLY_ANALYSIS_JOB_TYPE,
  WeeklyAnalysisQueueJobSchema,
} from '../../packages/contracts/src/weekly-analysis.js';
import { isRealProviderActivationEnabled, parseConfig } from '../../packages/shared/src/config.js';
import { collectionWindowsFor } from '../../packages/analytics/src/index.js';
import { assertSchedulingCapabilities } from '../../packages/publishing/src/index.js';
import { configFixture } from '../support/config.js';

const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const contract = JSON.parse(
  readFileSync('docs/implementation-artifacts/phase9/learning-runtime-contract.v1.json', 'utf8'),
);
const report = readFileSync('docs/PHASE_9_REPORT.md', 'utf8');

describe('Phase 9 closure contract', () => {
  it('reuses all historical gates and adds the frozen Learning transport gate', () => {
    expect(root.scripts['check:phase9']).toBe('pnpm check:phase8 && pnpm test:learning:runtime');
    expect(root.scripts['check:phase8']).toBe(
      'pnpm test:infra && pnpm check && pnpm test:postgres && pnpm test:storage && pnpm test:analytics:runtime && pnpm test:distribution:runtime && pnpm build:web && pnpm test:browser',
    );
    expect(root.scripts['test:learning:runtime']).toBe(
      'tsx tests/runtime/learning-bullmq-smoke.ts',
    );
  });

  it('connects 9A policy and source authority to the frozen contract', () => {
    expect(EvidenceComparabilityService).toBeTypeOf('function');
    expect(EVIDENCE_CONFIDENCE_LEVELS).toEqual(contract.evidencePolicy.confidenceLevels);
    expect(EVIDENCE_POLICY_RUNTIME_V1).toMatchObject({
      version: contract.evidencePolicy.key,
      singlePublicationMaxConfidence: 'WEAK_SIGNAL',
      interestingSignal: contract.evidencePolicy.interestingSignal,
      fairlySolid: {
        minimumComparablePublications: 6,
        minimumDistinctPublishDates: 3,
        outlierDominanceShare: contract.evidencePolicy.outlierDominanceShare,
        consistentDirectionShare: contract.evidencePolicy.consistentDirectionShare,
      },
    });
    expect(AUTHORITATIVE_ATTRIBUTION_SOURCE).toEqual(contract.sourceAuthority);
    expect(nullSafeRate(null, 10)).toBeNull();
    expect(nullSafeRate(0, 10)).toBe(0);
    expect(
      buildEvidenceFrame({
        metricKey: 'views',
        measurementWindow: 'T_PLUS_24H',
        analysisWindow: { from: new Date('2026-09-14Z'), to: new Date('2026-09-21Z') },
        observations: [],
        confoundersDocumented: false,
      }).deterministicConfidenceCeiling,
    ).toBe('INSUFFICIENT_DATA');
  });

  it('keeps 9B descriptive with no automatic winner or status mutation', () => {
    const experiment = {
      id: 'closure-experiment',
      name: 'Closure',
      hypothesis: 'A variant may differ.',
      primaryMetric: 'views',
      status: 'RUNNING',
    };
    const before = structuredClone(experiment);
    const result = buildExperimentEvidenceAnalysis({
      experiment,
      arms: [],
      confoundersDocumented: false,
      measurementWindow: 'T_PLUS_24H',
      analysisWindow: { from: new Date('2026-09-14Z'), to: new Date('2026-09-21Z') },
    });
    expect(result).not.toHaveProperty('winner');
    expect(result.primaryMetric).toBe('views');
    expect(experiment).toEqual(before);
  });

  it('executes 9C causal hard validation, with no strategy commands in output', () => {
    expect(AnalystRuntime.prototype.analyze).toBeTypeOf('function');
    expect(contract.causalClaimsAllowed).toBe(false);
    expect(contract.strategyAutopilotAllowed).toBe(false);
    const input = AnalystInputSchema.parse({
      analysisWindow: { from: '2026-09-14T00:00:00.000Z', to: '2026-09-21T00:00:00.000Z' },
      publications: [],
      experiments: [],
      priorInsights: [],
      attributionSignals: {},
      minimumEvidencePolicy: {
        minimumComparableSamples: 3,
        confidenceRulesVersion: 'EVIDENCE_POLICY_RUNTIME_V1',
      },
    });
    const output = AnalystOutputSchema.parse({
      insights: [
        {
          statement: 'The hook caused the improvement.',
          confidence: 'INSUFFICIENT_DATA',
          evidencePublicationIds: [],
          limitations: [],
          dimensions: {},
        },
      ],
      recommendations: [],
    });
    const context = {
      deterministicConfidenceCeiling: 'INSUFFICIENT_DATA' as const,
      mandatoryLimitations: [],
      allowedPrimaryMetrics: ['views'],
      allowedMeasurementWindows: ['T_PLUS_24H'],
    };
    expect(() => validateAnalystOutput(input, output, context)).toThrow(
      'ANALYST_CAUSAL_CLAIM_FORBIDDEN',
    );
    expect(Object.keys(AnalystOutputSchema.shape).sort()).toEqual(['insights', 'recommendations']);
    expect(
      AnalystOutputSchema.safeParse({
        insights: [],
        recommendations: [],
        strategy: { cadence: 10 },
      }).success,
    ).toBe(false);
  });

  it('keeps 9D persistence and explicit human proposal as separate entry points', () => {
    expect(Learning.prototype.persistValidatedAnalystOutput).toBeTypeOf('function');
    expect(Learning.prototype.transitionRecommendation).toBeTypeOf('function');
    expect(Learning.prototype.createExperimentProposal).toBeTypeOf('function');
    // PostgreSQL closure gates exercise all transitions, acceptance without an Experiment,
    // and concurrent explicit proposals against real transactions/locks.
    expect(contract.recommendationLifecycle).toEqual({
      initialStatus: 'PROPOSED',
      allowedTransitions: [
        ['PROPOSED', 'ACCEPTED'],
        ['PROPOSED', 'REJECTED'],
        ['ACCEPTED', 'EXECUTED'],
      ],
      acceptanceCreatesExperimentAutomatically: false,
      explicitProposalActionCreatesDraftExperiment: true,
      proposalActionMustBeIdempotent: true,
    });
  });

  it('keeps 9E canonical persistence/checkpoint recovery and 9F guarded read/action boundaries', () => {
    expect(WEEKLY_ANALYSIS_JOB_TYPE).toBe('WEEKLY_ANALYSIS');
    expect(
      WeeklyAnalysisQueueJobSchema.shape.analysisOperationKey.safeParse('a'.repeat(64)).success,
    ).toBe(true);
    expect(WeeklyAnalysisRepository.prototype.readOutputCheckpoint).toBeTypeOf('function');
    expect(WeeklyAnalysisRepository.prototype.complete).toBeTypeOf('function');
    expect(contract.weeklyAnalysis).toMatchObject({
      operationIdentityStableAcrossRetry: true,
      atomicLearningOutputPersistence: true,
      workerPayloadSecretFree: true,
    });
    expect(LearningDashboardService.prototype.list).toBeTypeOf('function');
    expect(LearningDashboardService.prototype.detail).toBeTypeOf('function');
    expect(LearningDashboardService.prototype.transitionRecommendation).toBeTypeOf('function');
    expect(LearningDashboardService.prototype.createExperimentProposal).toBeTypeOf('function');
  });

  it('keeps real provider activation off by default and publishing paused', () => {
    expect(contract.realProvidersEnabled).toBe(false);

    const config = parseConfig(configFixture);
    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('false');
    expect(config.PAUSE_ALL_PUBLISHING).toBe(true);
    expect(isRealProviderActivationEnabled(config)).toBe(false);

    const localWithExplicitFlag = parseConfig({
      ...configFixture,
      VCE_REAL_PROVIDERS_ENABLED: 'true',
    });

    expect(localWithExplicitFlag.VCE_REAL_PROVIDERS_ENABLED).toBe('true');
    expect(isRealProviderActivationEnabled(localWithExplicitFlag)).toBe(false);
  });

  it('keeps TikTok publishing and analytics manual', () => {
    expect(collectionWindowsFor('TIKTOK', 'PLATFORM_API')).toEqual([]);
    expect(collectionWindowsFor('TIKTOK', 'MANUAL_ENTRY').length).toBeGreaterThan(0);
    expect(() =>
      assertSchedulingCapabilities({
        platform: 'TIKTOK',
        deliveryMode: 'API_AUTOMATED',
        credentialsConfigured: true,
        capabilities: {},
        metadata: {
          schemaVersion: 'tiktok-manual-handoff-v1',
          platform: 'TIKTOK',
          caption: 'Closure',
          hashtags: [],
          commercialDisclosureReminder: true,
        },
      }),
    ).toThrow('TIKTOK_MANUAL_ONLY');
  });

  it('records closure without authorizing migrations or future activation', () => {
    expect(contract.prismaMigrationExpected).toBe(false);
    expect(report).toContain('9a70d37c3fc93644d995a977d4c6f05fb6c6ff5e');
    expect(report).toContain('Phase 10 — Security / Operations Hardening');
    expect(report).toContain('Phase 10 does not start automatically');
    expect(report).toContain('Phase 11');
  });
});
