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
import type { LearningDashboardService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const LEARNING_DASHBOARD = Symbol('learning-dashboard-service');

const OperationKeySchema = z.string().regex(/^[a-f0-9]{64}$/);
const IdSchema = z.string().uuid();
const ProposalInputSchema = z.object({ campaignId: z.string().uuid().optional() }).strict();
const actor = { actorType: 'USER', actorId: 'local-learning-operator' } as const;

@Controller('api/learning')
export class LearningDashboardController {
  constructor(
    @Inject(LEARNING_DASHBOARD) private readonly learning: LearningDashboardService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);

      if (error instanceof DomainError) {
        if (error.code === 'RECOMMENDATION_NOT_FOUND' || error.code === 'CAMPAIGN_NOT_FOUND') {
          throw new HttpException(error.code, 404);
        }
        if (
          error.code === 'INVALID_RECOMMENDATION_TRANSITION' ||
          error.code === 'RECOMMENDATION_NOT_ACCEPTED' ||
          error.code === 'EXPERIMENT_PROPOSAL_CONFLICT'
        ) {
          throw new HttpException(error.code, 409);
        }
        throw new HttpException(error.code, 422);
      }

      if (error instanceof Error) {
        if (error.message === 'LEARNING_REPORT_NOT_FOUND') {
          throw new HttpException(error.message, 404);
        }
        if (
          error.message === 'LEARNING_REPORT_PROVENANCE_LIMIT_EXCEEDED' ||
          error.message === 'LEARNING_REPORT_JOB_NOT_FOUND' ||
          error.message === 'LEARNING_REPORT_FROZEN_WINDOW_NOT_FOUND'
        ) {
          throw new HttpException(error.message, 409);
        }
      }

      throw new HttpException('LEARNING_OPERATION_FAILED', 409);
    }
  }

  @Get()
  list(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.learning.list());
  }

  @Get(':key')
  detail(
    @Param('key') key: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    this.read(req, res);
    return this.safe(() => this.learning.detail(OperationKeySchema.parse(key)));
  }

  @Post('recommendations/:id/accept')
  accept(@Param('id') recommendationId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() =>
      this.learning.transitionRecommendation(actor, IdSchema.parse(recommendationId), 'ACCEPTED'),
    );
  }

  @Post('recommendations/:id/reject')
  reject(@Param('id') recommendationId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() =>
      this.learning.transitionRecommendation(actor, IdSchema.parse(recommendationId), 'REJECTED'),
    );
  }

  @Post('recommendations/:id/execute')
  execute(@Param('id') recommendationId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() =>
      this.learning.transitionRecommendation(actor, IdSchema.parse(recommendationId), 'EXECUTED'),
    );
  }

  @Post('recommendations/:id/create-experiment-proposal')
  createExperimentProposal(
    @Param('id') recommendationId: string,
    @Body() body: unknown,
    @Req() req: IncomingMessage,
  ) {
    this.sessions.require(req, true);
    return this.safe(() => {
      const input = ProposalInputSchema.parse(body);
      return this.learning.createExperimentProposal(
        actor,
        IdSchema.parse(recommendationId),
        input.campaignId,
      );
    });
  }
}
