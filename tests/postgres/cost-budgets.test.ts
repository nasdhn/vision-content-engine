import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { postgresFixture } from '../../packages/database/test/support.js';
import {
  createDatabaseClient,
  InvocationRepository,
  InvocationBudgetReader,
  type Budget,
} from '../../packages/database/src/index.js';
import {
  AIProviderGateway,
  ProviderFailure,
  type ModelPolicy,
} from '../../packages/ai/src/index.js';
import { getPrompt } from '../../packages/ai/src/prompts.js';
import { contentHash } from '../../packages/contracts/src/canonical.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { FakeAIProvider } from '../support/ai-provider.js';
import knowledgeFixture from '../fixtures/phase2/knowledge.json' with { type: 'json' };

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let second: ReturnType<typeof createDatabaseClient>;
beforeAll(async () => {
  fixture = await postgresFixture();
  second = createDatabaseClient(fixture.url);
});
afterAll(async () => {
  await second?.$disconnect();
  await fixture?.close();
});
const quiet = new StructuredLogger('worker-ai', () => {});
const policy: ModelPolicy = {
  capability: 'CREATOR',
  maxAttempts: 2,
  timeoutMs: 1000,
  fallbackPolicy: 'NONE',
  maxInputTokens: 100000,
  maxOutputTokens: 100,
  maxEstimatedCost: 3,
};
const contracts = {
  input: z.object({}),
  output: z.object({ result: z.literal('OK') }),
  validate() {},
};
const success = (cost = '1') => ({
  body: '{"result":"OK"}',
  usage: { costAmount: cost, currency: 'EUR' },
});

async function setup(overrides: Partial<ModelPolicy> = {}, limit = '3') {
  const {
    id: _id,
    key: _key,
    version: _version,
    contentHash: _hash,
    effectiveAt: _at,
    ...payload
  } = knowledgeFixture;
  void [_id, _key, _version, _hash, _at];
  const knowledge = await fixture.client.knowledgeSnapshot.create({
    data: {
      key: randomUUID(),
      version: 1,
      status: 'ACTIVE',
      effectiveAt: new Date('2020-01-01T00:00:00Z'),
      contentHash: contentHash(payload),
      payloadJson: payload,
    },
  });
  const context = {
    ...payload,
    id: knowledge.id,
    key: knowledge.key,
    version: 1,
    contentHash: knowledge.contentHash,
    effectiveAt: knowledge.effectiveAt.toISOString(),
  };
  const request = {
    requestId: randomUUID(),
    capability: 'CREATOR' as const,
    purpose: 'synthetic-budget-check',
    prompt: { key: 'creator', version: '1.0.0' },
    knowledgeSnapshot: { id: knowledge.id, version: 1, contentHash: knowledge.contentHash },
    knowledgeContext: context,
    input: {},
  };
  const budget: Budget = {
    key: randomUUID(),
    from: '2020-01-01T00:00:00Z',
    to: '2100-01-01T00:00:00Z',
    limit,
    currency: 'EUR',
  };
  const p = { ...policy, ...overrides };
  const repo = new InvocationRepository(fixture.client);
  const gateway = (provider: FakeAIProvider, repository = repo) =>
    new AIProviderGateway(repository, [provider], () => false, quiet);
  const begin = async (repository = repo, id = request.requestId) => {
    const prompt = getPrompt('creator', '1.0.0');
    return repository.begin({
      id,
      purpose: request.purpose,
      capability: 'CREATOR',
      promptKey: prompt.key,
      promptVersion: prompt.version,
      promptContentHash: prompt.contentHash,
      knowledgeSnapshotId: knowledge.id,
      knowledgeContext: context,
      inputSchemaVersion: prompt.schemaVersion,
      outputSchemaVersion: prompt.schemaVersion,
      inputHash: contentHash(request),
      policy: p,
      budget,
      reservation: String(p.maxEstimatedCost),
    });
  };
  return { request, budget, policy: p, repo, gateway, begin };
}

it.each([
  { ceiling: 1, allowed: true },
  { ceiling: 2, allowed: true },
  { ceiling: 0, allowed: false },
])('checks the requested unit below/at/above capacity: $ceiling', async ({ ceiling, allowed }) => {
  const b = await setup({ maxEstimatedCost: ceiling }, String(ceiling));
  const provider = new FakeAIProvider(async () => success(), 'fixture', '1');
  const call = b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget);
  if (allowed) await expect(call).resolves.toHaveProperty('output');
  else await expect(call).rejects.toThrow('COST_BUDGET_BLOCK');
  expect(provider.calls).toHaveLength(allowed ? 1 : 0);
});

it('bounds provider attempts, retains unknown costs, and refuses redelivery without charging twice', async () => {
  const b = await setup({ maxEstimatedCost: 3, maxAttempts: 2 });
  const provider = new FakeAIProvider(
    async () => {
      throw new ProviderFailure('NETWORK');
    },
    'fixture',
    '1',
  );
  const run = () =>
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget);
  await expect(run()).rejects.toThrow('NETWORK');
  await expect(run()).rejects.toThrow('INVOCATION_ALREADY_EXISTS');
  expect(provider.calls).toHaveLength(2);
  const health = await new InvocationBudgetReader(fixture.client).read(b.request.requestId);
  expect(JSON.stringify(health)).not.toContain(b.budget.key);
  expect(health).toMatchObject({
    operation: {
      maxProviderCalls: 2,
      providerCallsConsumed: 2,
      providerCallsRemaining: 0,
      accountedCost: '2.00000000',
      unknownCostUpperBound: '2.00000000',
      reportedCost: '0.00000000',
    },
    scope: { consumed: '2.00000000', reserved: '0.00000000', remaining: '1.00000000' },
  });
  expect(
    await fixture.client.costEntry.count({ where: { modelInvocationId: b.request.requestId } }),
  ).toBe(0);
});

it('charges hard validation failures, but no provider call or cost for pre-call validation failure', async () => {
  const b = await setup();
  const provider = new FakeAIProvider(async () => success(), 'fixture', '1');
  await expect(
    b
      .gateway(provider)
      .generateStructured(
        { ...b.request, input: { extra: true } as unknown as Record<string, never> },
        { ...contracts, input: z.object({}).strict() },
        b.policy,
        b.budget,
      ),
  ).rejects.toThrow();
  expect(provider.calls).toHaveLength(0);
  expect(
    await fixture.client.modelInvocation.findUnique({ where: { id: b.request.requestId } }),
  ).toBeNull();
  await expect(
    b.gateway(provider).generateStructured(
      b.request,
      {
        ...contracts,
        validate() {
          throw new Error('HARD_VALIDATION_FAILED');
        },
      },
      b.policy,
      b.budget,
    ),
  ).rejects.toThrow('HARD_VALIDATION_FAILED');
  expect(provider.calls).toHaveLength(1);
  expect(
    (await new InvocationBudgetReader(fixture.client).read(b.request.requestId))?.scope.consumed,
  ).toBe('1.00000000');
});

it('serializes competing shared reservations with exactly one remaining unit', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  const other = new InvocationRepository(second);
  const results = await Promise.allSettled([b.begin(), b.begin(other, randomUUID())]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  const denied = results.find((result) => result.status === 'rejected');
  expect(denied && denied.status === 'rejected' && String(denied.reason)).toContain(
    'COST_BUDGET_BLOCK',
  );
});

it('serializes one remaining provider authorization and keeps crash reservations conservative', async () => {
  const b = await setup({ maxAttempts: 1, maxEstimatedCost: 1 }, '1');
  await b.begin();
  const data = {
    provider: 'deterministic-fixture',
    model: 'fixture',
    requestHash: 'a'.repeat(64),
    estimate: '1',
  };
  const results = await Promise.allSettled([
    b.repo.startAttempt(b.request.requestId, data),
    new InvocationRepository(second).startAttempt(b.request.requestId, data),
  ]);
  expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
  const provider = new FakeAIProvider(async () => success(), 'fixture', '1');
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('INVOCATION_ALREADY_EXISTS');
  expect(provider.calls).toHaveLength(0);
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: { status: 'RUNNING', providerCallsConsumed: 1, pendingCallReserved: '1.00000000' },
    scope: { reserved: '1.00000000', remaining: '0.00000000' },
  });
});

it('safely closes an interrupted invocation before any provider attempt was authorized', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  const actor = { actorType: 'USER', actorId: 'budget-recovery-test' } as const;
  await b.begin();
  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'SAFE_CLOSE', {
      actorType: 'SYSTEM',
      actorId: 'automatic-recovery',
    }),
  ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: {
      status: 'RUNNING',
      recovery: { state: 'NO_PROVIDER_ATTEMPT', allowedModes: ['SAFE_CLOSE'] },
    },
    scope: { reserved: '1.00000000', consumed: '0.00000000', remaining: '0.00000000' },
  });
  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'CONSERVATIVE_CLOSE', actor),
  ).rejects.toThrow('AI_RECOVERY_MODE_CONFLICT');

  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'SAFE_CLOSE', actor),
  ).resolves.toMatchObject({
    kind: 'CLOSED',
    status: 'FAILED',
    failureCode: 'AI_RECOVERY_NO_PROVIDER_ATTEMPT',
    budgetConsumed: '0.00000000',
  });
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: { status: 'FAILED', recovery: { state: 'NOT_REQUIRED' } },
    scope: { reserved: '0.00000000', consumed: '0.00000000', remaining: '1.00000000' },
  });
  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'SAFE_CLOSE', actor),
  ).resolves.toMatchObject({ kind: 'ALREADY_TERMINAL', status: 'FAILED' });
  expect(
    await fixture.client.auditEvent.count({
      where: { subjectId: b.request.requestId, action: 'ModelInvocation.recovered' },
    }),
  ).toBe(1);
});

it('requires explicit conservative close for an ambiguous running provider attempt', async () => {
  const b = await setup({ maxAttempts: 2, maxEstimatedCost: 2 }, '2');
  const actor = { actorType: 'USER', actorId: 'budget-recovery-test' } as const;
  await b.begin();
  const attempt = await b.repo.startAttempt(b.request.requestId, {
    provider: 'deterministic-fixture',
    model: 'fixture',
    requestHash: 'a'.repeat(64),
    estimate: '1',
  });
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: {
      status: 'RUNNING',
      pendingCallReserved: '1.00000000',
      recovery: {
        state: 'AMBIGUOUS_PROVIDER_OUTCOME',
        allowedModes: ['CONSERVATIVE_CLOSE'],
        runningAttemptId: attempt.id,
      },
    },
    scope: { reserved: '2.00000000', consumed: '0.00000000' },
  });

  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'SAFE_CLOSE', actor),
  ).resolves.toMatchObject({
    kind: 'RECONCILIATION_REQUIRED',
    reason: 'RUNNING_PROVIDER_ATTEMPT',
    runningAttemptId: attempt.id,
  });
  expect(
    await fixture.client.modelInvocationAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
  ).toMatchObject({ status: 'RUNNING', costAmount: null, costCurrency: null });

  await expect(
    new InvocationRepository(second).reconcileInterrupted(
      b.request.requestId,
      'CONSERVATIVE_CLOSE',
      actor,
    ),
  ).resolves.toMatchObject({
    kind: 'CLOSED',
    status: 'FAILED',
    failureCode: 'AI_RECOVERY_PROVIDER_OUTCOME_UNKNOWN',
    budgetConsumed: '1.00000000',
    conservativelyClosedAttemptId: attempt.id,
  });
  expect(
    await fixture.client.modelInvocationAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
  ).toMatchObject({
    status: 'FAILED',
    costAmount: null,
    costCurrency: 'EUR',
    failureCode: 'AI_PROVIDER_OUTCOME_UNKNOWN',
    validationJson: {
      accountedCost: '1.00000000',
      reservedCost: '1.00000000',
      recovery: 'CONSERVATIVE_CLOSE',
    },
  });
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: {
      status: 'FAILED',
      pendingCallReserved: '0.00000000',
      unknownCostUpperBound: '1.00000000',
      recovery: { state: 'NOT_REQUIRED' },
    },
    scope: { reserved: '0.00000000', consumed: '1.00000000', remaining: '1.00000000' },
  });
  expect(
    await fixture.client.costEntry.count({ where: { modelInvocationId: b.request.requestId } }),
  ).toBe(0);
  await expect(
    b.repo.finishAttempt(attempt.id, {
      status: 'SUCCEEDED',
      costCurrency: 'EUR',
      costAmount: '1',
      accountedCost: '1',
      validation: { schema: 'PASS' },
    }),
  ).rejects.toThrow('ATTEMPT_FINALIZATION_CONFLICT');
});

it('closes a crash after durable attempt accounting without losing known cost', async () => {
  const b = await setup({ maxEstimatedCost: 2 }, '2');
  const actor = { actorType: 'USER', actorId: 'budget-recovery-test' } as const;
  await b.begin();
  const attempt = await b.repo.startAttempt(b.request.requestId, {
    provider: 'deterministic-fixture',
    model: 'fixture',
    requestHash: 'a'.repeat(64),
    estimate: '1',
  });
  await b.repo.finishAttempt(attempt.id, {
    status: 'SUCCEEDED',
    costCurrency: 'EUR',
    costAmount: '1',
    accountedCost: '1',
    validation: { schema: 'PASS' },
  });
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: {
      status: 'RUNNING',
      accountedCost: '1.00000000',
      recovery: { state: 'OUTPUT_UNAVAILABLE', allowedModes: ['SAFE_CLOSE'] },
    },
    scope: { reserved: '2.00000000', consumed: '0.00000000', remaining: '0.00000000' },
  });
  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'CONSERVATIVE_CLOSE', actor),
  ).rejects.toThrow('AI_RECOVERY_MODE_CONFLICT');

  await expect(
    b.repo.reconcileInterrupted(b.request.requestId, 'SAFE_CLOSE', actor),
  ).resolves.toMatchObject({
    kind: 'CLOSED',
    status: 'FAILED',
    failureCode: 'AI_RECOVERY_TERMINAL_ATTEMPTS',
    budgetConsumed: '1.00000000',
  });
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: {
      status: 'FAILED',
      accountedCost: '1.00000000',
      reportedCost: '1.00000000',
      unknownCostUpperBound: '0.00000000',
      recovery: { state: 'NOT_REQUIRED' },
    },
    scope: { reserved: '0.00000000', consumed: '1.00000000', remaining: '1.00000000' },
  });
});

it('makes matching finalization replay idempotent and rejects conflicting refunds', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  await b.begin();
  const attempt = await b.repo.startAttempt(b.request.requestId, {
    provider: 'deterministic-fixture',
    model: 'fixture',
    requestHash: 'a'.repeat(64),
    estimate: '1',
  });
  const result = {
    status: 'FAILED' as const,
    costCurrency: 'EUR',
    costAmount: '1',
    accountedCost: '1',
    validation: {},
    failureCode: 'PERMANENT',
  };
  await Promise.all([
    b.repo.finishAttempt(attempt.id, result),
    new InvocationRepository(second).finishAttempt(attempt.id, result),
  ]);
  await expect(
    b.repo.finishAttempt(attempt.id, { ...result, costAmount: '0', accountedCost: '0' }),
  ).rejects.toThrow('ATTEMPT_FINALIZATION_CONFLICT');
  await b.repo.finish(b.request.requestId, 'FAILED', undefined, 'PERMANENT');
  await b.repo.finish(b.request.requestId, 'FAILED', undefined, 'PERMANENT');
  expect(
    await fixture.client.costEntry.count({ where: { modelInvocationId: b.request.requestId } }),
  ).toBe(1);
  expect(
    await fixture.client.auditEvent.count({
      where: { subjectId: b.request.requestId, action: 'ModelInvocation.failed' },
    }),
  ).toBe(1);
});

it('preserves a reservation after the provider returned but durable finalization failed', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  const provider = new FakeAIProvider(async () => success(), 'fixture', '1');
  const fail = vi
    .spyOn(b.repo, 'finishAttempt')
    .mockRejectedValueOnce(new Error('SIMULATED_PROCESS_LOSS'));
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('SIMULATED_PROCESS_LOSS');
  fail.mockRestore();
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('INVOCATION_ALREADY_EXISTS');
  expect(provider.calls).toHaveLength(1);
  expect(
    (await new InvocationBudgetReader(fixture.client).read(b.request.requestId))?.scope.reserved,
  ).toBe('1.00000000');
});

it('keeps operation reservations isolated and permits explicitly free calls under zero cost', async () => {
  const a = await setup({ maxEstimatedCost: 2 }, '3');
  await a.begin();
  const b = await setup({ maxEstimatedCost: 0 }, '0');
  const provider = new FakeAIProvider(async () => success(), 'fixture', '1');
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('COST_BUDGET_BLOCK');
  expect(provider.calls).toHaveLength(0);
  const free = await setup({ maxEstimatedCost: 0 }, '0');
  const freeProvider = new FakeAIProvider(async () => success('0'), 'fixture', '0');
  await free
    .gateway(freeProvider)
    .generateStructured(free.request, contracts, free.policy, free.budget);
  expect(freeProvider.calls).toHaveLength(1);
  expect(
    (await new InvocationBudgetReader(fixture.client).read(a.request.requestId))?.scope.reserved,
  ).toBe('2.00000000');
});

it('rejects an expired persisted window before another provider attempt', async () => {
  const b = await setup();
  await b.begin();
  await fixture.client.$executeRaw`
    UPDATE "ModelInvocation" SET "policyJson" = jsonb_set("policyJson", '{budget,to}', '"2021-01-01T00:00:00Z"'::jsonb)
    WHERE id = ${b.request.requestId}::uuid`;
  await expect(
    b.repo.startAttempt(b.request.requestId, {
      provider: 'deterministic-fixture',
      model: 'fixture',
      requestHash: 'a'.repeat(64),
      estimate: '1',
    }),
  ).rejects.toThrow('BUDGET_WINDOW_CLOSED');
  expect(
    await fixture.client.modelInvocationAttempt.count({
      where: { modelInvocationId: b.request.requestId },
    }),
  ).toBe(0);
});

it('records an adapter cost-bound violation honestly and blocks further shared reservations', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  const provider = new FakeAIProvider(async () => success('2'), 'fixture', '1');
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('PROVIDER_COST_BOUND_EXCEEDED');
  expect(provider.calls).toHaveLength(1);
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: { reportedCost: '2.00000000' },
    scope: { consumed: '2.00000000', exceeded: true, remaining: '0.00000000' },
  });
  await expect(b.begin(b.repo, randomUUID())).rejects.toThrow('COST_BUDGET_BLOCK');
});

it('refuses an unknown-cost refund and mismatched currency at durable finalization', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '1');
  await b.begin();
  const attempt = await b.repo.startAttempt(b.request.requestId, {
    provider: 'deterministic-fixture',
    model: 'fixture',
    requestHash: 'a'.repeat(64),
    estimate: '1',
  });
  await expect(
    b.repo.finishAttempt(attempt.id, {
      status: 'FAILED',
      costCurrency: 'EUR',
      accountedCost: '0',
      validation: {},
    }),
  ).rejects.toThrow('COST_ACCOUNTING_UNDERSTATED');
  await expect(
    b.repo.finishAttempt(attempt.id, {
      status: 'FAILED',
      costCurrency: 'USD',
      accountedCost: '1',
      validation: {},
    }),
  ).rejects.toThrow('USAGE_CURRENCY_MISMATCH');
  expect(
    (await new InvocationBudgetReader(fixture.client).read(b.request.requestId))?.scope.reserved,
  ).toBe('1.00000000');
});

it('retains known overruns when the process crashes after attempt accounting but before logical finalization', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '2');
  const provider = new FakeAIProvider(async () => success('2'), 'fixture', '1');
  const fail = vi
    .spyOn(b.repo, 'finish')
    .mockRejectedValueOnce(new Error('SIMULATED_PROCESS_LOSS'));
  await expect(
    b.gateway(provider).generateStructured(b.request, contracts, b.policy, b.budget),
  ).rejects.toThrow('SIMULATED_PROCESS_LOSS');
  fail.mockRestore();
  expect(await new InvocationBudgetReader(fixture.client).read(b.request.requestId)).toMatchObject({
    operation: { status: 'RUNNING', accountedCost: '2.00000000' },
    scope: { reserved: '2.00000000', consumed: '0.00000000', remaining: '0.00000000' },
  });
  await expect(b.begin(b.repo, randomUUID())).rejects.toThrow('COST_BUDGET_BLOCK');
});

it('fails the shared read closed when another reservation has incomplete currency metadata', async () => {
  const b = await setup({ maxEstimatedCost: 1 }, '3');
  await b.begin();
  const otherId = randomUUID();
  await b.begin(b.repo, otherId);
  await fixture.client.$executeRaw`
    UPDATE "ModelInvocation" SET "policyJson" = "policyJson" #- '{budget,currency}'
    WHERE id = ${otherId}::uuid`;
  await expect(
    new InvocationBudgetReader(fixture.client).read(b.request.requestId),
  ).rejects.toThrow('BUDGET_LEDGER_INCOMPLETE');
  await expect(b.begin(b.repo, randomUUID())).rejects.toThrow('BUDGET_POLICY_CONFLICT');
});
