import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';

import { invariant } from '@vision/domain';

import type { PrivateStorage } from './storage.js';

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
}) {
  await mkdir(dirname(input.targetPath), { recursive: true });
  const body = await input.storage.get(input.objectKey);
  await pipeline(Readable.from(body), createWriteStream(input.targetPath, { flags: 'wx' }));

  const checksumSha256 = await sha256File(input.targetPath);

  if (input.expectedChecksumSha256)
    invariant(checksumSha256 === input.expectedChecksumSha256, 'INPUT_CHECKSUM_MISMATCH');

  return {
    targetPath: input.targetPath,
    checksumSha256,
  } as const;
}

export async function verifyLocalObjectChecksum(path: string, expectedChecksumSha256: string) {
  return (await sha256File(path)) === expectedChecksumSha256;
}

export { sha256File };
