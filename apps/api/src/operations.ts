import { Controller, Get, HttpException, Inject, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { LOCAL_SESSION, type LocalSessionService } from './auth.js';
import type { RuntimeHealthService } from './runtime-health.js';

export const RUNTIME_HEALTH = Symbol('runtime-health');

@Controller('api/operations')
export class OperationsController {
  constructor(
    @Inject(RUNTIME_HEALTH) private readonly health: Pick<RuntimeHealthService, 'read'>,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  @Get('runtime')
  async read(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    res.setHeader('Cache-Control', 'private, no-store');
    this.sessions.require(req);
    try {
      return await this.health.read();
    } catch {
      throw new HttpException('RUNTIME_HEALTH_UNAVAILABLE', 503);
    }
  }
}
