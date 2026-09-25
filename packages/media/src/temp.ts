import {
  mkdtemp,
  mkdir,
  lstat,
  realpath,
  writeFile,
  readFile,
  opendir,
  rm,
} from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { invariant } from '@vision/domain';
import { StructuredLogger } from '@vision/observability';

const marker = '.vce-ephemeral-owner';
// No path-only delete API: the returned closure proves creation by this process.
export async function createOwnedTemp(
  root: string,
  kind: 'upload' | 'capture' | 'render',
  operationId: string,
  logger = new StructuredLogger('api'),
) {
  invariant(
    /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(operationId),
    'INVALID_TEMP_OWNER',
  );
  invariant(['upload', 'capture', 'render'].includes(kind), 'INVALID_TEMP_OWNER');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootPath = await realpath(root);
  const path = await mkdtemp(join(rootPath, `vce-${kind}-${operationId}-`));
  const identity = await lstat(path);
  const proof = randomUUID();
  await writeFile(join(path, marker), proof, { flag: 'wx', mode: 0o600 });
  let cleaned = false;
  return Object.freeze({
    path,
    async cleanup() {
      if (cleaned) return true;
      try {
        invariant(
          dirname(resolve(path)) === rootPath && (await realpath(root)) === rootPath,
          'TEMP_ROOT_MISMATCH',
        );
        const current = await lstat(path);
        invariant(
          current.isDirectory() &&
            !current.isSymbolicLink() &&
            current.ino === identity.ino &&
            current.dev === identity.dev,
          'TEMP_OWNER_MISMATCH',
        );
        invariant((await realpath(path)) === path, 'TEMP_OWNER_MISMATCH');
        const proofInfo = await lstat(join(path, marker));
        invariant(
          proofInfo.isFile() && !proofInfo.isSymbolicLink() && proofInfo.size === proof.length,
          'TEMP_OWNER_MISMATCH',
        );
        invariant((await readFile(join(path, marker), 'utf8')) === proof, 'TEMP_OWNER_MISMATCH');
        let entries = 0;
        async function bounded(directory: string, depth: number): Promise<void> {
          invariant(depth <= 16, 'TEMP_CLEANUP_LIMIT');
          const dir = await opendir(directory);
          for await (const entry of dir) {
            invariant(++entries <= 10000, 'TEMP_CLEANUP_LIMIT');
            // rm unlinks symlinks. Neither the scan nor deletion follows their targets.
            if (entry.isDirectory()) await bounded(join(directory, entry.name), depth + 1);
          }
        }
        await bounded(path, 0);
        await rm(path, { recursive: true, force: false });
        cleaned = true;
        logger.log('info', 'temp.cleanup_completed', { operationId });
        return true;
      } catch (error) {
        logger.log('warn', 'temp.cleanup_failed', { operationId, error });
        return false;
      }
    },
  });
}
