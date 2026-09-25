import { RUNTIME_INTEGER_MAX } from '@vision/contracts';
import { invariant } from '@vision/domain';
import { assertNoSecrets, contentHash } from '@vision/contracts/canonical';
import { Prisma } from './generated/prisma/client.js';
import type { PrismaClient } from './generated/prisma/client.js';
import { databaseTime, changed } from './transaction.js';
import { UnitOfWork } from './persistence.js';
import { Knowledge } from './knowledge.js';

import {
  boundedModelPolicy,
  costAmount,
  parseBudget,
  invocationBudget,
  type Budget,
} from './budgets.js';
export type { Budget } from './budgets.js';
export type InvocationStart = {
  knowledgeContext: unknown;
  id: string;
  purpose: string;
  capability: string;
  promptKey: string;
  promptVersion: string;
  promptContentHash: string;
  knowledgeSnapshotId: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  inputHash: string;
  policy: Prisma.InputJsonObject;
  budget: Budget;
  reservation: string;
  requestedProvider?: string;
  requestedModel?: string;
  reasoningLevel?: string;
};
export const MODEL_INVOCATION_OUTPUT_CHECKPOINTED_ACTION =
  'ModelInvocation.output_checkpointed' as const;

export type InvocationSuccessCheckpoint = Readonly<{
  output: unknown;
  metadata: unknown;
}>;

export type AttemptResult = {
  status: 'SUCCEEDED' | 'FAILED' | 'REJECTED_SCHEMA';
  responseHash?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  costAmount?: string;
  costCurrency: string;
  accountedCost: string;
  failureCode?: string;
  validation: Prisma.InputJsonObject;
};
const actor = { actorType: 'SYSTEM', actorId: 'ai-gateway' } as const;
const asInputJson = (value: unknown): Prisma.InputJsonValue => {
  assertNoSecrets(value);
  contentHash(value);
  return value as Prisma.InputJsonValue;
};
const jsonObject = (value: Prisma.JsonValue | null) =>
  (value ?? {}) as Record<string, Prisma.JsonValue>;

function policyWithoutBudget(policy: Record<string, Prisma.JsonValue>) {
  const { budget: _budget, ...rest } = policy;
  void _budget;
  return rest;
}

/** Short DB transactions only. No provider call runs inside a database transaction. */
export class InvocationRepository {
  constructor(private readonly db: PrismaClient) {}
  async begin(input: InvocationStart) {
    assertNoSecrets(input);
    parseBudget(input.budget);
    const checkedPolicy = boundedModelPolicy(input.policy);
    const checkedReservation = costAmount(input.reservation);
    invariant(checkedReservation.eq(checkedPolicy.maxEstimatedCost), 'BUDGET_RESERVATION_MISMATCH');
    return this.db.$transaction(async (tx) => {
      const { budget, reservation, policy, capability, knowledgeContext, ...data } = input;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-budget:${budget.key}`}, 0))`;
      const now = await databaseTime(tx);
      invariant(new Date(budget.from) <= now && now < new Date(budget.to), 'BUDGET_WINDOW_CLOSED');
      invariant(
        !(await tx.modelInvocation.findUnique({ where: { id: input.id } })),
        'INVOCATION_ALREADY_EXISTS',
      );
      const knowledge = await tx.knowledgeSnapshot.findUniqueOrThrow({
        where: { id: input.knowledgeSnapshotId },
      });
      invariant(
        knowledge.effectiveAt <= now &&
          knowledge.status !== 'DRAFT' &&
          knowledge.status !== 'ARCHIVED',
        'KNOWLEDGE_NOT_EFFECTIVE',
      );
      invariant(
        contentHash(knowledge.payloadJson) === knowledge.contentHash,
        'KNOWLEDGE_HASH_MISMATCH',
      );
      invariant(
        contentHash(await new Knowledge(tx, actor).snapshot(knowledge.id)) ===
          contentHash(knowledgeContext),
        'KNOWLEDGE_CONTEXT_MISMATCH',
      );
      const rows = await tx.modelInvocation.findMany({
        where: { policyJson: { path: ['budget', 'key'], equals: budget.key } },
      });
      let consumed = new Prisma.Decimal(0);
      for (const row of rows) {
        const old = jsonObject(jsonObject(row.policyJson).budget ?? null);
        if (old.to === budget.to && old.from === budget.from) {
          invariant(
            old.currency === budget.currency && old.limit === budget.limit,
            'BUDGET_POLICY_CONFLICT',
          );
          const finalizedCost = jsonObject(row.validationJson).budgetConsumed;
          const cost =
            row.status === 'RUNNING'
              ? Prisma.Decimal.max(
                  costAmount(old.reserved, 'BUDGET_LEDGER_INCOMPLETE'),
                  finalizedCost === undefined
                    ? 0
                    : costAmount(finalizedCost, 'BUDGET_LEDGER_INCOMPLETE'),
                )
              : costAmount(finalizedCost, 'BUDGET_LEDGER_INCOMPLETE');
          consumed = consumed.add(cost);
        } else {
          invariant(
            !(
              new Date(String(old.from)) < new Date(budget.to) &&
              new Date(String(old.to)) > new Date(budget.from)
            ),
            'BUDGET_WINDOW_OVERLAP',
          );
        }
      }
      invariant(consumed.add(reservation).lte(budget.limit), 'COST_BUDGET_BLOCK');
      const row = await tx.modelInvocation.create({
        data: {
          ...data,
          startedAt: now,
          policyJson: { ...policy, capability, budget: { ...budget, reserved: reservation } },
        },
      });
      await changed(tx, actor, 'ModelInvocation.started', 'ModelInvocation', row.id);
      return row;
    });
  }
  async startAttempt(
    id: string,
    data: {
      provider: string;
      model: string;
      requestHash: string;
      reasoningLevel?: string;
      estimate: string;
    },
  ) {
    assertNoSecrets(data);
    costAmount(data.estimate);
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ModelInvocation" WHERE id = ${id}::uuid FOR UPDATE`;
      const invocation = await tx.modelInvocation.findUniqueOrThrow({ where: { id } });
      invariant(invocation.status === 'RUNNING', 'INVOCATION_TERMINAL');
      const policy = jsonObject(invocation.policyJson);
      const checkedPolicy = boundedModelPolicy(policyWithoutBudget(policy));
      const { budget } = invocationBudget(policy.budget);
      const now = await databaseTime(tx);
      invariant(new Date(budget.from) <= now && now < new Date(budget.to), 'BUDGET_WINDOW_CLOSED');
      invariant(invocation.attemptCount < checkedPolicy.maxAttempts, 'ATTEMPTS_EXHAUSTED');
      const attempts = await tx.modelInvocationAttempt.findMany({
        where: { modelInvocationId: id },
        orderBy: { attemptNumber: 'asc' },
      });
      invariant(!attempts.some((a) => a.status === 'RUNNING'), 'ATTEMPT_ALREADY_RUNNING');
      const spent = attempts.reduce(
        (n, a) =>
          n.add(costAmount(jsonObject(a.validationJson).accountedCost, 'BUDGET_LEDGER_INCOMPLETE')),
        new Prisma.Decimal(0),
      );
      invariant(
        spent
          .add(data.estimate)
          .lte(costAmount(jsonObject(policy.budget ?? null).reserved, 'BUDGET_LEDGER_INCOMPLETE')),
        'COST_BUDGET_BLOCK',
      );
      const { estimate, ...fields } = data;
      const attempt = await tx.modelInvocationAttempt.create({
        data: {
          ...fields,
          modelInvocationId: id,
          attemptNumber: invocation.attemptCount + 1,
          startedAt: await databaseTime(tx),
          validationJson: { reservedCost: estimate },
        },
      });
      await tx.modelInvocation.update({ where: { id }, data: { attemptCount: { increment: 1 } } });
      return attempt;
    });
  }
  async finishAttempt(id: string, result: AttemptResult) {
    assertNoSecrets(result);
    costAmount(result.accountedCost);
    invariant(
      ['SUCCEEDED', 'FAILED', 'REJECTED_SCHEMA'].includes(result.status),
      'INVALID_ATTEMPT_RESULT',
    );
    for (const count of [result.inputTokens, result.outputTokens, result.cachedInputTokens]) {
      invariant(
        count === undefined ||
          (Number.isSafeInteger(count) && count >= 0 && count <= RUNTIME_INTEGER_MAX),
        'INVALID_USAGE',
      );
    }
    if (result.costAmount !== undefined) {
      invariant(costAmount(result.costAmount).eq(result.accountedCost), 'COST_ACCOUNTING_MISMATCH');
    }
    const finalizationHash = contentHash(result);
    return this.db.$transaction(async (tx) => {
      const owner = await tx.modelInvocationAttempt.findUniqueOrThrow({
        where: { id },
        select: { modelInvocationId: true },
      });
      // Same lock order as invocation completion/authorization. Publish accounting atomically.
      await tx.$queryRaw`SELECT id FROM "ModelInvocation" WHERE id = ${owner.modelInvocationId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "ModelInvocationAttempt" WHERE id = ${id}::uuid FOR UPDATE`;
      const attempt = await tx.modelInvocationAttempt.findUniqueOrThrow({ where: { id } });
      if (attempt.status !== 'RUNNING') {
        invariant(
          jsonObject(attempt.validationJson).finalizationHash === finalizationHash,
          'ATTEMPT_FINALIZATION_CONFLICT',
        );
        return attempt;
      }
      const invocation = await tx.modelInvocation.findUniqueOrThrow({
        where: { id: attempt.modelInvocationId },
      });
      const { budget } = invocationBudget(jsonObject(invocation.policyJson).budget);
      invariant(result.costCurrency === budget.currency, 'USAGE_CURRENCY_MISMATCH');
      const reservedCost = jsonObject(attempt.validationJson).reservedCost;
      if (result.costAmount === undefined)
        invariant(
          costAmount(result.accountedCost).gte(costAmount(reservedCost)),
          'COST_ACCOUNTING_UNDERSTATED',
        );
      const now = await databaseTime(tx);
      const { validation, accountedCost, ...data } = result;
      const row = await tx.modelInvocationAttempt.update({
        where: { id },
        data: {
          ...data,
          finishedAt: now,
          latencyMs: Math.max(0, now.getTime() - attempt.startedAt.getTime()),
          validationJson: {
            ...validation,
            accountedCost,
            reservedCost: String(reservedCost),
            finalizationHash,
          },
        },
      });
      const finalized = await tx.modelInvocationAttempt.findMany({
        where: { modelInvocationId: attempt.modelInvocationId, status: { not: 'RUNNING' } },
        select: { validationJson: true },
      });
      const consumed = finalized.reduce(
        (sum, item) => sum.add(costAmount(jsonObject(item.validationJson).accountedCost)),
        new Prisma.Decimal(0),
      );
      await tx.modelInvocation.update({
        where: { id: attempt.modelInvocationId },
        data: {
          validationJson: {
            ...jsonObject(invocation.validationJson),
            budgetConsumed: consumed.toFixed(8),
          },
        },
      });
      if (result.costAmount !== undefined)
        await new UnitOfWork(tx, actor).recordCost({
          category: 'AI',
          provider: attempt.provider,
          amount: result.costAmount,
          currency: result.costCurrency,
          modelInvocationId: attempt.modelInvocationId,
          occurredAt: now,
          metadataJson: { attemptId: id },
        });
      return row;
    });
  }
  async finish(
    id: string,
    status: 'SUCCEEDED' | 'FAILED' | 'REJECTED_SCHEMA',
    outputHash?: string,
    failureCode?: string,
    checkpoint?: InvocationSuccessCheckpoint,
  ) {
    const finalizationHash = contentHash({
      status,
      outputHash: outputHash ?? null,
      failureCode: failureCode ?? null,
      checkpoint: checkpoint ?? null,
    });
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ModelInvocation" WHERE id = ${id}::uuid FOR UPDATE`;
      const invocation = await tx.modelInvocation.findUniqueOrThrow({ where: { id } });
      if (invocation.status !== 'RUNNING') {
        invariant(
          jsonObject(invocation.validationJson).finalizationHash === finalizationHash,
          'INVOCATION_FINALIZATION_CONFLICT',
        );
        return invocation;
      }
      const attempts = await tx.modelInvocationAttempt.findMany({
        where: { modelInvocationId: id },
        orderBy: { attemptNumber: 'asc' },
      });
      invariant(!attempts.some((a) => a.status === 'RUNNING'), 'ATTEMPT_STILL_RUNNING');
      const now = await databaseTime(tx);
      const sum = (field: 'inputTokens' | 'outputTokens' | 'cachedInputTokens') =>
        attempts.length && attempts.every((a) => a[field] !== null)
          ? attempts.reduce((n, a) => n + a[field]!, 0)
          : null;
      const known = attempts.length && attempts.every((a) => a.costAmount !== null);
      const amount = known
        ? attempts.reduce((n, a) => n.add(a.costAmount!), new Prisma.Decimal(0))
        : null;
      const consumed = attempts
        .reduce(
          (n, a) => n.add(String(jsonObject(a.validationJson).accountedCost)),
          new Prisma.Decimal(0),
        )
        .toFixed(8);
      const row = await tx.modelInvocation.update({
        where: { id },
        data: {
          status,
          ...(outputHash ? { outputHash } : {}),
          ...(failureCode ? { failureCode } : {}),
          finishedAt: now,
          latencyMs: Math.max(0, now.getTime() - invocation.startedAt.getTime()),
          inputTokens: sum('inputTokens'),
          outputTokens: sum('outputTokens'),
          cachedInputTokens: sum('cachedInputTokens'),
          costAmount: amount,
          costCurrency: amount ? attempts[0]!.costCurrency : null,
          validationJson: {
            schema:
              status === 'SUCCEEDED'
                ? 'PASS'
                : (jsonObject(attempts.at(-1)?.validationJson ?? null).schema ?? 'NOT_RUN'),
            references: status === 'SUCCEEDED' ? 'PASS' : 'NOT_PASSED',
            businessRules: status === 'SUCCEEDED' ? 'PASS' : 'NOT_PASSED',
            claims: status === 'SUCCEEDED' ? 'PASS' : 'NOT_PASSED',
            budgetConsumed: consumed,
            finalizationHash,
          },
        },
      });
      if (checkpoint !== undefined) {
        invariant(status === 'SUCCEEDED' && outputHash, 'CHECKPOINT_REQUIRES_SUCCESS');
        invariant(contentHash(checkpoint.output) === outputHash, 'CHECKPOINT_OUTPUT_HASH_MISMATCH');
        const metadataHash = contentHash(checkpoint.metadata);
        await tx.auditEvent.create({
          data: {
            ...actor,
            action: MODEL_INVOCATION_OUTPUT_CHECKPOINTED_ACTION,
            subjectType: 'ModelInvocation',
            subjectId: id,
            afterJson: asInputJson({
              outputHash,
              output: checkpoint.output,
              metadata: checkpoint.metadata,
              metadataHash,
            }),
          },
        });
      }
      await changed(tx, actor, `ModelInvocation.${status.toLowerCase()}`, 'ModelInvocation', id);
      return row;
    });
  }
}
