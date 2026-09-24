import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Persistence } from '@vision/database';
import type { PrismaClient, VisionAttributionInput } from '@vision/database';

export const VISION_ATTRIBUTION_TIMESTAMP_HEADER = 'x-vce-timestamp';
export const VISION_ATTRIBUTION_SIGNATURE_HEADER = 'x-vce-signature';
export const VISION_ATTRIBUTION_SIGNATURE_VERSION = 'v1';
export const VISION_ATTRIBUTION_REPLAY_WINDOW_SECONDS = 300;
export const VISION_ATTRIBUTION_MAX_BODY_BYTES = 32 * 1024;

const externalEventId = z.string().min(1).max(200);
const opaqueId = z.string().min(1).max(256);
const trackingCode = z.string().uuid();
const currency = z.string().regex(/^[A-Z]{3}$/);

export const VisionAttributionEventSchema = z
  .object({
    externalEventId,
    eventType: z.enum(['SIGNUP', 'ACTIVATION', 'CUSTOMER', 'REVENUE']),
    occurredAt: z.string().datetime({ offset: true }),
    userId: opaqueId.optional(),
    trackingCode: trackingCode.optional(),
    campaignTrackingCode: z.string().min(1).max(128).optional(),
    valueAmountMinor: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    valueCurrency: currency.optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.eventType === 'REVENUE') {
      if (value.valueAmountMinor === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'REVENUE requires valueAmountMinor',
          path: ['valueAmountMinor'],
        });
      }
      if (value.valueCurrency === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'REVENUE requires valueCurrency',
          path: ['valueCurrency'],
        });
      }
      return;
    }
    if (value.valueAmountMinor !== undefined || value.valueCurrency !== undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'Revenue fields are only valid for REVENUE events',
        path: ['valueAmountMinor'],
      });
    }
  });

export type VisionAttributionEvent = z.infer<typeof VisionAttributionEventSchema>;

export class VisionAttributionIngestError extends Error {
  constructor(
    readonly code:
      | 'VISION_ATTRIBUTION_AUTH_FAILED'
      | 'VISION_ATTRIBUTION_SECRET_UNAVAILABLE'
      | 'VISION_ATTRIBUTION_BODY_TOO_LARGE'
      | 'VISION_ATTRIBUTION_INVALID_JSON'
      | 'VISION_ATTRIBUTION_INVALID_EVENT'
      | 'VISION_ATTRIBUTION_RAW_BODY_REQUIRED',
    readonly statusCode: 400 | 401 | 413 | 503,
  ) {
    super(code);
    this.name = 'VisionAttributionIngestError';
  }
}

export type VisionAttributionHeaders = Readonly<{
  timestamp?: string;
  signature?: string;
}>;

export type VisionAttributionAuthenticatorOptions = Readonly<{
  secret: string | (() => string);
  replayWindowSeconds?: number;
  maxBodyBytes?: number;
  now?: () => Date;
}>;

function authFailure(): never {
  throw new VisionAttributionIngestError('VISION_ATTRIBUTION_AUTH_FAILED', 401);
}

function parseUnixTimestamp(value: string | undefined): number {
  if (!value || !/^\d{10,13}$/.test(value)) authFailure();
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) authFailure();
  return parsed;
}

function parseSignature(value: string | undefined): Buffer {
  if (!value) authFailure();
  const match = /^v1=([a-fA-F0-9]{64})$/.exec(value);
  if (!match) authFailure();
  return Buffer.from(match[1]!, 'hex');
}

function signingPayload(timestamp: string, body: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), body]);
}

export function signVisionAttributionRequest(
  secret: string,
  timestamp: string,
  body: Buffer,
): string {
  return `${VISION_ATTRIBUTION_SIGNATURE_VERSION}=${createHmac('sha256', secret)
    .update(signingPayload(timestamp, body))
    .digest('hex')}`;
}

export class VisionAttributionAuthenticator {
  private readonly replayWindowSeconds: number;
  private readonly maxBodyBytes: number;
  private readonly now: () => Date;

  constructor(private readonly options: VisionAttributionAuthenticatorOptions) {
    if (typeof options.secret === 'string' && Buffer.byteLength(options.secret, 'utf8') < 32) {
      throw new Error('VISION_ATTRIBUTION_SECRET_TOO_SHORT');
    }
    this.replayWindowSeconds =
      options.replayWindowSeconds ?? VISION_ATTRIBUTION_REPLAY_WINDOW_SECONDS;
    this.maxBodyBytes = options.maxBodyBytes ?? VISION_ATTRIBUTION_MAX_BODY_BYTES;
    this.now = options.now ?? (() => new Date());
    if (!Number.isSafeInteger(this.replayWindowSeconds) || this.replayWindowSeconds <= 0) {
      throw new Error('VISION_ATTRIBUTION_REPLAY_WINDOW_INVALID');
    }
    if (!Number.isSafeInteger(this.maxBodyBytes) || this.maxBodyBytes <= 0) {
      throw new Error('VISION_ATTRIBUTION_BODY_LIMIT_INVALID');
    }
  }

  verify(rawBody: Buffer | undefined, headers: VisionAttributionHeaders): VisionAttributionEvent {
    if (!rawBody) {
      throw new VisionAttributionIngestError('VISION_ATTRIBUTION_RAW_BODY_REQUIRED', 400);
    }
    if (rawBody.length > this.maxBodyBytes) {
      throw new VisionAttributionIngestError('VISION_ATTRIBUTION_BODY_TOO_LARGE', 413);
    }

    const timestampSeconds = parseUnixTimestamp(headers.timestamp);
    const timestampText = headers.timestamp!;
    const nowMs = this.now().getTime();
    if (!Number.isFinite(nowMs)) authFailure();
    const timestampMs =
      timestampSeconds < 10_000_000_000 ? timestampSeconds * 1_000 : timestampSeconds;
    const deltaMs = Math.abs(nowMs - timestampMs);
    if (deltaMs > this.replayWindowSeconds * 1_000) authFailure();

    const supplied = parseSignature(headers.signature);
    let secret: string;
    try {
      secret =
        typeof this.options.secret === 'function' ? this.options.secret() : this.options.secret;
      if (Buffer.byteLength(secret, 'utf8') < 32) throw new Error();
    } catch {
      throw new VisionAttributionIngestError('VISION_ATTRIBUTION_SECRET_UNAVAILABLE', 503);
    }
    const expected = createHmac('sha256', secret)
      .update(signingPayload(timestampText, rawBody))
      .digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) authFailure();

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new VisionAttributionIngestError('VISION_ATTRIBUTION_INVALID_JSON', 400);
    }
    const result = VisionAttributionEventSchema.safeParse(parsed);
    if (!result.success) {
      throw new VisionAttributionIngestError('VISION_ATTRIBUTION_INVALID_EVENT', 400);
    }
    return result.data;
  }
}

export class VisionAttributionIngestService {
  private readonly persistence: Persistence;
  private readonly authenticator: VisionAttributionAuthenticator;

  constructor(db: PrismaClient, options: VisionAttributionAuthenticatorOptions) {
    this.persistence = new Persistence(db);
    this.authenticator = new VisionAttributionAuthenticator(options);
  }

  async ingest(rawBody: Buffer | undefined, headers: VisionAttributionHeaders) {
    const event = this.authenticator.verify(rawBody, headers);
    const input: VisionAttributionInput = {
      externalEventId: event.externalEventId,
      eventType: event.eventType,
      occurredAt: new Date(event.occurredAt),
      ...(event.userId !== undefined ? { userId: event.userId } : {}),
      ...(event.trackingCode !== undefined ? { trackingCode: event.trackingCode } : {}),
      ...(event.campaignTrackingCode !== undefined
        ? { campaignTrackingCode: event.campaignTrackingCode }
        : {}),
      ...(event.valueAmountMinor !== undefined ? { valueAmountMinor: event.valueAmountMinor } : {}),
      ...(event.valueCurrency !== undefined ? { valueCurrency: event.valueCurrency } : {}),
      ...(event.metadata !== undefined ? { metadata: event.metadata } : {}),
    };
    return this.persistence.transaction(
      { actorType: 'SYSTEM', actorId: 'vision-attribution-ingest' },
      (unit) => unit.analytics.ingestVisionAttribution(input),
    );
  }
}
