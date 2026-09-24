import { startPolledWorkerRuntime, type WorkerRuntimeOptions } from '@vision/observability';
import type { RenderWorkerOrchestrator } from './orchestrator.js';

/** Start once per process; close drains outstanding work before removing its heartbeat. */
export async function startRenderWorkerRuntime(
  orchestrator: RenderWorkerOrchestrator,
  options: WorkerRuntimeOptions,
) {
  const runtime = await startPolledWorkerRuntime(
    'worker-render',
    orchestrator.execute.bind(orchestrator),
    options,
  );
  return { heartbeat: runtime.heartbeat, execute: runtime.run, close: runtime.close };
}
