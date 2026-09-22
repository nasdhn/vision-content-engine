import { expect, it } from 'vitest';
import {
  FakePublisher,
  InstagramReelMetadataSchema,
  PlatformCapabilitiesSchema,
  TikTokManualMetadataSchema,
  YouTubeShortMetadataSchema,
  assertSchedulingCapabilities,
  parseDistributionOutboxEvent,
  retryDelayMs,
} from '../../packages/publishing/src/index.js';

it('accepts only frozen platform metadata contracts', () => {
  expect(
    InstagramReelMetadataSchema.parse({
      schemaVersion: 'instagram-reel-v1',
      platform: 'INSTAGRAM',
      caption: 'Vision',
      shareToFeed: true,
    }),
  ).toHaveProperty('platform', 'INSTAGRAM');
  expect(() =>
    TikTokManualMetadataSchema.parse({
      schemaVersion: 'tiktok-manual-handoff-v1',
      platform: 'TIKTOK',
      caption: 'Vision',
      hashtags: [],
      commercialDisclosureReminder: true,
      accessToken: 'forbidden',
    }),
  ).toThrow();
  expect(() =>
    YouTubeShortMetadataSchema.parse({
      schemaVersion: 'youtube-short-v1',
      platform: 'YOUTUBE',
      title: '',
      description: '',
      tags: [],
      categoryId: '22',
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
    }),
  ).toThrow();
});

it('fails closed on missing automated capabilities and public YouTube readiness', () => {
  const metadata = YouTubeShortMetadataSchema.parse({
    schemaVersion: 'youtube-short-v1',
    platform: 'YOUTUBE',
    title: 'Vision',
    description: '',
    tags: [],
    categoryId: '22',
    privacyStatus: 'public',
    selfDeclaredMadeForKids: false,
  });
  const capabilities = PlatformCapabilitiesSchema.parse({
    schemaVersion: 'v1',
    canPublishVideo: true,
    canPublishPublic: false,
    supportsNativeScheduling: true,
    deliveryMode: 'API_AUTOMATED',
    limitations: ['public-audit-required'],
    checkedAt: '2026-09-22T08:00:00.000Z',
  });
  expect(() =>
    assertSchedulingCapabilities({
      platform: 'YOUTUBE',
      deliveryMode: 'API_AUTOMATED',
      credentialsConfigured: true,
      capabilities,
      metadata,
    }),
  ).toThrow('YOUTUBE_PUBLIC_UPLOAD_NOT_READY');
  expect(() =>
    assertSchedulingCapabilities({
      platform: 'INSTAGRAM',
      deliveryMode: 'API_AUTOMATED',
      credentialsConfigured: false,
      capabilities,
      metadata: {
        schemaVersion: 'instagram-reel-v1',
        platform: 'INSTAGRAM',
        caption: '',
        shareToFeed: true,
      },
    }),
  ).toThrow('PUBLISH_CREDENTIALS_REQUIRED');
});

it('keeps TikTok manual handoff independent from API credentials', () => {
  expect(
    assertSchedulingCapabilities({
      platform: 'TIKTOK',
      deliveryMode: 'MANUAL_HANDOFF',
      credentialsConfigured: false,
      capabilities: null,
      metadata: {
        schemaVersion: 'tiktok-manual-handoff-v1',
        platform: 'TIKTOK',
        caption: 'Vision',
        hashtags: ['#vision'],
        commercialDisclosureReminder: true,
      },
    }),
  ).toBeNull();
});

it('calculates bounded deterministic retry delay with injectable jitter', () => {
  const policy = { maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 5_000, jitterRatio: 0.2 };
  expect(retryDelayMs(policy, 1, undefined, () => 0.5)).toBe(1_000);
  expect(retryDelayMs(policy, 3, undefined, () => 0.5)).toBe(4_000);
  expect(retryDelayMs(policy, 4, undefined, () => 0.5)).toBe(5_000);
  expect(retryDelayMs(policy, 1, 20_000, () => 0)).toBe(5_000);
});

it('parses only secret-free distribution outbox payloads', () => {
  const id = '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4743';
  const attempt = '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4744';
  const operation = '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4745';
  expect(
    parseDistributionOutboxEvent({
      id,
      eventType: 'Publication.publish.requested',
      payloadJson: { publicationId: id, publicationAttemptId: attempt, operationId: operation },
    }),
  ).toEqual({
    kind: 'PUBLISH',
    outboxEventId: id,
    publicationId: id,
    publicationAttemptId: attempt,
    operationId: operation,
  });
  expect(() =>
    parseDistributionOutboxEvent({
      id,
      eventType: 'Publication.publish.requested',
      payloadJson: {
        publicationId: id,
        publicationAttemptId: attempt,
        operationId: operation,
        accessToken: 'secret',
      },
    }),
  ).toThrow();
});

it('provides a deterministic fake publisher without real-provider capability', async () => {
  const publisher = new FakePublisher('INSTAGRAM');
  expect(publisher.isRealProvider).toBe(false);
  const snapshot = {
    publicationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4743',
    operationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4745',
    platform: 'INSTAGRAM' as const,
    deliveryMode: 'API_AUTOMATED' as const,
    scheduledAt: '2026-09-22T08:00:00.000Z',
    metadata: {
      schemaVersion: 'instagram-reel-v1' as const,
      platform: 'INSTAGRAM' as const,
      caption: 'Vision',
      shareToFeed: true,
    },
    account: {
      id: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4746',
      remoteAccountId: 'fixture',
      capabilities: null,
    },
    execution: {
      attemptId: null,
      attemptNumber: null,
      remoteRequestId: null,
      remotePostId: null,
      responseMetadata: null,
    },
    media: {
      assetId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4747',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: '1',
      mimeType: 'video/mp4',
      width: 1080,
      height: 1920,
      durationMs: 10_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
    },
  };
  const preparation = await publisher.prepare(snapshot);
  await expect(publisher.publish(snapshot, preparation)).resolves.toMatchObject({
    responseClass: 'SUCCESS',
  });
  expect(publisher.calls.map((call) => call.kind)).toEqual(['PREPARE', 'PUBLISH']);
});
