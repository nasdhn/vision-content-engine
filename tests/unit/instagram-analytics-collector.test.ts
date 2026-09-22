import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  INSTAGRAM_ANALYTICS_ADAPTER_KEY,
  InstagramAnalyticsCollector,
  adapterKeyFor,
  type AnalyticsCollectionSnapshot,
  type InstagramAnalyticsCapabilityHook,
  type InstagramAnalyticsCapabilityState,
  type InstagramAnalyticsCredential,
  type InstagramAnalyticsCredentialResolver,
  type InstagramAnalyticsMetricProfile,
} from '../../packages/analytics/src/index.js';

const NOW = new Date('2026-09-22T18:00:00.000Z');

const PROFILE: InstagramAnalyticsMetricProfile = {
  profileVersion: 'meta-media-insights-fixture-2026-09-22',
  mappings: [
    { providerMetric: 'views', canonicalMetric: 'views', providerUnit: 'COUNT' },
    { providerMetric: 'reach', canonicalMetric: 'reach', providerUnit: 'COUNT' },
    { providerMetric: 'likes', canonicalMetric: 'likes', providerUnit: 'COUNT' },
    { providerMetric: 'comments', canonicalMetric: 'comments', providerUnit: 'COUNT' },
    { providerMetric: 'shares', canonicalMetric: 'shares', providerUnit: 'COUNT' },
    { providerMetric: 'saved', canonicalMetric: 'saves', providerUnit: 'COUNT' },
    {
      providerMetric: 'fixture_total_watch_time',
      canonicalMetric: 'watchTimeMs',
      providerUnit: 'MILLISECONDS',
    },
    {
      providerMetric: 'fixture_avg_watch_time',
      canonicalMetric: 'avgWatchDurationMs',
      providerUnit: 'MILLISECONDS',
    },
  ],
};

function snapshot(
  overrides: Partial<AnalyticsCollectionSnapshot> = {},
): AnalyticsCollectionSnapshot {
  return {
    publicationId: randomUUID(),
    platformAccountId: randomUUID(),
    platform: 'INSTAGRAM',
    remotePostId: '17890000000000001',
    publishedAt: '2026-09-22T12:00:00.000Z',
    adapterKey: INSTAGRAM_ANALYTICS_ADAPTER_KEY,
    windowKey: 'T_PLUS_6H',
    scheduledFor: '2026-09-22T18:00:00.000Z',
    collectionOperationId: randomUUID(),
    ...overrides,
  };
}

function credentials(
  overrides: Partial<InstagramAnalyticsCredential> = {},
): InstagramAnalyticsCredentialResolver {
  return {
    resolve: vi.fn(async () => ({
      accessToken: 'fixture-instagram-analytics-token',
      expiresAt: '2026-09-22T20:00:00.000Z',
      ...overrides,
    })),
  };
}

function capabilities(
  overrides: Partial<InstagramAnalyticsCapabilityState> = {},
): InstagramAnalyticsCapabilityHook {
  return {
    verify: vi.fn(async () => ({
      checkedAt: '2026-09-22T17:30:00.000Z',
      validUntil: '2026-10-01T00:00:00.000Z',
      professionalAccount: true,
      mediaOwnedByAccount: true,
      insightsPermissionGranted: true,
      retentionRequirementsVerified: true,
      deletionRequired: false,
      supportedProviderMetrics: PROFILE.mappings.map((mapping) => mapping.providerMetric),
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

function collector(input: {
  fetchImpl?: typeof fetch;
  credentialResolver?: InstagramAnalyticsCredentialResolver;
  capabilityHook?: InstagramAnalyticsCapabilityHook;
  profile?: InstagramAnalyticsMetricProfile;
  apiVersion?: string;
  graphBaseUrl?: string;
}) {
  return new InstagramAnalyticsCollector(
    input.credentialResolver ?? credentials(),
    input.capabilityHook ?? capabilities(),
    input.profile ?? PROFILE,
    {
      apiVersion: input.apiVersion ?? 'v99.0',
      ...(input.fetchImpl === undefined ? {} : { fetchImpl: input.fetchImpl }),
      ...(input.graphBaseUrl === undefined ? {} : { graphBaseUrl: input.graphBaseUrl }),
      now: () => NOW,
    },
  );
}

describe('Phase 8D Instagram Analytics adapter', () => {
  it('uses the frozen adapter key and maps owned Professional media insights by metric name', async () => {
    expect(adapterKeyFor('INSTAGRAM')).toBe('INSTAGRAM_ANALYTICS_V1');
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.origin).toBe('https://graph.facebook.com');
      expect(url.pathname).toBe('/v99.0/17890000000000001/insights');
      expect(url.searchParams.get('metric')).toBe(
        PROFILE.mappings.map((entry) => entry.providerMetric).join(','),
      );
      expect(new Headers(init?.headers).get('authorization')).toBe(
        'Bearer fixture-instagram-analytics-token',
      );
      return jsonResponse({
        data: [
          { name: 'shares', period: 'lifetime', values: [{ value: 3 }] },
          { name: 'views', period: 'lifetime', values: [{ value: 1200 }] },
          { name: 'fixture_avg_watch_time', period: 'lifetime', values: [{ value: 42125 }] },
          { name: 'comments', period: 'lifetime', values: [{ value: 4 }] },
          { name: 'saved', period: 'lifetime', values: [{ value: 12 }] },
          { name: 'reach', period: 'lifetime', values: [{ value: 910 }] },
          { name: 'fixture_total_watch_time', period: 'lifetime', values: [{ value: 1500000 }] },
          { name: 'likes', period: 'lifetime', values: [{ value: 80 }] },
        ],
      });
    });

    const observation = await collector({ fetchImpl: fetchImpl as typeof fetch }).collect(
      snapshot(),
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(observation.metrics).toMatchObject({
      views: 1200n,
      reach: 910n,
      likes: 80n,
      comments: 4n,
      shares: 3n,
      saves: 12n,
      watchTimeMs: 1_500_000n,
      avgWatchDurationMs: 42_125,
    });
    expect(observation.metrics.impressions).toBeNull();
    expect(observation.providerSchemaVersion).toMatch(
      /^instagram-analytics-adapter-v1:meta-media-insights-fixture-2026-09-22:[0-9a-f]{16}$/,
    );
    expect(observation.rawPayload).toMatchObject({
      request: {
        apiVersion: 'v99.0',
        mediaId: '17890000000000001',
        profileVersion: PROFILE.profileVersion,
      },
    });
    expect(JSON.stringify(observation.rawPayload)).not.toContain(
      'fixture-instagram-analytics-token',
    );
  });

  it('requests only activation-verified provider metrics and leaves unsupported canonical metrics NULL', async () => {
    const supported = ['views', 'reach'];
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      expect(url.searchParams.get('metric')).toBe('views,reach');
      return jsonResponse({
        data: [
          { name: 'reach', values: [{ value: 0 }] },
          { name: 'views', values: [{ value: 14 }] },
        ],
      });
    });
    const observation = await collector({
      fetchImpl: fetchImpl as typeof fetch,
      capabilityHook: capabilities({ supportedProviderMetrics: supported }),
    }).collect(snapshot());
    expect(observation.metrics.views).toBe(14n);
    expect(observation.metrics.reach).toBe(0n);
    expect(observation.metrics.likes).toBeNull();
    expect(observation.metrics.avgWatchDurationMs).toBeNull();
    expect(observation.availability.unavailableMetrics).toContain('likes');
    expect(observation.availability.unavailableMetrics).toContain('avgWatchDurationMs');
  });

  it('returns UNSUPPORTED_METRIC without credentials or HTTP when the verified capability profile supports none', async () => {
    const credentialResolver = credentials();
    const fetchImpl = vi.fn();
    const observation = await collector({
      fetchImpl: fetchImpl as typeof fetch,
      credentialResolver,
      capabilityHook: capabilities({ supportedProviderMetrics: [] }),
    }).collect(snapshot());
    expect(observation.availability.status).toBe('UNSUPPORTED_METRIC');
    expect(observation.metrics.views).toBeNull();
    expect(credentialResolver.resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves an empty insights response as NOT_YET_AVAILABLE rather than zero', async () => {
    const observation = await collector({
      fetchImpl: (async () => jsonResponse({ data: [] })) as typeof fetch,
    }).collect(snapshot());
    expect(observation.availability.status).toBe('NOT_YET_AVAILABLE');
    expect(observation.metrics.views).toBeNull();
    expect(observation.metrics.likes).toBeNull();
  });

  it('fails closed on duplicate metrics and ambiguous provider value containers', async () => {
    await expect(
      collector({
        fetchImpl: (async () =>
          jsonResponse({
            data: [
              { name: 'views', values: [{ value: 1 }] },
              { name: 'views', values: [{ value: 2 }] },
            ],
          })) as typeof fetch,
      }).collect(snapshot()),
    ).rejects.toMatchObject({
      failureCode: 'SCHEMA_DRIFT',
      message: 'INSTAGRAM_ANALYTICS_DUPLICATE_METRIC:views',
    });

    await expect(
      collector({
        fetchImpl: (async () =>
          jsonResponse({
            data: [{ name: 'views', values: [{ value: 1 }], total_value: { value: 1 } }],
          })) as typeof fetch,
      }).collect(snapshot()),
    ).rejects.toMatchObject({
      failureCode: 'SCHEMA_DRIFT',
      message: 'INSTAGRAM_ANALYTICS_AMBIGUOUS_VALUE_CONTAINER:views',
    });
  });

  it('checks activation, ownership, permission and retention before credentials or HTTP', async () => {
    const blockedStates: Partial<InstagramAnalyticsCapabilityState>[] = [
      { professionalAccount: false },
      { mediaOwnedByAccount: false },
      { insightsPermissionGranted: false },
      { retentionRequirementsVerified: false },
      { validUntil: '2026-09-22T17:59:59.000Z' },
      { deletionRequired: true },
    ];
    for (const state of blockedStates) {
      const credentialResolver = credentials();
      const fetchImpl = vi.fn();
      await expect(
        collector({
          fetchImpl: fetchImpl as typeof fetch,
          credentialResolver,
          capabilityHook: capabilities(state),
        }).collect(snapshot()),
      ).rejects.toBeInstanceOf(Error);
      expect(credentialResolver.resolve).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
    }
  });

  it('classifies Meta auth, capability, unsupported-metric, transient and network failures', async () => {
    const cases = [
      [jsonResponse({ error: { code: 190 } }, 400), 'AUTH_REQUIRED'],
      [jsonResponse({ error: { code: 10 } }, 403), 'CAPABILITY_REQUIRED'],
      [jsonResponse({ error: { code: 100 } }, 400), 'UNSUPPORTED_METRIC'],
      [jsonResponse({ error: { code: 2, is_transient: true } }, 503), 'SOURCE_UNAVAILABLE'],
    ] as const;
    for (const [response, failureCode] of cases) {
      await expect(
        collector({ fetchImpl: (async () => response) as typeof fetch }).collect(snapshot()),
      ).rejects.toMatchObject({ failureCode });
    }
    await expect(
      collector({
        fetchImpl: (async () => {
          throw new Error('network down');
        }) as typeof fetch,
      }).collect(snapshot()),
    ).rejects.toMatchObject({
      failureCode: 'SOURCE_UNAVAILABLE',
      retryable: true,
    });
  });

  it('requires explicit HTTPS Graph configuration and a versioned verified metric profile', () => {
    expect(() =>
      collector({
        graphBaseUrl: 'http://graph.invalid',
      }),
    ).toThrow('INSTAGRAM_ANALYTICS_HTTPS_REQUIRED');
    expect(() =>
      collector({
        apiVersion: 'latest',
      }),
    ).toThrow();
    expect(() =>
      collector({
        profile: {
          profileVersion: 'duplicate',
          mappings: [
            { providerMetric: 'views', canonicalMetric: 'views', providerUnit: 'COUNT' },
            { providerMetric: 'views', canonicalMetric: 'reach', providerUnit: 'COUNT' },
          ],
        },
      }),
    ).toThrow();
  });
});
