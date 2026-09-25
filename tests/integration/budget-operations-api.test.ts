import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createApi } from '../../apps/api/src/app.js';
import type { InvocationBudgetReader } from '../../packages/database/src/index.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { probes } from '../helpers/runtime-health.js';

it('protects budget reads, exposes safe accounting and keeps error responses private', async () => {
  const id = randomUUID();
  const snapshot = {
    currency: 'EUR',
    operation: {
      id,
      status: 'SUCCEEDED' as const,
      maxProviderCalls: 2,
      providerCallsConsumed: 1,
      providerCallsRemaining: 1,
      costLimit: '2.00000000',
      accountedCost: '1.00000000',
      reportedCost: '1.00000000',
      unknownCostUpperBound: '0.00000000',
      pendingCallReserved: '0.00000000',
      remainingCost: '1.00000000',
    },
    scope: {
      id: 'a'.repeat(64),
      from: '2020-01-01T00:00:00Z',
      to: '2100-01-01T00:00:00Z',
      limit: '3.00000000',
      reserved: '0.00000000',
      consumed: '1.00000000',
      remaining: '2.00000000',
      providerCallsConsumed: 1,
      exceeded: false,
    },
  };
  const read = vi.fn<InvocationBudgetReader['read']>().mockResolvedValue(snapshot);
  const accessKey = randomBytes(32).toString('hex');
  const origin = 'http://localhost:5174';
  const lines: string[] = [];
  const app = await createApi(
    probes,
    { auth: { accessKey, origin }, budgetOperations: { read } },
    new StructuredLogger('api', (line) => lines.push(line)),
  );
  try {
    await app.listen(0, '127.0.0.1');
    const base = await app.getUrl();
    const path = `${base}/api/operations/budgets/${id}`;
    const denied = await fetch(path);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('cache-control')).toContain('no-store');
    expect(read).not.toHaveBeenCalled();
    const login = await fetch(`${base}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });
    expect(login.status).toBe(201);
    const headers = { Cookie: login.headers.get('set-cookie')!.split(';')[0]! };
    const response = await fetch(path, { headers });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toEqual(snapshot);
    expect(read).toHaveBeenCalledWith(id);
    const invalid = await fetch(`${base}/api/operations/budgets/not-an-id`, { headers });
    expect(invalid.status).toBe(400);
    expect(read).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce(null);
    expect((await fetch(path, { headers })).status).toBe(404);
    const sentinel = ['BUDGET', 'PRIVATE', 'SENTINEL'].join('_');
    read.mockRejectedValueOnce(new Error(sentinel));
    const failure = await fetch(path, { headers });
    expect(failure.status).toBe(503);
    expect(failure.headers.get('cache-control')).toBe('private, no-store');
    expect(await failure.text()).not.toContain(sentinel);
    expect((await fetch(path, { method: 'POST', headers })).status).toBe(404);
    expect(lines.join('')).not.toContain(sentinel);
    expect(lines.join('')).not.toContain(accessKey);
  } finally {
    await app.close();
  }
});
