import { describe, expect, it } from 'vitest';

import {
  buildExperimentEvidenceAnalysis,
  type ExperimentEvidenceArmInput,
} from '../../packages/application/src/experiment-evidence.js';

const analysisWindow = {
  from: new Date('2026-09-01T00:00:00.000Z'),
  to: new Date('2026-10-01T00:00:00.000Z'),
};

function arm(
  id: string,
  metricValue: number | bigint | null,
  overrides: Partial<ExperimentEvidenceArmInput> = {},
): ExperimentEvidenceArmInput {
  return {
    id,
    label: id,
    conceptVersionId: null,
    publicationId: `publication-${id}`,
    publication: {
      id: `publication-${id}`,
      status: 'PUBLISHED',
      publishedAt: `2026-09-${id === 'A' ? '10' : '11'}T12:00:00.000Z`,
      platform: 'INSTAGRAM',
      collectedAt: `2026-09-${id === 'A' ? '11' : '12'}T12:00:00.000Z`,
      measurementWindow: 'T_PLUS_24H',
      metricSemanticsVersion: 'canonical-metrics-v1',
      metricValue,
      crossPlatformComparable: false,
      comparabilityNotes: [],
    },
    ...overrides,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    experiment: {
      id: 'experiment-1',
      name: 'Hook test',
      hypothesis: 'A concise hook may improve observed likes.',
      primaryMetric: 'likes',
      status: 'RUNNING',
    },
    measurementWindow: 'T_PLUS_24H' as const,
    analysisWindow,
    confoundersDocumented: true,
    arms: [arm('A', 12), arm('B', 0)],
    ...overrides,
  };
}

describe('Phase 9B Experiment Evidence Analyzer', () => {
  it('uses only the declared Experiment primaryMetric and returns descriptive arm evidence', () => {
    const result = buildExperimentEvidenceAnalysis(input());

    expect(result.primaryMetric).toBe('likes');
    expect(result.readiness).toBe('READY');
    expect(result.arms.map((entry) => [entry.label, entry.metricValue])).toEqual([
      ['A', 12],
      ['B', 0],
    ]);
    expect('winner' in result).toBe(false);
    expect(
      result.limitations.some((value) =>
        value.includes('does not declare an authoritative winner'),
      ),
    ).toBe(true);
  });

  it('fails closed when primaryMetric is missing', () => {
    const result = buildExperimentEvidenceAnalysis(
      input({
        experiment: {
          id: 'experiment-1',
          name: 'Missing metric',
          hypothesis: 'No declared metric.',
          primaryMetric: null,
          status: 'DRAFT',
        },
      }),
    );

    expect(result.readiness).toBe('PRIMARY_METRIC_MISSING');
    expect(result.evidenceFrame).toBeNull();
  });

  it('fails closed when primaryMetric is unsupported', () => {
    const result = buildExperimentEvidenceAnalysis(
      input({
        experiment: {
          id: 'experiment-1',
          name: 'Unsupported metric',
          hypothesis: 'No silent metric substitution.',
          primaryMetric: 'madeUpScore',
          status: 'RUNNING',
        },
      }),
    );

    expect(result.readiness).toBe('UNSUPPORTED_PRIMARY_METRIC');
    expect(result.evidenceFrame).toBeNull();
  });

  it('does not guess publication membership from conceptVersionId', () => {
    const result = buildExperimentEvidenceAnalysis(
      input({
        arms: [
          arm('A', 12),
          {
            id: 'B',
            label: 'B',
            conceptVersionId: 'concept-version-b',
            publicationId: null,
            publication: null,
          },
        ],
      }),
    );

    expect(result.readiness).toBe('INSUFFICIENT_DATA');
    expect(result.arms[1]?.readiness).toBe('PUBLICATION_NOT_ASSIGNED');
    expect(result.arms[1]?.limitations[0]).toContain('not used to guess');
  });

  it('preserves primary-metric NULL separately from observed zero', () => {
    const result = buildExperimentEvidenceAnalysis(
      input({
        arms: [arm('A', null), arm('B', 0)],
      }),
    );

    expect(result.arms[0]?.readiness).toBe('METRIC_UNAVAILABLE');
    expect(result.arms[0]?.metricValue).toBeNull();
    expect(result.arms[1]?.readiness).toBe('READY');
    expect(result.arms[1]?.metricValue).toBe(0);
    expect(result.readiness).toBe('INSUFFICIENT_DATA');
  });

  it('blocks direct comparison when metric semantics differ', () => {
    const result = buildExperimentEvidenceAnalysis(
      input({
        arms: [
          arm('A', 12),
          arm('B', 10, {
            publication: {
              ...arm('B', 10).publication!,
              metricSemanticsVersion: 'provider-drift-v2',
            },
          }),
        ],
      }),
    );

    expect(result.readiness).toBe('INSUFFICIENT_DATA');
    expect(result.arms.some((entry) => entry.readiness === 'EXCLUDED_FROM_COMPARISON')).toBe(true);
  });

  it('keeps experiment status descriptive and does not infer causal effects', () => {
    const result = buildExperimentEvidenceAnalysis(input());

    expect(result.experimentStatus).toBe('RUNNING');
    expect(result.limitations.join(' ')).toContain('descriptive only');
    expect(result.limitations.join(' ')).toContain('causal effect');
  });
});
