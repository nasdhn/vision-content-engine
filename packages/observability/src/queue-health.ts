import { bounded } from './worker-heartbeat.js';
import { StructuredLogger } from './logging.js';

export const RUNTIME_QUEUES = ['ai', 'vce-publication', 'vce-analytics'] as const;
export type RuntimeQueueName = (typeof RUNTIME_QUEUES)[number];
export const QUEUE_SAMPLE_LIMIT = 100;
export type QueueState =
  'waiting' | 'active' | 'delayed' | 'failed' | 'completed' | 'paused' | 'prioritized';
export interface QueueHealthReader {
  isPaused(): Promise<boolean>;
  getJobCounts(...types: QueueState[]): Promise<Record<string, number>>;
  getJobs(
    types: QueueState[],
    start: number,
    end: number,
    asc: boolean,
  ): Promise<
    {
      timestamp: number;
      processedOn?: number;
    }[]
  >;
}
const states: QueueState[] = [
  'waiting',
  'active',
  'delayed',
  'failed',
  'completed',
  'paused',
  'prioritized',
];

export async function readQueueHealth(
  name: RuntimeQueueName,
  queue: QueueHealthReader,
  options: {
    now?: () => number;
    timeoutMs?: number;
    logger?: StructuredLogger;
  } = {},
) {
  const logger = options.logger ?? new StructuredLogger('api');
  try {
    return await bounded(async () => {
      // Separate bounds per state: a large waiting list must not hide all priority/paused work.
      const [counts, waiting, paused, prioritized, active, isPaused] = await Promise.all([
        queue.getJobCounts(...states),
        queue.getJobs(['waiting'], 0, QUEUE_SAMPLE_LIMIT - 1, true),
        queue.getJobs(['paused'], 0, QUEUE_SAMPLE_LIMIT - 1, true),
        queue.getJobs(['prioritized'], 0, QUEUE_SAMPLE_LIMIT - 1, true),
        queue.getJobs(['active'], 0, QUEUE_SAMPLE_LIMIT - 1, true),
        queue.isPaused(),
      ]);
      const safeCounts = Object.fromEntries(
        states.map((state) => {
          const value = counts[state];
          if (!Number.isSafeInteger(value) || value === undefined || value < 0)
            throw new Error('QUEUE_HEALTH_INVALID');
          return [state, value];
        }),
      );
      const now = (options.now ?? Date.now)();
      const age = (timestamps: (number | undefined)[]) => {
        const valid = timestamps.filter(
          (value): value is number =>
            typeof value === 'number' && Number.isFinite(value) && value >= 0,
        );
        return valid.length ? Math.max(0, now - Math.min(...valid)) : null;
      };
      return {
        name,
        available: true as const,
        counts: safeCounts,
        isPaused,
        oldestPendingAgeMs: age(
          [...waiting, ...paused, ...prioritized].map((job) => job.timestamp),
        ),
        oldestActiveAgeMs: age(active.map((job) => job.processedOn)),
        pendingSampleComplete: ['waiting', 'paused', 'prioritized'].every(
          (state) => counts[state]! <= QUEUE_SAMPLE_LIMIT,
        ),
        activeSampleComplete: counts.active! <= QUEUE_SAMPLE_LIMIT,
        sampleLimitPerState: QUEUE_SAMPLE_LIMIT,
      };
    }, options.timeoutMs);
  } catch {
    logger.log('warn', 'queue.health_read_failed', { queue: name });
    return { name, available: false as const };
  }
}
