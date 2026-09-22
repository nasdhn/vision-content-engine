import 'reflect-metadata';
import { Controller, Get, Inject, Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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
  TikTokManualAnalyticsService,
  VisionAttributionIngestService,
} from '@vision/application';

import {
  LOCAL_SESSION,
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
import { TikTokManualAnalyticsController, TIKTOK_MANUAL_ANALYTICS } from './analytics.js';
import {
  VisionAttributionIngestController,
  VISION_ATTRIBUTION_INGEST,
} from './vision-attribution.js';

const PROBES = Symbol('bootstrap-readiness-probes');

export type ApiBusinessOptions = {
  auth: LocalSessionOptions;
  recordings?: RecordingPackService;
  dashboard?: DashboardReadService;
  concepts?: ConceptReviewService;
  production?: ProductionReadService;
  review?: RenderReviewService;
  supporting?: SupportingReadService;
  manualHandoff?: ManualHandoffService;
  distribution?: DistributionOperationsService;
  analyticsManual?: TikTokManualAnalyticsService;
  visionAttribution?: VisionAttributionIngestService;
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

export async function createApi(probes: ReadinessProbes, business?: ApiBusinessOptions) {
  @Module({
    controllers: [
      HealthController,
      ...(business ? [LocalSessionController] : []),
      ...(business?.recordings ? [RecordingController] : []),
      ...(business?.dashboard ? [DashboardController] : []),
      ...(business?.concepts ? [ConceptReviewController] : []),
      ...(business?.production ? [ProductionController] : []),
      ...(business?.review ? [RenderReviewController] : []),
      ...(business?.supporting ? [SupportingReadController] : []),
      ...(business?.manualHandoff ? [ManualPublishController] : []),
      ...(business?.distribution ? [DistributionOperationsController] : []),
      ...(business?.analyticsManual ? [TikTokManualAnalyticsController] : []),
      ...(business?.visionAttribution ? [VisionAttributionIngestController] : []),
    ],
    providers: [
      { provide: PROBES, useValue: probes },
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
    ],
  })
  class BootstrapModule {}

  return NestFactory.create(BootstrapModule, {
    logger: false,
    abortOnError: false,
    rawBody: true,
  });
}
