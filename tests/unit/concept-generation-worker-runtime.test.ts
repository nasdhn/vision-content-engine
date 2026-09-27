import { describe, expect, it, vi } from 'vitest';

import type { ConceptGenerationWorkerOrchestrator } from '../../apps/worker-ai/src/concept-generation-worker.js';
import { startConceptGenerationWorkerRuntime } from '../../apps/worker-ai/src/concept-generation-runtime.js';
import type {
  HeartbeatRecord,
  HeartbeatStore,
  WorkerComponent,
} from '../../packages/observability/src/index.js';

describe('startConceptGenerationWorkerRuntime', () => {
  it('publishes worker-ai readiness, runs processOne, and drains in-flight work before close', async () => {
    const writes: HeartbeatRecord[] = [];
    const removals: Array<{
      component: WorkerComponent;
      instanceId: string;
    }> = [];

    const store: HeartbeatStore = {
      async write(record) {
        writes.push(structuredClone(record));
      },
      async remove(component, instanceId) {
        removals.push({ component, instanceId });
      },
      async read() {
        return {
          instances: [],
          truncated: false,
        };
      },
    };

    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });

    let releaseWork!: () => void;
    const workGate = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });

    const processOne = vi.fn(async (workerId: string) => {
      markStarted();
      await workGate;
      return {
        status: 'IDLE',
        workerId,
      } as const;
    });

    const orchestrator = {
      processOne,
    } as unknown as ConceptGenerationWorkerOrchestrator;

    const runtime = await startConceptGenerationWorkerRuntime(orchestrator, {
      store,
      probes: {
        postgres: async () => undefined,
        redis: async () => undefined,
      },
    });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      component: 'worker-ai',
      readiness: {
        status: 'ready',
        checks: {
          postgres: 'up',
          redis: 'up',
        },
      },
    });

    const pending = runtime.processOne('generation-runtime-worker');

    await started;

    expect(processOne).toHaveBeenCalledTimes(1);
    expect(processOne).toHaveBeenCalledWith('generation-runtime-worker');

    const closing = runtime.close();

    await Promise.resolve();

    expect(removals).toHaveLength(0);

    releaseWork();

    await expect(pending).resolves.toEqual({
      status: 'IDLE',
      workerId: 'generation-runtime-worker',
    });

    await closing;

    expect(removals).toEqual([
      {
        component: 'worker-ai',
        instanceId: runtime.heartbeat.instanceId,
      },
    ]);

    await expect(runtime.processOne('worker-after-close')).rejects.toThrow('WORKER_STOPPING');
  });
});
