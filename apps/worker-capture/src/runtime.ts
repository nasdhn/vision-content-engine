import { startPolledWorkerRuntime, type WorkerRuntimeOptions } from '@vision/observability';
import type { CaptureWorkerOrchestrator } from './orchestrator.js';

/** Start once per process; close drains outstanding work before removing its heartbeat. */
export async function startCaptureWorkerRuntime(
  orchestrator: CaptureWorkerOrchestrator,
  options: WorkerRuntimeOptions,
) {
  const runtime = await startPolledWorkerRuntime(
    'worker-capture',
    orchestrator.processOne.bind(orchestrator),
    options,
  );
  return { heartbeat: runtime.heartbeat, processOne: runtime.run, close: runtime.close };
}
