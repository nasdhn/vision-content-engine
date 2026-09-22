import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AnalyticsObservationSchema,
  EMPTY_CANONICAL_METRICS,
  METRIC_SEMANTICS_VERSION,
} from './index.js';
import type { AnalyticsCollectionSnapshot, AnalyticsObservation } from './index.js';

export const YOUTUBE_ANALYTICS_SCOPE =
  'https://www.googleapis.com/auth/yt-analytics.readonly' as const;
export const YOUTUBE_ANALYTICS_API_VERSION = 'v2' as const;
export const YOUTUBE_ANALYTICS_ADAPTER_VERSION = 'youtube-analytics-adapter-v1' as const;
export const YOUTUBE_ANALYTICS_NORMALIZER_VERSION = 'youtube-analytics-normalizer-v1' as const;
export const YOUTUBE_ANALYTICS_COMPLIANCE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1_000;

export const YOUTUBE_ANALYTICS_METRICS = [
  'views',
  'engagedViews',
  'likes',
  'comments',
  'shares',
  'estimatedMinutesWatched',
  'averageViewDuration',
  'averageViewPercentage',
] as const;

const AccessTokenSchema = z.string().min(1).max(16_384);
const ScopeSchema = z.string().min(1).max(512);
const IsoDateTimeSchema = z.string().datetime();
const YouTubeCellSchema = z.union([z.string(), z.number(), z.null()]);
const YouTubeColumnHeaderSchema = z
  .object({
    name: z.string().min(1),
    columnType: z.string().min(1).optional(),
    dataType: z.string().min(1).optional(),
  })
  .passthrough();
const YouTubeReportsResponseSchema = z
  .object({
    columnHeaders: z.array(YouTubeColumnHeaderSchema),
    rows: z.array(z.array(YouTubeCellSchema)).optional(),
  })
  .passthrough();
const GoogleErrorSchema = z
  .object({
    error: z
      .object({
        code: z.number().int().optional(),
        message: z.string().optional(),
        errors: z
          .array(
            z
              .object({
                reason: z.string().optional(),
                message: z.string().optional(),
              })
              .passthrough(),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type YouTubeAnalyticsCredential = Readonly<{
  accessToken: string;
  grantedScopes: readonly string[];
  expiresAt?: string;
}>;

export interface YouTubeAnalyticsCredentialResolver {
  resolve(platformAccountId: string): Promise<YouTubeAnalyticsCredential>;
}

export type YouTubeAnalyticsComplianceState = Readonly<{
  checkedAt: string;
  authorizationValid: boolean;
  videoExists: boolean;
  deletionRequired: boolean;
}>;

export interface YouTubeAnalyticsComplianceHook {
  verify(
    input: Readonly<{
      platformAccountId: string;
      videoId: string;
    }>,
  ): Promise<YouTubeAnalyticsComplianceState>;
}

export type YouTubeAnalyticsCollectorOptions = Readonly<{
  apiBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  requestTimeoutMs?: number;
}>;

export class YouTubeAnalyticsError extends Error {
  constructor(
    readonly failureCode:
      | 'AUTH_REQUIRED'
      | 'SOURCE_UNAVAILABLE'
      | 'SCHEMA_DRIFT'
      | 'COMPLIANCE_RECHECK_REQUIRED'
      | 'DELETION_REQUIRED',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'YouTubeAnalyticsError';
  }
}

const DEFAULT_API_BASE_URL = 'https://youtubeanalytics.googleapis.com/v2';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const CANONICAL_YOUTUBE_FIELDS = [
  'views',
  'engagedViews',
  'likes',
  'comments',
  'shares',
  'watchTimeMs',
  'avgWatchDurationMs',
  'avgWatchPercentage',
] as const;

type ColumnHeader = z.infer<typeof YouTubeColumnHeaderSchema>;
type ReportsResponse = z.infer<typeof YouTubeReportsResponseSchema>;

function utcDate(value: Date) {
  if (!Number.isFinite(value.getTime())) throw new Error('INVALID_ANALYTICS_DATE');
  return value.toISOString().slice(0, 10);
}

function schemaVersion(headers: readonly ColumnHeader[]) {
  const fingerprint = createHash('sha256')
    .update(
      JSON.stringify(
        headers.map((header) => ({
          name: header.name,
          columnType: header.columnType ?? null,
          dataType: header.dataType ?? null,
        })),
      ),
    )
    .digest('hex')
    .slice(0, 16);
  return `${YOUTUBE_ANALYTICS_ADAPTER_VERSION}:${fingerprint}`;
}

function googleErrorMetadata(body: unknown) {
  const parsed = GoogleErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  return {
    code: parsed.data.error.code,
    reason: parsed.data.error.errors?.[0]?.reason,
    message: parsed.data.error.message,
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function parseFiniteNonNegative(value: unknown, field: string) {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (!Number.isFinite(number) || number < 0) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      `YOUTUBE_ANALYTICS_INVALID_${field.toUpperCase()}`,
      false,
    );
  }
  return number;
}

function parseCount(value: unknown, field: string) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  const number = parseFiniteNonNegative(value, field);
  if (!Number.isSafeInteger(number)) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      `YOUTUBE_ANALYTICS_UNSAFE_${field.toUpperCase()}`,
      false,
    );
  }
  return BigInt(number);
}

function parseMillisecondsFromMinutes(value: unknown) {
  const minutes = parseFiniteNonNegative(value, 'estimatedMinutesWatched');
  const milliseconds = Math.round(minutes * 60_000);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      'YOUTUBE_ANALYTICS_WATCH_TIME_OUT_OF_RANGE',
      false,
    );
  }
  return BigInt(milliseconds);
}

function parseMillisecondsFromSeconds(value: unknown) {
  const seconds = parseFiniteNonNegative(value, 'averageViewDuration');
  const milliseconds = Math.round(seconds * 1_000);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      'YOUTUBE_ANALYTICS_AVG_DURATION_OUT_OF_RANGE',
      false,
    );
  }
  return milliseconds;
}

function parsePercentage(value: unknown) {
  const percentage = parseFiniteNonNegative(value, 'averageViewPercentage');
  if (percentage > 100) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      'YOUTUBE_ANALYTICS_PERCENTAGE_OUT_OF_RANGE',
      false,
    );
  }
  return percentage;
}

function headerIndex(response: ReportsResponse) {
  const index = new Map<string, number>();
  response.columnHeaders.forEach((header, position) => {
    if (index.has(header.name)) {
      throw new YouTubeAnalyticsError(
        'SCHEMA_DRIFT',
        `YOUTUBE_ANALYTICS_DUPLICATE_HEADER:${header.name}`,
        false,
      );
    }
    index.set(header.name, position);
  });
  for (const metric of YOUTUBE_ANALYTICS_METRICS) {
    if (!index.has(metric)) {
      throw new YouTubeAnalyticsError(
        'SCHEMA_DRIFT',
        `YOUTUBE_ANALYTICS_MISSING_HEADER:${metric}`,
        false,
      );
    }
  }
  return index;
}

function normalizeResponse(
  body: unknown,
  collectedAt: Date,
  requestEvidence: Readonly<Record<string, string>>,
): AnalyticsObservation {
  const parsed = YouTubeReportsResponseSchema.safeParse(body);
  if (!parsed.success) {
    throw new YouTubeAnalyticsError('SCHEMA_DRIFT', 'YOUTUBE_ANALYTICS_INVALID_RESPONSE', false);
  }
  const response = parsed.data;
  const index = headerIndex(response);
  const rows = response.rows ?? [];
  if (rows.length === 0) {
    return AnalyticsObservationSchema.parse({
      collectedAt: collectedAt.toISOString(),
      providerSchemaVersion: schemaVersion(response.columnHeaders),
      rawPayload: { request: requestEvidence, response: body },
      metrics: EMPTY_CANONICAL_METRICS,
      otherMetrics: null,
      availability: {
        status: 'NOT_YET_AVAILABLE',
        unavailableMetrics: [...CANONICAL_YOUTUBE_FIELDS],
        notes: [
          'YouTube Analytics may lag 48–72 hours; an empty report is never normalized as zero.',
        ],
      },
      comparability: {
        crossPlatformViewsComparable: false,
        notes: [
          'YouTube provider semantics are retained; canonical names do not imply direct cross-platform comparability.',
        ],
      },
      normalizerVersion: YOUTUBE_ANALYTICS_NORMALIZER_VERSION,
      metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
    });
  }
  if (rows.length !== 1) {
    throw new YouTubeAnalyticsError(
      'SCHEMA_DRIFT',
      'YOUTUBE_ANALYTICS_UNEXPECTED_ROW_COUNT',
      false,
    );
  }
  const row = rows[0]!;
  if (row.length < response.columnHeaders.length) {
    throw new YouTubeAnalyticsError('SCHEMA_DRIFT', 'YOUTUBE_ANALYTICS_SHORT_ROW', false);
  }
  const value = (name: (typeof YOUTUBE_ANALYTICS_METRICS)[number]) => row[index.get(name)!];
  const unavailableMetrics: string[] = [];
  const nullable = <T>(
    providerName: (typeof YOUTUBE_ANALYTICS_METRICS)[number],
    canonicalName: string,
    parser: (entry: unknown) => T,
  ): T | null => {
    const entry = value(providerName);
    if (entry === null || entry === undefined || entry === '') {
      unavailableMetrics.push(canonicalName);
      return null;
    }
    return parser(entry);
  };
  const metrics = {
    ...EMPTY_CANONICAL_METRICS,
    views: nullable('views', 'views', (entry) => parseCount(entry, 'views')),
    engagedViews: nullable('engagedViews', 'engagedViews', (entry) =>
      parseCount(entry, 'engagedViews'),
    ),
    likes: nullable('likes', 'likes', (entry) => parseCount(entry, 'likes')),
    comments: nullable('comments', 'comments', (entry) => parseCount(entry, 'comments')),
    shares: nullable('shares', 'shares', (entry) => parseCount(entry, 'shares')),
    watchTimeMs: nullable('estimatedMinutesWatched', 'watchTimeMs', parseMillisecondsFromMinutes),
    avgWatchDurationMs: nullable(
      'averageViewDuration',
      'avgWatchDurationMs',
      parseMillisecondsFromSeconds,
    ),
    avgWatchPercentage: nullable('averageViewPercentage', 'avgWatchPercentage', parsePercentage),
  };
  return AnalyticsObservationSchema.parse({
    collectedAt: collectedAt.toISOString(),
    providerSchemaVersion: schemaVersion(response.columnHeaders),
    rawPayload: { request: requestEvidence, response: body },
    metrics,
    otherMetrics: null,
    availability: {
      status: 'AVAILABLE',
      unavailableMetrics,
      notes: [
        'YouTube Analytics response columns are mapped by header name, never by fixed position.',
        'estimatedMinutesWatched and averageViewDuration are unit-normalized only; no composite YouTube-derived metric is created.',
      ],
    },
    comparability: {
      crossPlatformViewsComparable: false,
      notes: ['YouTube provider semantics are retained separately from other platforms.'],
    },
    normalizerVersion: YOUTUBE_ANALYTICS_NORMALIZER_VERSION,
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
  });
}

export class YouTubeAnalyticsCollector {
  readonly platform = 'YOUTUBE' as const;
  readonly isRealProvider = true;

  private readonly apiBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly credentials: YouTubeAnalyticsCredentialResolver,
    private readonly compliance: YouTubeAnalyticsComplianceHook,
    options: YouTubeAnalyticsCollectorOptions = {},
  ) {
    const base = new URL(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
    if (base.protocol !== 'https:') throw new Error('YOUTUBE_ANALYTICS_HTTPS_REQUIRED');
    this.apiBaseUrl = base.toString().replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1_000 ||
      this.requestTimeoutMs > 120_000
    ) {
      throw new Error('INVALID_YOUTUBE_ANALYTICS_TIMEOUT');
    }
  }

  private async assertCompliance(snapshot: AnalyticsCollectionSnapshot, now: Date) {
    const state = await this.compliance.verify({
      platformAccountId: snapshot.platformAccountId,
      videoId: snapshot.remotePostId,
    });
    const checkedAt = new Date(IsoDateTimeSchema.parse(state.checkedAt));
    if (checkedAt.getTime() > now.getTime() + 60_000) {
      throw new YouTubeAnalyticsError(
        'COMPLIANCE_RECHECK_REQUIRED',
        'YOUTUBE_ANALYTICS_COMPLIANCE_CHECK_IN_FUTURE',
        false,
      );
    }
    if (now.getTime() - checkedAt.getTime() > YOUTUBE_ANALYTICS_COMPLIANCE_MAX_AGE_MS) {
      throw new YouTubeAnalyticsError(
        'COMPLIANCE_RECHECK_REQUIRED',
        'YOUTUBE_ANALYTICS_30_DAY_RECHECK_REQUIRED',
        false,
      );
    }
    if (state.deletionRequired || !state.videoExists) {
      throw new YouTubeAnalyticsError(
        'DELETION_REQUIRED',
        'YOUTUBE_ANALYTICS_STORED_DATA_DELETION_REQUIRED',
        false,
      );
    }
    if (!state.authorizationValid) {
      throw new YouTubeAnalyticsError('AUTH_REQUIRED', 'YOUTUBE_ANALYTICS_AUTH_REQUIRED', false);
    }
  }

  private async accessToken(platformAccountId: string, now: Date) {
    const credential = await this.credentials.resolve(platformAccountId);
    const accessToken = AccessTokenSchema.parse(credential.accessToken);
    const scopes = credential.grantedScopes.map((scope) => ScopeSchema.parse(scope));
    if (!scopes.includes(YOUTUBE_ANALYTICS_SCOPE)) {
      throw new YouTubeAnalyticsError(
        'AUTH_REQUIRED',
        'YOUTUBE_ANALYTICS_READ_SCOPE_REQUIRED',
        false,
      );
    }
    if (credential.expiresAt !== undefined) {
      const expiresAt = new Date(IsoDateTimeSchema.parse(credential.expiresAt));
      if (expiresAt.getTime() <= now.getTime()) {
        throw new YouTubeAnalyticsError('AUTH_REQUIRED', 'YOUTUBE_ANALYTICS_AUTH_REQUIRED', false);
      }
    }
    return accessToken;
  }

  async collect(snapshot: AnalyticsCollectionSnapshot): Promise<AnalyticsObservation> {
    if (snapshot.platform !== 'YOUTUBE') throw new Error('YOUTUBE_ANALYTICS_SNAPSHOT_REQUIRED');
    if (snapshot.adapterKey !== 'YOUTUBE_ANALYTICS_V1') {
      throw new Error('YOUTUBE_ANALYTICS_ADAPTER_KEY_REQUIRED');
    }
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error('INVALID_ANALYTICS_NOW');
    await this.assertCompliance(snapshot, now);
    const accessToken = await this.accessToken(snapshot.platformAccountId, now);
    const publishedAt = new Date(snapshot.publishedAt);
    if (!Number.isFinite(publishedAt.getTime())) throw new Error('INVALID_PUBLISHED_AT');

    const requestEvidence = Object.freeze({
      ids: 'channel==MINE',
      startDate: utcDate(publishedAt),
      endDate: utcDate(now),
      metrics: YOUTUBE_ANALYTICS_METRICS.join(','),
      filters: `video==${snapshot.remotePostId}`,
    });
    const url = new URL(`${this.apiBaseUrl}/reports`);
    for (const [key, value] of Object.entries(requestEvidence)) url.searchParams.set(key, value);

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new YouTubeAnalyticsError(
        'SOURCE_UNAVAILABLE',
        'YOUTUBE_ANALYTICS_SOURCE_UNAVAILABLE',
        true,
      );
    }
    const body = await safeJson(response);
    if (!response.ok) {
      const metadata = googleErrorMetadata(body);
      if (response.status === 401 || response.status === 403) {
        throw new YouTubeAnalyticsError(
          'AUTH_REQUIRED',
          `YOUTUBE_ANALYTICS_AUTH_REQUIRED${metadata?.reason ? `:${metadata.reason}` : ''}`,
          false,
        );
      }
      if (response.status === 400) {
        throw new YouTubeAnalyticsError(
          'SCHEMA_DRIFT',
          `YOUTUBE_ANALYTICS_QUERY_REJECTED${metadata?.reason ? `:${metadata.reason}` : ''}`,
          false,
        );
      }
      throw new YouTubeAnalyticsError(
        'SOURCE_UNAVAILABLE',
        `YOUTUBE_ANALYTICS_SOURCE_UNAVAILABLE:${response.status}`,
        response.status === 429 || response.status >= 500,
      );
    }
    return normalizeResponse(body, now, requestEvidence);
  }
}
