import { describe, expect, it } from 'vitest';
import {
  VISION_ATTRIBUTION_MAX_BODY_BYTES,
  VisionAttributionAuthenticator,
  VisionAttributionIngestError,
  signVisionAttributionRequest,
} from '../../packages/application/src/vision-attribution-ingest.js';

const secret = 'a'.repeat(64);
const now = new Date('2026-09-22T18:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1_000));

function body(value: unknown) {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

function headers(raw: Buffer, at = timestamp) {
  return {
    timestamp: at,
    signature: signVisionAttributionRequest(secret, at, raw),
  };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    externalEventId: 'vision_evt_001',
    eventType: 'SIGNUP',
    occurredAt: '2026-09-22T17:59:30.000Z',
    userId: 'opaque-user-17',
    ...overrides,
  };
}

describe('Phase 8E Vision signed attribution authentication', () => {
  it('authenticates exact request bytes plus timestamp and parses the strict event', () => {
    const raw = body(event());
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    expect(auth.verify(raw, headers(raw))).toMatchObject({
      externalEventId: 'vision_evt_001',
      eventType: 'SIGNUP',
      userId: 'opaque-user-17',
    });
  });

  it('fails closed when the exact signed body bytes are changed', () => {
    const signed = body(event());
    const tampered = Buffer.from(`${signed.toString('utf8')} `, 'utf8');
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    expect(() => auth.verify(tampered, headers(signed))).toThrow('VISION_ATTRIBUTION_AUTH_FAILED');
  });

  it('rejects stale and future timestamps outside the bounded replay window', () => {
    const raw = body(event());
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    const stale = String(Math.floor((now.getTime() - 301_000) / 1_000));
    const future = String(Math.floor((now.getTime() + 301_000) / 1_000));
    expect(() => auth.verify(raw, headers(raw, stale))).toThrow('VISION_ATTRIBUTION_AUTH_FAILED');
    expect(() => auth.verify(raw, headers(raw, future))).toThrow('VISION_ATTRIBUTION_AUTH_FAILED');
  });

  it('rejects malformed signatures without comparing variable-length secrets', () => {
    const raw = body(event());
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    expect(() => auth.verify(raw, { timestamp, signature: 'v1=abcd' })).toThrow(
      'VISION_ATTRIBUTION_AUTH_FAILED',
    );
  });

  it('enforces strict schema and typed REVENUE semantics after authentication', () => {
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    const extra = body(event({ unexpected: true }));
    expect(() => auth.verify(extra, headers(extra))).toThrow('VISION_ATTRIBUTION_INVALID_EVENT');

    const missingMoney = body(event({ eventType: 'REVENUE' }));
    expect(() => auth.verify(missingMoney, headers(missingMoney))).toThrow(
      'VISION_ATTRIBUTION_INVALID_EVENT',
    );

    const moneyOnSignup = body(event({ valueAmountMinor: 100, valueCurrency: 'EUR' }));
    expect(() => auth.verify(moneyOnSignup, headers(moneyOnSignup))).toThrow(
      'VISION_ATTRIBUTION_INVALID_EVENT',
    );
  });

  it('enforces the explicit 32 KiB body ceiling', () => {
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    const raw = Buffer.alloc(VISION_ATTRIBUTION_MAX_BODY_BYTES + 1, 0x61);
    try {
      auth.verify(raw, headers(raw));
      throw new Error('EXPECTED_BODY_LIMIT_FAILURE');
    } catch (error) {
      expect(error).toBeInstanceOf(VisionAttributionIngestError);
      expect((error as VisionAttributionIngestError).statusCode).toBe(413);
    }
  });

  it('rejects invalid JSON only after the HMAC has authenticated the exact bytes', () => {
    const raw = Buffer.from('{not-json', 'utf8');
    const auth = new VisionAttributionAuthenticator({ secret, now: () => now });
    expect(() => auth.verify(raw, headers(raw))).toThrow('VISION_ATTRIBUTION_INVALID_JSON');
  });

  it('requires a server-side HMAC secret with at least 32 bytes', () => {
    expect(() => new VisionAttributionAuthenticator({ secret: 'short' })).toThrow(
      'VISION_ATTRIBUTION_SECRET_TOO_SHORT',
    );
  });
});

it('resolves the current HMAC key only when verifying and masks resolver failures', () => {
  let current = secret;
  let calls = 0;
  const auth = new VisionAttributionAuthenticator({
    secret: () => {
      calls++;
      return current;
    },
    now: () => now,
  });
  const raw = body(event());
  expect(calls).toBe(0);
  expect(auth.verify(raw, headers(raw)).externalEventId).toBe('vision_evt_001');
  current = 'b'.repeat(64);
  expect(() => auth.verify(raw, headers(raw))).toThrow('VISION_ATTRIBUTION_AUTH_FAILED');
  expect(
    auth.verify(raw, {
      timestamp,
      signature: signVisionAttributionRequest(current, timestamp, raw),
    }).externalEventId,
  ).toBe('vision_evt_001');
  const failed = new VisionAttributionAuthenticator({
    secret: () => {
      throw new Error(current);
    },
    now: () => now,
  });
  expect(() => failed.verify(raw, headers(raw))).toThrow('VISION_ATTRIBUTION_SECRET_UNAVAILABLE');
});
