import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  YOUTUBE_ANALYTICS_METRICS,
  YOUTUBE_ANALYTICS_SCOPE,
  YouTubeAnalyticsCollector,
  type AnalyticsCollectionSnapshot,
  type YouTubeAnalyticsComplianceHook,
  type YouTubeAnalyticsComplianceState,
  type YouTubeAnalyticsCredential,
  type YouTubeAnalyticsCredentialResolver,
} from '../../packages/analytics/src/index.js';

const NOW = new Date('2026-09-22T18:00:00.000Z');

function snapshot(
  overrides: Partial<AnalyticsCollectionSnapshot> = {},
): AnalyticsCollectionSnapshot {
  return {
    publicationId: randomUUID(),
    platformAccountId: randomUUID(),
    platform: 'YOUTUBE',
    remotePostId: 'dQw4w9WgXcQ',
    publishedAt: '2026-09-19T12:00:00.000Z',
    adapterKey: 'YOUTUBE_ANALYTICS_V1',
    windowKey: 'T_PLUS_72H',
    scheduledFor: '2026-09-22T12:00:00.000Z',
    collectionOperationId: randomUUID(),
    ...overrides,
  };
}

function credentials(
  overrides: Partial<YouTubeAnalyticsCredential> = {},
): YouTubeAnalyticsCredentialResolver {
  return {
    resolve: vi.fn(async () => ({
      accessToken: 'unit-test-token',
      grantedScopes: [YOUTUBE_ANALYTICS_SCOPE],
      expiresAt: '2026-09-22T20:00:00.000Z',
      ...overrides,
    })),
  };
}

function compliance(
  overrides: Partial<YouTubeAnalyticsComplianceState> = {},
): YouTubeAnalyticsComplianceHook {
  return {
    verify: vi.fn(async () => ({
      checkedAt: '2026-09-22T17:30:00.000Z',
      authorizationValid: true,
      videoExists: true,
      deletionRequired: false,
      ...overrides,
    })),
  };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Phase 8C YouTube Analytics adapter', () => {
  it('queries channel==MINE with an exact video filter and maps shuffled response headers by name', async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.origin).toBe('https://youtubeanalytics.googleapis.com');
      expect(url.pathname).toBe('/v2/reports');
      expect(url.searchParams.get('ids')).toBe('channel==MINE');
      expect(url.searchParams.get('filters')).toBe('video==dQw4w9WgXcQ');
      expect(url.searchParams.get('startDate')).toBe('2026-09-19');
      expect(url.searchParams.get('endDate')).toBe('2026-09-22');
      expect(url.searchParams.get('metrics')).toBe(YOUTUBE_ANALYTICS_METRICS.join(','));
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer unit-test-token');
      return jsonResponse({
        columnHeaders: [
          { name: 'shares', columnType: 'METRIC', dataType: 'INTEGER' },
          { name: 'views', columnType: 'METRIC', dataType: 'INTEGER' },
          { name: 'averageViewPercentage', columnType: 'METRIC', dataType: 'FLOAT' },
          { name: 'comments', columnType: 'METRIC', dataType: 'INTEGER' },
          { name: 'estimatedMinutesWatched', columnType: 'METRIC', dataType: 'INTEGER' },
          { name: 'engagedViews', columnType: 'METRIC', dataType: 'INTEGER' },
          { name: 'averageViewDuration', columnType: 'METRIC', dataType: 'FLOAT' },
          { name: 'likes', columnType: 'METRIC', dataType: 'INTEGER' },
        ],
        rows: [[3, 1200, 67.5, 4, 25, 900, 42.125, 80]],
      });
    });
    const collector = new YouTubeAnalyticsCollector(credentials(), compliance(), {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    });
    const observation = await collector.collect(snapshot());
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observation.metrics).toMatchObject({
      views: 1200n,
      engagedViews: 900n,
      likes: 80n,
      comments: 4n,
      shares: 3n,
      watchTimeMs: 1_500_000n,
      avgWatchDurationMs: 42_125,
      avgWatchPercentage: 67.5,
    });
    expect(observation.metrics.follows).toBeNull();
    expect(observation.providerSchemaVersion).toMatch(
      /^youtube-analytics-adapter-v1:[0-9a-f]{16}$/,
    );
    expect(observation.rawPayload).toMatchObject({
      request: { ids: 'channel==MINE', filters: 'video==dQw4w9WgXcQ' },
    });
    expect(JSON.stringify(observation.rawPayload)).not.toContain('unit-test-token');
  });

  it('preserves an empty delayed report as NOT_YET_AVAILABLE with NULL metrics', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        columnHeaders: YOUTUBE_ANALYTICS_METRICS.map((name) => ({
          name,
          columnType: 'METRIC',
          dataType: 'INTEGER',
        })),
        rows: [],
      }),
    );
    const collector = new YouTubeAnalyticsCollector(
      credentials(),
      compliance({ checkedAt: '2026-09-19T12:30:00.000Z' }),
      {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => new Date('2026-09-19T13:00:00.000Z'),
      },
    );
    const observation = await collector.collect(
      snapshot({
        publishedAt: '2026-09-19T12:00:00.000Z',
        scheduledFor: '2026-09-19T13:00:00.000Z',
        windowKey: 'T_PLUS_1H',
      }),
    );
    expect(observation.availability.status).toBe('NOT_YET_AVAILABLE');
    expect(observation.metrics.views).toBeNull();
    expect(observation.metrics.avgWatchDurationMs).toBeNull();
    expect(observation.availability.notes.join(' ')).toContain('48–72');
  });

  it('fails closed on response schema drift instead of positional guessing', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        columnHeaders: YOUTUBE_ANALYTICS_METRICS.filter((name) => name !== 'shares').map(
          (name) => ({ name }),
        ),
        rows: [[1, 1, 1, 1, 1, 1, 1]],
      }),
    );
    const collector = new YouTubeAnalyticsCollector(credentials(), compliance(), {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    });
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'SCHEMA_DRIFT',
      message: 'YOUTUBE_ANALYTICS_MISSING_HEADER:shares',
    });
  });

  it('requires the minimum yt-analytics.readonly scope before any provider call', async () => {
    const fetchImpl = vi.fn();
    const collector = new YouTubeAnalyticsCollector(
      credentials({ grantedScopes: ['https://www.googleapis.com/auth/youtube.upload'] }),
      compliance(),
      {
        fetchImpl: fetchImpl as typeof fetch,
        now: () => NOW,
      },
    );
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'AUTH_REQUIRED',
      message: 'YOUTUBE_ANALYTICS_READ_SCOPE_REQUIRED',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('enforces the 30-day authorization/video compliance recheck hook before credentials or HTTP', async () => {
    const credentialResolver = credentials();
    const fetchImpl = vi.fn();
    const collector = new YouTubeAnalyticsCollector(
      credentialResolver,
      compliance({ checkedAt: '2026-08-20T17:00:00.000Z' }),
      { fetchImpl: fetchImpl as typeof fetch, now: () => NOW },
    );
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'COMPLIANCE_RECHECK_REQUIRED',
      message: 'YOUTUBE_ANALYTICS_30_DAY_RECHECK_REQUIRED',
    });
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops collection when the compliance hook says stored YouTube data must be deleted', async () => {
    const credentialResolver = credentials();
    const fetchImpl = vi.fn();
    const collector = new YouTubeAnalyticsCollector(
      credentialResolver,
      compliance({ videoExists: false, deletionRequired: true }),
      { fetchImpl: fetchImpl as typeof fetch, now: () => NOW },
    );
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'DELETION_REQUIRED',
      message: 'YOUTUBE_ANALYTICS_STORED_DATA_DELETION_REQUIRED',
    });
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('classifies authorization, unsupported-query, provider and network failures', async () => {
    const responses = [
      jsonResponse({ error: { errors: [{ reason: 'authError' }] } }, 401),
      jsonResponse({ error: { errors: [{ reason: 'queryNotSupported' }] } }, 400),
      jsonResponse({ error: { errors: [{ reason: 'backendError' }] } }, 503),
    ];
    const fetchImpl = vi.fn(async () => responses.shift()!);
    const collector = new YouTubeAnalyticsCollector(credentials(), compliance(), {
      fetchImpl: fetchImpl as typeof fetch,
      now: () => NOW,
    });
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'AUTH_REQUIRED',
    });
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'SCHEMA_DRIFT',
    });
    await expect(collector.collect(snapshot())).rejects.toMatchObject({
      failureCode: 'SOURCE_UNAVAILABLE',
      retryable: true,
    });
    await expect(
      new YouTubeAnalyticsCollector(credentials(), compliance(), {
        fetchImpl: (async () => {
          throw new Error('network down');
        }) as typeof fetch,
        now: () => NOW,
      }).collect(snapshot()),
    ).rejects.toMatchObject({
      failureCode: 'SOURCE_UNAVAILABLE',
      message: 'YOUTUBE_ANALYTICS_SOURCE_UNAVAILABLE',
    });
  });

  it('requires HTTPS for the Analytics endpoint', () => {
    expect(
      () =>
        new YouTubeAnalyticsCollector(credentials(), compliance(), {
          apiBaseUrl: 'http://youtubeanalytics.invalid/v2',
        }),
    ).toThrow('YOUTUBE_ANALYTICS_HTTPS_REQUIRED');
  });
});
