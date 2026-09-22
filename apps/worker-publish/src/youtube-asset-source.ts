import { GetObjectCommand } from '@aws-sdk/client-s3';
import type { S3Client } from '@aws-sdk/client-s3';
import type { PrismaClient } from '@vision/database';
import type { ExactAssetChunkSource, PublicationSnapshot } from '@vision/publishing';

export type ExactAssetRangeReader = (
  input: Readonly<{
    bucket: string;
    objectKey: string;
    startByte: number;
    endByteInclusive: number;
  }>,
) => Promise<Uint8Array>;

export function createS3ExactAssetRangeReader(client: S3Client): ExactAssetRangeReader {
  return async (input) => {
    const response = await client.send(
      new GetObjectCommand({
        Bucket: input.bucket,
        Key: input.objectKey,
        Range: `bytes=${input.startByte}-${input.endByteInclusive}`,
      }),
    );
    if (!response.Body) throw new Error('YOUTUBE_ASSET_BODY_MISSING');
    return response.Body.transformToByteArray();
  };
}

export class DatabaseExactAssetChunkSource implements ExactAssetChunkSource {
  constructor(
    private readonly db: PrismaClient,
    private readonly bucket: string,
    private readonly read: ExactAssetRangeReader,
  ) {
    if (!bucket.trim()) throw new Error('YOUTUBE_ASSET_BUCKET_REQUIRED');
  }

  async readRange(
    publication: PublicationSnapshot,
    startByte: number,
    endByteInclusive: number,
  ): Promise<Uint8Array> {
    const totalBytes = Number(publication.media.sizeBytes);
    if (
      !Number.isSafeInteger(startByte) ||
      !Number.isSafeInteger(endByteInclusive) ||
      startByte < 0 ||
      endByteInclusive < startByte ||
      endByteInclusive >= totalBytes
    ) {
      throw new Error('INVALID_YOUTUBE_ASSET_RANGE');
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
      throw new Error('YOUTUBE_ASSET_SOURCE_UNAVAILABLE');
    }
    if (
      asset.id !== publication.media.assetId ||
      asset.checksumSha256 !== publication.media.checksumSha256 ||
      asset.sizeBytes.toString() !== publication.media.sizeBytes ||
      asset.mimeType !== publication.media.mimeType
    ) {
      throw new Error('YOUTUBE_ASSET_SOURCE_IDENTITY_MISMATCH');
    }

    const bytes = await this.read({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      startByte,
      endByteInclusive,
    });
    if (bytes.byteLength !== endByteInclusive - startByte + 1) {
      throw new Error('YOUTUBE_ASSET_RANGE_LENGTH_MISMATCH');
    }
    return bytes;
  }
}
