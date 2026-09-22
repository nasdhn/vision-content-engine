import { z } from 'zod';
import type {
  PlatformPublisher,
  PublicationSnapshot,
  PublishPreparation,
  PublishResult,
  ReconcileResult,
} from './index.js';
import { ProviderPublishError } from './provider-error.js';

const AccessTokenSchema = z.string().min(1).max(16_384);
const VideoIdSchema = z.string().min(1).max(256);
const VideoResponseSchema = z.object({ id: VideoIdSchema }).passthrough();
const VideoListResponseSchema = z
  .object({ items: z.array(z.object({ id: VideoIdSchema }).passthrough()) })
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

export type YouTubeCredential = Readonly<{
  accessToken: string;
  expiresAt?: string;
}>;

export interface YouTubeCredentialResolver {
  resolve(accountId: string): Promise<YouTubeCredential>;
}

export interface ExactAssetChunkSource {
  readRange(
    publication: PublicationSnapshot,
    startByte: number,
    endByteInclusive: number,
  ): Promise<Uint8Array>;
}

export type YouTubePublisherOptions = Readonly<{
  apiBaseUrl?: string;
  uploadBaseUrl?: string;
  chunkSizeBytes?: number;
  maxRecoveryAttempts?: number;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}>;

type UploadStatus =
  | Readonly<{ kind: 'COMPLETE'; videoId: string }>
  | Readonly<{ kind: 'INCOMPLETE'; nextOffset: number }>
  | Readonly<{ kind: 'EXPIRED' }>
  | Readonly<{
      kind: 'FAILED';
      result: Exclude<PublishResult, Readonly<{ responseClass: 'SUCCESS' }>>;
    }>;

const DEFAULT_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/youtube/v3';
const DEFAULT_CHUNK_SIZE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RECOVERY_ATTEMPTS = 3;
const YOUTUBE_CHUNK_GRANULARITY = 256 * 1024;
const MAX_YOUTUBE_VIDEO_BYTES = 256n * 1024n * 1024n * 1024n;

function sanitizeGoogleError(body: unknown): Readonly<Record<string, unknown>> | undefined {
  const parsed = GoogleErrorSchema.safeParse(body);
  if (!parsed.success) return undefined;
  const reason = parsed.data.error.errors?.[0]?.reason;
  return Object.freeze({
    ...(parsed.data.error.code !== undefined ? { providerErrorCode: parsed.data.error.code } : {}),
    ...(reason !== undefined ? { providerErrorReason: reason } : {}),
  });
}

function googleErrorReason(body: unknown) {
  const parsed = GoogleErrorSchema.safeParse(body);
  return parsed.success ? parsed.data.error.errors?.[0]?.reason : undefined;
}

function isRateLimited(status: number, body: unknown) {
  if (status === 429) return true;
  const reason = googleErrorReason(body);
  return (
    status === 403 &&
    ['quotaExceeded', 'rateLimitExceeded', 'userRateLimitExceeded', 'dailyLimitExceeded'].includes(
      reason ?? '',
    )
  );
}

function failureForHttp(
  status: number,
  body: unknown,
  context: 'SESSION' | 'UPLOAD' | 'READ',
): Exclude<PublishResult, Readonly<{ responseClass: 'SUCCESS' }>> {
  const responseMetadata = sanitizeGoogleError(body);
  if (isRateLimited(status, body)) {
    return {
      responseClass: 'RATE_LIMITED',
      failureCode: 'YOUTUBE_RATE_LIMITED',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  if (status === 401 || (status === 403 && !isRateLimited(status, body))) {
    return {
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_AUTH_REQUIRED',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  if (status === 404 && context === 'UPLOAD') {
    return {
      responseClass: 'TRANSIENT_FAILURE',
      failureCode: 'YOUTUBE_UPLOAD_SESSION_EXPIRED',
    };
  }
  if (status >= 500) {
    return {
      responseClass: 'TRANSIENT_FAILURE',
      failureCode: 'YOUTUBE_PROVIDER_UNAVAILABLE',
      ...(responseMetadata !== undefined ? { responseMetadata } : {}),
    };
  }
  return {
    responseClass: 'PERMANENT_FAILURE',
    failureCode:
      context === 'SESSION'
        ? 'YOUTUBE_UPLOAD_SESSION_REJECTED'
        : context === 'UPLOAD'
          ? 'YOUTUBE_UPLOAD_REJECTED'
          : 'YOUTUBE_LOOKUP_FAILED',
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

function youtubeWatchUrl(videoId: string) {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`;
}

function validateYouTubeMedia(publication: PublicationSnapshot) {
  if (publication.platform !== 'YOUTUBE') throw new Error('YOUTUBE_PUBLICATION_REQUIRED');
  if (publication.deliveryMode !== 'API_AUTOMATED') throw new Error('AUTOMATED_DELIVERY_REQUIRED');
  if (publication.metadata.platform !== 'YOUTUBE') throw new Error('YOUTUBE_METADATA_REQUIRED');

  const totalBytes = BigInt(publication.media.sizeBytes);
  if (totalBytes <= 0n || totalBytes > MAX_YOUTUBE_VIDEO_BYTES) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_MEDIA_SIZE_UNSUPPORTED',
    });
  }
  if (!(publication.media.mimeType ?? '').startsWith('video/')) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_MEDIA_TYPE_UNSUPPORTED',
    });
  }
  const metadata = publication.metadata;
  if (metadata.title.length > 100 || metadata.description.length > 5_000) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_METADATA_LIMIT_EXCEEDED',
    });
  }
  if (metadata.publishAt !== undefined && metadata.privacyStatus !== 'private') {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_SCHEDULE_REQUIRES_PRIVATE',
    });
  }
  if (
    metadata.publishAt !== undefined &&
    publication.account.capabilities?.supportsNativeScheduling !== true
  ) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_NATIVE_SCHEDULING_NOT_READY',
    });
  }
  if (
    metadata.privacyStatus !== 'private' &&
    publication.account.capabilities?.canPublishPublic !== true
  ) {
    throw new ProviderPublishError({
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_PUBLIC_UPLOAD_NOT_READY',
    });
  }
}

function parseRangeNextOffset(rangeHeader: string | null) {
  if (rangeHeader === null) return 0;
  const match = /^bytes=0-(\d+)$/.exec(rangeHeader.trim());
  if (!match) throw new Error('YOUTUBE_INVALID_UPLOAD_RANGE');
  const lastByte = Number(match[1]);
  if (!Number.isSafeInteger(lastByte) || lastByte < 0)
    throw new Error('YOUTUBE_INVALID_UPLOAD_RANGE');
  return lastByte + 1;
}

export class YouTubeDataPublisher implements PlatformPublisher {
  readonly platform = 'YOUTUBE' as const;
  readonly isRealProvider = true;

  private readonly apiBaseUrl: string;
  private readonly uploadBaseUrl: string;
  private readonly chunkSizeBytes: number;
  private readonly maxRecoveryAttempts: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;

  constructor(
    private readonly credentials: YouTubeCredentialResolver,
    private readonly mediaSource: ExactAssetChunkSource,
    options: YouTubePublisherOptions = {},
  ) {
    const apiBase = new URL(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
    const uploadBase = new URL(options.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL);
    if (apiBase.protocol !== 'https:' || uploadBase.protocol !== 'https:') {
      throw new Error('YOUTUBE_HTTPS_REQUIRED');
    }
    this.apiBaseUrl = apiBase.toString().replace(/\/$/, '');
    this.uploadBaseUrl = uploadBase.toString().replace(/\/$/, '');
    this.chunkSizeBytes = options.chunkSizeBytes ?? DEFAULT_CHUNK_SIZE_BYTES;
    this.maxRecoveryAttempts = options.maxRecoveryAttempts ?? DEFAULT_MAX_RECOVERY_ATTEMPTS;
    if (
      !Number.isSafeInteger(this.chunkSizeBytes) ||
      this.chunkSizeBytes < YOUTUBE_CHUNK_GRANULARITY ||
      this.chunkSizeBytes % YOUTUBE_CHUNK_GRANULARITY !== 0
    ) {
      throw new Error('INVALID_YOUTUBE_CHUNK_SIZE');
    }
    if (
      !Number.isSafeInteger(this.maxRecoveryAttempts) ||
      this.maxRecoveryAttempts < 1 ||
      this.maxRecoveryAttempts > 10
    ) {
      throw new Error('INVALID_YOUTUBE_RECOVERY_ATTEMPTS');
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? (() => new Date());
  }

  private async accessToken(accountId: string) {
    const credential = await this.credentials.resolve(accountId);
    const accessToken = AccessTokenSchema.parse(credential.accessToken);
    if (credential.expiresAt !== undefined) {
      const expiresAt = new Date(credential.expiresAt);
      if (!Number.isFinite(expiresAt.getTime()) || expiresAt.getTime() <= this.now().getTime()) {
        throw new ProviderPublishError({
          responseClass: 'PERMANENT_FAILURE',
          failureCode: 'YOUTUBE_AUTH_REQUIRED',
        });
      }
    }
    return accessToken;
  }

  private async queryUploadStatus(
    sessionUrl: string,
    accessToken: string,
    totalBytes: number,
  ): Promise<UploadStatus> {
    let response: Response;
    try {
      response = await this.fetchImpl(sessionUrl, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Length': '0',
          'Content-Range': `bytes */${totalBytes}`,
        },
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      return {
        kind: 'FAILED',
        result: {
          responseClass: 'UNKNOWN_SIDE_EFFECT',
          failureCode: 'YOUTUBE_UPLOAD_STATUS_UNKNOWN',
          remoteRequestId: sessionUrl,
        },
      };
    }
    if (response.status === 308) {
      return {
        kind: 'INCOMPLETE',
        nextOffset: parseRangeNextOffset(response.headers.get('range')),
      };
    }
    if (response.status === 404) return { kind: 'EXPIRED' };
    const body = await safeJson(response);
    if (response.ok) {
      const parsed = VideoResponseSchema.safeParse(body);
      if (parsed.success) return { kind: 'COMPLETE', videoId: parsed.data.id };
      return {
        kind: 'FAILED',
        result: {
          responseClass: 'UNKNOWN_SIDE_EFFECT',
          failureCode: 'YOUTUBE_UPLOAD_COMPLETION_INVALID',
          remoteRequestId: sessionUrl,
        },
      };
    }
    return { kind: 'FAILED', result: failureForHttp(response.status, body, 'READ') };
  }

  async prepare(publication: PublicationSnapshot): Promise<PublishPreparation> {
    validateYouTubeMedia(publication);
    const accessToken = await this.accessToken(publication.account.id);
    const metadata = publication.metadata;
    if (metadata.platform !== 'YOUTUBE') throw new Error('YOUTUBE_METADATA_REQUIRED');
    const totalBytes = Number(publication.media.sizeBytes);
    if (!Number.isSafeInteger(totalBytes) || totalBytes <= 0) {
      throw new ProviderPublishError({
        responseClass: 'PERMANENT_FAILURE',
        failureCode: 'YOUTUBE_MEDIA_SIZE_UNSUPPORTED',
      });
    }

    const url = new URL(`${this.uploadBaseUrl}/videos`);
    url.searchParams.set('uploadType', 'resumable');
    url.searchParams.set('part', 'snippet,status');
    const status = {
      privacyStatus: metadata.privacyStatus,
      selfDeclaredMadeForKids: metadata.selfDeclaredMadeForKids,
      ...(metadata.containsSyntheticMedia !== undefined
        ? { containsSyntheticMedia: metadata.containsSyntheticMedia }
        : {}),
      ...(metadata.publishAt !== undefined ? { publishAt: metadata.publishAt } : {}),
    };
    const body = JSON.stringify({
      snippet: {
        title: metadata.title,
        description: metadata.description,
        tags: metadata.tags,
        categoryId: metadata.categoryId,
        defaultLanguage: metadata.defaultLanguage,
      },
      status,
    });

    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json; charset=UTF-8',
          'X-Upload-Content-Length': String(totalBytes),
          'X-Upload-Content-Type': publication.media.mimeType ?? 'application/octet-stream',
        },
        body,
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new ProviderPublishError({
        responseClass: 'TRANSIENT_FAILURE',
        failureCode: 'YOUTUBE_SESSION_NETWORK_FAILURE',
      });
    }
    const responseBody = await safeJson(response);
    if (!response.ok) {
      throw new ProviderPublishError(failureForHttp(response.status, responseBody, 'SESSION'));
    }
    const location = response.headers.get('location');
    if (!location) {
      throw new ProviderPublishError({
        responseClass: 'TRANSIENT_FAILURE',
        failureCode: 'YOUTUBE_SESSION_LOCATION_MISSING',
      });
    }
    const session = new URL(location);
    if (session.protocol !== 'https:') throw new Error('YOUTUBE_UPLOAD_SESSION_HTTPS_REQUIRED');

    return Object.freeze({
      remoteRequestId: session.toString(),
      responseMetadata: Object.freeze({
        provider: 'YOUTUBE',
        uploadProtocol: 'RESUMABLE',
        totalBytes,
      }),
    });
  }

  async publish(
    publication: PublicationSnapshot,
    preparation: PublishPreparation,
  ): Promise<PublishResult> {
    validateYouTubeMedia(publication);
    if (!preparation.remoteRequestId) {
      return {
        responseClass: 'PERMANENT_FAILURE',
        failureCode: 'YOUTUBE_UPLOAD_SESSION_REQUIRED',
      };
    }
    const sessionUrl = new URL(preparation.remoteRequestId);
    if (sessionUrl.protocol !== 'https:') throw new Error('YOUTUBE_UPLOAD_SESSION_HTTPS_REQUIRED');
    const accessToken = await this.accessToken(publication.account.id);
    const totalBytes = Number(publication.media.sizeBytes);
    let offset = 0;
    let recoveries = 0;

    while (offset < totalBytes) {
      const end = Math.min(totalBytes - 1, offset + this.chunkSizeBytes - 1);
      const bytes = await this.mediaSource.readRange(publication, offset, end);
      const expectedLength = end - offset + 1;
      if (bytes.byteLength !== expectedLength) {
        return {
          responseClass: 'PERMANENT_FAILURE',
          failureCode: 'YOUTUBE_ASSET_RANGE_MISMATCH',
          remoteRequestId: sessionUrl.toString(),
        };
      }

      const uploadBody = new Uint8Array(bytes.byteLength);
      uploadBody.set(bytes);

      let response: Response;
      try {
        response = await this.fetchImpl(sessionUrl.toString(), {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Length': String(bytes.byteLength),
            'Content-Type': publication.media.mimeType ?? 'application/octet-stream',
            'Content-Range': `bytes ${offset}-${end}/${totalBytes}`,
          },
          body: uploadBody.buffer,
          signal: AbortSignal.timeout(120_000),
        });
      } catch {
        const status = await this.queryUploadStatus(sessionUrl.toString(), accessToken, totalBytes);
        if (status.kind === 'COMPLETE') {
          return {
            responseClass: 'SUCCESS',
            remotePostId: status.videoId,
            remoteUrl: youtubeWatchUrl(status.videoId),
            remoteRequestId: sessionUrl.toString(),
            responseMetadata: { provider: 'YOUTUBE', recoveredAfterNetworkFailure: true },
          };
        }
        if (status.kind === 'EXPIRED') {
          return {
            responseClass: 'TRANSIENT_FAILURE',
            failureCode: 'YOUTUBE_UPLOAD_SESSION_EXPIRED',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        if (status.kind === 'FAILED') return status.result;
        recoveries += 1;
        if (recoveries > this.maxRecoveryAttempts) {
          return {
            responseClass: 'TRANSIENT_FAILURE',
            failureCode: 'YOUTUBE_UPLOAD_INTERRUPTED',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        offset = status.nextOffset;
        continue;
      }

      if (response.status === 308) {
        const nextOffset = parseRangeNextOffset(response.headers.get('range'));
        if (nextOffset < offset || nextOffset > end + 1 || nextOffset > totalBytes) {
          return {
            responseClass: 'UNKNOWN_SIDE_EFFECT',
            failureCode: 'YOUTUBE_UPLOAD_PROGRESS_AMBIGUOUS',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        if (nextOffset === offset) {
          recoveries += 1;
          if (recoveries > this.maxRecoveryAttempts) {
            return {
              responseClass: 'TRANSIENT_FAILURE',
              failureCode: 'YOUTUBE_UPLOAD_NO_PROGRESS',
              remoteRequestId: sessionUrl.toString(),
            };
          }
        } else {
          recoveries = 0;
        }
        offset = nextOffset;
        continue;
      }

      const responseBody = await safeJson(response);
      if (response.ok) {
        const parsed = VideoResponseSchema.safeParse(responseBody);
        if (!parsed.success) {
          return {
            responseClass: 'UNKNOWN_SIDE_EFFECT',
            failureCode: 'YOUTUBE_UPLOAD_COMPLETION_INVALID',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        return {
          responseClass: 'SUCCESS',
          remotePostId: parsed.data.id,
          remoteUrl: youtubeWatchUrl(parsed.data.id),
          remoteRequestId: sessionUrl.toString(),
          responseMetadata: { provider: 'YOUTUBE' },
        };
      }

      if (response.status >= 500) {
        const status = await this.queryUploadStatus(sessionUrl.toString(), accessToken, totalBytes);
        if (status.kind === 'COMPLETE') {
          return {
            responseClass: 'SUCCESS',
            remotePostId: status.videoId,
            remoteUrl: youtubeWatchUrl(status.videoId),
            remoteRequestId: sessionUrl.toString(),
            responseMetadata: { provider: 'YOUTUBE', recoveredAfterProviderFailure: true },
          };
        }
        if (status.kind === 'EXPIRED') {
          return {
            responseClass: 'TRANSIENT_FAILURE',
            failureCode: 'YOUTUBE_UPLOAD_SESSION_EXPIRED',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        if (status.kind === 'FAILED') return status.result;
        recoveries += 1;
        if (recoveries > this.maxRecoveryAttempts) {
          return {
            responseClass: 'TRANSIENT_FAILURE',
            failureCode: 'YOUTUBE_UPLOAD_INTERRUPTED',
            remoteRequestId: sessionUrl.toString(),
          };
        }
        offset = status.nextOffset;
        continue;
      }

      const failure = failureForHttp(response.status, responseBody, 'UPLOAD');
      return { ...failure, remoteRequestId: sessionUrl.toString() };
    }

    return {
      responseClass: 'UNKNOWN_SIDE_EFFECT',
      failureCode: 'YOUTUBE_UPLOAD_COMPLETION_UNKNOWN',
      remoteRequestId: sessionUrl.toString(),
    };
  }

  async reconcile(publication: PublicationSnapshot): Promise<ReconcileResult> {
    validateYouTubeMedia(publication);
    const accessToken = await this.accessToken(publication.account.id);
    if (publication.execution.remotePostId) {
      const url = new URL(`${this.apiBaseUrl}/videos`);
      url.searchParams.set('part', 'status');
      url.searchParams.set('id', publication.execution.remotePostId);
      let response: Response;
      try {
        response = await this.fetchImpl(url.toString(), {
          method: 'GET',
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        return { kind: 'UNKNOWN' };
      }
      const body = await safeJson(response);
      if (!response.ok) return { kind: 'UNKNOWN' };
      const parsed = VideoListResponseSchema.safeParse(body);
      if (!parsed.success || parsed.data.items.length === 0) return { kind: 'UNKNOWN' };
      return {
        kind: 'PUBLISHED',
        remotePostId: publication.execution.remotePostId,
        remoteUrl: youtubeWatchUrl(publication.execution.remotePostId),
      };
    }

    if (!publication.execution.remoteRequestId) return { kind: 'UNKNOWN' };
    let sessionUrl: URL;
    try {
      sessionUrl = new URL(publication.execution.remoteRequestId);
    } catch {
      return { kind: 'UNKNOWN' };
    }
    if (sessionUrl.protocol !== 'https:') return { kind: 'UNKNOWN' };
    const totalBytes = Number(publication.media.sizeBytes);
    const status = await this.queryUploadStatus(sessionUrl.toString(), accessToken, totalBytes);
    if (status.kind === 'COMPLETE') {
      return {
        kind: 'PUBLISHED',
        remotePostId: status.videoId,
        remoteUrl: youtubeWatchUrl(status.videoId),
      };
    }
    if (status.kind === 'INCOMPLETE' || status.kind === 'EXPIRED') {
      return { kind: 'ABSENT_RETRY_ELIGIBLE' };
    }
    return { kind: 'UNKNOWN' };
  }
}
