import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  CostAmountSchema,
  ModelPolicySchema,
  RuntimeBudgetSchema,
} from '../../packages/contracts/src/index.js';
import { AIProviderGateway } from '../../packages/ai/src/index.js';
import { InvocationRepository, parseBudget } from '../../packages/database/src/index.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { FakeAIProvider } from '../support/ai-provider.js';

const budget = {
  key: 'synthetic',
  from: '2020-01-01T00:00:00Z',
  to: '2100-01-01T00:00:00Z',
  limit: '3',
  currency: 'EUR',
};
const policy = {
  capability: 'CREATOR' as const,
  maxAttempts: 2,
  timeoutMs: 1000,
  fallbackPolicy: 'NONE' as const,
  maxInputTokens: 100000,
  maxOutputTokens: 100,
  maxEstimatedCost: 3,
};

it.each(['-1', 'NaN', 'Infinity', '1e9', '10000000000', '0.000000001', '', '1.2.3'])(
  'rejects invalid/unrepresentable amount %s',
  (value) => {
    expect(CostAmountSchema.safeParse(value).success).toBe(false);
    expect(() => parseBudget({ ...budget, limit: value })).toThrow('INVALID_BUDGET');
  },
);
it('accepts explicit zero and exact decimal(18,8) bounds without implicit currency conversion', () => {
  expect(RuntimeBudgetSchema.parse({ ...budget, limit: '0', currency: 'USD' }).currency).toBe(
    'USD',
  );
  expect(CostAmountSchema.parse('9999999999.99999999')).toBe('9999999999.99999999');
  expect(
    ModelPolicySchema.parse({ ...policy, maxEstimatedCost: 0.00000001 }).maxEstimatedCost,
  ).toBe(0.00000001);
  expect(RuntimeBudgetSchema.safeParse({ ...budget, to: budget.from }).success).toBe(false);
});
it.each([0, -1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 2_147_483_648])(
  'rejects invalid or overflowing provider-call count %s',
  (value) => {
    expect(ModelPolicySchema.safeParse({ ...policy, maxAttempts: value }).success).toBe(false);
  },
);
it.each([-1, NaN, Infinity, 0.000000001, Number.MAX_SAFE_INTEGER])(
  'rejects unsafe numeric ceiling %s',
  (value) => {
    expect(ModelPolicySchema.safeParse({ ...policy, maxEstimatedCost: value }).success).toBe(false);
  },
);
it('rejects overflowing timer/token dimensions independently of cost', () => {
  for (const key of ['timeoutMs', 'maxInputTokens', 'maxOutputTokens'])
    expect(ModelPolicySchema.safeParse({ ...policy, [key]: 2_147_483_648 }).success).toBe(false);
});
it('denies missing budgets before persistence or provider execution and logs no raw data', async () => {
  const lines: string[] = [];
  const begin = vi.fn();
  const provider = new FakeAIProvider(async () => ({ body: '{}' }));
  const gateway = new AIProviderGateway(
    { begin } as unknown as InvocationRepository,
    [provider],
    () => false,
    new StructuredLogger('worker-ai', (line) => lines.push(line)),
  );
  await expect(
    gateway.generateStructured(
      { requestId: randomUUID() } as never,
      { input: z.object({}), output: z.object({}), validate() {} },
      policy,
      undefined as never,
    ),
  ).rejects.toThrow('BUDGET_REQUIRED');
  expect(begin).not.toHaveBeenCalled();
  expect(provider.calls).toHaveLength(0);
  expect(lines.map((line) => JSON.parse(line))).toContainEqual(
    expect.objectContaining({
      event: 'budget.denied',
      error: { name: 'Error', errorCode: 'BUDGET_REQUIRED' },
    }),
  );
});
it('validates direct repository attempt estimates before touching the database', async () => {
  const transaction = vi.fn();
  const repository = new InvocationRepository({ $transaction: transaction } as never);
  for (const estimate of ['-1', 'Infinity', '10000000000'])
    await expect(
      repository.startAttempt(randomUUID(), {
        provider: 'deterministic-fixture',
        model: 'fixture',
        requestHash: 'a'.repeat(64),
        estimate,
      }),
    ).rejects.toThrow('INVALID_COST_AMOUNT');
  expect(transaction).not.toHaveBeenCalled();
});

it('rejects token policies whose bounded attempts could overflow persisted aggregates', () => {
  expect(
    ModelPolicySchema.safeParse({ ...policy, maxInputTokens: 2_147_483_647, maxAttempts: 2 })
      .success,
  ).toBe(false);
});
