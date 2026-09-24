import { QueueKeys } from 'bullmq';
import type { Redis } from 'ioredis';
import {
  checkReadiness,
  readQueueHealth,
  readWorkerHealth,
  RedisHeartbeatStore,
  RedisQueueHealthReader,
  RUNTIME_QUEUES,
  StructuredLogger,
  type HeartbeatStore,
  type QueueHealthReader,
  type ReadinessProbes,
  type RuntimeQueueName,
} from '@vision/observability';

export class RuntimeHealthService {
  private pending: ReturnType<RuntimeHealthService['snapshot']> | undefined;
  constructor(
    private readonly probes: ReadinessProbes,
    private readonly heartbeats: HeartbeatStore,
    private readonly queues: ReadonlyArray<{ name: RuntimeQueueName; reader: QueueHealthReader }>,
    private readonly logger = new StructuredLogger('api'),
  ) {}

  private async snapshot() {
    const [dependencies, workers, queues] = await Promise.all([
      checkReadiness(this.probes),
      readWorkerHealth(this.heartbeats),
      Promise.all(
        this.queues.map(({ name, reader }) =>
          readQueueHealth(name, reader, { logger: this.logger }),
        ),
      ),
    ]);
    if (dependencies.status !== 'ready') this.logger.log('warn', 'dependency.not_ready');
    return { observedAt: new Date().toISOString(), dependencies, workers, queues };
  }

  read() {
    // Coalesce concurrent requests. Health reads never mutate canonical or queue state.
    this.pending ??= this.snapshot().finally(() => {
      this.pending = undefined;
    });
    return this.pending;
  }
}

export function createRuntimeHealthService(redis: Redis, probes: ReadinessProbes) {
  const logger = new StructuredLogger('api');
  const queues = RUNTIME_QUEUES.map((name) => ({
    name,
    reader: new RedisQueueHealthReader(async () => redis, new QueueKeys().toKey(name, '')),
  }));
  return new RuntimeHealthService(
    probes,
    new RedisHeartbeatStore(async () => redis),
    queues,
    logger,
  );
}
