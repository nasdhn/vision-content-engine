import { HeadBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { Redis } from 'ioredis';
import pg from 'pg';
import type { RuntimeConfig } from '@vision/shared';
import { assertLocalBootstrap } from '@vision/shared';
import type { ReadinessProbes } from '@vision/observability';

export function createLocalDependencies(config: RuntimeConfig) {
  assertLocalBootstrap(config);
  const postgres = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 1500,
    query_timeout: 1500,
    statement_timeout: 1500,
    idleTimeoutMillis: 5000,
  });
  postgres.on('error', () => {
    /* Reported as down through readiness, without raw errors. */
  });
  const redis = new Redis(config.REDIS_URL, {
    connectTimeout: 1500,
    commandTimeout: 1500,
    maxRetriesPerRequest: 0,
    enableOfflineQueue: false,
    retryStrategy: () => 1000,
  });
  redis.on('error', () => {
    /* Readiness reports connection failure. */
  });
  const storage = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY,
    },
    requestHandler: { connectionTimeout: 1500, requestTimeout: 1500 },
  });
  const probes: ReadinessProbes = {
    postgres: async () => {
      await postgres.query('SELECT 1');
    },
    redis: async () => {
      if ((await redis.ping()) !== 'PONG') throw new Error('REDIS_NOT_READY');
    },
    storage: async () => {
      await storage.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }), {
        abortSignal: AbortSignal.timeout(1500),
      });
    },
  };
  return {
    probes,
    storage,
    async close() {
      redis.disconnect();
      storage.destroy();
      await postgres.end();
    },
  };
}
