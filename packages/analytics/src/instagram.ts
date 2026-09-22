import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  AnalyticsObservationSchema,
  EMPTY_CANONICAL_METRICS,
  METRIC_SEMANTICS_VERSION,
} from './index.js';
import type {
  AnalyticsCollectionSnapshot,
  AnalyticsObservation,
  CanonicalMetrics,
} from './index.js';

export const INSTAGRAM_ANALYTICS_ADAPTER_KEY = 'INSTAGRAM_ANALYTICS_V1' as const;
export const INSTAGRAM_ANALYTICS_ADAPTER_VERSION = 'instagram-analytics-adapter-v1' as const;
export const INSTAGRAM_ANALYTICS_NORMALIZER_VERSION = 'instagram-analytics-normalizer-v1' as const;

const AccessTokenSchema = z.string().min(1).max(16_384);
const ApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const IsoDateTimeSchema = z.string().datetime();
const ProviderMetricNameSchema = z
  .string()
  .regex(/^[A-Za-z0-9_.]+$/)
  .max(128);
const ScalarSchema = z.union([z.number(), z.string(), z.null()]);

const CanonicalInstagramMetricSchema = z.enum([
  'views',
  'reach',
  'impressions',
  'likes',
  'comments',
  'shares',
  'saves',
  'watchTimeMs',
  'avgWatchDurationMs',
  'avgWatchPercentage',
  'completionRate',
  'profileVisits',
  'websiteClicks',
  'follows',
]);

const ProviderUnitSchema = z.enum([
  'COUNT',
  'MILLISECONDS',
  'SECONDS',
  'PERCENTAGE_0_100',
  'RATIO_0_1',
]);

const InstagramMetricMappingSchema = z
  .object({
    providerMetric: ProviderMetricNameSchema,
    canonicalMetric: CanonicalInstagramMetricSchema,
    providerUnit: ProviderUnitSchema,
  })
  .strict();

export const InstagramAnalyticsMetricProfileSchema = z
  .object({
    profileVersion: z.string().min(1).max(128),
    mappings: z.array(InstagramMetricMappingSchema).min(1).max(64),
  })
  .strict()
  .superRefine((profile, context) => {
    const providerNames = new Set<string>();
    const canonicalNames = new Set<string>();
    for (const [index, mapping] of profile.mappings.entries()) {
      if (providerNames.has(mapping.providerMetric)) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'providerMetric'],
          message: 'DUPLICATE_INSTAGRAM_PROVIDER_METRIC',
        });
      }
      providerNames.add(mapping.providerMetric);
      if (canonicalNames.has(mapping.canonicalMetric)) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'canonicalMetric'],
          message: 'DUPLICATE_INSTAGRAM_CANONICAL_METRIC',
        });
      }
      canonicalNames.add(mapping.canonicalMetric);

      const countFields = new Set([
        'views',
        'reach',
        'impressions',
        'likes',
        'comments',
        'shares',
        'saves',
        'profileVisits',
        'websiteClicks',
        'follows',
      ]);
      if (countFields.has(mapping.canonicalMetric) && mapping.providerUnit !== 'COUNT') {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'providerUnit'],
          message: 'INSTAGRAM_COUNT_METRIC_UNIT_MISMATCH',
        });
      }
      if (
        ['watchTimeMs', 'avgWatchDurationMs'].includes(mapping.canonicalMetric) &&
        !['MILLISECONDS', 'SECONDS'].includes(mapping.providerUnit)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'providerUnit'],
          message: 'INSTAGRAM_DURATION_METRIC_UNIT_MISMATCH',
        });
      }
      if (
        mapping.canonicalMetric === 'avgWatchPercentage' &&
        mapping.providerUnit !== 'PERCENTAGE_0_100'
      ) {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'providerUnit'],
          message: 'INSTAGRAM_PERCENTAGE_METRIC_UNIT_MISMATCH',
        });
      }
      if (mapping.canonicalMetric === 'completionRate' && mapping.providerUnit !== 'RATIO_0_1') {
        context.addIssue({
          code: 'custom',
          path: ['mappings', index, 'providerUnit'],
          message: 'INSTAGRAM_RATE_METRIC_UNIT_MISMATCH',
        });
      }
    }
  });

export type InstagramAnalyticsMetricProfile = z.infer<typeof InstagramAnalyticsMetricProfileSchema>;

const InstagramInsightValueSchema = z.object({ value: ScalarSchema }).passthrough();
const InstagramInsightSchema = z
  .object({
    name: ProviderMetricNameSchema,
    period: z.string().min(1).optional(),
    values: z.array(InstagramInsightValueSchema).optional(),
    total_value: InstagramInsightValueSchema.optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    id: z.string().optional(),
  })
  .passthrough();
const InstagramInsightsResponseSchema = z
  .object({
    data: z.array(InstagramInsightSchema),
  })
  .passthrough();
const MetaErrorBodySchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.number().int().optional(),
        error_subcode: z.number().int().optional(),
        is_transient: z.boolean().optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type InstagramAnalyticsCredential = Readonly<{
  accessToken: string;
  expiresAt?: string;
}>;

export interface InstagramAnalyticsCredentialResolver {
  resolve(platformAccountId: string): Promise<InstagramAnalyticsCredential>;
}

export type InstagramAnalyticsCapabilityState = Readonly<{
  checkedAt: string;
  validUntil: string;
  professionalAccount: boolean;
  mediaOwnedByAccount: boolean;
  insightsPermissionGranted: boolean;
  retentionRequirementsVerified: boolean;
  deletionRequired: boolean;
  supportedProviderMetrics: readonly string[];
}>;

export interface InstagramAnalyticsCapabilityHook {
  verify(
    input: Readonly<{
      platformAccountId: string;
      mediaId: string;
      profileVersion: string;
    }>,
  ): Promise<InstagramAnalyticsCapabilityState>;
}

export type InstagramAnalyticsCollectorOptions = Readonly<{
  apiVersion: string;
  graphBaseUrl?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  requestTimeoutMs?: number;
}>;

export class InstagramAnalyticsError extends Error {
  constructor(
    readonly failureCode:
      | 'AUTH_REQUIRED'
      | 'CAPABILITY_REQUIRED'
      | 'ACTIVATION_RECHECK_REQUIRED'
      | 'DELETION_REQUIRED'
      | 'UNSUPPORTED_METRIC'
      | 'SOURCE_UNAVAILABLE'
      | 'SCHEMA_DRIFT',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'InstagramAnalyticsError';
  }
}

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function parseDate(value: string, field: string) {
  const parsed = new Date(IsoDateTimeSchema.parse(value));
  if (!Number.isFinite(parsed.getTime())) throw new Error(`INVALID_${field}`);
  return parsed;
}

function safeCapabilityEvidence(state: InstagramAnalyticsCapabilityState) {
  return {
    checkedAt: state.checkedAt,
    validUntil: state.validUntil,
    professionalAccount: state.professionalAccount,
    mediaOwnedByAccount: state.mediaOwnedByAccount,
    insightsPermissionGranted: state.insightsPermissionGranted,
    retentionRequirementsVerified: state.retentionRequirementsVerified,
    deletionRequired: state.deletionRequired,
    supportedProviderMetrics: [...state.supportedProviderMetrics],
  };
}

function schemaVersion(
  profileVersion: string,
  entries: readonly z.infer<typeof InstagramInsightSchema>[],
) {
  const descriptors = entries
    .map((entry) => ({
      name: entry.name,
      period: entry.period ?? null,
      valueContainer:
        entry.values !== undefined
          ? 'values'
          : entry.total_value !== undefined
            ? 'total_value'
            : 'missing',
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(descriptors))
    .digest('hex')
    .slice(0, 16);
  return `${INSTAGRAM_ANALYTICS_ADAPTER_VERSION}:${profileVersion}:${fingerprint}`;
}

function metaErrorMetadata(body: unknown) {
  const parsed = MetaErrorBodySchema.safeParse(body);
  if (!parsed.success) return undefined;
  return {
    code: parsed.data.error.code,
    subcode: parsed.data.error.error_subcode,
    type: parsed.data.error.type,
    transient: parsed.data.error.is_transient,
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
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_INVALID_${field.toUpperCase()}`,
      false,
    );
  }
  return number;
}

function parseCount(value: unknown, field: string) {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  const number = parseFiniteNonNegative(value, field);
  if (!Number.isSafeInteger(number)) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_UNSAFE_${field.toUpperCase()}`,
      false,
    );
  }
  return BigInt(number);
}

function milliseconds(value: unknown, unit: 'MILLISECONDS' | 'SECONDS', field: string) {
  const numeric = parseFiniteNonNegative(value, field);
  const converted = unit === 'SECONDS' ? numeric * 1_000 : numeric;
  const rounded = Math.round(converted);
  if (!Number.isSafeInteger(rounded)) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_DURATION_OUT_OF_RANGE:${field}`,
      false,
    );
  }
  return rounded;
}

function percentage(value: unknown, field: string) {
  const numeric = parseFiniteNonNegative(value, field);
  if (numeric > 100) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_PERCENTAGE_OUT_OF_RANGE:${field}`,
      false,
    );
  }
  return numeric;
}

function ratio(value: unknown, field: string) {
  const numeric = parseFiniteNonNegative(value, field);
  if (numeric > 1) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_RATE_OUT_OF_RANGE:${field}`,
      false,
    );
  }
  return numeric;
}

function scalarValue(entry: z.infer<typeof InstagramInsightSchema>) {
  if (entry.values !== undefined && entry.total_value !== undefined) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      `INSTAGRAM_ANALYTICS_AMBIGUOUS_VALUE_CONTAINER:${entry.name}`,
      false,
    );
  }
  if (entry.values !== undefined) {
    if (entry.values.length === 0) return undefined;
    if (entry.values.length !== 1) {
      throw new InstagramAnalyticsError(
        'SCHEMA_DRIFT',
        `INSTAGRAM_ANALYTICS_UNEXPECTED_VALUE_COUNT:${entry.name}`,
        false,
      );
    }
    return entry.values[0]!.value;
  }
  if (entry.total_value !== undefined) return entry.total_value.value;
  throw new InstagramAnalyticsError(
    'SCHEMA_DRIFT',
    `INSTAGRAM_ANALYTICS_VALUE_CONTAINER_MISSING:${entry.name}`,
    false,
  );
}

function assignMetric(
  metrics: CanonicalMetrics,
  mapping: z.infer<typeof InstagramMetricMappingSchema>,
  value: unknown,
): CanonicalMetrics | null {
  if (value === null || value === undefined || value === '') return null;
  const field = mapping.providerMetric;
  switch (mapping.canonicalMetric) {
    case 'views':
    case 'reach':
    case 'impressions':
    case 'likes':
    case 'comments':
    case 'shares':
    case 'saves':
    case 'profileVisits':
    case 'websiteClicks':
    case 'follows':
      return { ...metrics, [mapping.canonicalMetric]: parseCount(value, field) };
    case 'watchTimeMs': {
      const duration = milliseconds(
        value,
        mapping.providerUnit as 'MILLISECONDS' | 'SECONDS',
        field,
      );
      return { ...metrics, watchTimeMs: BigInt(duration) };
    }
    case 'avgWatchDurationMs':
      return {
        ...metrics,
        avgWatchDurationMs: milliseconds(
          value,
          mapping.providerUnit as 'MILLISECONDS' | 'SECONDS',
          field,
        ),
      };
    case 'avgWatchPercentage':
      return { ...metrics, avgWatchPercentage: percentage(value, field) };
    case 'completionRate':
      return { ...metrics, completionRate: ratio(value, field) };
    default: {
      const exhaustive: never = mapping.canonicalMetric;
      throw new Error(`UNSUPPORTED_INSTAGRAM_CANONICAL_METRIC:${String(exhaustive)}`);
    }
  }
}

function unsupportedObservation(input: {
  now: Date;
  profile: InstagramAnalyticsMetricProfile;
  snapshot: AnalyticsCollectionSnapshot;
  capability: InstagramAnalyticsCapabilityState;
}) {
  const unavailableMetrics = input.profile.mappings.map((mapping) => mapping.canonicalMetric);
  return AnalyticsObservationSchema.parse({
    collectedAt: input.now.toISOString(),
    providerSchemaVersion: `${INSTAGRAM_ANALYTICS_ADAPTER_VERSION}:${input.profile.profileVersion}:capability-only`,
    rawPayload: {
      request: {
        mediaId: input.snapshot.remotePostId,
        profileVersion: input.profile.profileVersion,
        requestedMetrics: [],
      },
      capability: safeCapabilityEvidence(input.capability),
      response: null,
    },
    metrics: EMPTY_CANONICAL_METRICS,
    otherMetrics: null,
    availability: {
      status: 'UNSUPPORTED_METRIC',
      unavailableMetrics,
      notes: [
        'No provider metric in the verified Instagram activation profile is currently supported for this account/media.',
      ],
    },
    comparability: {
      crossPlatformViewsComparable: false,
      notes: ['Instagram provider semantics remain isolated from other platforms.'],
    },
    normalizerVersion: INSTAGRAM_ANALYTICS_NORMALIZER_VERSION,
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
  });
}

function normalizeResponse(input: {
  body: unknown;
  now: Date;
  profile: InstagramAnalyticsMetricProfile;
  activeMappings: readonly z.infer<typeof InstagramMetricMappingSchema>[];
  capability: InstagramAnalyticsCapabilityState;
  requestEvidence: Readonly<Record<string, unknown>>;
}): AnalyticsObservation {
  const parsed = InstagramInsightsResponseSchema.safeParse(input.body);
  if (!parsed.success) {
    throw new InstagramAnalyticsError(
      'SCHEMA_DRIFT',
      'INSTAGRAM_ANALYTICS_INVALID_RESPONSE',
      false,
    );
  }
  const response = parsed.data;
  const byName = new Map<string, z.infer<typeof InstagramInsightSchema>>();
  for (const entry of response.data) {
    if (byName.has(entry.name)) {
      throw new InstagramAnalyticsError(
        'SCHEMA_DRIFT',
        `INSTAGRAM_ANALYTICS_DUPLICATE_METRIC:${entry.name}`,
        false,
      );
    }
    byName.set(entry.name, entry);
  }

  if (response.data.length === 0) {
    return AnalyticsObservationSchema.parse({
      collectedAt: input.now.toISOString(),
      providerSchemaVersion: schemaVersion(input.profile.profileVersion, response.data),
      rawPayload: {
        request: input.requestEvidence,
        capability: safeCapabilityEvidence(input.capability),
        response: input.body,
      },
      metrics: EMPTY_CANONICAL_METRICS,
      otherMetrics: null,
      availability: {
        status: 'NOT_YET_AVAILABLE',
        unavailableMetrics: input.profile.mappings.map((mapping) => mapping.canonicalMetric),
        notes: [
          'Instagram returned no media-insights rows; absence is preserved as unavailable and never normalized as zero.',
        ],
      },
      comparability: {
        crossPlatformViewsComparable: false,
        notes: ['Instagram provider semantics remain isolated from other platforms.'],
      },
      normalizerVersion: INSTAGRAM_ANALYTICS_NORMALIZER_VERSION,
      metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
    });
  }

  let metrics: CanonicalMetrics = { ...EMPTY_CANONICAL_METRICS };
  const unavailableMetrics = new Set<string>();
  const activeProviderNames = new Set(
    input.activeMappings.map((mapping) => mapping.providerMetric),
  );

  for (const mapping of input.profile.mappings) {
    if (!activeProviderNames.has(mapping.providerMetric)) {
      unavailableMetrics.add(mapping.canonicalMetric);
      continue;
    }
    const entry = byName.get(mapping.providerMetric);
    if (!entry) {
      unavailableMetrics.add(mapping.canonicalMetric);
      continue;
    }
    const value = scalarValue(entry);
    if (value === undefined || value === null || value === '') {
      unavailableMetrics.add(mapping.canonicalMetric);
      continue;
    }
    const assigned = assignMetric(metrics, mapping, value);
    if (assigned === null) {
      unavailableMetrics.add(mapping.canonicalMetric);
    } else {
      metrics = assigned;
    }
  }

  const allUnavailable = input.profile.mappings.every((mapping) =>
    unavailableMetrics.has(mapping.canonicalMetric),
  );

  return AnalyticsObservationSchema.parse({
    collectedAt: input.now.toISOString(),
    providerSchemaVersion: schemaVersion(input.profile.profileVersion, response.data),
    rawPayload: {
      request: input.requestEvidence,
      capability: safeCapabilityEvidence(input.capability),
      response: input.body,
    },
    metrics,
    otherMetrics: null,
    availability: {
      status: allUnavailable ? 'NOT_YET_AVAILABLE' : 'AVAILABLE',
      unavailableMetrics: [...unavailableMetrics].sort(),
      notes: [
        'Instagram media-insights are mapped through the explicitly verified versioned activation profile.',
        'Missing or unsupported provider metrics remain NULL and are never fabricated as zero.',
      ],
    },
    comparability: {
      crossPlatformViewsComparable: false,
      notes: ['Instagram provider semantics remain isolated from other platforms.'],
    },
    normalizerVersion: INSTAGRAM_ANALYTICS_NORMALIZER_VERSION,
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
  });
}

export class InstagramAnalyticsCollector {
  readonly platform = 'INSTAGRAM' as const;
  readonly isRealProvider = true;

  private readonly profile: InstagramAnalyticsMetricProfile;
  private readonly apiVersion: string;
  private readonly graphBaseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly requestTimeoutMs: number;

  constructor(
    private readonly credentials: InstagramAnalyticsCredentialResolver,
    private readonly capabilities: InstagramAnalyticsCapabilityHook,
    profile: InstagramAnalyticsMetricProfile,
    options: InstagramAnalyticsCollectorOptions,
  ) {
    this.profile = InstagramAnalyticsMetricProfileSchema.parse(profile);
    this.apiVersion = ApiVersionSchema.parse(options.apiVersion);
    const graphBase = new URL(options.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL);
    if (graphBase.protocol !== 'https:') throw new Error('INSTAGRAM_ANALYTICS_HTTPS_REQUIRED');
    graphBase.pathname = graphBase.pathname.replace(/\/$/, '');
    this.graphBaseUrl = graphBase.toString().replace(/\/$/, '');
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    if (
      !Number.isSafeInteger(this.requestTimeoutMs) ||
      this.requestTimeoutMs < 1_000 ||
      this.requestTimeoutMs > 120_000
    ) {
      throw new Error('INVALID_INSTAGRAM_ANALYTICS_TIMEOUT');
    }
  }

  private async capabilityState(snapshot: AnalyticsCollectionSnapshot, now: Date) {
    const state = await this.capabilities.verify({
      platformAccountId: snapshot.platformAccountId,
      mediaId: snapshot.remotePostId,
      profileVersion: this.profile.profileVersion,
    });
    const checkedAt = parseDate(state.checkedAt, 'INSTAGRAM_CAPABILITY_CHECKED_AT');
    const validUntil = parseDate(state.validUntil, 'INSTAGRAM_CAPABILITY_VALID_UNTIL');
    if (
      checkedAt.getTime() > now.getTime() + 60_000 ||
      validUntil.getTime() < checkedAt.getTime()
    ) {
      throw new InstagramAnalyticsError(
        'ACTIVATION_RECHECK_REQUIRED',
        'INSTAGRAM_ANALYTICS_CAPABILITY_EVIDENCE_INVALID',
        false,
      );
    }
    if (validUntil.getTime() < now.getTime()) {
      throw new InstagramAnalyticsError(
        'ACTIVATION_RECHECK_REQUIRED',
        'INSTAGRAM_ANALYTICS_ACTIVATION_RECHECK_REQUIRED',
        false,
      );
    }
    if (state.deletionRequired) {
      throw new InstagramAnalyticsError(
        'DELETION_REQUIRED',
        'INSTAGRAM_ANALYTICS_STORED_DATA_DELETION_REQUIRED',
        false,
      );
    }
    if (!state.retentionRequirementsVerified) {
      throw new InstagramAnalyticsError(
        'ACTIVATION_RECHECK_REQUIRED',
        'INSTAGRAM_ANALYTICS_RETENTION_REQUIREMENTS_UNVERIFIED',
        false,
      );
    }
    if (!state.professionalAccount || !state.mediaOwnedByAccount) {
      throw new InstagramAnalyticsError(
        'CAPABILITY_REQUIRED',
        'INSTAGRAM_ANALYTICS_OWNED_PROFESSIONAL_MEDIA_REQUIRED',
        false,
      );
    }
    if (!state.insightsPermissionGranted) {
      throw new InstagramAnalyticsError(
        'AUTH_REQUIRED',
        'INSTAGRAM_ANALYTICS_INSIGHTS_PERMISSION_REQUIRED',
        false,
      );
    }
    const supportedProviderMetrics = state.supportedProviderMetrics.map((metric) =>
      ProviderMetricNameSchema.parse(metric),
    );
    if (new Set(supportedProviderMetrics).size !== supportedProviderMetrics.length) {
      throw new InstagramAnalyticsError(
        'ACTIVATION_RECHECK_REQUIRED',
        'INSTAGRAM_ANALYTICS_DUPLICATE_SUPPORTED_METRIC',
        false,
      );
    }
    return { ...state, supportedProviderMetrics };
  }

  private async accessToken(platformAccountId: string, now: Date) {
    const credential = await this.credentials.resolve(platformAccountId);
    const accessToken = AccessTokenSchema.parse(credential.accessToken);
    if (credential.expiresAt !== undefined) {
      const expiresAt = parseDate(credential.expiresAt, 'INSTAGRAM_TOKEN_EXPIRES_AT');
      if (expiresAt.getTime() <= now.getTime()) {
        throw new InstagramAnalyticsError(
          'AUTH_REQUIRED',
          'INSTAGRAM_ANALYTICS_AUTH_REQUIRED',
          false,
        );
      }
    }
    return accessToken;
  }

  async collect(snapshot: AnalyticsCollectionSnapshot): Promise<AnalyticsObservation> {
    if (snapshot.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_ANALYTICS_SNAPSHOT_REQUIRED');
    if (snapshot.adapterKey !== INSTAGRAM_ANALYTICS_ADAPTER_KEY) {
      throw new Error('INSTAGRAM_ANALYTICS_ADAPTER_KEY_REQUIRED');
    }
    const now = this.now();
    if (!Number.isFinite(now.getTime())) throw new Error('INVALID_ANALYTICS_NOW');
    const capability = await this.capabilityState(snapshot, now);
    const supported = new Set(capability.supportedProviderMetrics);
    const activeMappings = this.profile.mappings.filter((mapping) =>
      supported.has(mapping.providerMetric),
    );

    if (activeMappings.length === 0) {
      return unsupportedObservation({ now, profile: this.profile, snapshot, capability });
    }

    const accessToken = await this.accessToken(snapshot.platformAccountId, now);
    const requestedMetrics = activeMappings.map((mapping) => mapping.providerMetric);
    const requestEvidence = Object.freeze({
      apiVersion: this.apiVersion,
      mediaId: snapshot.remotePostId,
      profileVersion: this.profile.profileVersion,
      requestedMetrics,
    });
    const url = new URL(
      `${this.graphBaseUrl}/${this.apiVersion}/${encodeURIComponent(snapshot.remotePostId)}/insights`,
    );
    url.searchParams.set('metric', requestedMetrics.join(','));

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(this.requestTimeoutMs),
      });
    } catch {
      throw new InstagramAnalyticsError(
        'SOURCE_UNAVAILABLE',
        'INSTAGRAM_ANALYTICS_SOURCE_UNAVAILABLE',
        true,
      );
    }

    const body = await safeJson(response);
    if (!response.ok) {
      const metadata = metaErrorMetadata(body);
      const suffix = metadata?.code === undefined ? '' : `:${metadata.code}`;
      if (response.status === 401 || metadata?.code === 190) {
        throw new InstagramAnalyticsError(
          'AUTH_REQUIRED',
          `INSTAGRAM_ANALYTICS_AUTH_REQUIRED${suffix}`,
          false,
        );
      }
      if (response.status === 403) {
        throw new InstagramAnalyticsError(
          'CAPABILITY_REQUIRED',
          `INSTAGRAM_ANALYTICS_CAPABILITY_REQUIRED${suffix}`,
          false,
        );
      }
      if (response.status === 400 && metadata?.code === 100) {
        throw new InstagramAnalyticsError(
          'UNSUPPORTED_METRIC',
          `INSTAGRAM_ANALYTICS_METRIC_REJECTED${suffix}`,
          false,
        );
      }
      if (response.status === 429 || response.status >= 500 || metadata?.transient === true) {
        throw new InstagramAnalyticsError(
          'SOURCE_UNAVAILABLE',
          `INSTAGRAM_ANALYTICS_SOURCE_UNAVAILABLE:${response.status}`,
          true,
        );
      }
      throw new InstagramAnalyticsError(
        'SOURCE_UNAVAILABLE',
        `INSTAGRAM_ANALYTICS_SOURCE_UNAVAILABLE:${response.status}`,
        false,
      );
    }

    return normalizeResponse({
      body,
      now,
      profile: this.profile,
      activeMappings,
      capability,
      requestEvidence,
    });
  }
}
