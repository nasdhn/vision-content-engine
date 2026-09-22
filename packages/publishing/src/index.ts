import { z } from 'zod';

export const PublicationDeliveryModeSchema = z.enum(['API_AUTOMATED', 'MANUAL_HANDOFF']);
export const PlatformSchema = z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE']);
export const PublicationResponseClassSchema = z.enum([
  'SUCCESS',
  'TRANSIENT_FAILURE',
  'PERMANENT_FAILURE',
  'RATE_LIMITED',
  'UNKNOWN_SIDE_EFFECT',
]);

export const InstagramReelMetadataSchema = z
  .object({
    schemaVersion: z.literal('instagram-reel-v1'),
    platform: z.literal('INSTAGRAM'),
    caption: z.string(),
    shareToFeed: z.boolean(),
  })
  .strict();

export const YouTubeShortMetadataSchema = z
  .object({
    schemaVersion: z.literal('youtube-short-v1'),
    platform: z.literal('YOUTUBE'),
    title: z.string().min(1),
    description: z.string(),
    tags: z.array(z.string()),
    categoryId: z.string().min(1),
    defaultLanguage: z.string().default('fr'),
    privacyStatus: z.enum(['private', 'public', 'unlisted']),
    publishAt: z.string().datetime().optional(),
    selfDeclaredMadeForKids: z.boolean(),
    containsSyntheticMedia: z.boolean().optional(),
  })
  .strict();

export const TikTokManualMetadataSchema = z
  .object({
    schemaVersion: z.literal('tiktok-manual-handoff-v1'),
    platform: z.literal('TIKTOK'),
    caption: z.string(),
    hashtags: z.array(z.string()),
    ctaNotes: z.string().optional(),
    coverRecommendation: z.string().optional(),
    commercialDisclosureReminder: z.boolean(),
  })
  .strict();

export const PlatformCapabilitiesSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    canPublishVideo: z.boolean(),
    canPublishPublic: z.boolean(),
    supportsNativeScheduling: z.boolean(),
    deliveryMode: PublicationDeliveryModeSchema,
    limitations: z.array(z.string()),
    checkedAt: z.string().datetime(),
  })
  .strict();

export type PublicationMetadata =
  | z.infer<typeof InstagramReelMetadataSchema>
  | z.infer<typeof YouTubeShortMetadataSchema>
  | z.infer<typeof TikTokManualMetadataSchema>;

export type PlatformCapabilities = z.infer<typeof PlatformCapabilitiesSchema>;

export function parsePublicationMetadata(platform: z.infer<typeof PlatformSchema>, value: unknown) {
  if (platform === 'INSTAGRAM') return InstagramReelMetadataSchema.parse(value);
  if (platform === 'YOUTUBE') return YouTubeShortMetadataSchema.parse(value);
  return TikTokManualMetadataSchema.parse(value);
}

export function assertSchedulingCapabilities(input: {
  platform: z.infer<typeof PlatformSchema>;
  deliveryMode: z.infer<typeof PublicationDeliveryModeSchema>;
  credentialsConfigured: boolean;
  capabilities: unknown;
  metadata: PublicationMetadata;
}) {
  const { platform, deliveryMode } = input;
  if (platform === 'TIKTOK') {
    if (deliveryMode !== 'MANUAL_HANDOFF') throw new Error('TIKTOK_MANUAL_ONLY');
    return null;
  }
  if (deliveryMode !== 'API_AUTOMATED') throw new Error('AUTOMATED_DELIVERY_REQUIRED');
  if (!input.credentialsConfigured) throw new Error('PUBLISH_CREDENTIALS_REQUIRED');
  const capabilities = PlatformCapabilitiesSchema.parse(input.capabilities);
  if (capabilities.deliveryMode !== deliveryMode || !capabilities.canPublishVideo) {
    throw new Error('PUBLISH_CAPABILITY_REQUIRED');
  }
  if (
    platform === 'YOUTUBE' &&
    input.metadata.platform === 'YOUTUBE' &&
    input.metadata.privacyStatus !== 'private' &&
    !capabilities.canPublishPublic
  ) {
    throw new Error('YOUTUBE_PUBLIC_UPLOAD_NOT_READY');
  }
  return capabilities;
}

export const PublishRequestedJobSchema = z
  .object({
    kind: z.literal('PUBLISH'),
    outboxEventId: z.string().uuid(),
    publicationId: z.string().uuid(),
    publicationAttemptId: z.string().uuid(),
    operationId: z.string().uuid(),
  })
  .strict();

export const ReconcileRequestedJobSchema = z
  .object({
    kind: z.literal('RECONCILE'),
    outboxEventId: z.string().uuid(),
    publicationId: z.string().uuid(),
    operationId: z.string().uuid(),
  })
  .strict();

export const PublishQueueJobSchema = z.discriminatedUnion('kind', [
  PublishRequestedJobSchema,
  ReconcileRequestedJobSchema,
]);

export type PublishQueueJob = z.infer<typeof PublishQueueJobSchema>;

export type PublicationSnapshot = Readonly<{
  publicationId: string;
  operationId: string;
  platform: z.infer<typeof PlatformSchema>;
  deliveryMode: z.infer<typeof PublicationDeliveryModeSchema>;
  scheduledAt: string | null;
  metadata: PublicationMetadata;
  account: Readonly<{
    id: string;
    remoteAccountId: string;
    capabilities: PlatformCapabilities | null;
  }>;
  execution: Readonly<{
    attemptId: string | null;
    attemptNumber: number | null;
    remoteRequestId: string | null;
    responseMetadata: unknown;
  }>;
  media: Readonly<{
    assetId: string;
    checksumSha256: string;
    sizeBytes: string;
    mimeType: string | null;
    width: number | null;
    height: number | null;
    durationMs: number | null;
  }>;
}>;

export type PublishPreparation = Readonly<{
  remoteRequestId?: string;
  responseMetadata?: Readonly<Record<string, unknown>>;
}>;

export type PublishResult =
  | Readonly<{
      responseClass: 'SUCCESS';
      remotePostId: string;
      remoteUrl?: string;
      remoteRequestId?: string;
      responseMetadata?: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      responseClass: 'TRANSIENT_FAILURE' | 'RATE_LIMITED' | 'PERMANENT_FAILURE';
      failureCode: string;
      failureMessage?: string;
      retryAfterMs?: number;
      remoteRequestId?: string;
      responseMetadata?: Readonly<Record<string, unknown>>;
    }>
  | Readonly<{
      responseClass: 'UNKNOWN_SIDE_EFFECT';
      failureCode: string;
      failureMessage?: string;
      remoteRequestId?: string;
      remotePostId?: string;
      responseMetadata?: Readonly<Record<string, unknown>>;
    }>;

export type ReconcileResult =
  | Readonly<{ kind: 'PUBLISHED'; remotePostId: string; remoteUrl?: string }>
  | Readonly<{ kind: 'FAILED'; failureCode: string }>
  | Readonly<{ kind: 'UNKNOWN' }>
  | Readonly<{ kind: 'ABSENT_RETRY_ELIGIBLE' }>;

export interface PlatformPublisher {
  readonly platform: z.infer<typeof PlatformSchema>;
  readonly isRealProvider: boolean;
  prepare(publication: PublicationSnapshot): Promise<PublishPreparation>;
  publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation,
  ): Promise<PublishResult>;
  reconcile(publication: PublicationSnapshot): Promise<ReconcileResult>;
}

export type PublisherRegistry = Readonly<{
  resolve(platform: z.infer<typeof PlatformSchema>): PlatformPublisher;
}>;

export class StaticPublisherRegistry implements PublisherRegistry {
  private readonly byPlatform: ReadonlyMap<z.infer<typeof PlatformSchema>, PlatformPublisher>;

  constructor(publishers: readonly PlatformPublisher[]) {
    const byPlatform = new Map(
      publishers.map((publisher) => [publisher.platform, publisher] as const),
    );
    if (byPlatform.size !== publishers.length) throw new Error('DUPLICATE_PLATFORM_PUBLISHER');
    this.byPlatform = byPlatform;
  }

  resolve(platform: z.infer<typeof PlatformSchema>) {
    const publisher = this.byPlatform.get(platform);
    if (!publisher) throw new Error('PUBLISHER_NOT_CONFIGURED');
    return publisher;
  }
}

export type PublishRetryPolicy = Readonly<{
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
}>;

export const DEFAULT_PUBLISH_RETRY_POLICY: PublishRetryPolicy = Object.freeze({
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 60_000,
  jitterRatio: 0.2,
});

export function assertPublishRetryPolicy(policy: PublishRetryPolicy) {
  if (!Number.isSafeInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new Error('INVALID_PUBLISH_MAX_ATTEMPTS');
  }
  if (!Number.isSafeInteger(policy.baseDelayMs) || policy.baseDelayMs < 1) {
    throw new Error('INVALID_PUBLISH_RETRY_BASE');
  }
  if (!Number.isSafeInteger(policy.maxDelayMs) || policy.maxDelayMs < policy.baseDelayMs) {
    throw new Error('INVALID_PUBLISH_RETRY_MAX');
  }
  if (!Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new Error('INVALID_PUBLISH_RETRY_JITTER');
  }
  return policy;
}

export function retryDelayMs(
  policy: PublishRetryPolicy,
  attemptNumber: number,
  retryAfterMs?: number,
  random = Math.random,
) {
  assertPublishRetryPolicy(policy);
  if (!Number.isSafeInteger(attemptNumber) || attemptNumber < 1) {
    throw new Error('INVALID_ATTEMPT_NUMBER');
  }
  if (retryAfterMs !== undefined) {
    if (!Number.isSafeInteger(retryAfterMs) || retryAfterMs < 0) {
      throw new Error('INVALID_RETRY_AFTER');
    }
    return Math.min(policy.maxDelayMs, retryAfterMs);
  }
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attemptNumber - 1));
  const jitterWindow = exponential * policy.jitterRatio;
  const jitter = (random() * 2 - 1) * jitterWindow;
  return Math.max(0, Math.round(Math.min(policy.maxDelayMs, exponential + jitter)));
}

export class FakePublisher implements PlatformPublisher {
  readonly isRealProvider = false;
  readonly calls: Array<
    Readonly<{ kind: 'PREPARE' | 'PUBLISH' | 'RECONCILE'; operationId: string }>
  > = [];

  private readonly publishResults: PublishResult[];
  private readonly reconcileResults: ReconcileResult[];

  constructor(
    readonly platform: z.infer<typeof PlatformSchema>,
    options: Readonly<{
      publishResults?: readonly PublishResult[];
      reconcileResults?: readonly ReconcileResult[];
    }> = {},
  ) {
    this.publishResults = [...(options.publishResults ?? [])];
    this.reconcileResults = [...(options.reconcileResults ?? [])];
  }

  async prepare(publication: PublicationSnapshot): Promise<PublishPreparation> {
    this.calls.push({ kind: 'PREPARE', operationId: publication.operationId });
    return Object.freeze({});
  }

  async publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation,
  ): Promise<PublishResult> {
    void preparation;
    this.calls.push({ kind: 'PUBLISH', operationId: publication.operationId });
    return (
      this.publishResults.shift() ?? {
        responseClass: 'SUCCESS',
        remotePostId: `fake-${publication.operationId}`,
        remoteUrl: `https://example.invalid/${publication.operationId}`,
      }
    );
  }

  async reconcile(publication: PublicationSnapshot): Promise<ReconcileResult> {
    this.calls.push({ kind: 'RECONCILE', operationId: publication.operationId });
    return this.reconcileResults.shift() ?? { kind: 'UNKNOWN' };
  }
}

export const DISTRIBUTION_OUTBOX_EVENT_TYPES = Object.freeze([
  'Publication.publish.requested',
  'Publication.reconcile.requested',
] as const);

export function parseDistributionOutboxEvent(event: {
  id: string;
  eventType: string;
  payloadJson: unknown;
}): PublishQueueJob {
  if (event.eventType === 'Publication.publish.requested') {
    const payload = z
      .object({
        publicationId: z.string().uuid(),
        publicationAttemptId: z.string().uuid(),
        operationId: z.string().uuid(),
      })
      .strict()
      .parse(event.payloadJson);
    return PublishRequestedJobSchema.parse({
      kind: 'PUBLISH',
      outboxEventId: event.id,
      ...payload,
    });
  }
  if (event.eventType === 'Publication.reconcile.requested') {
    const payload = z
      .object({ publicationId: z.string().uuid(), operationId: z.string().uuid() })
      .strict()
      .parse(event.payloadJson);
    return ReconcileRequestedJobSchema.parse({
      kind: 'RECONCILE',
      outboxEventId: event.id,
      ...payload,
    });
  }
  throw new Error('UNSUPPORTED_DISTRIBUTION_EVENT');
}
