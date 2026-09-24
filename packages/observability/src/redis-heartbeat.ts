import {
  HEARTBEAT_RETENTION_MS,
  HEARTBEAT_TTL_MS,
  INSTANCE_LIMIT,
  requiredDependencies,
  type HeartbeatRecord,
  type HeartbeatStore,
  type WorkerComponent,
  type WorkerObservation,
} from './worker-heartbeat.js';

/** Structural adapter: use an existing non-blocking ioredis connection. */
export interface HeartbeatRedis {
  readonly status?: string;
  eval(script: string, numberOfKeys: number, ...args: (string | number)[]): Promise<unknown>;
}
const writeScript = `
local now = redis.call('TIME')
local ms = now[1] * 1000 + math.floor(now[2] / 1000)
if redis.call('EXISTS', KEYS[4]) == 1 or math.abs(ms - tonumber(ARGV[5])) >= tonumber(ARGV[3]) then return 0 end
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', ms - ARGV[4])
redis.call('ZADD', KEYS[1], ms, ARGV[1])
redis.call('PEXPIRE', KEYS[1], ARGV[4])
redis.call('SET', KEYS[2], ARGV[2], 'PX', ARGV[4])
local remaining = tonumber(ARGV[3]) - math.max(0, ms - tonumber(ARGV[5]))
redis.call('SET', KEYS[3], '1', 'PX', remaining)
return 1`;
const removeScript = `
redis.call('SET', KEYS[4], '1', 'PX', ARGV[2])
redis.call('ZREM', KEYS[1], ARGV[1])
return redis.call('DEL', KEYS[2], KEYS[3])`;
const readScript = `
local ids = redis.call('ZREVRANGE', KEYS[1], 0, ARGV[1])
local result = {}
for _, id in ipairs(ids) do
  local record = redis.call('GET', ARGV[2] .. id)
  if record then
    table.insert(result, record)
    table.insert(result, tostring(redis.call('EXISTS', ARGV[2] .. id .. ':alive')))
  end
end
return result`;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class RedisHeartbeatStore implements HeartbeatStore {
  private readonly writing = new Set<string>();
  constructor(
    private readonly client: () => Promise<HeartbeatRedis>,
    private readonly prefix = 'vce:runtime',
  ) {}
  private keys(component: WorkerComponent, instanceId = '') {
    const base = `${this.prefix}:{${component}}:`;
    return {
      index: `${base}instances`,
      record: `${base}instance:${instanceId}`,
      base: `${base}instance:`,
    };
  }
  private async connection() {
    const client = await this.client();
    if (client.status !== undefined && client.status !== 'ready')
      throw new Error('REDIS_NOT_READY');
    return client;
  }
  async write(record: HeartbeatRecord) {
    if (this.writing.has(record.instanceId)) throw new Error('HEARTBEAT_WRITE_PENDING');
    this.writing.add(record.instanceId);
    try {
      const keys = this.keys(record.component, record.instanceId);
      const result = await (
        await this.connection()
      ).eval(
        writeScript,
        4,
        keys.index,
        keys.record,
        `${keys.record}:alive`,
        `${keys.record}:stopped`,
        record.instanceId,
        JSON.stringify(record),
        HEARTBEAT_TTL_MS,
        HEARTBEAT_RETENTION_MS,
        record.lastSeenAt,
      );
      if (result !== 1) throw new Error('HEARTBEAT_WRITE_EXPIRED');
    } finally {
      this.writing.delete(record.instanceId);
    }
  }
  async remove(component: WorkerComponent, instanceId: string) {
    const keys = this.keys(component, instanceId);
    await (
      await this.connection()
    ).eval(
      removeScript,
      4,
      keys.index,
      keys.record,
      `${keys.record}:alive`,
      `${keys.record}:stopped`,
      instanceId,
      HEARTBEAT_RETENTION_MS,
    );
  }
  async read(component: WorkerComponent) {
    const keys = this.keys(component);
    const rows = await (
      await this.connection()
    ).eval(readScript, 1, keys.index, INSTANCE_LIMIT, keys.base);
    if (!Array.isArray(rows)) throw new Error('HEARTBEAT_INVALID');
    const instances: WorkerObservation[] = [];
    for (let index = 0; index < rows.length && instances.length < INSTANCE_LIMIT; index += 2) {
      // Explicit projection: never spread the operational Redis JSON into an API response.
      const raw: unknown = JSON.parse(String(rows[index]));
      if (!raw || typeof raw !== 'object') throw new Error('HEARTBEAT_INVALID');
      const record = raw as HeartbeatRecord;
      if (
        record.component !== component ||
        !uuid.test(record.instanceId) ||
        !Number.isSafeInteger(record.startedAt) ||
        !Number.isSafeInteger(record.lastSeenAt) ||
        record.startedAt < 0 ||
        record.lastSeenAt < record.startedAt ||
        !record.readiness ||
        !['ready', 'not_ready'].includes(record.readiness.status)
      )
        throw new Error('HEARTBEAT_INVALID');
      const checks: HeartbeatRecord['readiness']['checks'] = {};
      for (const dependency of requiredDependencies(component)) {
        const value = record.readiness.checks?.[dependency];
        if (value !== 'up' && value !== 'down') throw new Error('HEARTBEAT_INVALID');
        checks[dependency] = value;
      }
      instances.push({
        component,
        instanceId: record.instanceId,
        startedAt: record.startedAt,
        lastSeenAt: record.lastSeenAt,
        status: rows[index + 1] === '1' ? 'HEALTHY' : 'STALE',
        readiness: {
          status: Object.values(checks).every((value) => value === 'up') ? 'ready' : 'not_ready',
          checks,
        },
      });
    }
    return { instances, truncated: rows.length > INSTANCE_LIMIT * 2 };
  }
}
