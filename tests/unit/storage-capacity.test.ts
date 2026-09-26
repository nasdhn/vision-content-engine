import { randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  access,
  symlink,
  rename,
  rm,
  utimes,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import {
  CapacityGuard,
  createOwnedTemp,
  recoverOwnedTemps,
  boundedBytes,
  materializePrivateObject,
  renderWorkingBytes,
  S3PrivateStorage,
} from '../../packages/media/src/index.js';
import { capacityPolicy, CAPACITY_DEFAULTS } from '../../packages/shared/src/index.js';
import { StructuredLogger } from '../../packages/observability/src/index.js';
import { Readable } from 'node:stream';

const quiet = new StructuredLogger('api', () => {});
const policy = { minimumFreeBytes: 10, maxUploadBytes: 4, maxArtifactBytes: 4 };
const guard = (free = 100) =>
  new CapacityGuard(
    policy,
    async () => ({ bavail: BigInt(free), bsize: 1n, blocks: 1000n }),
    quiet,
  );
it.each([14, 15])('allows equality and capacity above the exact boundary: %s', async (free) => {
  expect(await guard(free).require('/unused', 4)).toEqual({ freeBytes: free, requiredBytes: 14 });
});
it.each([0, 9, 13])('denies insufficient capacity: %s', async (free) => {
  await expect(guard(free).require('/unused', 4)).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
});
it.each([-1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 1.5, 0])(
  'rejects invalid policy bytes: %s',
  (value) => {
    for (const key of Object.keys(policy))
      expect(() => capacityPolicy({ ...policy, [key]: value })).toThrow('INVALID_CAPACITY_POLICY');
  },
);
it('rejects overflow, invalid disk observations and unavailable stats instead of assuming unlimited space', async () => {
  await expect(guard().require('/unused', Number.MAX_SAFE_INTEGER)).rejects.toThrow(
    'INVALID_CAPACITY_REQUEST',
  );
  expect(() => renderWorkingBytes([Number.MAX_SAFE_INTEGER], Number.MAX_SAFE_INTEGER)).toThrow();
  for (const stats of [
    { bavail: -1n, bsize: 1n, blocks: 1n },
    { bavail: 2n, bsize: 1n, blocks: 1n },
    { bavail: 1n, bsize: 0n, blocks: 1n },
  ]) {
    await expect(
      new CapacityGuard(policy, async () => stats, quiet).require('/unused', 0),
    ).rejects.toThrow('LOCAL_CAPACITY_UNAVAILABLE');
  }
  const bad = new CapacityGuard(
    policy,
    async () => {
      throw new Error('sensitive path');
    },
    quiet,
  );
  expect(await bad.read('/unused')).toMatchObject({ available: false });
});
it('bounds a stalled stat call', async () => {
  vi.useFakeTimers();
  try {
    const result = new CapacityGuard(policy, () => new Promise(() => {}), quiet).freeBytes(
      '/unused',
    );
    const check = expect(result).rejects.toThrow('LOCAL_CAPACITY_UNAVAILABLE');
    await vi.advanceTimersByTimeAsync(1001);
    await check;
  } finally {
    vi.useRealTimers();
  }
});
it('distinguishes healthy, low and insufficient snapshots without exposing paths', async () => {
  for (const [free, status] of [
    [14, 'HEALTHY'],
    [10, 'LOW'],
    [9, 'INSUFFICIENT'],
  ] as const) {
    const result = await guard(free).read('/private/sentinel');
    expect(result).toMatchObject({ available: true, localFreeBytes: free, status });
    expect(JSON.stringify(result)).not.toContain('sentinel');
  }
});
it.each([3, 4])('allows streams below/at the limit: %s', async (size) => {
  const result = [];
  for await (const chunk of boundedBytes(Readable.from([Buffer.alloc(size)]), 4))
    result.push(chunk);
  expect(Buffer.concat(result).length).toBe(size);
});
it.each([undefined, 3])(
  'stops an oversized stream, including dishonest Content-Length %s',
  async (declared) => {
    let closed = false;
    let lastChunkRead = false;
    async function* source() {
      try {
        yield Buffer.alloc(3);
        yield Buffer.alloc(2);
        lastChunkRead = true;
        yield Buffer.alloc(1);
      } finally {
        closed = true;
      }
    }
    await expect(
      (async () => {
        for await (const _chunk of boundedBytes(source(), 4, declared)) void _chunk;
      })(),
    ).rejects.toThrow('ARTIFACT_TOO_LARGE');
    expect(closed).toBe(true);
    expect(lastChunkRead).toBe(false);
  },
);
it('cleans partial downloads, does not overwrite complete files, and denies before fetching on a full disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  try {
    const get = vi.fn(async () => Readable.from([Buffer.from('abc'), Buffer.from('de')]));
    const storage = { bucket: 'fixture', put: vi.fn(), get };
    const targetPath = join(root, 'output');
    await expect(
      materializePrivateObject({ storage, objectKey: 'private', targetPath, capacity: guard(0) }),
    ).rejects.toThrow('INSUFFICIENT_LOCAL_CAPACITY');
    expect(get).not.toHaveBeenCalled();
    await expect(
      materializePrivateObject({ storage, objectKey: 'private', targetPath, capacity: guard() }),
    ).rejects.toThrow('ARTIFACT_TOO_LARGE');
    expect(await readdir(root)).toEqual([]);
    get.mockImplementation(async () => Readable.from([Buffer.from('abcd')]));
    await materializePrivateObject({
      storage,
      objectKey: 'private',
      targetPath,
      expectedSizeBytes: 4,
      capacity: guard(),
    });
    expect(await readFile(targetPath, 'utf8')).toBe('abcd');
    await expect(
      materializePrivateObject({ storage, objectKey: 'private', targetPath, capacity: guard() }),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(['output']);
    expect(await readFile(targetPath, 'utf8')).toBe('abcd');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('only deletes its own ephemeral workspace; foreign/canonical content and nested symlink targets survive', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  try {
    const canonical = join(root, 'canonical');
    await mkdir(canonical);
    await writeFile(join(canonical, 'master'), 'immutable');
    const workspace = await createOwnedTemp(root, 'render', randomUUID(), quiet);
    await symlink(canonical, join(workspace.path, 'outside'));
    await writeFile(join(workspace.path, 'intermediate'), 'temporary');
    expect(await workspace.cleanup()).toBe(true);
    expect(await workspace.cleanup()).toBe(true);
    expect(await readFile(join(canonical, 'master'), 'utf8')).toBe('immutable');
    await expect(createOwnedTemp(root, 'render', '../../canonical', quiet)).rejects.toThrow(
      'INVALID_TEMP_OWNER',
    );
    // Method rebinding cannot redirect the closure to a caller-selected path.
    const other = await createOwnedTemp(root, 'capture', randomUUID(), quiet);
    expect(await other.cleanup.call({ path: canonical })).toBe(true);
    await expect(access(canonical)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('refuses replaced workspace symlinks and logs cleanup failure without masking the original error', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  const lines: string[] = [];
  try {
    const workspace = await createOwnedTemp(
      root,
      'upload',
      randomUUID(),
      new StructuredLogger('api', (line) => lines.push(line)),
    );
    const original = `${workspace.path}-original`;
    await rename(workspace.path, original);
    const foreign = join(root, 'foreign');
    await mkdir(foreign);
    await symlink(foreign, workspace.path);
    const originalError = new Error('original operation failure');
    await expect(
      (async () => {
        try {
          throw originalError;
        } finally {
          await workspace.cleanup();
        }
      })(),
    ).rejects.toBe(originalError);
    expect(lines.map((line) => JSON.parse(line).event)).toContain('temp.cleanup_failed');
    expect(lines.join('')).not.toContain(root);
    await expect(access(foreign)).resolves.toBeUndefined();
    await expect(access(original)).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('does not sweep either recent or old directories merely by naming/age', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  try {
    const old = join(root, `vce-upload-${randomUUID()}-ABCdef`);
    await mkdir(old);
    await utimes(old, new Date(0), new Date(0));
    const recent = await createOwnedTemp(root, 'upload', randomUUID(), quiet);
    const operation = await createOwnedTemp(root, 'render', randomUUID(), quiet);
    await operation.cleanup();
    await expect(access(old)).resolves.toBeUndefined();
    await expect(access(recent.path)).resolves.toBeUndefined();
    await recent.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('recovers only structurally owned terminal upload/capture workspaces and never render workspaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  try {
    const activeId = randomUUID();
    const terminalId = randomUUID();
    const captureId = randomUUID();
    const renderId = randomUUID();
    const active = await createOwnedTemp(root, 'upload', activeId, quiet);
    const terminal = await createOwnedTemp(root, 'upload', terminalId, quiet);
    const capture = await createOwnedTemp(root, 'capture', captureId, quiet);
    const render = await createOwnedTemp(root, 'render', renderId, quiet);
    const forgedId = randomUUID();
    const forged = join(root, `vce-upload-${forgedId}-ABCdef`);
    await mkdir(forged);
    await writeFile(join(forged, '.vce-ephemeral-owner'), 'not-a-valid-owner');
    const foreign = join(root, 'foreign');
    await mkdir(foreign);
    await writeFile(join(foreign, 'canonical'), 'keep');
    const symlinkId = randomUUID();
    const replaced = join(root, `vce-upload-${symlinkId}-ABCdef`);
    await symlink(foreign, replaced);

    const summary = await recoverOwnedTemps(
      root,
      {
        kinds: ['upload'],
        isTerminal: async ({ operationId }) =>
          operationId === terminalId || operationId === forgedId || operationId === symlinkId,
      },
      quiet,
    );

    expect(summary).toEqual({ scanned: 4, deleted: 1, retained: 1, invalid: 2 });
    await expect(access(terminal.path)).rejects.toThrow();
    await expect(access(active.path)).resolves.toBeUndefined();
    await expect(access(capture.path)).resolves.toBeUndefined();
    await expect(access(render.path)).resolves.toBeUndefined();
    await expect(access(forged)).resolves.toBeUndefined();
    await expect(access(join(foreign, 'canonical'))).resolves.toBeUndefined();

    await active.cleanup();
    await capture.cleanup();
    await render.cleanup();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it('validates local upload bytes before S3 and destroys oversized remote bodies', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vce-capacity-test-'));
  const send = vi.fn();
  const storage = new S3PrivateStorage({ send } as never, 'fixture-private', guard());
  try {
    const file = join(root, 'source');
    await writeFile(file, '12345');
    await expect(storage.put('key', file, 5, 'text/plain')).rejects.toThrow('ARTIFACT_TOO_LARGE');
    await expect(storage.put('key', file, 4, 'text/plain')).rejects.toThrow('ARTIFACT_TOO_LARGE');
    expect(send).not.toHaveBeenCalled();
    const body = Readable.from([Buffer.alloc(5)]);
    send.mockResolvedValueOnce({ Body: body, ContentLength: 5 });
    await expect(storage.get('key')).rejects.toThrow('ARTIFACT_TOO_LARGE');
    expect(body.destroyed).toBe(true);
    const unknown = Readable.from([Buffer.alloc(5)]);
    send.mockResolvedValueOnce({ Body: unknown });
    const stream = await storage.get('key');
    await expect(
      (async () => {
        for await (const chunk of stream) void chunk;
      })(),
    ).rejects.toThrow('ARTIFACT_TOO_LARGE');
    expect(unknown.destroyed).toBe(true);
    expect(CAPACITY_DEFAULTS.maxArtifactBytes).toBe(512 * 1024 * 1024);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
