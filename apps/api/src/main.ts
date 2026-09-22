import 'dotenv/config';
import { createDatabaseClient } from '@vision/database';
import {
  ConceptReviewService,
  DashboardReadService,
  ProductionReadService,
  RecordingPackService,
  RenderReviewService,
  SupportingReadService,
  ManualHandoffService,
  DistributionOperationsService,
  TikTokManualAnalyticsService,
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

    const storage = new S3PrivateStorage(dependencies.storage, config.S3_BUCKET);
    const recordings = new RecordingPackService(db, storage);
    const dashboard = new DashboardReadService(db);
    const concepts = new ConceptReviewService(db);
    const production = new ProductionReadService(db);
    const review = new RenderReviewService(db, storage);
    const manualHandoff = new ManualHandoffService(db, storage);
    const distribution = new DistributionOperationsService(db, {
      realProvidersEnabled: false,
    });
    const analyticsManual = new TikTokManualAnalyticsService(db);
    const supporting = new SupportingReadService(db, {
      environment: config.VCE_ENV,
      webOrigin: config.VCE_WEB_ORIGIN,
      safety: {
        pauseAllPublishing: config.PAUSE_ALL_PUBLISHING,
        pauseAiGeneration: config.PAUSE_AI_GENERATION,
        pauseCapture: config.PAUSE_CAPTURE,
        pauseRendering: config.PAUSE_RENDERING,
        pauseAnalyticsCollection: config.PAUSE_ANALYTICS_COLLECTION,
        realProvidersEnabled: false,
      },
    });

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
      production,
      review,
      supporting,
      manualHandoff,
      distribution,
      analyticsManual,
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
