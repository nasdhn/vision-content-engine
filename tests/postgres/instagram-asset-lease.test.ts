import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { DatabaseExactAssetDeliveryLeaseProvider } from '../../apps/worker-publish/src/index.js';
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
    platform: 'INSTAGRAM',
    deliveryMode: 'API_AUTOMATED',
    scheduledAt: '2026-09-22T12:00:00.000Z',
    metadata: {
      schemaVersion: 'instagram-reel-v1',
      platform: 'INSTAGRAM',
      caption: 'Vision',
      shareToFeed: true,
    },
    account: {
      id: randomUUID(),
      remoteAccountId: '17841400000000000',
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
      durationMs: 15_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
    },
  };
}

it('issues a short-lived HTTPS lease only for the exact canonical asset identity', async () => {
  const asset = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'private-vce',
      objectKey: `renders/${randomUUID()}/master.mp4`,
      checksumSha256: 'b'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 1_000_000n,
      width: 1080,
      height: 1920,
      durationMs: 15_000,
      fps: 30,
      audioChannels: 2,
      sampleRate: 48_000,
      status: 'READY',
      sourceType: 'RENDER',
    },
  });
  const signed: Array<Readonly<{ bucket: string; objectKey: string; expiresInSeconds: number }>> =
    [];
  const provider = new DatabaseExactAssetDeliveryLeaseProvider(
    fixture.client,
    'private-vce',
    async (input) => {
      signed.push(input);
      return 'https://objects.example.test/signed/master.mp4?signature=opaque';
    },
    () => new Date('2026-09-22T12:00:00.000Z'),
  );

  const lease = await provider.issue(snapshotFor(asset), 900);
  expect(lease).toEqual({
    assetId: asset.id,
    checksumSha256: asset.checksumSha256,
    url: 'https://objects.example.test/signed/master.mp4?signature=opaque',
    expiresAt: '2026-09-22T12:15:00.000Z',
  });
  expect(signed).toEqual([
    {
      bucket: 'private-vce',
      objectKey: asset.objectKey,
      mimeType: 'video/mp4',
      expiresInSeconds: 900,
    },
  ]);
  expect(JSON.stringify(lease)).not.toContain(asset.objectKey);
  expect(JSON.stringify(lease)).not.toContain('private-vce');
});

it('fails closed when the requested snapshot does not match the stored exact asset', async () => {
  const asset = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'private-vce',
      objectKey: `renders/${randomUUID()}/master.mp4`,
      checksumSha256: 'c'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 2_000_000n,
      status: 'READY',
      sourceType: 'RENDER',
    },
  });
  let signerCalled = false;
  const provider = new DatabaseExactAssetDeliveryLeaseProvider(
    fixture.client,
    'private-vce',
    async () => {
      signerCalled = true;
      return 'https://objects.example.test/should-not-be-issued';
    },
  );
  const canonical = snapshotFor(asset);

  await expect(
    provider.issue(
      {
        ...canonical,
        media: { ...canonical.media, checksumSha256: 'd'.repeat(64) },
      },
      900,
    ),
  ).rejects.toThrow('ASSET_DELIVERY_LEASE_IDENTITY_MISMATCH');
  expect(signerCalled).toBe(false);
});
