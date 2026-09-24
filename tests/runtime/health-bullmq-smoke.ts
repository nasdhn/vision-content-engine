import { WEEKLY_ANALYSIS_QUEUE_NAME } from '../../packages/contracts/src/weekly-analysis.js';
import { ANALYTICS_QUEUE_NAME } from '../../packages/analytics/src/index.js';
import { PUBLISH_QUEUE_NAME } from '../../apps/control/src/index.js';
import 'dotenv/config';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Queue, Worker } from 'bullmq';
import {
  bounded,
  checkReadiness,
  HEARTBEAT_RETENTION_MS,
  HEARTBEAT_TTL_MS,
  observeWorkerLifecycle,
  readQueueHealth,
  readWorkerHealth,
  RedisHeartbeatStore,
  RedisQueueHealthReader,
  RUNTIME_QUEUES,
  WorkerHeartbeat,
  WORKER_COMPONENTS,
  type HeartbeatRecord,
} from '../../packages/observability/src/index.js';
import { createLocalDependencies } from '../../apps/api/src/local-dependencies.js';
import { EnvironmentSecretResolver, parseConfig } from '../../packages/shared/src/index.js';
import { startControlRuntime } from '../../apps/control/src/runtime.js';
import { startCaptureWorkerRuntime } from '../../apps/worker-capture/src/runtime.js';
import { startRenderWorkerRuntime } from '../../apps/worker-render/src/runtime.js';
import type { CaptureWorkerOrchestrator } from '../../apps/worker-capture/src/orchestrator.js';
import type { RenderWorkerOrchestrator } from '../../apps/worker-render/src/orchestrator.js';

assert.deepEqual(RUNTIME_QUEUES, [
  WEEKLY_ANALYSIS_QUEUE_NAME,
  PUBLISH_QUEUE_NAME,
  ANALYTICS_QUEUE_NAME,
]);
const config = parseConfig(process.env);
assert.equal(config.VCE_REAL_PROVIDERS_ENABLED, 'false');
assert.equal(config.PAUSE_ALL_PUBLISHING, true);
const secrets = new EnvironmentSecretResolver(process.env, [
  'DATABASE_URL',
  'REDIS_URL',
  'S3_ACCESS_KEY_ID',
  'S3_SECRET_ACCESS_KEY',
]);
const redisUrl = new URL(secrets.resolve('REDIS_URL'));
assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(redisUrl.hostname), 'LOCAL_REDIS_REQUIRED');
const dependencies = createLocalDependencies(config, secrets);
const prefix = `vce-health-smoke-${randomUUID()}`;
const connection = {
  host: redisUrl.hostname,
  port: Number(redisUrl.port || 6379),
  ...(redisUrl.username ? { username: decodeURIComponent(redisUrl.username) } : {}),
  ...(redisUrl.password ? { password: decodeURIComponent(redisUrl.password) } : {}),
  db: Number(redisUrl.pathname.slice(1) || 0),
};
const queues: Queue[] = [];
const sessions: WorkerHeartbeat[] = [];
const workers: Worker[] = [];
const store = new RedisHeartbeatStore(async () => dependencies.redis, prefix);
try {
  if (dependencies.redis.status !== 'ready') await bounded(() => once(dependencies.redis, 'ready'));
  assert.equal((await checkReadiness(dependencies.probes)).status, 'ready');
  const runtimeOptions = { store, probes: dependencies.probes };
  const control = await startControlRuntime(runtimeOptions);
  sessions.push(control);
  let captureCalls = 0;
  let renderCalls = 0;
  const capture = await startCaptureWorkerRuntime(
    {
      processOne: async () => {
        captureCalls++;
        return { status: 'IDLE' };
      },
    } as unknown as CaptureWorkerOrchestrator,
    runtimeOptions,
  );
  sessions.push(capture.heartbeat);
  const render = await startRenderWorkerRuntime(
    {
      execute: async () => {
        renderCalls++;
      },
    } as unknown as RenderWorkerOrchestrator,
    runtimeOptions,
  );
  sessions.push(render.heartbeat);
  await capture.processOne('smoke');
  await render.execute({ renderId: randomUUID(), renderAttemptId: randomUUID() });
  assert.equal(captureCalls, 1);
  assert.equal(renderCalls, 1);
  for (const component of ['worker-ai', 'worker-publish', 'worker-analytics'] as const)
    sessions.push(await WorkerHeartbeat.start(component, runtimeOptions));
  const extra = await WorkerHeartbeat.start('control', runtimeOptions);
  sessions.push(extra);
  assert.notEqual(extra.instanceId, control.instanceId);
  assert.equal((await store.read('control')).instances.length, 2);
  assert.ok(
    (await readWorkerHealth(store)).every(
      (worker) => worker.available && worker.status === 'HEALTHY',
    ),
  );
  const liveKey = `${prefix}:{control}:instance:${control.instanceId}`;
  const liveTtl = await dependencies.redis.pttl(`${liveKey}:alive`);
  const retainedTtl = await dependencies.redis.pttl(liveKey);
  assert.ok(liveTtl > 0 && liveTtl <= HEARTBEAT_TTL_MS);
  assert.ok(retainedTtl > liveTtl && retainedTtl <= HEARTBEAT_RETENTION_MS);
  // Expire the signal on Redis itself: deterministic crash/TTL simulation without sleeps.
  await dependencies.redis.pexpire(`${liveKey}:alive`, 0);
  assert.equal(
    (await store.read('control')).instances.find((row) => row.instanceId === control.instanceId)
      ?.status,
    'STALE',
  );
  await control.refresh();
  assert.equal(
    (await store.read('control')).instances.find((row) => row.instanceId === control.instanceId)
      ?.status,
    'HEALTHY',
  );
  const staleWrite: HeartbeatRecord = {
    component: 'control',
    instanceId: extra.instanceId,
    startedAt: extra.startedAt,
    lastSeenAt: Date.now(),
    readiness: { status: 'ready', checks: { postgres: 'up', redis: 'up' } },
  };
  await extra.close();
  await dependencies.redis.pexpire(`${liveKey}:alive`, 0);
  await dependencies.redis.pexpire(liveKey, 0);
  assert.equal((await store.read('control')).instances.length, 0);
  await control.refresh();
  await assert.rejects(() => store.write(staleWrite), /HEARTBEAT_WRITE_EXPIRED/);

  for (const name of RUNTIME_QUEUES) {
    const queue = new Queue(name, { connection, prefix });
    queue.on('error', () => {});
    queues.push(queue);
    const reader = new RedisQueueHealthReader(async () => dependencies.redis, queue.toKey(''));
    const now = Date.now();
    const health = () => readQueueHealth(name, reader, { now: () => now + 5000 });
    const empty = await health();
    assert.ok(empty.available);
    assert.equal(empty.oldestPendingAgeMs, null);
    assert.ok(Object.values(empty.counts).every((count) => count === 0));
    await queue.add('first', { fixture: true }, { timestamp: now - 1000 });
    await queue.add('second', { fixture: true }, { timestamp: now - 500 });
    await queue.add('later', { fixture: true }, { delay: 3_600_000, timestamp: now - 50_000 });
    const pending = await health();
    assert.ok(pending.available);
    assert.equal(pending.counts.waiting, 2);
    assert.equal(pending.counts.delayed, 1);
    assert.equal(pending.oldestPendingAgeMs, 6000);
    await queue.pause();
    const paused = await health();
    assert.ok(paused.available);
    assert.equal(paused.isPaused, true);
    assert.equal(paused.counts.waiting, 2);
    assert.equal(paused.counts.paused, 0);
    assert.equal(paused.oldestPendingAgeMs, 6000);
    await queue.resume();
    const worker = new Worker(name, undefined, { connection, prefix, autorun: false });
    worker.on('error', () => {});
    workers.push(worker);
    const job = await worker.getNextJob('health-token', { block: false });
    assert.ok(job);
    const active = await health();
    assert.ok(active.available);
    assert.equal(active.counts.active, 1);
    assert.equal(active.counts.waiting, 1);
    assert.ok(active.oldestActiveAgeMs !== null && active.oldestActiveAgeMs >= 0);
    assert.equal(active.oldestPendingAgeMs, 5500);
    await job.moveToFailed(new Error('SMOKE_EXPECTED_FAILURE'), 'health-token');
    const failed = await health();
    assert.ok(failed.available);
    assert.equal(failed.counts.failed, 1);
    assert.equal(failed.counts.active, 0);
    const snapshotBefore = await queue.getJobCounts('waiting', 'delayed', 'failed');
    await health();
    assert.deepEqual(await queue.getJobCounts('waiting', 'delayed', 'failed'), snapshotBefore);
  }

  // Exercise the exact lifecycle helper used by all three production BullMQ factories.
  const lifecycleWorker = new Worker('lifecycle', undefined, {
    connection,
    prefix,
    autorun: false,
  });
  lifecycleWorker.on('error', () => {});
  workers.push(lifecycleWorker);
  const observed = await observeWorkerLifecycle(lifecycleWorker, 'worker-ai', dependencies.probes);
  const productionStore = new RedisHeartbeatStore(async () => dependencies.redis);
  const ownId = observed.heartbeat.instanceId;
  assert.ok(
    (await productionStore.read('worker-ai')).instances.some(
      (row) => row.instanceId === ownId && row.status === 'HEALTHY',
    ),
  );
  await observed.close();
  assert.ok(
    !(await productionStore.read('worker-ai')).instances.some((row) => row.instanceId === ownId),
  );
  // Remove only this test's ephemeral shutdown tombstone.
  await dependencies.redis.del(`vce:runtime:{worker-ai}:instance:${ownId}:stopped`);
  await Promise.all(sessions.map((session) => session.close()));
  assert.ok(
    (await readWorkerHealth(store)).every((row) => row.available && row.status === 'MISSING'),
  );
  assert.equal(WORKER_COMPONENTS.length, 6);
  console.log(
    'PASS: six runtime types; Redis TTL, shutdown, multi-instance; three isolated BullMQ queues; waiting/paused/active/delayed/failed/ages; real dependency readiness.',
  );
} finally {
  await Promise.all(workers.map((worker) => worker.close()));
  await Promise.all(sessions.map((session) => session.close()));
  for (const queue of queues) {
    try {
      await queue.obliterate({ force: true });
    } finally {
      await queue.close();
    }
  }
  // Bounded inventory: only the seven session keys owned by this smoke, never global SCAN/FLUSH.
  for (const session of sessions)
    await dependencies.redis.del(
      `${prefix}:{${session.component}}:instance:${session.instanceId}:stopped`,
      `${prefix}:{${session.component}}:instances`,
    );
  await dependencies.close();
}
