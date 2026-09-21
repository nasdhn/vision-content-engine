import { Controller, Get, HttpException, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { DashboardReadService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const DASHBOARD = Symbol('dashboard-read-service');

@Controller('api')
export class DashboardController {
  constructor(
    @Inject(DASHBOARD) private readonly dashboard: DashboardReadService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch {
      throw new HttpException('DASHBOARD_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get('dashboard')
  summary(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.dashboard.summary());
  }

  @Get('attention')
  attention(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.dashboard.attention());
  }
}
