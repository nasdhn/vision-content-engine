import {
  EnvironmentSecretResolver,
  accountCredentialResolver,
} from '../../packages/shared/src/secrets.js';
import { expect, it } from 'vitest';
import {
  InstagramGraphPublisher,
  ProviderPublishError,
} from '../../packages/publishing/src/index.js';
import type {
  ExactAssetDeliveryLeaseProvider,
  InstagramCredentialResolver,
  PublicationSnapshot,
} from '../../packages/publishing/src/index.js';

const now = new Date('2026-09-22T12:00:00.000Z');
const token = 'fixture-instagram-access-token';

function snapshot(overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    publicationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4743',
    operationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4745',
    platform: 'INSTAGRAM',
    deliveryMode: 'API_AUTOMATED',
    scheduledAt: '2026-09-22T12:00:00.000Z',
    metadata: {
      schemaVersion: 'instagram-reel-v1',
      platform: 'INSTAGRAM',
      caption: 'Vision transforme une recherche en prospects qualifiés.',
      shareToFeed: true,
    },
    account: {
      id: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4746',
      remoteAccountId: '17841400000000000',
      capabilities: {
        schemaVersion: 'v1',
        canPublishVideo: true,
        canPublishPublic: true,
        supportsNativeScheduling: false,
        deliveryMode: 'API_AUTOMATED',
        limitations: [],
        checkedAt: '2026-09-22T11:00:00.000Z',
      },
    },
    execution: {
      attemptId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4748',
      attemptNumber: 1,
      remoteRequestId: null,
      remotePostId: null,
      responseMetadata: null,
    },
    media: {
      assetId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4747',
      checksumSha256: 'a'.repeat(64),
      sizeBytes: '1000000',
      mimeType: 'video/mp4',
      width: 1080,
      height: 1920,
      durationMs: 15_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
    },
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function credentials(): InstagramCredentialResolver {
  return accountCredentialResolver(
    new EnvironmentSecretResolver({ INSTAGRAM_ACCESS_TOKEN: token }, ['INSTAGRAM_ACCESS_TOKEN']),
    'INSTAGRAM_ACCESS_TOKEN',
    '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4746',
    { expiresAt: '2026-09-23T12:00:00.000Z' },
  );
}

function leaseProvider(onIssue?: (ttlSeconds: number) => void): ExactAssetDeliveryLeaseProvider {
  return {
    async issue(publication, ttlSeconds) {
      onIssue?.(ttlSeconds);
      return {
        assetId: publication.media.assetId,
        checksumSha256: publication.media.checksumSha256,
        url: 'https://media.example.test/exact.mp4?signature=private-delivery-signature',
        expiresAt: new Date(now.getTime() + ttlSeconds * 1_000).toISOString(),
      };
    },
  };
}

it('creates, polls and publishes an Instagram Reel without persisting secrets or delivery URLs', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const replies = [
    response({ data: [{ quota_usage: 1, config: { quota_total: 50, quota_duration: 86400 } }] }),
    response({ id: 'container-1' }),
    response({ id: 'container-1', status_code: 'IN_PROGRESS', status: 'Processing' }),
    response({ id: 'container-1', status_code: 'FINISHED', status: 'Finished' }),
    response({ id: 'media-1' }),
    response({ id: 'media-1', permalink: 'https://www.instagram.com/reel/vision/' }),
  ];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    const next = replies.shift();
    if (!next) throw new Error('UNEXPECTED_FETCH');
    return next;
  };
  let leaseTtl = 0;
  const publisher = new InstagramGraphPublisher(
    credentials(),
    leaseProvider((ttl) => (leaseTtl = ttl)),
    {
      apiVersion: 'v25.0',
      graphBaseUrl: 'https://graph.example.test',
      pollIntervalMs: 0,
      maxPollAttempts: 3,
      leaseTtlSeconds: 900,
      fetchImpl,
      sleep: async () => undefined,
      now: () => now,
    },
  );

  const publication = snapshot();
  const preparation = await publisher.prepare(publication);
  expect(leaseTtl).toBe(900);
  expect(preparation).toMatchObject({
    remoteRequestId: 'container-1',
    responseMetadata: {
      provider: 'INSTAGRAM',
      containerStatus: 'FINISHED',
      quotaUsage: 1,
      quotaTotal: 50,
    },
  });
  expect(JSON.stringify(preparation)).not.toContain(token);
  expect(JSON.stringify(preparation)).not.toContain('private-delivery-signature');

  await expect(publisher.publish(publication, preparation)).resolves.toEqual({
    responseClass: 'SUCCESS',
    remotePostId: 'media-1',
    remoteUrl: 'https://www.instagram.com/reel/vision/',
    remoteRequestId: 'container-1',
    responseMetadata: { provider: 'INSTAGRAM' },
  });

  expect(requests).toHaveLength(6);
  expect(requests.every((request) => !request.url.includes('access_token'))).toBe(true);
  expect(requests.every((request) => !request.url.includes(token))).toBe(true);
  const create = requests[1]!;
  expect(String(create.init.body)).toContain('media_type=REELS');
  expect(String(create.init.body)).toContain('video_url=https%3A%2F%2Fmedia.example.test');
  expect(String(create.init.body)).toContain('share_to_feed=true');
  expect(create.init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
});

it('fails before issuing an asset lease when the live account publishing quota is exhausted', async () => {
  let leaseCalls = 0;
  const publisher = new InstagramGraphPublisher(
    credentials(),
    leaseProvider(() => {
      leaseCalls += 1;
    }),
    {
      apiVersion: 'v25.0',
      graphBaseUrl: 'https://graph.example.test',
      fetchImpl: async () =>
        response({
          data: [{ quota_usage: 50, config: { quota_total: 50, quota_duration: 86400 } }],
        }),
      now: () => now,
    },
  );

  await expect(publisher.prepare(snapshot())).rejects.toMatchObject({
    result: {
      responseClass: 'RATE_LIMITED',
      failureCode: 'INSTAGRAM_PUBLISHING_QUOTA_EXHAUSTED',
    },
  });
  expect(leaseCalls).toBe(0);
});

it('bounds container polling and classifies not-ready processing as safely retryable', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => {
    calls += 1;
    if (calls === 1) return response({ data: [{ quota_usage: 0 }] });
    if (calls === 2) return response({ id: 'container-wait' });
    return response({ id: 'container-wait', status_code: 'IN_PROGRESS' });
  };
  const publisher = new InstagramGraphPublisher(credentials(), leaseProvider(), {
    apiVersion: 'v25.0',
    graphBaseUrl: 'https://graph.example.test',
    pollIntervalMs: 0,
    maxPollAttempts: 3,
    fetchImpl,
    sleep: async () => undefined,
    now: () => now,
  });

  await expect(publisher.prepare(snapshot())).rejects.toMatchObject({
    result: {
      responseClass: 'TRANSIENT_FAILURE',
      failureCode: 'INSTAGRAM_CONTAINER_NOT_READY',
      remoteRequestId: 'container-wait',
    },
  });
  expect(calls).toBe(5);
});

it('classifies a lost media_publish response as an unknown remote side effect', async () => {
  const publisher = new InstagramGraphPublisher(credentials(), leaseProvider(), {
    apiVersion: 'v25.0',
    graphBaseUrl: 'https://graph.example.test',
    fetchImpl: async () => {
      throw new Error('connection reset');
    },
    now: () => now,
  });

  await expect(
    publisher.publish(snapshot(), { remoteRequestId: 'container-ambiguous' }),
  ).resolves.toEqual({
    responseClass: 'UNKNOWN_SIDE_EFFECT',
    failureCode: 'INSTAGRAM_PUBLISH_RESPONSE_AMBIGUOUS',
    remoteRequestId: 'container-ambiguous',
  });
});

it('reconciles a known Instagram media ID but never infers success from a FINISHED container alone', async () => {
  const replies = [
    response({ id: 'media-known', permalink: 'https://www.instagram.com/reel/known/' }),
    response({ id: 'container-only', status_code: 'FINISHED' }),
  ];
  const publisher = new InstagramGraphPublisher(credentials(), leaseProvider(), {
    apiVersion: 'v25.0',
    graphBaseUrl: 'https://graph.example.test',
    fetchImpl: async () => replies.shift() ?? response({}, 500),
    now: () => now,
  });

  await expect(
    publisher.reconcile(
      snapshot({
        execution: {
          attemptId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4748',
          attemptNumber: 1,
          remoteRequestId: 'container-known',
          remotePostId: 'media-known',
          responseMetadata: null,
        },
      }),
    ),
  ).resolves.toEqual({
    kind: 'PUBLISHED',
    remotePostId: 'media-known',
    remoteUrl: 'https://www.instagram.com/reel/known/',
  });

  await expect(
    publisher.reconcile(
      snapshot({
        execution: {
          attemptId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4748',
          attemptNumber: 1,
          remoteRequestId: 'container-only',
          remotePostId: null,
          responseMetadata: null,
        },
      }),
    ),
  ).resolves.toEqual({ kind: 'UNKNOWN' });
});

it('rejects incompatible Reel media before credentials or provider calls', async () => {
  let credentialCalls = 0;
  const publisher = new InstagramGraphPublisher(
    {
      async resolve() {
        credentialCalls += 1;
        return { accessToken: token };
      },
    },
    leaseProvider(),
    {
      apiVersion: 'v25.0',
      graphBaseUrl: 'https://graph.example.test',
      fetchImpl: async () => response({}),
      now: () => now,
    },
  );

  await expect(
    publisher.prepare(
      snapshot({
        media: {
          ...snapshot().media,
          sampleRate: 44_100,
        },
      }),
    ),
  ).rejects.toBeInstanceOf(ProviderPublishError);
  expect(credentialCalls).toBe(0);
});

it('refreshes Instagram account health and classifies lost authorization without publishing', async () => {
  const healthy = new InstagramGraphPublisher(credentials(), leaseProvider(), {
    apiVersion: 'v25.0',
    graphBaseUrl: 'https://graph.example.test',
    fetchImpl: async () =>
      response({ data: [{ quota_usage: 2, config: { quota_total: 50, quota_duration: 86400 } }] }),
    now: () => now,
  });
  await expect(
    healthy.checkAccount!({
      id: snapshot().account.id,
      platform: 'INSTAGRAM',
      remoteAccountId: snapshot().account.remoteAccountId,
      capabilities: snapshot().account.capabilities,
    }),
  ).resolves.toMatchObject({
    kind: 'ACTIVE',
    remoteAccountId: snapshot().account.remoteAccountId,
    capabilities: { canPublishVideo: true, checkedAt: now.toISOString() },
  });

  const expired = new InstagramGraphPublisher(
    {
      async resolve() {
        return { accessToken: token, expiresAt: '2026-09-21T12:00:00.000Z' };
      },
    },
    leaseProvider(),
    { apiVersion: 'v25.0', graphBaseUrl: 'https://graph.example.test', now: () => now },
  );
  await expect(
    expired.checkAccount!({
      id: snapshot().account.id,
      platform: 'INSTAGRAM',
      remoteAccountId: snapshot().account.remoteAccountId,
      capabilities: snapshot().account.capabilities,
    }),
  ).resolves.toEqual({ kind: 'REAUTH_REQUIRED', failureCode: 'INSTAGRAM_AUTH_REQUIRED' });
});
