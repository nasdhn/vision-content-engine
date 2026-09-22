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
import type { DistributionOperationsService } from '@vision/application';

import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const DISTRIBUTION_OPERATIONS = Symbol('distribution-operations-service');
const actor = { actorType: 'USER', actorId: 'local-distribution-operator' } as const;
const id = z.string().uuid();
const rescheduleInput = z.object({ scheduledAt: z.string().datetime() }).strict();

@Controller('api/distribution')
export class DistributionOperationsController {
  constructor(
    @Inject(DISTRIBUTION_OPERATIONS) private readonly operations: DistributionOperationsService,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}

  private async safe<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof z.ZodError) throw new HttpException('INVALID_INPUT', 400);
      if (error instanceof DomainError) {
        const notFound = new Set(['PLATFORM_ACCOUNT_NOT_FOUND']);
        const conflicts = new Set([
          'RECONCILIATION_REQUIRED',
          'PUBLICATION_RESCHEDULE_NOT_SAFE',
          'INVALID_PUBLICATION_TRANSITION',
          'PLATFORM_ACCOUNT_DISABLED',
          'REAL_PROVIDERS_DISABLED',
          'ACCOUNT_HEALTH_REFRESH_UNAVAILABLE',
          'PLATFORM_ACCOUNT_IDENTITY_MISMATCH',
        ]);
        throw new HttpException(
          error.code,
          notFound.has(error.code) ? 404 : conflicts.has(error.code) ? 409 : 422,
        );
      }
      throw new HttpException('DISTRIBUTION_OPERATION_FAILED', 409);
    }
  }

  private read(req: IncomingMessage, res: ServerResponse) {
    this.sessions.require(req);
    res.setHeader('Cache-Control', 'private, no-store');
  }

  @Get()
  overview(@Req() req: IncomingMessage, @Res({ passthrough: true }) res: ServerResponse) {
    this.read(req, res);
    return this.safe(() => this.operations.overview());
  }

  @Post(':id/reconcile')
  reconcile(@Param('id') publicationId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() => this.operations.requestReconciliation(actor, id.parse(publicationId)));
  }

  @Post(':id/reschedule')
  reschedule(
    @Param('id') publicationId: string,
    @Body() body: unknown,
    @Req() req: IncomingMessage,
  ) {
    this.sessions.require(req, true);
    return this.safe(() => {
      const input = rescheduleInput.parse(body);
      return this.operations.reschedule(
        actor,
        id.parse(publicationId),
        new Date(input.scheduledAt),
      );
    });
  }

  @Post(':id/cancel')
  cancel(@Param('id') publicationId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() => this.operations.cancel(actor, id.parse(publicationId)));
  }

  @Post('accounts/:id/refresh')
  refreshAccount(@Param('id') accountId: string, @Req() req: IncomingMessage) {
    this.sessions.require(req, true);
    return this.safe(() => this.operations.refreshAccount(actor, id.parse(accountId)));
  }
}
