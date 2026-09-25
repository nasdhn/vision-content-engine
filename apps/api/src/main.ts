import { createRuntimeHealthService } from './runtime-health.js';
import { StructuredLogger } from '@vision/observability';
import 'dotenv/config';
import { createDatabaseClient, InvocationBudgetReader } from '@vision/database';
import {
  AnalyticsReadService,
  ConceptReviewService,
  DashboardReadService,
  ProductionReadService,
  RecordingPackService,
  RenderReviewService,
  SupportingReadService,
  ManualHandoffService,
  DistributionOperationsService,
  TikTokManualAnalyticsService,
  VisionAttributionIngestService,
  LearningDashboardService,
} from '@vision/application';
import { S3PrivateStorage } from '@vision/media';
import { EnvironmentSecretResolver, parseConfig } from '@vision/shared';

import { createApi } from './app.js';
import { createLocalDependencies } from './local-dependencies.js';

async function main() {
  const config = parseConfig(process.env);
  const secrets = new EnvironmentSecretResolver(process.env, [
    'DATABASE_URL',
    'REDIS_URL',
    'S3_ACCESS_KEY_ID',
    'S3_SECRET_ACCESS_KEY',
    'VCE_LOCAL_ACCESS_KEY',
    'VCE_VISION_ATTRIBUTION_INGEST_SECRET',
  ]);
  const dependencies = createLocalDependencies(config, secrets);
  const db = createDatabaseClient(secrets.resolve('DATABASE_URL'));
  const runtimeHealth = createRuntimeHealthService(dependencies.redis, dependencies.probes);

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
    const analyticsRead = new AnalyticsReadService(db);
    const analyticsManual = new TikTokManualAnalyticsService(db);
    const learning = new LearningDashboardService(db);
    const visionAttribution = config.VCE_VISION_ATTRIBUTION_INGEST_SECRET
      ? new VisionAttributionIngestService(db, {
          secret: () => secrets.resolve('VCE_VISION_ATTRIBUTION_INGEST_SECRET'),
        })
      : undefined;
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
        accessKey: () => secrets.resolve('VCE_LOCAL_ACCESS_KEY'),
        origin: config.VCE_WEB_ORIGIN,
      },
      runtimeHealth,
      budgetOperations: new InvocationBudgetReader(db),
      recordings,
      dashboard,
      concepts,
      production,
      review,
      supporting,
      manualHandoff,
      distribution,
      analyticsRead,
      analyticsManual,
      learning,
      ...(visionAttribution ? { visionAttribution } : {}),
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

    new StructuredLogger('api').log('info', 'runtime.started');
  } catch {
    await dependencies.close();
    await db.$disconnect();
    throw new Error('BOOTSTRAP_STARTUP_FAILED');
  }
}

main().catch(() => {
  new StructuredLogger('api').log('error', 'runtime.failed', {
    errorCode: 'BOOTSTRAP_STARTUP_FAILED',
  });
  process.exitCode = 1;
});
