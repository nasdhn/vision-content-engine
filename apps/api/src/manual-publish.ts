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
import type { ManualHandoffService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const MANUAL_HANDOFF = Symbol('manual-handoff-service');
const actor = { actorType: 'USER', actorId: 'local-distribution-operator' } as const;
const id = z.string().uuid();
const completionInput = z
  .object({
    remoteUrl: z
      .string()
      .trim()
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://'))
      .optional(),
  })
  .strict();

function byteRange(header: string | undefined, size: number) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;

  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) return undefined;
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }

  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    start >= size
  ) {
    return undefined;
  }

  return { start, end: Math.min(end, size - 1) };
}

@Controller('api/manual-publish')
export class ManualPublishController {
  constructor(
    @Inject(MANUAL_HANDOFF) private readonly manual: ManualHandoffService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        if (error.code === 'PUBLICATION_NOT_FOUND') throw new HttpException(error.code, 404);
        const conflicts = new Set([
          'INVALID_PUBLICATION_TRANSITION',
          'MANUAL_HANDOFF_NOT_AVAILABLE',
          'PLATFORM_ACCOUNT_NOT_ACTIVE',
        ]);
        throw new HttpException(error.code, conflicts.has(error.code) ? 409 : 422);
      }
      throw new HttpException('MANUAL_HANDOFF_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get()
  queue(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.manual.queue());
  }

  @Get(':id')
  detail(
    @Param('id') publicationId: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.manual.detail(id.parse(publicationId)));
  }

  @Get(':id/media')
  async media(
    @Param('id') publicationId: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    this.sessions.require(req);
    const media = await this.safe(() => this.manual.media(actor, id.parse(publicationId)));
    const range = byteRange(
      typeof req.headers.range === 'string' ? req.headers.range : undefined,
      media.sizeBytes,
    );

    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');

    if (range === undefined) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${media.sizeBytes}`);
      res.end();
      return;
    }

    if (range) {
      const body = media.bytes.subarray(range.start, range.end + 1);
      res.statusCode = 206;
      res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${media.sizeBytes}`);
      res.setHeader('Content-Length', body.byteLength);
      res.end(body);
      return;
    }

    res.setHeader('Content-Length', media.sizeBytes);
    res.end(media.bytes);
  }

  @Get(':id/download')
  async download(
    @Param('id') publicationId: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    this.sessions.require(req);
    const safeId = id.parse(publicationId);
    const media = await this.safe(() => this.manual.media(actor, safeId));
    res.setHeader('Content-Type', media.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', `attachment; filename="vision-tiktok-${safeId}.mp4"`);
    res.setHeader('Content-Length', media.sizeBytes);
    res.end(media.bytes);
  }

  @Post(':id/complete')
  complete(@Param('id') publicationId: string, @Body() body: unknown, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(async () => {
      const input = completionInput.parse(body);
      return this.manual.complete(
        actor,
        id.parse(publicationId),
        input.remoteUrl?.trim() || undefined,
      );
    });
  }
}
