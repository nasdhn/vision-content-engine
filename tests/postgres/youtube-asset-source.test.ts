import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DatabaseExactAssetChunkSource } from '../../apps/worker-publish/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import type { PublicationSnapshot } from '../../packages/publishing/src/index.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

beforeAll(async () => {
  fixture = await postgresFixture();
});

afterAll(async () => {
  await fixture?.close();
});

function snapshotFor(asset: {
  id: string;
  checksumSha256: string | null;
  sizeBytes: bigint | null;
  mimeType: string | null;
}): PublicationSnapshot {
  return {
    publicationId: randomUUID(),
    operationId: randomUUID(),
    platform: 'YOUTUBE',
    deliveryMode: 'API_AUTOMATED',
    scheduledAt: '2026-09-22T14:00:00.000Z',
    metadata: {
      schemaVersion: 'youtube-short-v1',
      platform: 'YOUTUBE',
      title: 'Vision',
      description: '',
      tags: [],
      categoryId: '28',
      defaultLanguage: 'fr',
      privacyStatus: 'private',
      selfDeclaredMadeForKids: false,
      containsSyntheticMedia: false,
    },
    account: {
      id: randomUUID(),
      remoteAccountId: 'UCfixture',
      capabilities: null,
    },
    execution: {
      attemptId: randomUUID(),
      attemptNumber: 1,
      remoteRequestId: null,
      remotePostId: null,
      responseMetadata: null,
    },
    media: {
      assetId: asset.id,
      checksumSha256: asset.checksumSha256!,
      sizeBytes: asset.sizeBytes!.toString(),
      mimeType: asset.mimeType,
      width: 1080,
      height: 1920,
      durationMs: 30_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
    },
  };
}

it('reads only the requested byte range from the exact canonical private asset', async () => {
  const asset = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'private-vce',
      objectKey: `renders/${randomUUID()}/youtube.mp4`,
      checksumSha256: 'e'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 1_000_000n,
      width: 1080,
      height: 1920,
      durationMs: 30_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
      status: 'READY',
      sourceType: 'RENDER',
    },
  });
  const reads: Array<
    Readonly<{ bucket: string; objectKey: string; startByte: number; endByteInclusive: number }>
  > = [];
  const source = new DatabaseExactAssetChunkSource(fixture.client, 'private-vce', async (input) => {
    reads.push(input);
    return new Uint8Array(input.endByteInclusive - input.startByte + 1).fill(3);
  });

  const bytes = await source.readRange(snapshotFor(asset), 262_144, 524_287);
  expect(bytes.byteLength).toBe(262_144);
  expect(reads).toEqual([
    {
      bucket: 'private-vce',
      objectKey: asset.objectKey,
      startByte: 262_144,
      endByteInclusive: 524_287,
    },
  ]);
});

it('fails closed before storage access when asset identity or byte range is invalid', async () => {
  const asset = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'private-vce',
      objectKey: `renders/${randomUUID()}/youtube.mp4`,
      checksumSha256: 'f'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 500_000n,
      status: 'READY',
      sourceType: 'RENDER',
    },
  });
  let readerCalls = 0;
  const source = new DatabaseExactAssetChunkSource(fixture.client, 'private-vce', async (input) => {
    readerCalls += 1;
    return new Uint8Array(input.endByteInclusive - input.startByte + 1);
  });
  const canonical = snapshotFor(asset);

  await expect(
    source.readRange(
      { ...canonical, media: { ...canonical.media, checksumSha256: '0'.repeat(64) } },
      0,
      10,
    ),
  ).rejects.toThrow('YOUTUBE_ASSET_SOURCE_IDENTITY_MISMATCH');
  await expect(source.readRange(canonical, 0, 500_000)).rejects.toThrow(
    'INVALID_YOUTUBE_ASSET_RANGE',
  );
  expect(readerCalls).toBe(0);
});
