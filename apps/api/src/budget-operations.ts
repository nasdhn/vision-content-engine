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
import type { InvocationBudgetReader, InvocationRepository } from '@vision/database';
import { z } from 'zod';
import { DomainError } from '@vision/domain';
import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const BUDGET_OPERATIONS = Symbol('budget-operations');
export type BudgetOperationsPort = Pick<InvocationBudgetReader, 'read'> &
  Pick<InvocationRepository, 'reconcileInterrupted'>;
const recoveryInput = z.object({ mode: z.enum(['SAFE_CLOSE', 'CONSERVATIVE_CLOSE']) }).strict();
const recoveryActor = { actorType: 'USER', actorId: 'local-budget-operator' } as const;
@Controller('api/operations/budgets')
export class BudgetOperationsController {
  constructor(
    @Inject(BUDGET_OPERATIONS) private readonly budgets: BudgetOperationsPort,
    @Inject(LOCAL_SESSION) private readonly sessions: LocalSessionService,
  ) {}
  @Get(':operationId')
  async read(
    @Param('operationId') id: string,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    this.sessions.require(req);
    if (!z.string().uuid().safeParse(id).success) throw new HttpException('INVALID_INPUT', 400);
    let result;
    try {
      result = await this.budgets.read(id);
    } catch {
      throw new HttpException('BUDGET_UNAVAILABLE', 503);
    }
    if (!result) throw new HttpException('BUDGET_NOT_FOUND', 404);
    return result;
  }
  @Post(':operationId/reconcile')
  async reconcile(
    @Param('operationId') id: string,
    @Body() body: unknown,
    @Req() req: IncomingMessage,
    @Res({ passthrough: true }) res: ServerResponse,
  ) {
    res.setHeader('Cache-Control', 'private, no-store');
    this.sessions.require(req, true);
    if (!z.string().uuid().safeParse(id).success) throw new HttpException('INVALID_INPUT', 400);
    const parsed = recoveryInput.safeParse(body);
    if (!parsed.success) throw new HttpException('INVALID_INPUT', 400);
    try {
      const result = await this.budgets.reconcileInterrupted(id, parsed.data.mode, recoveryActor);
      if (result.kind === 'RECONCILIATION_REQUIRED') {
        throw new HttpException('RECONCILIATION_REQUIRED', 409);
      }
      return result;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (error instanceof DomainError) {
        if (error.code === 'INVOCATION_NOT_FOUND') throw new HttpException(error.code, 404);
        if (
          [
            'AI_RECOVERY_STATE_CONFLICT',
            'AI_RECOVERY_MODE_CONFLICT',
            'BUDGET_LEDGER_INCOMPLETE',
            'BUDGET_POLICY_CONFLICT',
          ].includes(error.code)
        ) {
          throw new HttpException(error.code, 409);
        }
      }
      throw new HttpException('AI_RECOVERY_FAILED', 409);
    }
  }
}
