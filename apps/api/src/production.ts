import { Controller, Get, HttpException, Inject, Param, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import type { ProductionReadService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const PRODUCTION_READ = Symbol('production-read-service');
const id = z.string().uuid();

@Controller('api/production')
export class ProductionController {
  constructor(
    @Inject(PRODUCTION_READ) private readonly production: ProductionReadService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) throw new HttpException(error.code, 422);
      throw new HttpException('PRODUCTION_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get()
  list(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.production.list());
  }

  @Get(':id')
  detail(
    @Param('id') creativePlanVersionId: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.production.detail(id.parse(creativePlanVersionId)));
  }
}
