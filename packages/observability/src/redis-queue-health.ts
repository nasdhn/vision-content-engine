import type { HeartbeatRedis } from './redis-heartbeat.js';
import { QUEUE_SAMPLE_LIMIT, type QueueHealthReader, type QueueState } from './queue-health.js';

const countsScript = `
local result = {}
for _, state in ipairs(ARGV) do
  local key = KEYS[1] .. state
  local count
  if state == 'wait' or state == 'paused' or state == 'active' then
    count = redis.call('LLEN', key)
  else count = redis.call('ZCARD', key) end
  table.insert(result, count)
end
return result`;
const sampleScript = `
local state = ARGV[1]
local ids
if state == 'wait' or state == 'paused' or state == 'active' then
  ids = redis.call('LRANGE', KEYS[1] .. state, -tonumber(ARGV[2]), -1)
else ids = redis.call('ZRANGE', KEYS[1] .. state, 0, tonumber(ARGV[2]) - 1) end
local result = {}
for _, id in ipairs(ids) do
  local times = redis.call('HMGET', KEYS[1] .. id, 'timestamp', 'processedOn')
  table.insert(result, times)
end
return result`;

/** BullMQ 6 Redis lists/sets, using QueueKeys' prefix. No payloads or legacy-marker cleanup. */
export class RedisQueueHealthReader implements QueueHealthReader {
  constructor(
    private readonly client: () => Promise<HeartbeatRedis>,
    private readonly queueKey: string,
  ) {}
  private async connection() {
    const client = await this.client();
    if (client.status !== undefined && client.status !== 'ready')
      throw new Error('REDIS_NOT_READY');
    return client;
  }
  async isPaused() {
    return (
      (await (
        await this.connection()
      ).eval("return redis.call('HEXISTS', KEYS[1], 'paused')", 1, `${this.queueKey}meta`)) === 1
    );
  }
  async getJobCounts(...types: QueueState[]): Promise<Record<string, number>> {
    const values = await (
      await this.connection()
    ).eval(
      countsScript,
      1,
      this.queueKey,
      ...types.map((type) => (type === 'waiting' ? 'wait' : type)),
    );
    if (!Array.isArray(values) || values.length !== types.length)
      throw new Error('QUEUE_HEALTH_INVALID');
    return Object.fromEntries(types.map((type, index) => [type, values[index] as number]));
  }
  async getJobs(types: QueueState[], start: number, end: number, asc: boolean) {
    if (types.length !== 1 || start !== 0 || end !== QUEUE_SAMPLE_LIMIT - 1 || !asc)
      throw new Error('QUEUE_SAMPLE_INVALID');
    const state = types[0] === 'waiting' ? 'wait' : types[0]!;
    const rows = await (
      await this.connection()
    ).eval(sampleScript, 1, this.queueKey, state, QUEUE_SAMPLE_LIMIT);
    if (!Array.isArray(rows)) throw new Error('QUEUE_HEALTH_INVALID');
    return rows.flatMap((row: unknown) => {
      if (!Array.isArray(row) || !row[0]) return [];
      return [{ timestamp: Number(row[0]), ...(row[1] ? { processedOn: Number(row[1]) } : {}) }];
    });
  }
}
