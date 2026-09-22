import { z } from 'zod';

export const UMAMI_IMPORT_ADAPTER_KEY = 'UMAMI_EVENTS_V1';
export const UMAMI_PROVIDER_SCHEMA_VERSION = 'umami-events-api-v1';
export const UMAMI_ATTRIBUTION_POLICY_VERSION = 'umami-attribution-v1';
export const UMAMI_DEFAULT_PAGE_SIZE = 500;
export const UMAMI_DEFAULT_MAX_PAGES = 20;

const OpaqueStringSchema = z.string().min(1).max(2048);

export const UmamiEventRowSchema = z
  .object({
    id: OpaqueStringSchema,
    websiteId: OpaqueStringSchema,
    sessionId: OpaqueStringSchema,
    createdAt: z.string().datetime({ offset: true }),
    urlPath: z.string().max(4096),
    urlQuery: z.string().max(8192),
    referrerPath: z.string().max(4096),
    referrerQuery: z.string().max(8192),
    referrerDomain: z.string().max(2048),
    pageTitle: z.string().max(4096),
    eventType: z.number().int().nonnegative(),
    eventName: z.string().max(512).nullable(),
  })
  .passthrough();

export type UmamiEventRow = z.infer<typeof UmamiEventRowSchema>;

const UmamiEventsPageSchema = z
  .object({
    data: z.array(UmamiEventRowSchema),
    count: z.number().int().nonnegative(),
    page: z.number().int().positive(),
    pageSize: z.number().int().positive(),
  })
  .passthrough();

export type UmamiCredentials = Readonly<{
  endpoint: string;
  websiteId: string;
  bearerToken: string;
}>;

export interface UmamiCredentialsResolver {
  resolve(): Promise<UmamiCredentials> | UmamiCredentials;
}

export type UmamiEventsClientOptions = Readonly<{
  fetchImpl?: typeof fetch;
  pageSize?: number;
  maxPages?: number;
}>;

export type UmamiImportWindow = Readonly<{
  startAt: Date;
  endAt: Date;
}>;

export class UmamiApiError extends Error {
  constructor(
    readonly code:
      | 'UMAMI_AUTH_REQUIRED'
      | 'UMAMI_SOURCE_UNAVAILABLE'
      | 'UMAMI_SCHEMA_DRIFT'
      | 'UMAMI_INVALID_CONFIGURATION'
      | 'UMAMI_INVALID_WINDOW'
      | 'UMAMI_PAGE_LIMIT_EXCEEDED'
      | 'UMAMI_PAGINATION_INCOMPLETE',
  ) {
    super(code);
    this.name = 'UmamiApiError';
  }
}

function validateCredentials(input: UmamiCredentials) {
  let endpoint: URL;
  try {
    endpoint = new URL(input.endpoint);
  } catch {
    throw new UmamiApiError('UMAMI_INVALID_CONFIGURATION');
  }
  if (endpoint.protocol !== 'https:') {
    throw new UmamiApiError('UMAMI_INVALID_CONFIGURATION');
  }
  if (!z.string().uuid().safeParse(input.websiteId).success || input.bearerToken.length < 1) {
    throw new UmamiApiError('UMAMI_INVALID_CONFIGURATION');
  }
  endpoint.pathname = endpoint.pathname.replace(/\/+$/, '');
  return { endpoint, websiteId: input.websiteId, bearerToken: input.bearerToken } as const;
}

function validateWindow(window: UmamiImportWindow) {
  const startAt = window.startAt.getTime();
  const endAt = window.endAt.getTime();
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
    throw new UmamiApiError('UMAMI_INVALID_WINDOW');
  }
  return { startAt, endAt } as const;
}

function pageUrl(
  endpoint: URL,
  websiteId: string,
  window: Readonly<{ startAt: number; endAt: number }>,
  page: number,
  pageSize: number,
) {
  const url = new URL(
    `${endpoint.toString().replace(/\/$/, '')}/websites/${encodeURIComponent(websiteId)}/events`,
  );
  url.searchParams.set('startAt', String(window.startAt));
  url.searchParams.set('endAt', String(window.endAt));
  url.searchParams.set('page', String(page));
  url.searchParams.set('pageSize', String(pageSize));
  url.searchParams.set('orderBy', 'createdAt');
  return url;
}

export class UmamiEventsClient {
  readonly isRealProvider = true;
  private readonly fetchImpl: typeof fetch;
  private readonly pageSize: number;
  private readonly maxPages: number;

  constructor(
    private readonly credentials: UmamiCredentialsResolver,
    options: UmamiEventsClientOptions = {},
  ) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.pageSize = options.pageSize ?? UMAMI_DEFAULT_PAGE_SIZE;
    this.maxPages = options.maxPages ?? UMAMI_DEFAULT_MAX_PAGES;
    if (!Number.isSafeInteger(this.pageSize) || this.pageSize < 1 || this.pageSize > 500) {
      throw new UmamiApiError('UMAMI_INVALID_CONFIGURATION');
    }
    if (!Number.isSafeInteger(this.maxPages) || this.maxPages < 1 || this.maxPages > 100) {
      throw new UmamiApiError('UMAMI_INVALID_CONFIGURATION');
    }
  }

  async fetchEvents(windowInput: UmamiImportWindow) {
    const window = validateWindow(windowInput);
    const credentials = validateCredentials(await this.credentials.resolve());
    const rows: UmamiEventRow[] = [];
    const rawPages: unknown[] = [];
    let expectedCount: number | null = null;

    for (let page = 1; page <= this.maxPages; page += 1) {
      const url = pageUrl(credentials.endpoint, credentials.websiteId, window, page, this.pageSize);
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method: 'GET',
          headers: {
            accept: 'application/json',
            authorization: `Bearer ${credentials.bearerToken}`,
          },
        });
      } catch {
        throw new UmamiApiError('UMAMI_SOURCE_UNAVAILABLE');
      }

      if (response.status === 401 || response.status === 403) {
        throw new UmamiApiError('UMAMI_AUTH_REQUIRED');
      }
      if (!response.ok) {
        throw new UmamiApiError('UMAMI_SOURCE_UNAVAILABLE');
      }

      let raw: unknown;
      try {
        raw = await response.json();
      } catch {
        throw new UmamiApiError('UMAMI_SCHEMA_DRIFT');
      }
      const parsed = UmamiEventsPageSchema.safeParse(raw);
      if (!parsed.success) {
        throw new UmamiApiError('UMAMI_SCHEMA_DRIFT');
      }
      if (parsed.data.page !== page) {
        throw new UmamiApiError('UMAMI_SCHEMA_DRIFT');
      }
      if (expectedCount === null) expectedCount = parsed.data.count;
      if (parsed.data.count !== expectedCount) {
        throw new UmamiApiError('UMAMI_SCHEMA_DRIFT');
      }

      rawPages.push(raw);
      rows.push(...parsed.data.data);
      if (rows.length >= expectedCount) {
        return Object.freeze({
          providerSchemaVersion: UMAMI_PROVIDER_SCHEMA_VERSION,
          websiteId: credentials.websiteId,
          rows: Object.freeze(rows.slice(0, expectedCount)),
          rawPages: Object.freeze(rawPages),
          totalCount: expectedCount,
        });
      }
      if (parsed.data.data.length === 0) {
        throw new UmamiApiError('UMAMI_PAGINATION_INCOMPLETE');
      }
    }

    throw new UmamiApiError('UMAMI_PAGE_LIMIT_EXCEEDED');
  }
}

export type UmamiAttributionHints = Readonly<{
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  trackingCode: string | null;
  referrerDomain: string | null;
}>;

function normalizedQuery(query: string) {
  const trimmed = query.trim().replace(/^\?/, '');
  return new URLSearchParams(trimmed);
}

export function attributionHintsForUmamiEvent(row: UmamiEventRow): UmamiAttributionHints {
  const query = normalizedQuery(row.urlQuery);
  const utmContent = query.get('utm_content');
  return Object.freeze({
    utmSource: query.get('utm_source'),
    utmMedium: query.get('utm_medium'),
    utmCampaign: query.get('utm_campaign'),
    utmContent,
    trackingCode:
      utmContent !== null && z.string().uuid().safeParse(utmContent).success ? utmContent : null,
    referrerDomain: row.referrerDomain.trim() || null,
  });
}

export function umamiEventKind(row: UmamiEventRow) {
  return row.eventName !== null && row.eventName.trim().length > 0
    ? ('WEB_MARKETING_OBSERVATION' as const)
    : ('WEBSITE_VISIT' as const);
}

export const UmamiInferencePolicySchema = z
  .object({
    enabled: z.boolean(),
    maxAgeMinutes: z.number().int().positive().max(43_200),
  })
  .strict();

export type UmamiInferencePolicy = z.infer<typeof UmamiInferencePolicySchema>;

function sourcePlatform(value: string | null) {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (normalized === 'youtube') return 'YOUTUBE' as const;
  if (normalized === 'instagram') return 'INSTAGRAM' as const;
  if (normalized === 'tiktok') return 'TIKTOK' as const;
  return null;
}

function referrerPlatform(value: string | null) {
  const normalized =
    value
      ?.trim()
      .toLowerCase()
      .replace(/^www\./, '') ?? '';
  if (
    normalized === 'youtube.com' ||
    normalized.endsWith('.youtube.com') ||
    normalized === 'youtu.be'
  ) {
    return 'YOUTUBE' as const;
  }
  if (normalized === 'instagram.com' || normalized.endsWith('.instagram.com')) {
    return 'INSTAGRAM' as const;
  }
  if (normalized === 'tiktok.com' || normalized.endsWith('.tiktok.com')) {
    return 'TIKTOK' as const;
  }
  return null;
}

export function platformHintForUmamiEvent(row: UmamiEventRow) {
  const hints = attributionHintsForUmamiEvent(row);
  const candidates = [
    sourcePlatform(hints.utmSource),
    referrerPlatform(hints.referrerDomain),
  ].filter((value): value is 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK' => value !== null);
  const unique = [...new Set(candidates)];
  return unique.length === 1 ? unique[0]! : null;
}
