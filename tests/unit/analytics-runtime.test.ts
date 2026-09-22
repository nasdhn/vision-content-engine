import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AnalyticsCollectionJobSchema,
  AnalyticsObservationSchema,
  AUTOMATED_PLATFORM_WINDOWS,
  EMPTY_CANONICAL_METRICS,
  collectionDueAt,
  collectionOperationIdFor,
  collectionWindowsFor,
  parseAnalyticsOutboxEvent,
} from '../../packages/analytics/src/index.js';

describe('Phase 8A analytics runtime contracts', () => {
  it('keeps the frozen automated collection windows exact and versioned', () => {
    expect(AUTOMATED_PLATFORM_WINDOWS.map((window) => [window.key, window.offsetSeconds])).toEqual([
      ['T_PLUS_1H', 3_600],
      ['T_PLUS_6H', 21_600],
      ['T_PLUS_24H', 86_400],
      ['T_PLUS_72H', 259_200],
      ['T_PLUS_7D', 604_800],
      ['T_PLUS_30D', 2_592_000],
    ]);
    expect(collectionWindowsFor('TIKTOK', 'PLATFORM_API')).toHaveLength(0);
    expect(
      collectionDueAt(new Date('2026-01-01T00:00:00Z'), AUTOMATED_PLATFORM_WINDOWS[0]!),
    ).toEqual(new Date('2026-01-01T01:00:00Z'));
  });

  it('derives a stable UUID collectionOperationId from logical collection identity', () => {
    const publicationId = randomUUID();
    const input = {
      publicationId,
      adapterKey: 'YOUTUBE_ANALYTICS_V1',
      windowKey: 'T_PLUS_24H' as const,
      collectionMethod: 'PLATFORM_API' as const,
    };
    const first = collectionOperationIdFor(input);
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    expect(collectionOperationIdFor(input)).toBe(first);
    expect(collectionOperationIdFor({ ...input, windowKey: 'T_PLUS_72H' })).not.toBe(first);
  });

  it('preserves NULL distinct from explicit observed zero', () => {
    expect(
      AnalyticsObservationSchema.parse({
        collectedAt: '2026-09-22T12:00:00.000Z',
        providerSchemaVersion: 'fixture-v1',
        rawPayload: { views: 0 },
        metrics: { ...EMPTY_CANONICAL_METRICS, views: 0n },
        availability: { status: 'AVAILABLE', unavailableMetrics: [], notes: [] },
        comparability: { crossPlatformViewsComparable: false, notes: [] },
        normalizerVersion: 'fixture-normalizer-v1',
        metricSemanticsVersion: 'canonical-metrics-v1',
      }).metrics.views,
    ).toBe(0n);
    expect(EMPTY_CANONICAL_METRICS.views).toBeNull();
  });

  it('rejects secret-like extra fields from the strict queue contract', () => {
    const payload = {
      schemaVersion: 'v1',
      kind: 'COLLECT_PLATFORM_METRICS',
      workflowRunId: randomUUID(),
      jobAttemptId: randomUUID(),
      publicationId: randomUUID(),
      platformAccountId: randomUUID(),
      platform: 'YOUTUBE',
      adapterKey: 'YOUTUBE_ANALYTICS_V1',
      windowKey: 'T_PLUS_24H',
      collectionOperationId: randomUUID(),
      scheduledFor: '2026-09-23T12:00:00.000Z',
    };
    expect(
      parseAnalyticsOutboxEvent({
        id: randomUUID(),
        eventType: 'Analytics.collection.requested',
        payloadJson: payload,
      }),
    ).toMatchObject({ platform: 'YOUTUBE', windowKey: 'T_PLUS_24H' });
    expect(() =>
      AnalyticsCollectionJobSchema.parse({
        ...payload,
        outboxEventId: randomUUID(),
        accessToken: 'secret',
      }),
    ).toThrow();
  });
});
