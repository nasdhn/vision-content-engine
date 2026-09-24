import { OperationsController, RUNTIME_HEALTH } from './operations.js';
import type { RuntimeHealthService } from './runtime-health.js';
import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { StructuredLogger } from '@vision/observability';
import { checkReadiness } from '@vision/observability';
import type { ReadinessProbes } from '@vision/observability';
import type {
  ConceptReviewService,
  DashboardReadService,
  ProductionReadService,
  RecordingPackService,
  RenderReviewService,
  SupportingReadService,
  ManualHandoffService,
  DistributionOperationsService,
  AnalyticsReadService,
  TikTokManualAnalyticsService,
  VisionAttributionIngestService,
  LearningDashboardService,
} from '@vision/application';

import {
  LOCAL_SESSION,
  LocalAuthExceptionFilter,
  LocalSessionController,
  LocalSessionService,
  type LocalSessionOptions,
} from './auth.js';
import { DashboardController, DASHBOARD } from './dashboard.js';
import { ConceptReviewController, CONCEPT_REVIEW } from './concepts.js';
import { ProductionController, PRODUCTION_READ } from './production.js';
import { RecordingController, RECORDINGS } from './recordings.js';
import { RenderReviewController, RENDER_REVIEW } from './review.js';
import { SupportingReadController, SUPPORTING_READ } from './supporting.js';
import { ManualPublishController, MANUAL_HANDOFF } from './manual-publish.js';
import { DistributionOperationsController, DISTRIBUTION_OPERATIONS } from './distribution.js';
import {
  ANALYTICS_READ,
  AnalyticsReadController,
  TikTokManualAnalyticsController,
  TIKTOK_MANUAL_ANALYTICS,
} from './analytics.js';
import {
  VisionAttributionIngestController,
  VISION_ATTRIBUTION_INGEST,
} from './vision-attribution.js';
import { LearningDashboardController, LEARNING_DASHBOARD } from './learning.js';

const PROBES = Symbol('bootstrap-readiness-probes');

export type ApiBusinessOptions = {
  auth: LocalSessionOptions;
  runtimeHealth?: Pick<RuntimeHealthService, 'read'>;
  recordings?: RecordingPackService;
  dashboard?: DashboardReadService;
  concepts?: ConceptReviewService;
  production?: ProductionReadService;
  review?: RenderReviewService;
  supporting?: SupportingReadService;
  manualHandoff?: ManualHandoffService;
  distribution?: DistributionOperationsService;
  analyticsRead?: AnalyticsReadService;
  analyticsManual?: TikTokManualAnalyticsService;
  visionAttribution?: VisionAttributionIngestService;
  learning?: LearningDashboardService;
};

@Controller()
class HealthController {
  constructor(@Inject(PROBES) private readonly probes: ReadinessProbes) {}

  @Get('healthz')
  health() {
    return { status: 'ok', service: 'api' };
  }

  @Get('readyz')
  async ready() {
    const result = await checkReadiness(this.probes);
    if (result.status !== 'ready') throw new ServiceUnavailableException(result);
    return result;
  }
}

export async function createApi(
  probes: ReadinessProbes,
  business?: ApiBusinessOptions,
  logger = new StructuredLogger('api'),
) {
  @Module({
    controllers: [
      HealthController,
      ...(business?.runtimeHealth ? [OperationsController] : []),
      ...(business ? [LocalSessionController] : []),
      ...(business?.recordings ? [RecordingController] : []),
      ...(business?.dashboard ? [DashboardController] : []),
      ...(business?.concepts ? [ConceptReviewController] : []),
      ...(business?.production ? [ProductionController] : []),
      ...(business?.review ? [RenderReviewController] : []),
      ...(business?.supporting ? [SupportingReadController] : []),
      ...(business?.manualHandoff ? [ManualPublishController] : []),
      ...(business?.distribution ? [DistributionOperationsController] : []),
      ...(business?.analyticsRead ? [AnalyticsReadController] : []),
      ...(business?.analyticsManual ? [TikTokManualAnalyticsController] : []),
      ...(business?.visionAttribution ? [VisionAttributionIngestController] : []),
      ...(business?.learning ? [LearningDashboardController] : []),
    ],
    providers: [
      { provide: PROBES, useValue: probes },
      ...(business?.runtimeHealth
        ? [{ provide: RUNTIME_HEALTH, useValue: business.runtimeHealth }]
        : []),
      ...(business
        ? [
            {
              provide: LOCAL_SESSION,
              useValue: new LocalSessionService(business.auth),
            },
          ]
        : []),
      ...(business?.recordings
        ? [
            {
              provide: RECORDINGS,
              useValue: business.recordings,
            },
          ]
        : []),
      ...(business?.dashboard
        ? [
            {
              provide: DASHBOARD,
              useValue: business.dashboard,
            },
          ]
        : []),
      ...(business?.concepts
        ? [
            {
              provide: CONCEPT_REVIEW,
              useValue: business.concepts,
            },
          ]
        : []),
      ...(business?.production
        ? [
            {
              provide: PRODUCTION_READ,
              useValue: business.production,
            },
          ]
        : []),
      ...(business?.review
        ? [
            {
              provide: RENDER_REVIEW,
              useValue: business.review,
            },
          ]
        : []),
      ...(business?.supporting
        ? [
            {
              provide: SUPPORTING_READ,
              useValue: business.supporting,
            },
          ]
        : []),
      ...(business?.manualHandoff
        ? [
            {
              provide: MANUAL_HANDOFF,
              useValue: business.manualHandoff,
            },
          ]
        : []),
      ...(business?.distribution
        ? [
            {
              provide: DISTRIBUTION_OPERATIONS,
              useValue: business.distribution,
            },
          ]
        : []),
      ...(business?.analyticsRead
        ? [
            {
              provide: ANALYTICS_READ,
              useValue: business.analyticsRead,
            },
          ]
        : []),
      ...(business?.analyticsManual
        ? [
            {
              provide: TIKTOK_MANUAL_ANALYTICS,
              useValue: business.analyticsManual,
            },
          ]
        : []),
      ...(business?.visionAttribution
        ? [
            {
              provide: VISION_ATTRIBUTION_INGEST,
              useValue: business.visionAttribution,
            },
          ]
        : []),
      ...(business?.learning
        ? [
            {
              provide: LEARNING_DASHBOARD,
              useValue: business.learning,
            },
          ]
        : []),
    ],
  })
  class BootstrapModule {}

  const app = await NestFactory.create(BootstrapModule, {
    logger: false,
    abortOnError: false,
    rawBody: true,
  });
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const started = Date.now();
    res.once('finish', () => {
      const loginFailed =
        req.method === 'POST' &&
        req.url?.split('?')[0]?.replace(/\/$/, '').toLowerCase() === '/api/session' &&
        res.statusCode >= 400;
      const authCodes: Record<number, string> = {
        400: 'AUTH_INVALID_INPUT',
        401: 'AUTH_FAILED',
        403: 'ORIGIN_REJECTED',
        429: 'AUTH_RATE_LIMITED',
        503: 'AUTH_UNAVAILABLE',
      };
      logger.log(
        res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
        loginFailed ? 'auth.login_failed' : 'api.request_completed',
        {
          method: req.method,
          statusCode: res.statusCode,
          durationMs: Date.now() - started,
          ...(loginFailed ? { errorCode: authCodes[res.statusCode] } : {}),
        },
      );
    });
    next();
  });
  if (business) app.useGlobalFilters(new LocalAuthExceptionFilter(app.getHttpAdapter()));
  return app;
}
