import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, it } from 'vitest';

import { materializePrivateObject } from '../../packages/media/src/index.js';
import type { PrivateStorage } from '../../packages/media/src/index.js';

class MemoryStorage implements PrivateStorage {
  readonly bucket = 'fixture';
  constructor(private readonly bytes: Uint8Array) {}
  async put() {
    throw new Error('not-used');
  }
  async get() {
    const bytes = this.bytes;
    return (async function* () {
      yield bytes;
    })();
  }
}

it('materializes private immutable bytes and validates the expected checksum', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-render-materialize-'));
  const bytes = Buffer.from('exact-render-input');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  try {
    const target = join(dir, 'asset.bin');
    await expect(
      materializePrivateObject({
        storage: new MemoryStorage(bytes),
        objectKey: 'private/input',
        targetPath: target,
        expectedChecksumSha256: checksum,
      }),
    ).resolves.toMatchObject({ checksumSha256: checksum });
    expect(await readFile(target)).toEqual(bytes);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

it('fails closed on checksum mismatch', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'vce-render-materialize-'));
  try {
    await expect(
      materializePrivateObject({
        storage: new MemoryStorage(Buffer.from('wrong')),
        objectKey: 'private/input',
        targetPath: join(dir, 'asset.bin'),
        expectedChecksumSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow('INPUT_CHECKSUM_MISMATCH');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
