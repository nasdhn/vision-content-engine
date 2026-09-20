import { createReadStream } from 'node:fs';
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
  ) {}
  async put(key: string, file: string, size: number, mime: string) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: createReadStream(file),
        ContentLength: size,
        ContentType: mime,
        IfNoneMatch: '*',
      }),
      { abortSignal: AbortSignal.timeout(60000) },
    );
  }
  async get(key: string) {
    const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      abortSignal: AbortSignal.timeout(60000),
    });
    if (!result.Body || !(Symbol.asyncIterator in result.Body))
      throw new Error('OBJECT_UNREADABLE');
    return result.Body as AsyncIterable<Uint8Array>;
  }
}
