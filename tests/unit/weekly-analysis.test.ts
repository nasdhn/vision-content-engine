import { describe, expect, it } from 'vitest';

import { latestCompletedUtcWeek } from '../../packages/application/src/weekly-analysis.js';
import {
  WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION,
  WEEKLY_ANALYSIS_CONTEXT_VERSION,
  WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION,
  weeklyAnalysisOperationKeyFor,
} from '../../packages/contracts/src/weekly-analysis.js';

const base = {
  analysisWindow: {
    from: '2026-09-14T00:00:00.000Z',
    to: '2026-09-21T00:00:00.000Z',
  },
  measurementWindow: 'T_PLUS_24H' as const,
  evidencePolicyVersion: WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION,
  analystPromptVersion: WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION,
  contextBuilderVersion: WEEKLY_ANALYSIS_CONTEXT_VERSION,
  knowledgeSnapshot: {
    id: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4745',
    version: 1,
    contentHash: 'a'.repeat(64),
  },
  policy: {
    capability: 'ANALYST' as const,
    maxAttempts: 1,
    timeoutMs: 1_000,
    fallbackPolicy: 'NONE' as const,
    maxInputTokens: 10_000,
    maxOutputTokens: 1_000,
    maxEstimatedCost: 0.1,
  },
  budget: {
    key: 'weekly-test',
    from: '2026-01-01T00:00:00.000Z',
    to: '2027-01-01T00:00:00.000Z',
    limit: '1.00000000',
    currency: 'EUR',
  },
};

describe('Phase 9E weekly analysis identity/window', () => {
  it('derives one stable logical key from the frozen semantic operation, not knowledge identity', () => {
    const first = weeklyAnalysisOperationKeyFor(base);
    const retry = weeklyAnalysisOperationKeyFor({
      ...base,
      knowledgeSnapshot: {
        ...base.knowledgeSnapshot,
        id: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4746',
        version: 2,
        contentHash: 'b'.repeat(64),
      },
    });

    expect(retry).toBe(first);
    expect(
      weeklyAnalysisOperationKeyFor({
        ...base,
        analysisWindow: {
          from: '2026-09-07T00:00:00.000Z',
          to: '2026-09-14T00:00:00.000Z',
        },
      }),
    ).not.toBe(first);
    expect(weeklyAnalysisOperationKeyFor({ ...base, measurementWindow: 'T_PLUS_72H' })).not.toBe(
      first,
    );
  });

  it('selects the latest completed Monday-to-Monday UTC week', () => {
    expect(latestCompletedUtcWeek(new Date('2026-09-23T10:15:00.000Z'))).toEqual({
      from: '2026-09-14T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
    });
    expect(latestCompletedUtcWeek(new Date('2026-09-21T00:00:00.000Z'))).toEqual({
      from: '2026-09-14T00:00:00.000Z',
      to: '2026-09-21T00:00:00.000Z',
    });
  });

  it('rejects non-weekly or non-midnight windows', () => {
    expect(() =>
      weeklyAnalysisOperationKeyFor({
        ...base,
        analysisWindow: {
          from: '2026-09-14T01:00:00.000Z',
          to: '2026-09-21T01:00:00.000Z',
        },
      }),
    ).toThrow();
  });
});
