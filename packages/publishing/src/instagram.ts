import { z } from 'zod';
import type {
  PlatformAccountHealthResult,
  PlatformAccountSnapshot,
  PlatformPublisher,
  PublicationSnapshot,
  PublishPreparation,
  PublishResult,
  ReconcileResult,
} from './index.js';
import { ProviderPublishError } from './provider-error.js';

const AccessTokenSchema = z.string().min(1).max(16_384);
const ApiVersionSchema = z.string().regex(/^v\d+\.\d+$/);
const MetaIdSchema = z.string().min(1).max(256);

const MetaErrorBodySchema = z
  .object({
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional(),
        code: z.number().int().optional(),
        error_subcode: z.number().int().optional(),
      })
      .passthrough(),
  })
  .passthrough();

const CapabilityResponseSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            quota_usage: z.number().int().nonnegative(),
            config: z
              .object({
                quota_total: z.number().int().positive(),
                quota_duration: z.number().int().positive(),
              })
              .partial()
              .optional(),
          })
          .passthrough(),
      )
      .min(1),
  })
  .passthrough();

const ContainerCreateResponseSchema = z.object({ id: MetaIdSchema }).passthrough();
const ContainerStatusResponseSchema = z
  .object({
    id: MetaIdSchema.optional(),
    status_code: z.string().min(1),
    status: z.string().optional(),
  })
  .passthrough();
const MediaPublishResponseSchema = z.object({ id: MetaIdSchema }).passthrough();
const MediaLookupResponseSchema = z
  .object({
    id: MetaIdSchema,
    permalink: z.string().url().optional(),
  })
  .passthrough();

export type InstagramCredential = Readonly<{
  accessToken: string;
  expiresAt?: string;
}>;

export interface InstagramCredentialResolver {
  resolve(accountId: string): Promise<InstagramCredential>;
}

export type ExactAssetDeliveryLease = Readonly<{
  assetId: string;
  checksumSha256: string;
  url: string;
  expiresAt: string;
}>;

export interface ExactAssetDeliveryLeaseProvider {
  issue(publication: PublicationSnapshot, ttlSeconds: number): Promise<ExactAssetDeliveryLease>;
}

export type InstagramPublisherOptions = Readonly<{
  apiVersion: string;
  graphBaseUrl?: string;
  pollIntervalMs?: number;
  maxPollAttempts?: number;
  leaseTtlSeconds?: number;
  fetchImpl?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => Date;
}>;

type CapabilitySnapshot = Readonly<{
  quotaUsage: number;
  quotaTotal: number | null;
  quotaDurationSeconds: number | null;
}>;

type MetaFailureContext = 'READ' | 'CONTAINER_CREATE' | 'MEDIA_PUBLISH';

const DEFAULT_GRAPH_BASE_URL = 'https://graph.facebook.com';
const DEFAULT_POLL_INTERVAL_MS = 60_000;
const DEFAULT_MAX_POLL_ATTEMPTS = 5;
const DEFAULT_LEASE_TTL_SECONDS = 15 * 60;
const MAX_LEASE_TTL_SECONDS = 30 * 60;
const MAX_INSTAGRAM_VIDEO_BYTES = 1_000_000_000n;
const MIN_INSTAGRAM_DURATION_MS = 3_000;
const MAX_INSTAGRAM_DURATION_MS = 15 * 60_000;

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function sanitizeFailureMetadata(body: unknown): Readonly<Record<string, unknown>> | undefined {
  const parsed = MetaErrorBodySchema.safeParse(body);
  if (!parsed.success) return undefined;
  const error = parsed.data.error;
  return Object.freeze({
    ...(error.type !== undefined ? { providerErrorType: error.type } : {}),
    ...(error.code !== undefined ? { providerErrorCode: error.code } : {}),
    ...(error.error_subcode !== undefined ? { providerErrorSubcode: error.error_subcode } : {}),
  });
}

function isRateLimited(status: number, body: unknown) {
  if (status === 429) return true;
  const parsed = MetaErrorBodySchema.safeParse(body);
  if (!parsed.success) return false;
  const code = parsed.data.error.code;
  return code === 4 || code === 9 || code === 17 || code === 32 || code === 613;
}

function failureForHttp(
  status: number,
  body: unknown,
  context: MetaFailureContext,
): Exclude<PublishResult, Readonly<{ responseClass: 'SUCCESS' }>> {
  const responseMetadata = sanitizeFailureMetadata(body);
  if (isRateLimited(status, body)) {
    return {
      responseClass: 'RATE_LIMITED',
      failureCode: 'INSTAGRAM_RATE_LIMITED',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  if (status === 401 || status === 403) {
    return {
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_AUTH_REQUIRED',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  if (status >= 500 && context === 'MEDIA_PUBLISH') {
    return {
      responseClass: 'UNKNOWN_SIDE_EFFECT',
      failureCode: 'INSTAGRAM_PUBLISH_RESPONSE_AMBIGUOUS',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  if (status >= 500) {
    return {
      responseClass: 'TRANSIENT_FAILURE',
      failureCode: 'INSTAGRAM_PROVIDER_UNAVAILABLE',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  return {
    responseClass: 'PERMANENT_FAILURE',
    failureCode:
      context === 'CONTAINER_CREATE'
        ? 'INSTAGRAM_CONTAINER_REJECTED'
        : context === 'MEDIA_PUBLISH'
          ? 'INSTAGRAM_PUBLISH_REJECTED'
          : 'INSTAGRAM_CAPABILITY_CHECK_FAILED',
    ...(responseMetadata !== undefined ? { responseMetadata } : {}),
  };
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function validateInstagramMedia(publication: PublicationSnapshot) {
  if (publication.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_PUBLICATION_REQUIRED');
  if (publication.deliveryMode !== 'API_AUTOMATED') throw new Error('AUTOMATED_DELIVERY_REQUIRED');
  if (publication.metadata.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_METADATA_REQUIRED');

  const sizeBytes = BigInt(publication.media.sizeBytes);
  if (sizeBytes <= 0n || sizeBytes > MAX_INSTAGRAM_VIDEO_BYTES) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_MEDIA_SIZE_UNSUPPORTED',
    });
  }
  if (!['video/mp4', 'video/quicktime'].includes(publication.media.mimeType ?? '')) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_MEDIA_CONTAINER_UNSUPPORTED',
    });
  }
  if (
    publication.media.durationMs === null ||
    publication.media.durationMs < MIN_INSTAGRAM_DURATION_MS ||
    publication.media.durationMs > MAX_INSTAGRAM_DURATION_MS
  ) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_MEDIA_DURATION_UNSUPPORTED',
    });
  }
  if (publication.media.width !== null && publication.media.width > 1920) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_MEDIA_WIDTH_UNSUPPORTED',
    });
  }
  if (
    publication.media.fps !== null &&
    (publication.media.fps < 23 || publication.media.fps > 60)
  ) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_MEDIA_FPS_UNSUPPORTED',
    });
  }
  if (publication.media.sampleRate !== null && publication.media.sampleRate !== 48_000) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'INSTAGRAM_AUDIO_SAMPLE_RATE_UNSUPPORTED',
    });
  }
}

function validateLease(
  publication: PublicationSnapshot,
  lease: ExactAssetDeliveryLease,
  now: Date,
  requestedTtlSeconds: number,
) {
  if (
    lease.assetId !== publication.media.assetId ||
    lease.checksumSha256 !== publication.media.checksumSha256
  ) {
    throw new Error('ASSET_DELIVERY_LEASE_IDENTITY_MISMATCH');
  }
  const url = new URL(lease.url);
  if (url.protocol !== 'https:') throw new Error('ASSET_DELIVERY_LEASE_HTTPS_REQUIRED');
  const expiresAt = new Date(lease.expiresAt);
  if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
    throw new Error('ASSET_DELIVERY_LEASE_EXPIRED');
  }
  if (expiresAt.getTime() - now.getTime() > (requestedTtlSeconds + 5) * 1_000) {
    throw new Error('ASSET_DELIVERY_LEASE_TOO_LONG');
  }
}

export class InstagramGraphPublisher implements PlatformPublisher {
  readonly platform = 'INSTAGRAM' as const;
  readonly isRealProvider = true;

  private readonly apiVersion: string;
  private readonly graphBaseUrl: string;
  private readonly pollIntervalMs: number;
  private readonly maxPollAttempts: number;
  private readonly leaseTtlSeconds: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => Date;

  constructor(
    private readonly credentials: InstagramCredentialResolver,
    private readonly mediaLeases: ExactAssetDeliveryLeaseProvider,
    options: InstagramPublisherOptions,
  ) {
    this.apiVersion = ApiVersionSchema.parse(options.apiVersion);
    const graphBase = new URL(options.graphBaseUrl ?? DEFAULT_GRAPH_BASE_URL);
    if (graphBase.protocol !== 'https:') throw new Error('INSTAGRAM_GRAPH_HTTPS_REQUIRED');
    graphBase.pathname = graphBase.pathname.replace(/\/$/, '');
    this.graphBaseUrl = graphBase.toString().replace(/\/$/, '');
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPollAttempts = options.maxPollAttempts ?? DEFAULT_MAX_POLL_ATTEMPTS;
    this.leaseTtlSeconds = options.leaseTtlSeconds ?? DEFAULT_LEASE_TTL_SECONDS;
    if (!Number.isSafeInteger(this.pollIntervalMs) || this.pollIntervalMs < 0) {
      throw new Error('INVALID_INSTAGRAM_POLL_INTERVAL');
    }
    if (
      !Number.isSafeInteger(this.maxPollAttempts) ||
      this.maxPollAttempts < 1 ||
      this.maxPollAttempts > 10
    ) {
      throw new Error('INVALID_INSTAGRAM_POLL_ATTEMPTS');
    }
    if (
      !Number.isSafeInteger(this.leaseTtlSeconds) ||
      this.leaseTtlSeconds < 60 ||
      this.leaseTtlSeconds > MAX_LEASE_TTL_SECONDS
    ) {
      throw new Error('INVALID_INSTAGRAM_LEASE_TTL');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? sleep;
    this.now = options.now ?? (() => new Date());
  }

  private endpoint(path: string) {
    return `${this.graphBaseUrl}/${this.apiVersion}/${path.replace(/^\//, '')}`;
  }

  private async accessToken(accountId: string) {
    const credential = await this.credentials.resolve(accountId);
    const accessToken = AccessTokenSchema.parse(credential.accessToken);
    if (credential.expiresAt !== undefined) {
      const expiresAt = new Date(credential.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= this.now().getTime()) {
        throw new ProviderPublishError({
          responseClass: 'PERMANENT_FAILURE',
          failureCode: 'INSTAGRAM_AUTH_REQUIRED',
        });
      }
    }
    return accessToken;
  }

  private async request(
    url: string,
    accessToken: string,
    init: RequestInit,
    context: MetaFailureContext,
  ) {
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(init.body !== undefined
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
        },
        signal: init.signal ?? AbortSignal.timeout(30_000),
      });
    } catch {
      if (context === 'MEDIA_PUBLISH') {
        throw new ProviderPublishError({
          responseClass: 'UNKNOWN_SIDE_EFFECT',
          failureCode: 'INSTAGRAM_PUBLISH_RESPONSE_AMBIGUOUS',
        });
      }
      throw new ProviderPublishError({
        responseClass: 'TRANSIENT_FAILURE',
        failureCode: 'INSTAGRAM_NETWORK_FAILURE',
      });
    }
    const body = await safeJson(response);
    if (!response.ok)
      throw new ProviderPublishError(failureForHttp(response.status, body, context));
    return body;
  }

  private async capabilityCheck(publication: PublicationSnapshot, accessToken: string) {
    const url = new URL(
      this.endpoint(
        `${encodeURIComponent(publication.account.remoteAccountId)}/content_publishing_limit`,
      ),
    );
    url.searchParams.set('fields', 'quota_usage,config');
    const body = await this.request(url.toString(), accessToken, { method: 'GET' }, 'READ');
    const parsed = CapabilityResponseSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProviderPublishError({
        responseClass: 'PERMANENT_FAILURE',
        failureCode: 'INSTAGRAM_PROFESSIONAL_ACCOUNT_REQUIRED',
      });
    }
    const row = parsed.data.data[0]!;
    const snapshot: CapabilitySnapshot = Object.freeze({
      quotaUsage: row.quota_usage,
      quotaTotal: row.config?.quota_total ?? null,
      quotaDurationSeconds: row.config?.quota_duration ?? null,
    });
    if (snapshot.quotaTotal !== null && snapshot.quotaUsage >= snapshot.quotaTotal) {
      throw new ProviderPublishError({
        responseClass: 'RATE_LIMITED',
        failureCode: 'INSTAGRAM_PUBLISHING_QUOTA_EXHAUSTED',
        ...(snapshot.quotaDurationSeconds !== null
          ? { retryAfterMs: snapshot.quotaDurationSeconds * 1_000 }
          : {}),
        responseMetadata: {
          quotaUsage: snapshot.quotaUsage,
          quotaTotal: snapshot.quotaTotal,
        },
      });
    }
    return snapshot;
  }

  async prepare(publication: PublicationSnapshot): Promise<PublishPreparation> {
    validateInstagramMedia(publication);
    const accessToken = await this.accessToken(publication.account.id);
    const capability = await this.capabilityCheck(publication, accessToken);
    const lease = await this.mediaLeases.issue(publication, this.leaseTtlSeconds);
    validateLease(publication, lease, this.now(), this.leaseTtlSeconds);

    const metadata = publication.metadata;
    if (metadata.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_METADATA_REQUIRED');
    const form = new URLSearchParams({
      media_type: 'REELS',
      video_url: lease.url,
      caption: metadata.caption,
      share_to_feed: metadata.shareToFeed ? 'true' : 'false',
    });
    const createBody = await this.request(
      this.endpoint(`${encodeURIComponent(publication.account.remoteAccountId)}/media`),
      accessToken,
      { method: 'POST', body: form.toString() },
      'CONTAINER_CREATE',
    );
    const created = ContainerCreateResponseSchema.safeParse(createBody);
    if (!created.success) {
      throw new ProviderPublishError({
        responseClass: 'TRANSIENT_FAILURE',
        failureCode: 'INSTAGRAM_CONTAINER_RESPONSE_INVALID',
      });
    }
    const containerId = created.data.id;

    for (let attempt = 1; attempt <= this.maxPollAttempts; attempt += 1) {
      const statusUrl = new URL(this.endpoint(encodeURIComponent(containerId)));
      statusUrl.searchParams.set('fields', 'status_code,status');
      const statusBody = await this.request(
        statusUrl.toString(),
        accessToken,
        { method: 'GET' },
        'READ',
      );
      const status = ContainerStatusResponseSchema.safeParse(statusBody);
      if (!status.success) {
        throw new ProviderPublishError({
          responseClass: 'TRANSIENT_FAILURE',
          failureCode: 'INSTAGRAM_CONTAINER_STATUS_INVALID',
          remoteRequestId: containerId,
        });
      }
      if (status.data.status_code === 'FINISHED') {
        return Object.freeze({
          remoteRequestId: containerId,
          responseMetadata: Object.freeze({
            provider: 'INSTAGRAM',
            containerStatus: 'FINISHED',
            quotaUsage: capability.quotaUsage,
            ...(capability.quotaTotal !== null ? { quotaTotal: capability.quotaTotal } : {}),
            assetLeaseExpiresAt: lease.expiresAt,
          }),
        });
      }
      if (status.data.status_code === 'ERROR' || status.data.status_code === 'EXPIRED') {
        throw new ProviderPublishError({
          responseClass: 'PERMANENT_FAILURE',
          failureCode:
            status.data.status_code === 'ERROR'
              ? 'INSTAGRAM_CONTAINER_ERROR'
              : 'INSTAGRAM_CONTAINER_EXPIRED',
          remoteRequestId: containerId,
          responseMetadata: { containerStatus: status.data.status_code },
        });
      }
      if (status.data.status_code === 'PUBLISHED') {
        throw new ProviderPublishError({
          responseClass: 'UNKNOWN_SIDE_EFFECT',
          failureCode: 'INSTAGRAM_CONTAINER_ALREADY_PUBLISHED',
          remoteRequestId: containerId,
          responseMetadata: { containerStatus: status.data.status_code },
        });
      }
      if (attempt < this.maxPollAttempts) await this.sleep(this.pollIntervalMs);
    }

    throw new ProviderPublishError({
      responseClass: 'TRANSIENT_FAILURE',
      failureCode: 'INSTAGRAM_CONTAINER_NOT_READY',
      remoteRequestId: containerId,
      responseMetadata: { pollAttempts: this.maxPollAttempts },
    });
  }

  async publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation,
  ): Promise<PublishResult> {
    if (publication.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_PUBLICATION_REQUIRED');
    const containerId = MetaIdSchema.safeParse(preparation.remoteRequestId);
    if (!containerId.success) {
      return {
        responseClass: 'PERMANENT_FAILURE',
        failureCode: 'INSTAGRAM_CONTAINER_ID_REQUIRED',
      };
    }
    const accessToken = await this.accessToken(publication.account.id);
    const form = new URLSearchParams({ creation_id: containerId.data });

    let body: unknown;
    try {
      body = await this.request(
        this.endpoint(`${encodeURIComponent(publication.account.remoteAccountId)}/media_publish`),
        accessToken,
        { method: 'POST', body: form.toString() },
        'MEDIA_PUBLISH',
      );
    } catch (error) {
      if (error instanceof ProviderPublishError) {
        return {
          ...error.result,
          remoteRequestId: containerId.data,
        };
      }
      return {
        responseClass: 'UNKNOWN_SIDE_EFFECT',
        failureCode: 'INSTAGRAM_PUBLISH_RESPONSE_AMBIGUOUS',
        remoteRequestId: containerId.data,
      };
    }

    const published = MediaPublishResponseSchema.safeParse(body);
    if (!published.success) {
      return {
        responseClass: 'UNKNOWN_SIDE_EFFECT',
        failureCode: 'INSTAGRAM_PUBLISH_RESPONSE_INVALID',
        remoteRequestId: containerId.data,
      };
    }

    let remoteUrl: string | undefined;
    try {
      const mediaUrl = new URL(this.endpoint(encodeURIComponent(published.data.id)));
      mediaUrl.searchParams.set('fields', 'id,permalink');
      const lookup = await this.request(
        mediaUrl.toString(),
        accessToken,
        { method: 'GET' },
        'READ',
      );
      const parsed = MediaLookupResponseSchema.safeParse(lookup);
      if (parsed.success) remoteUrl = parsed.data.permalink;
    } catch {
      // The publish response already carried the authoritative media ID.
    }

    return {
      responseClass: 'SUCCESS',
      remotePostId: published.data.id,
      ...(remoteUrl !== undefined ? { remoteUrl } : {}),
      remoteRequestId: containerId.data,
      responseMetadata: { provider: 'INSTAGRAM' },
    };
  }

  async checkAccount(account: PlatformAccountSnapshot): Promise<PlatformAccountHealthResult> {
    if (account.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_ACCOUNT_REQUIRED');
    let accessToken: string;
    try {
      accessToken = await this.accessToken(account.id);
    } catch (error) {
      const failure = error instanceof ProviderPublishError ? error.result : null;
      return {
        kind: 'REAUTH_REQUIRED',
        failureCode: failure?.failureCode ?? 'INSTAGRAM_AUTH_REQUIRED',
      };
    }

    const url = new URL(
      this.endpoint(`${encodeURIComponent(account.remoteAccountId)}/content_publishing_limit`),
    );
    url.searchParams.set('fields', 'quota_usage,config');
    try {
      const body = await this.request(url.toString(), accessToken, { method: 'GET' }, 'READ');
      const parsed = CapabilityResponseSchema.safeParse(body);
      if (!parsed.success) {
        return { kind: 'ERROR', failureCode: 'INSTAGRAM_CAPABILITY_RESPONSE_INVALID' };
      }
      const row = parsed.data.data[0]!;
      const limitations: string[] = [];
      if (row.config?.quota_total !== undefined && row.quota_usage >= row.config.quota_total) {
        limitations.push('PUBLISHING_QUOTA_EXHAUSTED');
      }
      return {
        kind: 'ACTIVE',
        remoteAccountId: account.remoteAccountId,
        capabilities: {
          schemaVersion: 'v1',
          canPublishVideo: true,
          canPublishPublic: true,
          supportsNativeScheduling: false,
          deliveryMode: 'API_AUTOMATED',
          limitations,
          checkedAt: this.now().toISOString(),
        },
      };
    } catch (error) {
      const failure = error instanceof ProviderPublishError ? error.result : null;
      if (failure?.failureCode === 'INSTAGRAM_AUTH_REQUIRED') {
        return { kind: 'REAUTH_REQUIRED', failureCode: failure.failureCode };
      }
      if (
        failure?.responseClass === 'TRANSIENT_FAILURE' ||
        failure?.responseClass === 'RATE_LIMITED'
      ) {
        return {
          kind: 'UNAVAILABLE',
          failureCode: failure.failureCode,
        };
      }
      return {
        kind: 'ERROR',
        failureCode: failure?.failureCode ?? 'INSTAGRAM_ACCOUNT_HEALTH_FAILED',
      };
    }
  }

  async reconcile(publication: PublicationSnapshot): Promise<ReconcileResult> {
    if (publication.platform !== 'INSTAGRAM') throw new Error('INSTAGRAM_PUBLICATION_REQUIRED');
    let accessToken: string;
    try {
      accessToken = await this.accessToken(publication.account.id);
    } catch {
      return { kind: 'UNKNOWN' };
    }

    if (publication.execution.remotePostId !== null) {
      try {
        const mediaUrl = new URL(
          this.endpoint(encodeURIComponent(publication.execution.remotePostId)),
        );
        mediaUrl.searchParams.set('fields', 'id,permalink');
        const body = await this.request(
          mediaUrl.toString(),
          accessToken,
          { method: 'GET' },
          'READ',
        );
        const media = MediaLookupResponseSchema.safeParse(body);
        if (!media.success) return { kind: 'UNKNOWN' };
        return {
          kind: 'PUBLISHED',
          remotePostId: media.data.id,
          ...(media.data.permalink !== undefined ? { remoteUrl: media.data.permalink } : {}),
        };
      } catch {
        return { kind: 'UNKNOWN' };
      }
    }

    const containerId = MetaIdSchema.safeParse(publication.execution.remoteRequestId);
    if (!containerId.success) return { kind: 'UNKNOWN' };
    try {
      const statusUrl = new URL(this.endpoint(encodeURIComponent(containerId.data)));
      statusUrl.searchParams.set('fields', 'status_code,status');
      const body = await this.request(statusUrl.toString(), accessToken, { method: 'GET' }, 'READ');
      const status = ContainerStatusResponseSchema.safeParse(body);
      if (!status.success) return { kind: 'UNKNOWN' };
      if (status.data.status_code === 'ERROR' || status.data.status_code === 'EXPIRED') {
        return {
          kind: 'FAILED',
          failureCode:
            status.data.status_code === 'ERROR'
              ? 'INSTAGRAM_CONTAINER_ERROR'
              : 'INSTAGRAM_CONTAINER_EXPIRED',
        };
      }
      // FINISHED/PUBLISHED/IN_PROGRESS alone cannot prove whether media_publish succeeded.
      return { kind: 'UNKNOWN' };
    } catch {
      return { kind: 'UNKNOWN' };
    }
  }
}
