import { invariant } from '@vision/domain';
import { contentHash } from '@vision/contracts/canonical';
import { Prisma, type PrismaClient } from './generated/prisma/client.js';
import { boundedModelPolicy, costAmount, invocationBudget } from './budgets.js';

const object = (value: Prisma.JsonValue | null) =>
  (value ?? {}) as Record<string, Prisma.JsonValue>;

/** Read-only projection of the existing invocation ledger; no parallel budget storage. */
export class InvocationBudgetReader {
  constructor(private readonly db: PrismaClient) {}
  async read(operationId: string) {
    return this.db.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET TRANSACTION READ ONLY`;
        await tx.$executeRaw`SET LOCAL statement_timeout = '1500ms'`;
        const invocation = await tx.modelInvocation.findUnique({
          where: { id: operationId },
          select: {
            id: true,
            status: true,
            policyJson: true,
            attemptCount: true,
            attempts: { select: { status: true, costAmount: true, validationJson: true } },
          },
        });
        if (!invocation) return null;
        const stored = object(invocation.policyJson);
        const { budget: rawBudget, ...rawPolicy } = stored;
        const policy = boundedModelPolicy(rawPolicy);
        const { budget, reserved: reservation } = invocationBudget(rawBudget);
        const validAmount = '^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,8})?$';
        const [scope] = await tx.$queryRaw<
          { reserved: string; consumed: string; calls: bigint; valid: boolean }[]
        >`
        WITH ledger AS (
          SELECT status, "attemptCount", "policyJson",
            CASE WHEN status = 'RUNNING' THEN
              CASE WHEN ("policyJson" #>> '{budget,reserved}') ~ ${validAmount}
                AND COALESCE("validationJson" ->> 'budgetConsumed', '0') ~ ${validAmount}
              THEN GREATEST(("policyJson" #>> '{budget,reserved}')::numeric,
                COALESCE("validationJson" ->> 'budgetConsumed', '0')::numeric)::text ELSE NULL END
              ELSE "validationJson" ->> 'budgetConsumed' END AS amount
          FROM "ModelInvocation"
          WHERE "policyJson" #>> '{budget,key}' = ${budget.key}
            AND "policyJson" #>> '{budget,from}' = ${budget.from}
            AND "policyJson" #>> '{budget,to}' = ${budget.to}
        )
        SELECT COALESCE(SUM(CASE WHEN status = 'RUNNING' AND amount ~ ${validAmount} THEN amount::numeric ELSE 0 END), 0)::text AS reserved,
          COALESCE(SUM(CASE WHEN status <> 'RUNNING' AND amount ~ ${validAmount} THEN amount::numeric ELSE 0 END), 0)::text AS consumed,
          COALESCE(SUM("attemptCount"), 0)::bigint AS calls,
          BOOL_AND(COALESCE(amount ~ ${validAmount}
            AND "policyJson" #>> '{budget,currency}' = ${budget.currency}
            AND "policyJson" #>> '{budget,limit}' = ${budget.limit}, false)) AS valid
        FROM ledger`;
        invariant(
          scope?.valid && scope.calls <= BigInt(Number.MAX_SAFE_INTEGER),
          'BUDGET_LEDGER_INCOMPLETE',
        );
        let accounted = new Prisma.Decimal(0);
        let reported = new Prisma.Decimal(0);
        let unknown = new Prisma.Decimal(0);
        let pending = new Prisma.Decimal(0);
        for (const attempt of invocation.attempts) {
          const metadata = object(attempt.validationJson);
          if (attempt.status === 'RUNNING')
            pending = pending.add(costAmount(metadata.reservedCost));
          else {
            const amount = costAmount(metadata.accountedCost);
            accounted = accounted.add(amount);
            if (attempt.costAmount === null) unknown = unknown.add(amount);
            else reported = reported.add(attempt.costAmount);
          }
        }
        const remaining = (limit: Prisma.Decimal, committed: Prisma.Decimal) =>
          Prisma.Decimal.max(0, limit.sub(committed)).toFixed(8);
        const committed = new Prisma.Decimal(scope.reserved).add(scope.consumed);
        return {
          currency: budget.currency,
          operation: {
            id: invocation.id,
            status: invocation.status,
            maxProviderCalls: policy.maxAttempts,
            providerCallsConsumed: invocation.attemptCount,
            providerCallsRemaining: Math.max(0, policy.maxAttempts - invocation.attemptCount),
            costLimit: new Prisma.Decimal(policy.maxEstimatedCost).toFixed(8),
            accountedCost: accounted.toFixed(8),
            reportedCost: reported.toFixed(8),
            unknownCostUpperBound: unknown.toFixed(8),
            pendingCallReserved: pending.toFixed(8),
            remainingCost: remaining(reservation, accounted.add(pending)),
          },
          scope: {
            id: contentHash({ key: budget.key, from: budget.from, to: budget.to }),
            from: budget.from,
            to: budget.to,
            limit: costAmount(budget.limit).toFixed(8),
            reserved: new Prisma.Decimal(scope.reserved).toFixed(8),
            consumed: new Prisma.Decimal(scope.consumed).toFixed(8),
            remaining: remaining(costAmount(budget.limit), committed),
            providerCallsConsumed: Number(scope.calls),
            exceeded: committed.gt(budget.limit),
          },
        };
      },
      { isolationLevel: 'RepeatableRead', maxWait: 2000, timeout: 3000 },
    );
  }
}
