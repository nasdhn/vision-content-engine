import { CapacityGuard } from '../../packages/media/src/index.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createApi } from '../../apps/api/src/app.js';
import { RuntimeHealthService } from '../../apps/api/src/runtime-health.js';
import {
  StructuredLogger,
  HEARTBEAT_TTL_MS,
  type HeartbeatRecord,
  RUNTIME_QUEUES,
} from '../../packages/observability/src/index.js';
import { MemoryHeartbeatStore, probes, emptyCounts } from '../helpers/runtime-health.js';

it('protects the read-only snapshot, projects worker/queue states and keeps failures secret-safe', async () => {
  const now = Date.now();
  const store = new MemoryHeartbeatStore(() => now);
  const base: HeartbeatRecord = {
    component: 'control',
    instanceId: randomUUID(),
    startedAt: now - 100_000,
    lastSeenAt: now,
    readiness: { status: 'ready', checks: { postgres: 'up', redis: 'up' } },
  };
  await store.write(base);
  await store.write({
    ...base,
    component: 'worker-ai',
    instanceId: randomUUID(),
    lastSeenAt: now - HEARTBEAT_TTL_MS,
  });
  const queues = RUNTIME_QUEUES.map((name) => ({
    name,
    reader: {
      isPaused: async () => false,
      getJobCounts: async () => ({ ...emptyCounts, failed: 4 }),
      getJobs: async () => [],
    },
  }));
  const lines: string[] = [];
  const logger = new StructuredLogger('api', (line) => lines.push(line));
  const capacity = new CapacityGuard(
    { minimumFreeBytes: 10, maxUploadBytes: 4, maxArtifactBytes: 4 },
    async () => ({ bavail: 14n, bsize: 1n, blocks: 20n }),
    logger,
  );
  const service = new RuntimeHealthService(probes, store, queues, logger, capacity);
  const read = vi.spyOn(service, 'read');
  const accessKey = randomBytes(32).toString('hex');
  const origin = 'http://localhost:5174';
  const app = await createApi(
    probes,
    { auth: { accessKey, origin }, runtimeHealth: service },
    logger,
  );
  try {
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const denied = await fetch(`${url}/api/operations/runtime`);
    expect(denied.status).toBe(401);
    expect(denied.headers.get('cache-control')).toContain('no-store');
    expect(read).not.toHaveBeenCalled();
    const login = await fetch(`${url}/api/session`, {
      method: 'POST',
      headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey }),
    });
    expect(login.status).toBe(201);
    const cookie = login.headers.get('set-cookie')!.split(';')[0]!;
    const response = await fetch(`${url}/api/operations/runtime`, { headers: { Cookie: cookie } });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const body = await response.json();
    expect(body).toMatchObject({
      localCapacity: {
        scope: 'API_TEMP_FILESYSTEM',
        available: true,
        localFreeBytes: 14,
        status: 'HEALTHY',
        limits: { minimumFreeBytes: 10, maxUploadBytes: 4, maxArtifactBytes: 4 },
      },
      dependencies: { status: 'ready' },
      workers: [
        { component: 'control', status: 'HEALTHY' },
        { component: 'worker-ai', status: 'STALE' },
        { component: 'worker-capture', status: 'MISSING' },
        { component: 'worker-render', status: 'MISSING' },
        { component: 'worker-publish', status: 'MISSING' },
        { component: 'worker-analytics', status: 'MISSING' },
      ],
      queues: RUNTIME_QUEUES.map((name) => ({ name, counts: { failed: 4 } })),
    });
    expect(JSON.stringify(body)).not.toMatch(/credential|token|cookie|redis:\/\/|postgres:\/\//i);
    expect(
      (
        await fetch(`${url}/api/operations/runtime`, {
          method: 'POST',
          headers: { Cookie: cookie },
        })
      ).status,
    ).toBe(404);
    const sentinel = ['OPS', 'FAILURE', 'SENTINEL'].join('_');
    read.mockRejectedValueOnce(new Error(sentinel));
    const failed = await fetch(`${url}/api/operations/runtime`, { headers: { Cookie: cookie } });
    expect(failed.status).toBe(503);
    expect(failed.headers.get('cache-control')).toBe('private, no-store');
    expect(await failed.text()).not.toContain(sentinel);
    expect(lines.join('')).not.toContain(sentinel);
    expect(lines.join('')).not.toContain(accessKey);
  } finally {
    await app.close();
  }
});

it('reports dependency/read failures as unavailable, never healthy zeros', async () => {
  const down = async () => {
    throw new Error('private connection detail');
  };
  const store = new MemoryHeartbeatStore(Date.now);
  vi.spyOn(store, 'read').mockImplementation(down);
  const lines: string[] = [];
  const service = new RuntimeHealthService(
    { postgres: down, redis: down, storage: down },
    store,
    RUNTIME_QUEUES.map((name) => ({
      name,
      reader: { isPaused: async () => false, getJobCounts: down, getJobs: down },
    })),
    new StructuredLogger('api', (line) => lines.push(line)),
  );
  const result = await service.read();
  expect(result.dependencies).toEqual({
    status: 'not_ready',
    checks: { postgres: 'down', redis: 'down', storage: 'down' },
  });
  expect(result.workers.every((worker) => !worker.available)).toBe(true);
  expect(result.queues).toEqual(RUNTIME_QUEUES.map((name) => ({ name, available: false })));
  expect(lines.map((line) => JSON.parse(line).event)).toContain('dependency.not_ready');
  expect(JSON.stringify(result) + lines.join('')).not.toContain('private connection detail');
});
