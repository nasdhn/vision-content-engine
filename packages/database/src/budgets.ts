import type { z } from 'zod';
import { invariant } from '@vision/domain';
import { CostAmountSchema, ModelPolicySchema, RuntimeBudgetSchema } from '@vision/contracts';
import { Prisma } from './generated/prisma/client.js';

export type Budget = z.infer<typeof RuntimeBudgetSchema>;
export function parseBudget(value: unknown): Budget {
  invariant(value !== undefined && value !== null, 'BUDGET_REQUIRED');
  const parsed = RuntimeBudgetSchema.safeParse(value);
  invariant(parsed.success, 'INVALID_BUDGET');
  return parsed.data;
}
export function costAmount(value: unknown, code = 'INVALID_COST_AMOUNT') {
  const parsed = CostAmountSchema.safeParse(value);
  invariant(parsed.success, code);
  return new Prisma.Decimal(parsed.data);
}
export function boundedModelPolicy(value: unknown) {
  const parsed = ModelPolicySchema.safeParse(value);
  invariant(parsed.success, 'INVALID_MODEL_POLICY');
  const policy = parsed.data;
  invariant(
    policy.maxEstimatedCost !== undefined &&
      policy.maxInputTokens !== undefined &&
      policy.maxOutputTokens !== undefined,
    'BOUNDED_POLICY_REQUIRED',
  );
  return {
    ...policy,
    maxEstimatedCost: policy.maxEstimatedCost,
    maxInputTokens: policy.maxInputTokens,
    maxOutputTokens: policy.maxOutputTokens,
  };
}

export function invocationBudget(value: unknown) {
  invariant(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    'BUDGET_LEDGER_INCOMPLETE',
  );
  const { reserved, ...policy } = value as Record<string, unknown>;
  return {
    budget: parseBudget(policy),
    reserved: costAmount(reserved, 'BUDGET_LEDGER_INCOMPLETE'),
  };
}
