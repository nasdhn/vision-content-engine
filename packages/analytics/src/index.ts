import { createHash } from 'node:crypto';
import { z } from 'zod';

export const ANALYTICS_QUEUE_NAME = 'vce-analytics';
export const ANALYTICS_OUTBOX_EVENT_TYPES = ['Analytics.collection.requested'] as const;
export const ANALYTICS_RUNTIME_SCHEMA_VERSION = 'analytics-runtime-v1';
export const METRIC_SEMANTICS_VERSION = 'canonical-metrics-v1';

export const AnalyticsPlatformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE']);
export const MetricCollectionMethodSchema = z.enum(['PLATFORM_API', 'MANUAL_ENTRY']);
export const AnalyticsWindowKeySchema = z.enum([
  'T_PLUS_1H',
  'T_PLUS_6H',
  'T_PLUS_24H',
  'T_PLUS_72H',
  'T_PLUS_7D',
  'T_PLUS_30D',
]);
export type AnalyticsWindowKey = z.infer<typeof AnalyticsWindowKeySchema>;

export type CollectionWindow = Readonly<{
  key: AnalyticsWindowKey;
  offsetSeconds: number;
}>;

export const AUTOMATED_PLATFORM_WINDOWS: readonly CollectionWindow[] = Object.freeze([
  Object.freeze({ key: 'T_PLUS_1H', offsetSeconds: 3_600 }),
  Object.freeze({ key: 'T_PLUS_6H', offsetSeconds: 21_600 }),
  Object.freeze({ key: 'T_PLUS_24H', offsetSeconds: 86_400 }),
  Object.freeze({ key: 'T_PLUS_72H', offsetSeconds: 259_200 }),
  Object.freeze({ key: 'T_PLUS_7D', offsetSeconds: 604_800 }),
  Object.freeze({ key: 'T_PLUS_30D', offsetSeconds: 2_592_000 }),
]);

export const MANUAL_TIKTOK_WINDOWS: readonly CollectionWindow[] = Object.freeze([
  Object.freeze({ key: 'T_PLUS_24H', offsetSeconds: 86_400 }),
  Object.freeze({ key: 'T_PLUS_72H', offsetSeconds: 259_200 }),
  Object.freeze({ key: 'T_PLUS_7D', offsetSeconds: 604_800 }),
]);

export const OPTIONAL_MANUAL_TIKTOK_WINDOWS: readonly CollectionWindow[] = Object.freeze([
  Object.freeze({ key: 'T_PLUS_30D', offsetSeconds: 2_592_000 }),
]);

export const MANUAL_TIKTOK_OVERDUE_GRACE_SECONDS = 86_400;

export function manualTikTokWindow(windowKey: AnalyticsWindowKey) {
  const window = [...MANUAL_TIKTOK_WINDOWS, ...OPTIONAL_MANUAL_TIKTOK_WINDOWS].find(
    (candidate) => candidate.key === windowKey,
  );
  if (!window) throw new Error('INVALID_TIKTOK_MANUAL_WINDOW');
  return window;
}

export function manualTikTokOverdueAt(publishedAt: Date, windowKey: AnalyticsWindowKey) {
  const dueAt = collectionDueAt(publishedAt, manualTikTokWindow(windowKey));
  return new Date(dueAt.getTime() + MANUAL_TIKTOK_OVERDUE_GRACE_SECONDS * 1_000);
}

export function collectionWindowsFor(
  platform: z.infer<typeof AnalyticsPlatformSchema>,
  method: z.infer<typeof MetricCollectionMethodSchema>,
): readonly CollectionWindow[] {
  if (platform === 'TIKTOK' && method === 'MANUAL_ENTRY') return MANUAL_TIKTOK_WINDOWS;
  if (platform !== 'TIKTOK' && method === 'PLATFORM_API') return AUTOMATED_PLATFORM_WINDOWS;
  return Object.freeze([]);
}

export function adapterKeyFor(platform: z.infer<typeof AnalyticsPlatformSchema>) {
  if (platform === 'YOUTUBE') return 'YOUTUBE_ANALYTICS_V1';
  if (platform === 'INSTAGRAM') return 'INSTAGRAM_ANALYTICS_V1';
  return 'TIKTOK_MANUAL_V1';
}

export function collectionDueAt(publishedAt: Date, window: CollectionWindow) {
  if (Number.isNaN(publishedAt.getTime())) throw new Error('INVALID_PUBLISHED_AT');
  return new Date(publishedAt.getTime() + window.offsetSeconds * 1_000);
}

function deterministicUuid(input: string) {
  const bytes = Buffer.from(createHash('sha256').update(input).digest().subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function collectionOperationIdFor(input: {
  publicationId: string;
  adapterKey: string;
  windowKey: AnalyticsWindowKey;
  collectionMethod: z.infer<typeof MetricCollectionMethodSchema>;
}) {
  return deterministicUuid(
    [
      ANALYTICS_RUNTIME_SCHEMA_VERSION,
      input.publicationId,
      input.adapterKey,
      input.windowKey,
      input.collectionMethod,
    ].join('|'),
  );
}

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([JsonPrimitiveSchema, z.array(JsonValueSchema), z.record(z.string(), JsonValueSchema)]),
);

const NullableCountSchema = z.bigint().nonnegative().nullable();
const NullableDurationIntSchema = z.number().int().nonnegative().nullable();
const NullableFiniteNumberSchema = z.number().finite().nonnegative().nullable();

export const CanonicalMetricsSchema = z
  .object({
    views: NullableCountSchema,
    engagedViews: NullableCountSchema,
    reach: NullableCountSchema,
    impressions: NullableCountSchema,
    likes: NullableCountSchema,
    comments: NullableCountSchema,
    shares: NullableCountSchema,
    saves: NullableCountSchema,
    watchTimeMs: NullableCountSchema,
    avgWatchDurationMs: NullableDurationIntSchema,
    avgWatchPercentage: NullableFiniteNumberSchema,
    completionRate: NullableFiniteNumberSchema,
    profileVisits: NullableCountSchema,
    websiteClicks: NullableCountSchema,
    follows: NullableCountSchema,
  })
  .strict();

export type CanonicalMetrics = z.infer<typeof CanonicalMetricsSchema>;

export const EMPTY_CANONICAL_METRICS: CanonicalMetrics = Object.freeze({
  views: null,
  engagedViews: null,
  reach: null,
  impressions: null,
  likes: null,
  comments: null,
  shares: null,
  saves: null,
  watchTimeMs: null,
  avgWatchDurationMs: null,
  avgWatchPercentage: null,
  completionRate: null,
  profileVisits: null,
  websiteClicks: null,
  follows: null,
});

const ManualCountInputSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional();
const ManualDurationInputSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER)
  .optional();
const ManualRateInputSchema = z.number().finite().min(0).max(1).optional();

export const TikTokManualMetricsInputSchema = z
  .object({
    views: ManualCountInputSchema,
    likes: ManualCountInputSchema,
    comments: ManualCountInputSchema,
    shares: ManualCountInputSchema,
    saves: ManualCountInputSchema,
    watchTimeMs: ManualCountInputSchema,
    avgWatchDurationMs: ManualDurationInputSchema,
    completionRate: ManualRateInputSchema,
    profileVisits: ManualCountInputSchema,
    follows: ManualCountInputSchema,
  })
  .strict()
  .refine((value) => Object.values(value).some((entry) => entry !== undefined), {
    message: 'MANUAL_METRICS_REQUIRED',
  });

export type TikTokManualMetricsInput = z.infer<typeof TikTokManualMetricsInputSchema>;

const MANUAL_TIKTOK_CANONICAL_KEYS = [
  'views',
  'likes',
  'comments',
  'shares',
  'saves',
  'watchTimeMs',
  'avgWatchDurationMs',
  'completionRate',
  'profileVisits',
  'follows',
] as const;

export function normalizeTikTokManualMetrics(
  input: unknown,
  collectedAt: Date,
): AnalyticsObservation {
  const parsed = TikTokManualMetricsInputSchema.parse(input);
  const metrics: CanonicalMetrics = {
    ...EMPTY_CANONICAL_METRICS,
    ...(parsed.views === undefined ? {} : { views: BigInt(parsed.views) }),
    ...(parsed.likes === undefined ? {} : { likes: BigInt(parsed.likes) }),
    ...(parsed.comments === undefined ? {} : { comments: BigInt(parsed.comments) }),
    ...(parsed.shares === undefined ? {} : { shares: BigInt(parsed.shares) }),
    ...(parsed.saves === undefined ? {} : { saves: BigInt(parsed.saves) }),
    ...(parsed.watchTimeMs === undefined ? {} : { watchTimeMs: BigInt(parsed.watchTimeMs) }),
    ...(parsed.avgWatchDurationMs === undefined
      ? {}
      : { avgWatchDurationMs: parsed.avgWatchDurationMs }),
    ...(parsed.completionRate === undefined ? {} : { completionRate: parsed.completionRate }),
    ...(parsed.profileVisits === undefined ? {} : { profileVisits: BigInt(parsed.profileVisits) }),
    ...(parsed.follows === undefined ? {} : { follows: BigInt(parsed.follows) }),
  };
  const unavailableMetrics = MANUAL_TIKTOK_CANONICAL_KEYS.filter(
    (key) => parsed[key] === undefined,
  );
  return AnalyticsObservationSchema.parse({
    collectedAt: collectedAt.toISOString(),
    providerSchemaVersion: 'tiktok-manual-entry-v1',
    rawPayload: parsed,
    metrics,
    otherMetrics: null,
    availability: {
      status: 'AVAILABLE',
      unavailableMetrics,
      notes: ['Valeurs absentes = non observées, jamais converties en zéro.'],
    },
    comparability: {
      crossPlatformViewsComparable: false,
      notes: ['Saisie manuelle TikTok; sémantique provider conservée séparément.'],
    },
    normalizerVersion: 'tiktok-manual-normalizer-v1',
    metricSemanticsVersion: METRIC_SEMANTICS_VERSION,
  });
}

export function parseManualTikTokJobType(jobType: string) {
  const match = /^ANALYTICS_MANUAL:TIKTOK:(T_PLUS_(?:24H|72H|7D))$/.exec(jobType);
  if (!match) throw new Error('INVALID_TIKTOK_MANUAL_JOB_TYPE');
  return AnalyticsWindowKeySchema.parse(match[1]);
}

export const AnalyticsFailureCodeSchema = z.enum([
  'NOT_YET_AVAILABLE',
  'UNSUPPORTED_METRIC',
  'AUTH_REQUIRED',
  'SOURCE_UNAVAILABLE',
  'SCHEMA_DRIFT',
  'NORMALIZATION_FAILED',
  'DUPLICATE_REJECTED',
  'MANUAL_SNAPSHOT_OVERDUE',
]);
export type AnalyticsFailureCode = z.infer<typeof AnalyticsFailureCodeSchema>;

export const AnalyticsAvailabilityStatusSchema = z.enum([
  'AVAILABLE',
  'NOT_YET_AVAILABLE',
  'UNSUPPORTED_METRIC',
]);

export const AnalyticsObservationSchema = z
  .object({
    collectedAt: z.string().datetime(),
    providerSchemaVersion: z.string().min(1).nullable().default(null),
    rawPayload: JsonValueSchema,
    metrics: CanonicalMetricsSchema,
    otherMetrics: z.record(z.string(), JsonValueSchema).nullable().default(null),
    availability: z
      .object({
        status: AnalyticsAvailabilityStatusSchema,
        unavailableMetrics: z.array(z.string()).default([]),
        notes: z.array(z.string()).default([]),
      })
      .strict(),
    comparability: z
      .object({
        crossPlatformViewsComparable: z.boolean().default(false),
        notes: z.array(z.string()).default([]),
      })
      .strict(),
    normalizerVersion: z.string().min(1),
    metricSemanticsVersion: z.string().min(1),
  })
  .strict();

export type AnalyticsObservation = z.infer<typeof AnalyticsObservationSchema>;

export const AnalyticsCollectionJobSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    kind: z.literal('COLLECT_PLATFORM_METRICS'),
    outboxEventId: z.string().uuid(),
    workflowRunId: z.string().uuid(),
    jobAttemptId: z.string().uuid(),
    publicationId: z.string().uuid(),
    platformAccountId: z.string().uuid(),
    platform: AnalyticsPlatformSchema,
    adapterKey: z.string().min(1),
    windowKey: AnalyticsWindowKeySchema,
    collectionOperationId: z.string().uuid(),
    scheduledFor: z.string().datetime(),
  })
  .strict();

export type AnalyticsCollectionJob = z.infer<typeof AnalyticsCollectionJobSchema>;

export type AnalyticsCollectionSnapshot = Readonly<{
  publicationId: string;
  platformAccountId: string;
  platform: z.infer<typeof AnalyticsPlatformSchema>;
  remotePostId: string;
  publishedAt: string;
  adapterKey: string;
  windowKey: AnalyticsWindowKey;
  scheduledFor: string;
  collectionOperationId: string;
}>;

export interface AnalyticsCollector {
  readonly platform: z.infer<typeof AnalyticsPlatformSchema>;
  readonly isRealProvider: boolean;
  collect(snapshot: AnalyticsCollectionSnapshot): Promise<AnalyticsObservation>;
}

export class StaticAnalyticsCollectorRegistry {
  private readonly byPlatform = new Map<string, AnalyticsCollector>();

  constructor(collectors: readonly AnalyticsCollector[]) {
    for (const collector of collectors) {
      if (this.byPlatform.has(collector.platform)) throw new Error('DUPLICATE_ANALYTICS_COLLECTOR');
      this.byPlatform.set(collector.platform, collector);
    }
  }

  resolve(platform: z.infer<typeof AnalyticsPlatformSchema>) {
    const collector = this.byPlatform.get(platform);
    if (!collector) throw new Error('ANALYTICS_COLLECTOR_UNAVAILABLE');
    return collector;
  }
}

export class FakeAnalyticsCollector implements AnalyticsCollector {
  readonly isRealProvider = false;
  private calls = 0;

  constructor(
    readonly platform: z.infer<typeof AnalyticsPlatformSchema>,
    private readonly observation: AnalyticsObservation,
  ) {}

  async collect(snapshot: AnalyticsCollectionSnapshot) {
    void snapshot;
    this.calls += 1;
    return AnalyticsObservationSchema.parse(structuredClone(this.observation));
  }

  callCount() {
    return this.calls;
  }
}

export function rawPayloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function parseAnalyticsOutboxEvent(event: {
  id: string;
  eventType: string;
  payloadJson: unknown;
}) {
  if (event.eventType !== 'Analytics.collection.requested') {
    throw new Error('NOT_ANALYTICS_OUTBOX_EVENT');
  }
  const payload = AnalyticsCollectionJobSchema.omit({ outboxEventId: true }).parse(
    event.payloadJson,
  );
  return AnalyticsCollectionJobSchema.parse({ ...payload, outboxEventId: event.id });
}

export * from './youtube.js';

export * from './instagram.js';

export * from './umami.js';
