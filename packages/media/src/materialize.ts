import { StructuredLogger } from '@vision/observability';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, link, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { invariant } from '@vision/domain';

import type { PrivateStorage } from './storage.js';
import { CapacityGuard } from './capacity.js';
import { boundedBytes } from './bounded-stream.js';

async function sha256File(path: string) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(path), hash);
  return hash.digest('hex');
}

export async function materializePrivateObject(input: {
  storage: PrivateStorage;
  objectKey: string;
  targetPath: string;
  expectedChecksumSha256?: string | null;
  expectedSizeBytes?: number;
  capacity?: CapacityGuard;
}) {
  const capacity = input.capacity ?? new CapacityGuard();
  const maximum = capacity.policy.maxArtifactBytes;
  if (input.expectedSizeBytes !== undefined) capacity.artifactSize(input.expectedSizeBytes);
  await capacity.require(dirname(input.targetPath), input.expectedSizeBytes ?? maximum);
  await mkdir(dirname(input.targetPath), { recursive: true });
  const partial = `${input.targetPath}.${randomUUID()}.part`;
  try {
    const body = await input.storage.get(input.objectKey);
    await pipeline(
      Readable.from(boundedBytes(body, maximum, input.expectedSizeBytes)),
      createWriteStream(partial, { flags: 'wx', mode: 0o600 }),
    );
    await capacity.file(partial);
    const checksumSha256 = await sha256File(partial);
    if (input.expectedChecksumSha256)
      invariant(checksumSha256 === input.expectedChecksumSha256, 'INPUT_CHECKSUM_MISMATCH');
    // Atomic publication without replacing an existing complete artifact.
    await link(partial, input.targetPath);
    return { targetPath: input.targetPath, checksumSha256 } as const;
  } finally {
    await unlink(partial).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT')
        new StructuredLogger('worker-render').log('warn', 'temp.cleanup_failed', { error });
    });
  }
}

export async function verifyLocalObjectChecksum(path: string, expectedChecksumSha256: string) {
  return (await sha256File(path)) === expectedChecksumSha256;
}

export { sha256File };
