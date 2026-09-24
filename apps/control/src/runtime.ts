import { WorkerHeartbeat, type WorkerRuntimeOptions } from '@vision/observability';

/** The control loop owner starts this once, then closes it after draining its dispatchers. */
export function startControlRuntime(options: WorkerRuntimeOptions) {
  return WorkerHeartbeat.start('control', options);
}
