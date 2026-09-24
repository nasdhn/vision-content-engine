import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import {
  startPolledWorkerRuntime,
  checkReadiness,
  checkWorkerReadiness,
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_RETENTION_MS,
  HEARTBEAT_TTL_MS,
  readWorkerHealth,
  RedisHeartbeatStore,
  StructuredLogger,
  WorkerHeartbeat,
  WORKER_COMPONENTS,
} from '../../packages/observability/src/index.js';
import { MemoryHeartbeatStore, probes } from '../helpers/runtime-health.js';

const quiet = new StructuredLogger('control', () => {});
afterEach(() => vi.useRealTimers());

it('distinguishes fresh, crashed/stale and missing with explicit time and no live timer', async () => {
  let now = 1000;
  const store = new MemoryHeartbeatStore(() => now);
  const record = {
    component: 'control' as const,
    instanceId: randomUUID(),
    startedAt: now,
    lastSeenAt: now,
    readiness: await checkWorkerReadiness('control', probes),
  };
  expect((await readWorkerHealth(store))[0]).toMatchObject({ status: 'MISSING' });
  await store.write(record);
  expect((await readWorkerHealth(store))[0]).toMatchObject({
    status: 'HEALTHY',
    instances: [{ status: 'HEALTHY' }],
  });
  now += HEARTBEAT_TTL_MS;
  expect((await readWorkerHealth(store))[0]).toMatchObject({
    status: 'STALE',
    instances: [{ lastSeenAt: 1000 }],
  });
  now = 1000 + HEARTBEAT_RETENTION_MS;
  expect((await readWorkerHealth(store))[0]).toMatchObject({ status: 'MISSING' });
});

it('refreshes idle instances independently and closes idempotently without reviving them', async () => {
  vi.useFakeTimers();
  const store = new MemoryHeartbeatStore(Date.now);
  const first = await WorkerHeartbeat.start('control', { store, probes, logger: quiet });
  const second = await WorkerHeartbeat.start('control', { store, probes, logger: quiet });
  expect(first.instanceId).not.toBe(second.instanceId);
  expect((await store.read('control')).instances).toHaveLength(2);
  const original = first.startedAt;
  await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS);
  expect(store.records.get(first.instanceId)).toMatchObject({
    startedAt: original,
    lastSeenAt: original + HEARTBEAT_INTERVAL_MS,
  });
  await Promise.all([first.close(), first.close()]);
  await first.refresh();
  expect((await store.read('control')).instances.map((row) => row.instanceId)).toEqual([
    second.instanceId,
  ]);
  await second.close();
  await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL_MS * 2);
  expect((await store.read('control')).instances).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it('does not kill work on heartbeat failure, reports safely, and can refresh again', async () => {
  const lines: string[] = [];
  const store = new MemoryHeartbeatStore(Date.now);
  const failure = ['HEALTH', 'ERROR', 'SENTINEL'].join('_');
  vi.spyOn(store, 'write').mockRejectedValueOnce(new Error(failure));
  const session = await WorkerHeartbeat.start('control', {
    store,
    probes,
    logger: new StructuredLogger('control', (line) => lines.push(line)),
  });
  try {
    expect((await readWorkerHealth(store))[0]).toMatchObject({ status: 'MISSING' });
    await session.refresh();
    expect((await readWorkerHealth(store))[0]).toMatchObject({ status: 'HEALTHY' });
  } finally {
    await session.close();
  }
  const events = lines.map((line) => JSON.parse(line).event);
  expect(events).toEqual(['heartbeat.failed', 'worker.started', 'worker.stopped']);
  expect(lines.join('')).not.toContain(failure);
});

it.each(WORKER_COMPONENTS)(
  '%s needs its actual dependencies; disabled providers are not probed',
  async (component) => {
    expect(await checkWorkerReadiness(component, probes)).toMatchObject({ status: 'ready' });
    for (const dependency of ['postgres', 'redis'] as const) {
      expect(
        await checkWorkerReadiness(component, {
          ...probes,
          [dependency]: async () => {
            throw new Error('down');
          },
        }),
      ).toMatchObject({ status: 'not_ready', checks: { [dependency]: 'down' } });
    }
    const withoutStorage = await checkWorkerReadiness(component, {
      postgres: probes.postgres,
      redis: probes.redis,
    });
    expect(withoutStorage.status).toBe(
      ['worker-capture', 'worker-render', 'worker-publish'].includes(component)
        ? 'not_ready'
        : 'ready',
    );
    expect((await checkWorkerReadiness(component, {})).status).toBe('not_ready');
  },
);

it('bounds blocked dependencies and heartbeat storage without hanging shutdown', async () => {
  vi.useFakeTimers();
  const forever = () => new Promise<void>(() => {});
  const readiness = checkReadiness({ ...probes, postgres: forever }, 20);
  await vi.advanceTimersByTimeAsync(20);
  expect(await readiness).toMatchObject({ status: 'not_ready', checks: { postgres: 'down' } });
  expect((await checkReadiness({})).status).toBe('not_ready');
  const store = new MemoryHeartbeatStore(Date.now);
  vi.spyOn(store, 'write').mockImplementation(forever);
  const starting = WorkerHeartbeat.start('control', {
    store,
    probes,
    timeoutMs: 20,
    logger: quiet,
  });
  await vi.advanceTimersByTimeAsync(20);
  const session = await starting;
  await session.close();
  expect(vi.getTimerCount()).toBe(0);
});

it('marks a live runtime not ready when storage fails, without changing liveness', async () => {
  const store = new MemoryHeartbeatStore(Date.now);
  const lines: string[] = [];
  const session = await WorkerHeartbeat.start('worker-render', {
    store,
    probes: {
      ...probes,
      storage: async () => {
        throw new Error('down');
      },
    },
    logger: new StructuredLogger('worker-render', (line) => lines.push(line)),
  });
  try {
    expect((await store.read('worker-render')).instances[0]).toMatchObject({
      status: 'HEALTHY',
      readiness: { status: 'not_ready', checks: { storage: 'down' } },
    });
    expect(lines.map((line) => JSON.parse(line).event)).toContain('dependency.not_ready');
  } finally {
    await session.close();
  }
});

it('reports unavailable storage honestly instead of MISSING, including timeouts', async () => {
  vi.useFakeTimers();
  const store = new MemoryHeartbeatStore(Date.now);
  vi.spyOn(store, 'read').mockImplementation(() => new Promise(() => {}));
  const result = readWorkerHealth(store, 20);
  await vi.advanceTimersByTimeAsync(20);
  expect(await result).toEqual(
    WORKER_COMPONENTS.map((component) => ({ component, available: false })),
  );
});

it('projects Redis metadata and rejects malformed identity/checks rather than leaking it', async () => {
  const record = {
    component: 'control',
    instanceId: randomUUID(),
    startedAt: 100,
    lastSeenAt: 200,
    readiness: { status: 'ready', checks: { postgres: 'up', redis: 'up' } },
    secret: 'forbidden',
    host: 'private',
    nested: { token: 'forbidden' },
  };
  const evalRead = vi.fn(async (): Promise<unknown> => [JSON.stringify(record), '1']);
  const store = new RedisHeartbeatStore(async () => ({ eval: evalRead }));
  expect(JSON.stringify(await store.read('control'))).not.toMatch(/forbidden|private|secret|token/);
  evalRead.mockResolvedValue([JSON.stringify({ ...record, instanceId: 'private-hostname' }), '1']);
  await expect(store.read('control')).rejects.toThrow('HEARTBEAT_INVALID');
});

it('drains long work with a live heartbeat and refuses new work during shutdown', async () => {
  const store = new MemoryHeartbeatStore(Date.now);
  let finish!: (value: string) => void;
  const runtime = await startPolledWorkerRuntime(
    'worker-render',
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
    { store, probes, logger: quiet },
  );
  const job = runtime.run();
  await Promise.resolve();
  const closing = runtime.close();
  expect((await store.read('worker-render')).instances).toHaveLength(1);
  await expect(runtime.run()).rejects.toThrow('WORKER_STOPPING');
  finish('completed');
  expect(await job).toBe('completed');
  await closing;
  expect((await store.read('worker-render')).instances).toHaveLength(0);
});
