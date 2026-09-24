import { afterEach, expect, it, vi } from 'vitest';
import {
  readQueueHealth,
  StructuredLogger,
  type QueueHealthReader,
} from '../../packages/observability/src/index.js';
import { emptyCounts } from '../helpers/runtime-health.js';
afterEach(() => vi.useRealTimers());

it('samples bounded pending/active ages without treating intentional delay or long activity as stalled', async () => {
  const reader: QueueHealthReader = {
    isPaused: async () => false,
    getJobCounts: async () => ({
      ...emptyCounts,
      waiting: 102,
      active: 1,
      delayed: 999,
      failed: 42,
    }),
    getJobs: vi.fn(async (states) =>
      states[0] === 'waiting'
        ? [{ timestamp: 100 }, { timestamp: 50 }]
        : states[0] === 'active'
          ? [{ timestamp: 0, processedOn: 10 }]
          : [],
    ),
  };
  const result = await readQueueHealth('ai', reader, { now: () => 1000 });
  expect(result).toMatchObject({
    available: true,
    counts: { delayed: 999, failed: 42 },
    oldestPendingAgeMs: 950,
    oldestActiveAgeMs: 990,
    pendingSampleComplete: false,
    activeSampleComplete: true,
  });
  expect(result).not.toHaveProperty('stalled');
  expect(reader.getJobs).toHaveBeenCalledTimes(4);
  for (const call of vi.mocked(reader.getJobs).mock.calls)
    expect(call.slice(1)).toEqual([0, 99, true]);
});

it('returns null ages for empty/delayed-only queues', async () => {
  expect(
    await readQueueHealth('vce-publication', {
      isPaused: async () => false,
      getJobCounts: async () => ({ ...emptyCounts, delayed: 1 }),
      getJobs: async () => [],
    }),
  ).toMatchObject({ available: true, oldestPendingAgeMs: null, oldestActiveAgeMs: null });
});

it('returns unavailable rather than fake zero counts for failure or timeout, without raw errors', async () => {
  const lines: string[] = [];
  const logger = new StructuredLogger('api', (line) => lines.push(line));
  const failure = ['QUEUE', 'PRIVATE', 'SENTINEL'].join('_');
  const reader: QueueHealthReader = {
    isPaused: async () => false,
    getJobCounts: async () => {
      throw new Error(failure);
    },
    getJobs: async () => [],
  };
  expect(await readQueueHealth('ai', reader, { logger })).toEqual({ name: 'ai', available: false });
  expect(lines.map((line) => JSON.parse(line).event)).toEqual(['queue.health_read_failed']);
  expect(lines.join('')).not.toContain(failure);
  vi.useFakeTimers();
  reader.getJobCounts = () => new Promise(() => {});
  const pending = readQueueHealth('ai', reader, { timeoutMs: 20, logger });
  await vi.advanceTimersByTimeAsync(20);
  expect(await pending).toEqual({ name: 'ai', available: false });
});
