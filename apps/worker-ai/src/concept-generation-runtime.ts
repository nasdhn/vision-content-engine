import { startPolledWorkerRuntime, type WorkerRuntimeOptions } from '@vision/observability';

import type { ConceptGenerationWorkerOrchestrator } from './concept-generation-worker.js';

/** Start once per process; close drains outstanding generation work before removing its heartbeat. */
export async function startConceptGenerationWorkerRuntime(
  orchestrator: ConceptGenerationWorkerOrchestrator,
  options: WorkerRuntimeOptions,
) {
  const runtime = await startPolledWorkerRuntime(
    'worker-ai',
    orchestrator.processOne.bind(orchestrator),
    options,
  );

  return {
    heartbeat: runtime.heartbeat,
    processOne: runtime.run,
    close: runtime.close,
  };
}
