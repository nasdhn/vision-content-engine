import { describe, expect, it } from 'vitest';

import {
  authoritativeSourceFor,
  buildEvidenceFrame,
  isAuthoritativeAttributionSource,
  nullSafeRate,
  type LearningEvidenceObservation,
} from '../../packages/application/src/learning-evidence.js';

const analysisWindow = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-10-01T00:00:00.000Z'),
};

function observation(
  overrides: Partial<LearningEvidenceObservation> &
    Pick<LearningEvidenceObservation, 'publicationId'>,
): LearningEvidenceObservation {
  const { publicationId, ...rest } = overrides;
  return {
    publicationId,
    platform: 'INSTAGRAM',
    publishedAt: '2026-09-10T12:00:00.000Z',
    collectedAt: '2026-09-11T12:00:00.000Z',
    measurementWindow: 'T_PLUS_24H',
    metricSemanticsVersion: 'canonical-metrics-v1',
    metricValue: 10,
    effectDirection: 1,
    crossPlatformComparable: false,
    comparabilityNotes: [],
    ...rest,
  };
}

describe('Phase 9A Evidence & Comparability Engine', () => {
  it('caps a single publication at WEAK_SIGNAL', () => {
    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations: [observation({ publicationId: '00000000-0000-7000-8000-000000000001' })],
      confoundersDocumented: true,
    });

    expect(frame.sampleSize).toBe(1);
    expect(frame.deterministicConfidenceCeiling).toBe('WEAK_SIGNAL');
  });

  it('blocks different measurement windows from direct comparison', () => {
    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations: [
        observation({ publicationId: '00000000-0000-7000-8000-000000000001' }),
        observation({
          publicationId: '00000000-0000-7000-8000-000000000002',
          measurementWindow: 'T_PLUS_72H',
        }),
      ],
      confoundersDocumented: true,
    });

    expect(frame.sampleSize).toBe(1);
    expect(frame.excluded).toContainEqual({
      publicationId: '00000000-0000-7000-8000-000000000002',
      reason: 'MEASUREMENT_WINDOW_MISMATCH',
    });
  });

  it('blocks incompatible metric semantics deterministically', () => {
    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations: [
        observation({ publicationId: 'a', metricSemanticsVersion: 'canonical-metrics-v1' }),
        observation({ publicationId: 'b', metricSemanticsVersion: 'canonical-metrics-v1' }),
        observation({ publicationId: 'c', metricSemanticsVersion: 'provider-drift-v2' }),
      ],
      confoundersDocumented: true,
    });

    expect(frame.metricSemanticsVersion).toBe('canonical-metrics-v1');
    expect(frame.excluded).toContainEqual({
      publicationId: 'c',
      reason: 'INCOMPATIBLE_METRIC_SEMANTICS',
    });
  });

  it('blocks cross-platform comparison unless every observation explicitly permits it', () => {
    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations: [
        observation({ publicationId: 'a', platform: 'INSTAGRAM' }),
        observation({ publicationId: 'b', platform: 'INSTAGRAM' }),
        observation({
          publicationId: 'c',
          platform: 'YOUTUBE',
          crossPlatformComparable: false,
        }),
      ],
      confoundersDocumented: true,
    });

    expect(frame.platforms).toEqual(['INSTAGRAM']);
    expect(frame.excluded).toContainEqual({
      publicationId: 'c',
      reason: 'INCOMPATIBLE_PLATFORM',
    });
  });

  it('preserves NULL versus observed zero in rate semantics', () => {
    expect(nullSafeRate(null, 10n)).toBeNull();
    expect(nullSafeRate(0n, 10n)).toBe(0);
    expect(nullSafeRate(5n, 0n)).toBeNull();
    expect(nullSafeRate(5n, 10n)).toBe(0.5);
  });

  it('caps confidence when one observation dominates the sample', () => {
    const observations = [1000, 1, 1, 1, 1, 1].map((metricValue, index) =>
      observation({
        publicationId: `p-${index}`,
        metricValue,
        publishedAt: `2026-09-${String(10 + (index % 3)).padStart(2, '0')}T12:00:00.000Z`,
        effectDirection: 1,
      }),
    );

    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations,
      confoundersDocumented: true,
      confounders: ['same CTA', 'same target audience'],
    });

    expect(frame.diagnostics.outlierDominanceShare).toBeGreaterThan(0.6);
    expect(frame.deterministicConfidenceCeiling).toBe('INTERESTING_SIGNAL');
  });

  it('allows FAIRLY_SOLID only when sample, dates, direction and outlier checks all pass', () => {
    const observations = [10, 11, 9, 12, 10, 11].map((metricValue, index) =>
      observation({
        publicationId: `p-${index}`,
        metricValue,
        publishedAt: `2026-09-${String(10 + (index % 3)).padStart(2, '0')}T12:00:00.000Z`,
        effectDirection: 1,
      }),
    );

    const frame = buildEvidenceFrame({
      metricKey: 'views',
      measurementWindow: 'T_PLUS_24H',
      analysisWindow,
      observations,
      confoundersDocumented: true,
      confounders: ['same campaign', 'same CTA'],
    });

    expect(frame.sampleSize).toBe(6);
    expect(frame.distinctPublishDates).toBe(3);
    expect(frame.diagnostics.consistentDirectionShare).toBe(1);
    expect(frame.deterministicConfidenceCeiling).toBe('FAIRLY_SOLID');
  });

  it('inherits Phase 8 business-outcome source authority', () => {
    expect(authoritativeSourceFor('WEBSITE_VISIT')).toBe('UMAMI');
    expect(authoritativeSourceFor('SIGNUP')).toBe('VISION_APP');
    expect(isAuthoritativeAttributionSource('CUSTOMER', 'VISION_APP')).toBe(true);
    expect(isAuthoritativeAttributionSource('CUSTOMER', 'MANUAL')).toBe(false);
  });
});
