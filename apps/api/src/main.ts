import 'dotenv/config';
import { createDatabaseClient } from '@vision/database';
import {
  ConceptReviewService,
  DashboardReadService,
  RecordingPackService,
} from '@vision/application';
import { S3PrivateStorage } from '@vision/media';
import { parseConfig } from '@vision/shared';

import { createApi } from './app.js';
import { createLocalDependencies } from './local-dependencies.js';

async function main() {
  const config = parseConfig(process.env);
  const dependencies = createLocalDependencies(config);
  const db = createDatabaseClient(config.DATABASE_URL);

  try {
    if (!config.VCE_LOCAL_ACCESS_KEY || config.VCE_LOCAL_ACCESS_KEY.length < 32)
      throw new Error('LOCAL_AUTH_NOT_CONFIGURED');

    const recordings = new RecordingPackService(
      db,
      new S3PrivateStorage(dependencies.storage, config.S3_BUCKET),
    );
    const dashboard = new DashboardReadService(db);
    const concepts = new ConceptReviewService(db);

    await recordings.recoverInterrupted();
    await recordings.prepareExisting();

    const app = await createApi(dependencies.probes, {
      auth: {
        accessKey: config.VCE_LOCAL_ACCESS_KEY,
        origin: config.VCE_WEB_ORIGIN,
      },
      recordings,
      dashboard,
      concepts,
    });

    const close = async () => {
      await app.close();
      await dependencies.close();
      await db.$disconnect();
    };

    process.once('SIGINT', () => {
      void close();
    });
    process.once('SIGTERM', () => {
      void close();
    });

    await app.listen(config.VCE_API_PORT, config.VCE_API_HOST);

    console.log(
      JSON.stringify({
        level: 'info',
        service: 'api',
        message: 'Local Vision control API started',
      }),
    );
  } catch {
    await dependencies.close();
    await db.$disconnect();
    throw new Error('BOOTSTRAP_STARTUP_FAILED');
  }
}

main().catch(() => {
  console.error(
    JSON.stringify({
      level: 'error',
      service: 'api',
      errorCode: 'BOOTSTRAP_STARTUP_FAILED',
    }),
  );
  process.exitCode = 1;
});
