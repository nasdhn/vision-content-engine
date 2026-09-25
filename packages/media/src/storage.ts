import { createReadStream } from 'node:fs';
import { invariant } from '@vision/domain';
import { CapacityGuard } from './capacity.js';
import { boundedBytes } from './bounded-stream.js';
import type { S3Client } from '@aws-sdk/client-s3';
import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
export interface PrivateStorage {
  readonly bucket: string;
  put(key: string, file: string, size: number, mime: string): Promise<void>;
  get(key: string): Promise<AsyncIterable<Uint8Array>>;
}
/** No ACL, public URL, listing or arbitrary bucket supplied by clients. Keys are server-owned. */
export class S3PrivateStorage implements PrivateStorage {
  constructor(
    private readonly client: S3Client,
    readonly bucket: string,
    private readonly capacity = new CapacityGuard(),
  ) {}
  async put(key: string, file: string, size: number, mime: string) {
    this.capacity.artifactSize(size);
    invariant((await this.capacity.file(file)) === size, 'ARTIFACT_SIZE_MISMATCH');
    const stream = createReadStream(file, { end: size - 1 });
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: stream,
          ContentLength: size,
          ContentType: mime,
          IfNoneMatch: '*',
        }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
    } finally {
      stream.destroy();
    }
  }
  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(60000),
    });
    if (!result.Body || !(Symbol.asyncIterator in result.Body))
      throw new Error('OBJECT_UNREADABLE');
    const body = result.Body;
    const destroy = () => {
      if ('destroy' in body && typeof body.destroy === 'function') body.destroy();
    };
    try {
      if (result.ContentLength !== undefined) this.capacity.artifactSize(result.ContentLength);
    } catch (error) {
      destroy();
      throw error;
    }
    const maximum = this.capacity.policy.maxArtifactBytes;
    return (async function* () {
      try {
        yield* boundedBytes(body as AsyncIterable<Uint8Array>, maximum, result.ContentLength);
      } finally {
        destroy();
      }
    })();
  }
}
