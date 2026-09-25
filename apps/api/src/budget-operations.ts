import { Controller, Get, HttpException, Inject, Param, Req, Res } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { InvocationBudgetReader } from '@vision/database';
import { z } from 'zod';
import { LOCAL_SESSION, type LocalSessionService } from './auth.js';

export const BUDGET_OPERATIONS = Symbol('budget-operations');
@Controller('api/operations/budgets')
export class BudgetOperationsController {
  constructor(
    @Inject(BUDGET_OPERATIONS) private readonly budgets: Pick<InvocationBudgetReader, 'read'>,
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
}
