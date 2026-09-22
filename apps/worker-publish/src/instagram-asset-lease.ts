import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PrismaClient } from '@vision/database';
import type {
  ExactAssetDeliveryLease,
  ExactAssetDeliveryLeaseProvider,
  PublicationSnapshot,
} from '@vision/publishing';

export type ExactAssetUrlSigner = (
  input: Readonly<{
    bucket: string;
    objectKey: string;
    mimeType: string | null;
    expiresInSeconds: number;
  }>,
) => Promise<string>;

export function createS3ExactAssetUrlSigner(client: S3Client): ExactAssetUrlSigner {
  return async (input) =>
    getSignedUrl(
      client,
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        ...(input.mimeType !== null ? { ResponseContentType: input.mimeType } : {}),
      }),
      { expiresIn: input.expiresInSeconds },
    );
}

export class DatabaseExactAssetDeliveryLeaseProvider implements ExactAssetDeliveryLeaseProvider {
  constructor(
    private readonly db: PrismaClient,
    private readonly bucket: string,
    private readonly sign: ExactAssetUrlSigner,
    private readonly now: () => Date = () => new Date(),
  ) {
    if (!bucket.trim()) throw new Error('ASSET_DELIVERY_BUCKET_REQUIRED');
  }

  async issue(
    publication: PublicationSnapshot,
    ttlSeconds: number,
  ): Promise<ExactAssetDeliveryLease> {
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 60 || ttlSeconds > 1_800) {
      throw new Error('INVALID_ASSET_DELIVERY_LEASE_TTL');
    }
    const asset = await this.db.asset.findUnique({
      where: { id: publication.media.assetId },
      select: {
        id: true,
        storageProvider: true,
        bucket: true,
        objectKey: true,
        status: true,
        deletedAt: true,
        checksumSha256: true,
        sizeBytes: true,
        mimeType: true,
      },
    });
    if (
      !asset ||
      asset.status !== 'READY' ||
      asset.deletedAt !== null ||
      asset.storageProvider !== 'S3' ||
      asset.bucket !== this.bucket ||
      asset.checksumSha256 === null ||
      asset.sizeBytes === null ||
      asset.sizeBytes <= 0n
    ) {
      throw new Error('ASSET_DELIVERY_LEASE_UNAVAILABLE');
    }
    if (
      asset.id !== publication.media.assetId ||
      asset.checksumSha256 !== publication.media.checksumSha256 ||
      asset.sizeBytes.toString() !== publication.media.sizeBytes ||
      asset.mimeType !== publication.media.mimeType
    ) {
      throw new Error('ASSET_DELIVERY_LEASE_IDENTITY_MISMATCH');
    }
    const url = await this.sign({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      mimeType: asset.mimeType,
      expiresInSeconds: ttlSeconds,
    });
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') throw new Error('ASSET_DELIVERY_LEASE_HTTPS_REQUIRED');
    const expiresAt = new Date(this.now().getTime() + ttlSeconds * 1_000).toISOString();
    return Object.freeze({
      assetId: asset.id,
      checksumSha256: asset.checksumSha256,
      url,
      expiresAt,
    });
  }
}
