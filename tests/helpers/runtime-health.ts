import {
  HEARTBEAT_RETENTION_MS,
  HEARTBEAT_TTL_MS,
  type HeartbeatRecord,
  type HeartbeatStore,
  type WorkerComponent,
  type WorkerObservation,
} from '../../packages/observability/src/index.js';

export class MemoryHeartbeatStore implements HeartbeatStore {
  readonly records = new Map<string, HeartbeatRecord>();
  constructor(private readonly now: () => number) {}
  async write(record: HeartbeatRecord) {
    this.records.set(record.instanceId, record);
  }
  async remove(_component: WorkerComponent, instanceId: string) {
    this.records.delete(instanceId);
  }
  async read(component: WorkerComponent) {
    const instances: WorkerObservation[] = [...this.records.values()]
      .filter(
        (record) =>
          record.component === component && this.now() - record.lastSeenAt < HEARTBEAT_RETENTION_MS,
      )
      .map((record) => ({
        ...record,
        status: this.now() - record.lastSeenAt < HEARTBEAT_TTL_MS ? 'HEALTHY' : 'STALE',
      }));
    return { instances, truncated: false };
  }
}
export const up = async () => {};
export const probes = { postgres: up, redis: up, storage: up };
export const emptyCounts = {
  waiting: 0,
  active: 0,
  delayed: 0,
  failed: 0,
  completed: 0,
  paused: 0,
  prioritized: 0,
};
