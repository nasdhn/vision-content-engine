import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  UMAMI_ATTRIBUTION_POLICY_VERSION,
  UmamiApiError,
  UmamiEventsClient,
  attributionHintsForUmamiEvent,
  platformHintForUmamiEvent,
  umamiEventKind,
} from '../../packages/analytics/src/umami.js';

const websiteId = randomUUID();
const sessionId = randomUUID();

function event(overrides: Record<string, unknown> = {}) {
  return {
    id: randomUUID(),
    websiteId,
    sessionId,
    createdAt: '2026-09-22T18:00:00.000Z',
    urlPath: '/',
    urlQuery: '',
    referrerPath: '',
    referrerQuery: '',
    referrerDomain: '',
    pageTitle: 'Vision',
    eventType: 1,
    eventName: '',
    ...overrides,
  };
}

function credentials() {
  return {
    endpoint: 'https://stats.example.test/api',
    websiteId,
    bearerToken: 'umami-test-token',
  };
}

describe('Phase 8F Umami API import adapter', () => {
  it('uses the supported events API with bounded pagination and preserves pageviews plus marketing events', async () => {
    const first = event({
      urlQuery: `utm_source=youtube&utm_medium=organic_social&utm_content=${randomUUID()}`,
      referrerDomain: 'youtube.com',
    });
    const second = event({
      eventName: 'pricing-cta-click',
      referrerDomain: 'scanner.example.test',
    });
    const calls: Array<{ url: string; authorization: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({
        url: url.toString(),
        authorization: new Headers(init?.headers).get('authorization'),
      });
      const page = Number(url.searchParams.get('page'));
      return new Response(
        JSON.stringify({
          data: page === 1 ? [first] : [second],
          count: 2,
          page,
          pageSize: 1,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    };

    const client = new UmamiEventsClient({ resolve: credentials }, { fetchImpl, pageSize: 1 });
    const result = await client.fetchEvents({
      startAt: new Date('2026-09-22T00:00:00.000Z'),
      endAt: new Date('2026-09-23T00:00:00.000Z'),
    });

    expect(result.rows).toHaveLength(2);
    expect(result.rawPages).toHaveLength(2);
    expect(umamiEventKind(result.rows[0]!)).toBe('WEBSITE_VISIT');
    expect(umamiEventKind(result.rows[1]!)).toBe('WEB_MARKETING_OBSERVATION');
    expect(calls).toHaveLength(2);
    expect(calls[0]!.authorization).toBe('Bearer umami-test-token');
    const firstUrl = new URL(calls[0]!.url);
    expect(firstUrl.pathname).toBe(`/api/websites/${websiteId}/events`);
    expect(firstUrl.searchParams.get('startAt')).toBe('1790035200000');
    expect(firstUrl.searchParams.get('endAt')).toBe('1790121600000');
    expect(firstUrl.searchParams.get('pageSize')).toBe('1');
    expect(firstUrl.searchParams.get('orderBy')).toBe('createdAt');
  });

  it('extracts deterministic utm_content trackingCode and rejects conflicting platform hints for inference', () => {
    const trackingCode = randomUUID();
    const row = event({
      urlQuery: `utm_source=youtube&utm_medium=organic_social&utm_campaign=vision&utm_content=${trackingCode}`,
      referrerDomain: 'instagram.com',
    });
    const hints = attributionHintsForUmamiEvent(row);
    expect(hints).toMatchObject({
      utmSource: 'youtube',
      utmMedium: 'organic_social',
      utmCampaign: 'vision',
      utmContent: trackingCode,
      trackingCode,
    });
    expect(platformHintForUmamiEvent(row)).toBeNull();
    expect(UMAMI_ATTRIBUTION_POLICY_VERSION).toBe('umami-attribution-v1');
  });

  it('classifies auth and schema failures without leaking credentials', async () => {
    const authClient = new UmamiEventsClient(
      { resolve: credentials },
      { fetchImpl: async () => new Response('{}', { status: 401 }) },
    );
    await expect(
      authClient.fetchEvents({
        startAt: new Date('2026-09-22T00:00:00Z'),
        endAt: new Date('2026-09-23T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'UMAMI_AUTH_REQUIRED' });

    const schemaClient = new UmamiEventsClient(
      { resolve: credentials },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: 'not-an-array' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    );
    await expect(
      schemaClient.fetchEvents({
        startAt: new Date('2026-09-22T00:00:00Z'),
        endAt: new Date('2026-09-23T00:00:00Z'),
      }),
    ).rejects.toBeInstanceOf(UmamiApiError);
  });

  it('fails closed instead of silently truncating when the configured pagination ceiling is reached', async () => {
    const client = new UmamiEventsClient(
      { resolve: credentials },
      {
        pageSize: 1,
        maxPages: 1,
        fetchImpl: async () =>
          new Response(JSON.stringify({ data: [event()], count: 2, page: 1, pageSize: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      },
    );
    await expect(
      client.fetchEvents({
        startAt: new Date('2026-09-22T00:00:00Z'),
        endAt: new Date('2026-09-23T00:00:00Z'),
      }),
    ).rejects.toMatchObject({ code: 'UMAMI_PAGE_LIMIT_EXCEEDED' });
  });
});
