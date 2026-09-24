import { randomUUID } from 'node:crypto';
import { checkReadiness, type Probe } from './readiness.js';
import { StructuredLogger } from './logging.js';

export const WORKER_COMPONENTS = [
  'control',
  'worker-ai',
  'worker-capture',
  'worker-render',
  'worker-publish',
  'worker-analytics',
] as const;
export type WorkerComponent = (typeof WORKER_COMPONENTS)[number];
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const HEARTBEAT_TTL_MS = 45_000;
export const HEARTBEAT_RETENTION_MS = 300_000;
export const INSTANCE_LIMIT = 100;
export type Dependency = 'postgres' | 'redis' | 'storage';
export type WorkerProbes = Partial<Record<Dependency, Probe>>;
export type WorkerReadiness = {
  status: 'ready' | 'not_ready';
  checks: Partial<Record<Dependency, 'up' | 'down'>>;
};
export type HeartbeatRecord = {
  component: WorkerComponent;
  instanceId: string;
  startedAt: number;
  lastSeenAt: number;
  readiness: WorkerReadiness;
};
export type WorkerObservation = HeartbeatRecord & { status: 'HEALTHY' | 'STALE' };
export interface HeartbeatStore {
  write(record: HeartbeatRecord): Promise<void>;
  remove(component: WorkerComponent, instanceId: string): Promise<void>;
  read(component: WorkerComponent): Promise<{ instances: WorkerObservation[]; truncated: boolean }>;
}

/** Bounds the response; clients must also disable offline buffering / bound command execution. */
export async function bounded<T>(work: () => Promise<T>, timeoutMs = 2000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(work),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('HEALTH_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function requiredDependencies(component: WorkerComponent): Dependency[] {
  return component === 'worker-capture' ||
    component === 'worker-render' ||
    component === 'worker-publish'
    ? ['postgres', 'redis', 'storage']
    : ['postgres', 'redis'];
}

export async function checkWorkerReadiness(
  component: WorkerComponent,
  probes: WorkerProbes,
  timeoutMs = 2000,
): Promise<WorkerReadiness> {
  const selected = Object.fromEntries(
    requiredDependencies(component).map((name) => [
      name,
      probes[name] ??
        (async () => {
          throw new Error('DEPENDENCY_MISSING');
        }),
    ]),
  );
  return checkReadiness(selected, timeoutMs);
}

export type WorkerRuntimeOptions = {
  store: HeartbeatStore;
  probes: WorkerProbes;
  now?: () => number;
  logger?: StructuredLogger;
  timeoutMs?: number;
};

/** One session per started runtime, independent of any job or canonical lease. */
export class WorkerHeartbeat {
  readonly instanceId = randomUUID();
  readonly startedAt: number;
  private timer?: ReturnType<typeof setInterval>;
  private inFlight: Promise<void> | undefined;
  private stopping = false;
  private closing?: Promise<void>;
  private readonly now: () => number;
  private readonly logger: StructuredLogger;

  private constructor(
    readonly component: WorkerComponent,
    private readonly options: WorkerRuntimeOptions,
  ) {
    this.now = options.now ?? Date.now;
    this.startedAt = this.now();
    this.logger = options.logger ?? new StructuredLogger(component);
  }

  static async start(component: WorkerComponent, options: WorkerRuntimeOptions) {
    const session = new WorkerHeartbeat(component, options);
    await session.refresh();
    session.timer = setInterval(() => {
      void session.refresh();
    }, HEARTBEAT_INTERVAL_MS);
    session.timer.unref();
    session.logger.log('info', 'worker.started', { instanceId: session.instanceId });
    return session;
  }

  refresh(): Promise<void> {
    if (this.stopping) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    // Coalesce overlapping refresh requests. Redis storage also bounds outstanding writes.
    const operation = this.refreshOnce();
    const settled = operation.finally(() => {
      this.inFlight = undefined;
    });
    this.inFlight = settled;
    return settled;
  }

  private async refreshOnce() {
    try {
      const readiness = await checkWorkerReadiness(
        this.component,
        this.options.probes,
        this.options.timeoutMs,
      );
      if (readiness.status !== 'ready')
        this.logger.log('warn', 'dependency.not_ready', { instanceId: this.instanceId });
      if (this.stopping) return;
      await bounded(
        () =>
          this.options.store.write({
            component: this.component,
            instanceId: this.instanceId,
            startedAt: this.startedAt,
            lastSeenAt: this.now(),
            readiness,
          }),
        this.options.timeoutMs,
      );
    } catch {
      this.logger.log('warn', 'heartbeat.failed', { instanceId: this.instanceId });
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.stopping = true;
    clearInterval(this.timer);
    this.closing = (async () => {
      await this.inFlight;
      try {
        await bounded(
          () => this.options.store.remove(this.component, this.instanceId),
          this.options.timeoutMs,
        );
      } catch {
        // Redis TTL remains authoritative if shutdown cannot reach Redis.
        this.logger.log('warn', 'heartbeat.failed', { instanceId: this.instanceId });
      }
      this.logger.log('info', 'worker.stopped', { instanceId: this.instanceId });
    })();
    return this.closing;
  }
}

export async function readWorkerHealth(store: HeartbeatStore, timeoutMs = 2000) {
  return Promise.all(
    WORKER_COMPONENTS.map(async (component) => {
      try {
        const result = await bounded(() => store.read(component), timeoutMs);
        return {
          component,
          available: true as const,
          ...result,
          status:
            result.instances.length === 0
              ? ('MISSING' as const)
              : result.instances.some((instance) => instance.status === 'HEALTHY')
                ? ('HEALTHY' as const)
                : ('STALE' as const),
        };
      } catch {
        return { component, available: false as const };
      }
    }),
  );
}
