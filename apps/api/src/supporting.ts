import { Controller, Get, HttpException, Inject, Param, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import type { SupportingReadService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const SUPPORTING_READ = Symbol('supporting-read-service');
const id = z.string().uuid();

@Controller('api')
export class SupportingReadController {
  constructor(
    @Inject(SUPPORTING_READ) private readonly supporting: SupportingReadService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        throw new HttpException(error.code, error.code === 'ASSET_NOT_FOUND' ? 404 : 422);
      }
      throw new HttpException('SUPPORTING_READ_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get('calendar')
  calendar(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.calendar());
  }

  @Get('published')
  published(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.published());
  }

  @Get('assets')
  assets(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.assets());
  }

  @Get('assets/:id')
  asset(
    @Param('id') assetId: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.supporting.asset(id.parse(assetId)));
  }

  @Get('patterns')
  patterns(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.patterns());
  }

  @Get('templates')
  templates(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.templates());
  }

  @Get('settings/summary')
  settings(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.supporting.settingsSummary());
  }
}
