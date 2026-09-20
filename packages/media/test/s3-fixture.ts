import { randomUUID } from 'node:crypto';
import {
  S3Client,
  CreateBucketCommand,
  DeleteObjectCommand,
  DeleteBucketCommand,
} from '@aws-sdk/client-s3';
import { S3PrivateStorage } from '../src/storage.js';
/** Disposable bucket using existing LOCAL credentials. No production endpoints accepted. */
export async function s3Fixture(env: NodeJS.ProcessEnv) {
  const endpoint = env.S3_ENDPOINT!;
  if (
    (env.VCE_ENV ?? 'LOCAL') !== 'LOCAL' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(endpoint).hostname)
  )
    throw new Error('LOCAL_STORAGE_REQUIRED');
  const client = new S3Client({
    endpoint,
    region: env.S3_REGION!,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: { accessKeyId: env.S3_ACCESS_KEY_ID!, secretAccessKey: env.S3_SECRET_ACCESS_KEY! },
  });
  const bucket = `vce-test-${randomUUID()}`;
  await client.send(new CreateBucketCommand({ Bucket: bucket }));
  const keys = new Set<string>();
  const store = new S3PrivateStorage(client, bucket);
  return {
    store,
    endpoint,
    bucket,
    key() {
      const key = `originals/${randomUUID()}`;
      keys.add(key);
      return key;
    },
    async close() {
      try {
        for (const key of keys)
          await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
        await client.send(new DeleteBucketCommand({ Bucket: bucket }));
      } finally {
        client.destroy();
      }
    },
  };
}
