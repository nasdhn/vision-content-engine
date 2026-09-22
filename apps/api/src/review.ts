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
import { RENDER_REJECTION_REASON_CODES, type RenderReviewService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const RENDER_REVIEW = Symbol('render-review-service');

const id = z.string().uuid();
const actor = { actorType: 'USER', actorId: 'local-creative-director' } as const;
const decisionInput = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reasonCode: z.enum(RENDER_REJECTION_REASON_CODES).optional(),
    comment: z.string().trim().max(1000).optional(),
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

@Controller('api/review')
export class RenderReviewController {
  constructor(
    @Inject(RENDER_REVIEW) private readonly review: RenderReviewService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        const conflicts = new Set([
          'INVALID_TRANSITION',
          'RENDER_OUTPUT_MISMATCH',
          'RENDER_NOT_REVIEWABLE',
        ]);
        throw new HttpException(error.code, conflicts.has(error.code) ? 409 : 422);
      }
      throw new HttpException('REVIEW_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get()
  queue(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.review.queue());
  }

  @Get(':id/media')
  async media(
    @Param('id') renderId: string,
    @Req() req: IncomingMessage,
    @Res() res: ServerResponse,
  ) {
    this.sessions.require(req);
    const media = await this.safe(() => this.review.media(actor, id.parse(renderId)));
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

  @Get(':id')
  detail(
    @Param('id') renderId: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.review.detail(id.parse(renderId)));
  }

  @Post(':id/decision')
  decide(@Param('id') renderId: string, @Body() body: unknown, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(async () => {
      const input = decisionInput.parse(body);
      return this.review.decide(actor, id.parse(renderId), {
        decision: input.decision,
        ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
        ...(input.comment !== undefined ? { comment: input.comment } : {}),
      });
    });
  }
}
