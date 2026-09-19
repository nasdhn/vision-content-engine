import { afterEach, expect, it, vi } from 'vitest';
import { checkReadiness } from '../../packages/observability/src/index.js';

afterEach(() => vi.useRealTimers());
const up = async () => {};
it('requires all local critical dependencies', async () => {
  expect((await checkReadiness({ postgres: up, redis: up, storage: up })).status).toBe('ready');
  const result = await checkReadiness({
    postgres: up,
    redis: async () => {
      throw new Error('secret-in-provider-error');
    },
    storage: up,
  });
  expect(result).toEqual({
    status: 'not_ready',
    checks: { postgres: 'up', redis: 'down', storage: 'up' },
  });
  expect(JSON.stringify(result)).not.toContain('secret');
});
it('bounds hung readiness checks', async () => {
  vi.useFakeTimers();
  const result = checkReadiness(
    { postgres: () => new Promise(() => {}), redis: up, storage: up },
    100,
  );
  await vi.advanceTimersByTimeAsync(100);
  expect((await result).checks.postgres).toBe('down');
});
