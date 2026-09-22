import {
  Body,
  Controller,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import type { AnalyticsReadService, TikTokManualAnalyticsService } from '@vision/application';
import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const ANALYTICS_READ = Symbol('analytics-read-service');
export const TIKTOK_MANUAL_ANALYTICS = Symbol('tiktok-manual-analytics-service');
const id = z.string().uuid();
const actor = { actorType: 'USER', actorId: 'local-analytics-operator' } as const;

@Controller('api/analytics')
export class AnalyticsReadController {
  constructor(
    @Inject(ANALYTICS_READ) private readonly analytics: AnalyticsReadService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  @Get()
  async overview(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
    try {
      return await this.analytics.overview();
    } catch {
      throw new HttpException('ANALYTICS_READ_FAILED', 409);
    }
  }
}

@Controller('api/analytics/manual')
export class TikTokManualAnalyticsController {
  constructor(
    @Inject(TIKTOK_MANUAL_ANALYTICS) private readonly analytics: TikTokManualAnalyticsService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        const conflicts = new Set([
          'MANUAL_SNAPSHOT_NOT_DUE',
          'MANUAL_ANALYTICS_JOB_NOT_PENDING',
          'PUBLICATION_NOT_PUBLISHED',
          'TIKTOK_PUBLICATION_REQUIRED',
        ]);
        throw new HttpException(error.code, conflicts.has(error.code) ? 409 : 422);
      }
      if (error instanceof Error && error.message === 'MANUAL_METRICS_REQUIRED') {
        throw new HttpException('MANUAL_METRICS_REQUIRED', 400);
      }
      throw new HttpException('MANUAL_ANALYTICS_OPERATION_FAILED', 409);
    }
  }

  @Get()
  overview(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
    return this.safe(() => this.analytics.overview());
  }

  @Post(':id/submit')
  submit(@Param('id') jobAttemptId: string, @Body() body: unknown, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() => this.analytics.submit(actor, id.parse(jobAttemptId), body));
  }
}
