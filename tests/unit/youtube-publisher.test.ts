import { expect, it } from 'vitest';
import { ProviderPublishError, YouTubeDataPublisher } from '../../packages/publishing/src/index.js';
import type {
  ExactAssetChunkSource,
  PublicationSnapshot,
  YouTubeCredentialResolver,
} from '../../packages/publishing/src/index.js';

const now = new Date('2026-09-22T14:00:00.000Z');
const token = 'fixture-youtube-access-token';

function snapshot(overrides: Partial<PublicationSnapshot> = {}): PublicationSnapshot {
  return {
    publicationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4743',
    operationId: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4745',
    platform: 'YOUTUBE',
    deliveryMode: 'API_AUTOMATED',
    scheduledAt: '2026-09-22T14:00:00.000Z',
    metadata: {
      schemaVersion: 'youtube-short-v1',
      platform: 'YOUTUBE',
      title: 'Vision en 30 secondes',
      description: 'Prospection B2B avec Vision.',
      tags: ['vision', 'prospection'],
      categoryId: '28',
      defaultLanguage: 'fr',
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false,
    },
    account: {
      id: '0199f2d2-6ac2-7f64-9ed0-49ce5a9f4746',
      remoteAccountId: 'UCfixture',
      capabilities: {
        schemaVersion: 'v1',
        canPublishVideo: true,
        canPublishPublic: false,
        supportsNativeScheduling: true,
        deliveryMode: 'API_AUTOMATED',
        limitations: ['public-audit-required'],
        checkedAt: '2026-09-22T13:00:00.000Z',
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
      sizeBytes: String(700_000),
      mimeType: 'video/mp4',
      width: 1080,
      height: 1920,
      durationMs: 30_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
    },
    ...overrides,
  };
}

function credentials(): YouTubeCredentialResolver {
  return {
    async resolve() {
      return { accessToken: token, expiresAt: '2026-09-23T14:00:00.000Z' };
    },
  };
}

function chunks(onRead?: (start: number, end: number) => void): ExactAssetChunkSource {
  return {
    async readRange(_publication, startByte, endByteInclusive) {
      onRead?.(startByte, endByteInclusive);
      return new Uint8Array(endByteInclusive - startByte + 1).fill(7);
    },
  };
}

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function emptyResponse(status: number, headers: HeadersInit = {}) {
  return new Response(null, { status, headers });
}

it('creates a resumable session and uploads the exact asset in resumable chunks', async () => {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const replies = [
    emptyResponse(200, {
      location: 'https://upload.youtube.example/session/abc123',
    }),
    emptyResponse(308, { range: 'bytes=0-524287' }),
    jsonResponse({ id: 'youtube-video-1' }, 201),
  ];
  const reads: Array<[number, number]> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    requests.push({ url: String(input), init });
    const next = replies.shift();
    if (!next) throw new Error('UNEXPECTED_FETCH');
    return next;
  };
  const publisher = new YouTubeDataPublisher(
    credentials(),
    chunks((a, b) => reads.push([a, b])),
    {
      apiBaseUrl: 'https://youtube.example/youtube/v3',
      uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
      chunkSizeBytes: 512 * 1024,
      fetchImpl,
      now: () => now,
    },
  );

  const publication = snapshot();
  const preparation = await publisher.prepare(publication);
  expect(preparation).toEqual({
    remoteRequestId: 'https://upload.youtube.example/session/abc123',
    responseMetadata: {
      provider: 'YOUTUBE',
      uploadProtocol: 'RESUMABLE',
      totalBytes: 700_000,
    },
  });
  expect(JSON.stringify(preparation)).not.toContain(token);

  await expect(publisher.publish(publication, preparation)).resolves.toEqual({
    responseClass: 'SUCCESS',
    remotePostId: 'youtube-video-1',
    remoteUrl: 'https://www.youtube.com/watch?v=youtube-video-1',
    remoteRequestId: 'https://upload.youtube.example/session/abc123',
    responseMetadata: { provider: 'YOUTUBE' },
  });

  expect(reads).toEqual([
    [0, 524_287],
    [524_288, 699_999],
  ]);
  expect(requests).toHaveLength(3);
  expect(requests.every((request) => !request.url.includes(token))).toBe(true);
  expect(requests[0]!.init.headers).toMatchObject({ Authorization: `Bearer ${token}` });
  expect(String(requests[0]!.init.body)).toContain('"privacyStatus":"private"');
  expect(String(requests[0]!.init.body)).toContain('"containsSyntheticMedia":false');
  expect(requests[1]!.init.headers).toMatchObject({
    'Content-Range': 'bytes 0-524287/700000',
  });
});

it('recovers a lost chunk response by querying the resumable session before continuing', async () => {
  let call = 0;
  const requests: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl: typeof fetch = async (input, init = {}) => {
    call += 1;
    requests.push({ url: String(input), init });
    if (call === 1) {
      return emptyResponse(200, { location: 'https://upload.youtube.example/session/recover' });
    }
    if (call === 2) throw new Error('socket reset after remote accepted first chunk');
    if (call === 3) return emptyResponse(308, { range: 'bytes=0-524287' });
    if (call === 4) return jsonResponse({ id: 'youtube-recovered' }, 201);
    throw new Error('UNEXPECTED_FETCH');
  };
  const publisher = new YouTubeDataPublisher(credentials(), chunks(), {
    apiBaseUrl: 'https://youtube.example/youtube/v3',
    uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
    chunkSizeBytes: 512 * 1024,
    fetchImpl,
    now: () => now,
  });
  const publication = snapshot();
  const preparation = await publisher.prepare(publication);

  await expect(publisher.publish(publication, preparation)).resolves.toMatchObject({
    responseClass: 'SUCCESS',
    remotePostId: 'youtube-recovered',
  });
  expect(requests[2]!.init.headers).toMatchObject({
    'Content-Length': '0',
    'Content-Range': 'bytes */700000',
  });
  expect(requests[3]!.init.headers).toMatchObject({
    'Content-Range': 'bytes 524288-699999/700000',
  });
});

it('fails closed to unknown side effect when both upload and status responses are lost', async () => {
  let call = 0;
  const fetchImpl: typeof fetch = async () => {
    call += 1;
    if (call === 1) {
      return emptyResponse(200, { location: 'https://upload.youtube.example/session/ambiguous' });
    }
    throw new Error('network unavailable');
  };
  const publisher = new YouTubeDataPublisher(credentials(), chunks(), {
    apiBaseUrl: 'https://youtube.example/youtube/v3',
    uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
    chunkSizeBytes: 512 * 1024,
    fetchImpl,
    now: () => now,
  });
  const publication = snapshot({ media: { ...snapshot().media, sizeBytes: String(512 * 1024) } });
  const preparation = await publisher.prepare(publication);

  await expect(publisher.publish(publication, preparation)).resolves.toEqual({
    responseClass: 'UNKNOWN_SIDE_EFFECT',
    failureCode: 'YOUTUBE_UPLOAD_STATUS_UNKNOWN',
    remoteRequestId: 'https://upload.youtube.example/session/ambiguous',
  });
});

it('reconciles a completed resumable session and retries only provably incomplete sessions', async () => {
  const replies = [
    jsonResponse({ id: 'youtube-from-session' }, 201),
    emptyResponse(308, { range: 'bytes=0-262143' }),
  ];
  const publisher = new YouTubeDataPublisher(credentials(), chunks(), {
    apiBaseUrl: 'https://youtube.example/youtube/v3',
    uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
    fetchImpl: async () => replies.shift() ?? jsonResponse({}, 500),
    now: () => now,
  });

  await expect(
    publisher.reconcile(
      snapshot({
        execution: {
          attemptId: snapshot().execution.attemptId,
          attemptNumber: 1,
          remoteRequestId: 'https://upload.youtube.example/session/completed',
          remotePostId: null,
          responseMetadata: null,
        },
      }),
    ),
  ).resolves.toEqual({
    kind: 'PUBLISHED',
    remotePostId: 'youtube-from-session',
    remoteUrl: 'https://www.youtube.com/watch?v=youtube-from-session',
  });

  await expect(
    publisher.reconcile(
      snapshot({
        execution: {
          attemptId: snapshot().execution.attemptId,
          attemptNumber: 1,
          remoteRequestId: 'https://upload.youtube.example/session/incomplete',
          remotePostId: null,
          responseMetadata: null,
        },
      }),
    ),
  ).resolves.toEqual({ kind: 'ABSENT_RETRY_ELIGIBLE' });
});

it('rejects public upload before provider calls when the account is not audit-ready', async () => {
  let credentialCalls = 0;
  const publisher = new YouTubeDataPublisher(
    {
      async resolve() {
        credentialCalls += 1;
        return { accessToken: token };
      },
    },
    chunks(),
    {
      apiBaseUrl: 'https://youtube.example/youtube/v3',
      uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
      fetchImpl: async () => jsonResponse({}),
      now: () => now,
    },
  );

  await expect(
    publisher.prepare(
      snapshot({
        metadata: {
          schemaVersion: 'youtube-short-v1',
          platform: 'YOUTUBE',
          title: 'Vision en 30 secondes',
          description: 'Prospection B2B avec Vision.',
          tags: ['vision', 'prospection'],
          categoryId: '28',
          defaultLanguage: 'fr',
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: false,
        },
      }),
    ),
  ).rejects.toBeInstanceOf(ProviderPublishError);
  expect(credentialCalls).toBe(0);
});

it('requires private visibility for native publishAt scheduling', async () => {
  const publisher = new YouTubeDataPublisher(credentials(), chunks(), {
    apiBaseUrl: 'https://youtube.example/youtube/v3',
    uploadBaseUrl: 'https://upload.youtube.example/youtube/v3',
    fetchImpl: async () => jsonResponse({}),
    now: () => now,
  });

  await expect(
    publisher.prepare(
      snapshot({
        metadata: {
          schemaVersion: 'youtube-short-v1',
          platform: 'YOUTUBE',
          title: 'Vision en 30 secondes',
          description: 'Prospection B2B avec Vision.',
          tags: ['vision', 'prospection'],
          categoryId: '28',
          defaultLanguage: 'fr',
          privacyStatus: 'unlisted',
          publishAt: '2026-09-23T14:00:00.000Z',
          selfDeclaredMadeForKids: false,
          containsSyntheticMedia: false,
        },
        account: {
          ...snapshot().account,
          capabilities: {
            ...snapshot().account.capabilities!,
            canPublishPublic: true,
          },
        },
      }),
    ),
  ).rejects.toMatchObject({
    result: {
      responseClass: 'PERMANENT_FAILURE',
      failureCode: 'YOUTUBE_SCHEDULE_REQUIRES_PRIVATE',
    },
  });
});
