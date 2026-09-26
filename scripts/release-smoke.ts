import 'dotenv/config';

import { checkReleaseCanary } from '../apps/api/src/release-canary.js';
import { EnvironmentSecretResolver, parseConfig } from '../packages/shared/src/index.js';

function assertReleaseSmokeSafety(config: ReturnType<typeof parseConfig>) {
  if (config.VCE_REAL_PROVIDERS_ENABLED !== 'false') {
    throw new Error('RELEASE_SMOKE_REQUIRES_REAL_PROVIDERS_DISABLED');
  }

  if (!config.PAUSE_ALL_PUBLISHING) {
    throw new Error('RELEASE_SMOKE_REQUIRES_PUBLISHING_PAUSED');
  }

  if (!config.PAUSE_AI_GENERATION) {
    throw new Error('RELEASE_SMOKE_REQUIRES_AI_PAUSED');
  }

  if (!config.PAUSE_CAPTURE) {
    throw new Error('RELEASE_SMOKE_REQUIRES_CAPTURE_PAUSED');
  }

  if (!config.PAUSE_RENDERING) {
    throw new Error('RELEASE_SMOKE_REQUIRES_RENDERING_PAUSED');
  }

  if (!config.PAUSE_ANALYTICS_COLLECTION) {
    throw new Error('RELEASE_SMOKE_REQUIRES_ANALYTICS_PAUSED');
  }
}

try {
  const config = parseConfig(process.env);
  assertReleaseSmokeSafety(config);

  const secrets = new EnvironmentSecretResolver(process.env, [
    'DATABASE_URL',
    'REDIS_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
  ]);

  const result = await checkReleaseCanary(config, secrets);

  console.log(
    `PASS: release smoke (${result.environment}) — dependencies ready, private object-storage write/read/delete canary passed, isolated Redis enqueue/consume canary passed, worker heartbeat check=${result.workerHeartbeatCheck}; providers remained disabled and all work classes remained paused.`,
  );
} catch (error) {
  console.error(
    `RELEASE_SMOKE_FAILED: ${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
  );
  process.exitCode = 1;
}
