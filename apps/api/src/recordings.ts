import {
  Body,
  Controller,
  Get,
  Post,
  Param,
  Req,
  Res,
  Inject,
  HttpException,
} from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import type { RecordingPackService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const RECORDINGS = Symbol('recordings');
const actor = { actorType: 'USER', actorId: 'local-creative-director' } as const;
const id = z.string().uuid();

@Controller('api')
export class RecordingController {
  constructor(
    @Inject(RECORDINGS) private readonly service: RecordingPackService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof DomainError) throw new HttpException(error.code, 422);
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      throw new HttpException('RECORDING_OPERATION_FAILED', 409);
    }
  }

  @Get('recording-packs')
  packs(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
    return this.safe(() => this.service.packs());
  }

  @Post('recording-requests/:id/upload')
  upload(@Param('id') requestId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(async () => {
      id.parse(requestId);
      if (req.headers['content-type'] !== 'application/octet-stream')
        throw new DomainError('BINARY_UPLOAD_REQUIRED');

      const timer = setTimeout(() => req.destroy(), 120_000);
      try {
        return await this.service.upload(
          actor,
          requestId,
          req,
          z.string().optional().parse(req.headers['x-content-sha256']),
        );
      } finally {
        clearTimeout(timer);
      }
    });
  }

  @Post('recordings/:id/selection')
  selection(@Param('id') takeId: string, @Body() body: unknown, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(async () =>
      this.service.select(
        actor,
        id.parse(takeId),
        z
          .object({ status: z.enum(['SELECTED', 'REJECTED', 'UPLOADED']) })
          .strict()
          .parse(body).status,
      ),
    );
  }

  @Get('assets/:id/preview')
  async preview(
    @Param('id') assetId: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    this.sessions.require(req);
    const result = await this.safe(async () => this.service.preview(actor, id.parse(assetId)));
    res.setHeader('Content-Type', result.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', result.bytes.byteLength);
    res.end(result.bytes);
  }
}
