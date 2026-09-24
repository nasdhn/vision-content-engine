import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  parseConfig,
  assertLocalBootstrap,
  EnvironmentSecretResolver,
  s3CredentialProvider,
} from '@vision/shared';
import { createLocalDependencies } from './local-dependencies.js';
import { checkReadiness } from '@vision/observability';

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';

export async function checkLocalInfra() {
  const config = parseConfig(process.env);
  assertLocalBootstrap(config);
  const secrets = new EnvironmentSecretResolver(process.env, [
    'DATABASE_URL',
    'REDIS_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]);
  const dependencies = createLocalDependencies(config, secrets);
  const storage = new S3Client({
    endpoint: config.S3_ENDPOINT,
    region: config.S3_REGION,
    forcePathStyle: true,
    maxAttempts: 1,
    credentials: s3CredentialProvider(secrets),
    requestHandler: { connectionTimeout: 1500, requestTimeout: 2000 },
  });
  const key = `bootstrap-canary/${randomUUID()}.txt`;
  const object = { Bucket: config.S3_BUCKET, Key: key };
  try {
    // Bounded readiness polling, no fixed sleep as a success criterion.
    const deadline = Date.now() + 10000;
    let readiness = await checkReadiness(dependencies.probes);
    while (readiness.status !== 'ready' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      readiness = await checkReadiness(dependencies.probes);
    }
    assert.equal(readiness.status, 'ready');
    await storage.send(new PutObjectCommand({ ...object, Body: 'Phase 0 synthetic canary' }));
    const response = await storage.send(new GetObjectCommand(object));
    assert.equal(await response.Body?.transformToString(), 'Phase 0 synthetic canary');
    const anonymous = await fetch(`${config.S3_ENDPOINT}/${config.S3_BUCKET}/${key}`, {
      signal: AbortSignal.timeout(2000),
    });
    assert.equal(anonymous.status, 403, 'Private S3 object must reject anonymous access');
    await anonymous.body?.cancel();
    console.log(
      'PASS: PostgreSQL SELECT 1, Redis PING, S3 signed write/read, anonymous access denied.',
    );
  } finally {
    await storage.send(new DeleteObjectCommand(object)).catch(() => {
      console.error('Canary cleanup failed');
      process.exitCode = 1;
    });
    storage.destroy();
    await dependencies.close();
  }
}
