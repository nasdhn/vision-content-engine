import { createHash } from 'node:crypto';
import { RedisHeartbeatStore, type HeartbeatRedis } from './redis-heartbeat.js';
import {
  WorkerHeartbeat,
  type WorkerComponent,
  type WorkerProbes,
  type WorkerRuntimeOptions,
} from './worker-heartbeat.js';

interface ScriptRedis {
  status: string;
  defineCommand(name: string, definition: { numberOfKeys: number; lua: string }): void;
  runCommand(name: string, args: (string | number)[]): Promise<unknown>;
}

/** Reuse BullMQ's non-blocking client; keep the heartbeat alive while graceful close drains work. */
export async function observeWorkerLifecycle<
  T extends {
    getBackend(): { client: Promise<ScriptRedis> };
    close(force?: boolean): Promise<void>;
    pause(doNotWaitActive?: boolean): Promise<void>;
  },
>(worker: T, component: WorkerComponent, probes: WorkerProbes) {
  const adapter = worker.getBackend().client.then((client): HeartbeatRedis => {
    const registered = new Set<string>();
    return {
      get status() {
        return client.status;
      },
      async eval(script, numberOfKeys, ...args) {
        if (client.status !== 'ready') throw new Error('REDIS_NOT_READY');
        const name = `vceRuntime${createHash('sha256').update(script).digest('hex').slice(0, 16)}`;
        if (!registered.has(name)) {
          client.defineCommand(name, { numberOfKeys, lua: script });
          registered.add(name);
        }
        return client.runCommand(name, args);
      },
    };
  });
  const heartbeat = await WorkerHeartbeat.start(component, {
    store: new RedisHeartbeatStore(() => adapter),
    probes: {
      ...probes,
      redis: async () => {
        if ((await (await adapter).eval("return redis.call('PING')", 0)) !== 'PONG')
          throw new Error('REDIS_NOT_READY');
      },
    },
  });
  const close = worker.close.bind(worker);
  worker.close = async (force?: boolean) => {
    try {
      if (!force) await worker.pause();
    } finally {
      try {
        await heartbeat.close();
      } finally {
        await close(force);
      }
    }
  };
  return Object.assign(worker, { heartbeat });
}

/** Lifecycle for the existing caller-driven capture/render runtimes. */
export async function startPolledWorkerRuntime<Args extends unknown[], Result>(
  component: WorkerComponent,
  work: (...args: Args) => Promise<Result>,
  options: WorkerRuntimeOptions,
) {
  const heartbeat = await WorkerHeartbeat.start(component, options);
  const running = new Set<Promise<Result>>();
  let closing: Promise<void> | undefined;
  return {
    heartbeat,
    run(...args: Args): Promise<Result> {
      if (closing) return Promise.reject(new Error('WORKER_STOPPING'));
      const pending = Promise.resolve().then(() => work(...args));
      running.add(pending);
      void pending.then(
        () => running.delete(pending),
        () => running.delete(pending),
      );
      return pending;
    },
    close() {
      closing ??= (async () => {
        await Promise.allSettled([...running]);
        await heartbeat.close();
      })();
      return closing;
    },
  };
}
