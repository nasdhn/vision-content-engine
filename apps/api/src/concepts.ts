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
import { CONCEPT_REJECTION_REASON_CODES, type ConceptReviewService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const CONCEPT_REVIEW = Symbol('concept-review-service');

const id = z.string().uuid();
const decisionInput = z
  .object({
    decision: z.enum(['APPROVED', 'REJECTED']),
    reasonCode: z.enum(CONCEPT_REJECTION_REASON_CODES).optional(),
    comment: z.string().trim().max(1000).optional(),
  })
  .strict();

@Controller('api/concepts')
export class ConceptReviewController {
  constructor(
    @Inject(CONCEPT_REVIEW) private readonly concepts: ConceptReviewService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        const conflicts = new Set([
          'STALE_VERSION',
          'INVALID_TRANSITION',
          'EXPLICIT_SELECTION_REQUIRED',
        ]);
        throw new HttpException(error.code, conflicts.has(error.code) ? 409 : 422);
      }
      throw new HttpException('CONCEPT_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get('review')
  queue(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.concepts.queue());
  }

  @Get(':id')
  detail(
    @Param('id') conceptVersionId: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.concepts.detail(id.parse(conceptVersionId)));
  }

  @Post(':id/decision')
  decide(
    @Param('id') conceptVersionId: string,
    @Body() body: unknown,
    @Req() req: IncomingMessage,
  ) {
    this.sessions.require(req, true);
    return this.safe(async () => {
      const input = decisionInput.parse(body);
      return this.concepts.decide(
        { actorType: 'USER', actorId: 'local-creative-director' },
        id.parse(conceptVersionId),
        {
          decision: input.decision,
          ...(input.reasonCode !== undefined ? { reasonCode: input.reasonCode } : {}),
          ...(input.comment !== undefined ? { comment: input.comment } : {}),
        },
      );
    });
  }
}
