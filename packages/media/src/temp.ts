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
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const RECOVERABLE_TEMP =
  /^vce-(upload|capture)-([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12})-([A-Za-z0-9]{6})$/i;

export type RecoverableTempKind = 'upload' | 'capture';
export type RecoverableTempCandidate = Readonly<{ kind: RecoverableTempKind; operationId: string }>;
export type TempRecoverySummary = Readonly<{
  scanned: number;
  deleted: number;
  retained: number;
  invalid: number;
}>;

async function boundedWorkspace(path: string) {
  let entries = 0;
  async function bounded(directory: string, depth: number): Promise<void> {
    invariant(depth <= 16, 'TEMP_CLEANUP_LIMIT');
    const dir = await opendir(directory);
    for await (const entry of dir) {
      invariant(++entries <= 10000, 'TEMP_CLEANUP_LIMIT');
      if (entry.isDirectory()) await bounded(join(directory, entry.name), depth + 1);
    }
  }
  await bounded(path, 0);
}
// No path-only delete API: the returned closure proves creation by this process.
export async function createOwnedTemp(
  root: string,
  kind: 'upload' | 'capture' | 'render',
  operationId: string,
  logger = new StructuredLogger('api'),
) {
  invariant(UUID.test(operationId), 'INVALID_TEMP_OWNER');
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
        // rm unlinks symlinks. Neither the scan nor deletion follows their targets.
        await boundedWorkspace(path);
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

/**
 * Crash recovery for VCE-owned upload/capture workspaces only.
 * A filename or age is never enough: callers must prove the canonical operation is terminal.
 * Render workspaces are intentionally excluded until render execution is durably fenced.
 */
export async function recoverOwnedTemps(
  root: string,
  options: Readonly<{
    kinds: readonly RecoverableTempKind[];
    isTerminal(candidate: RecoverableTempCandidate): Promise<boolean>;
    limit?: number;
  }>,
  logger = new StructuredLogger('api'),
): Promise<TempRecoverySummary> {
  const limit = options.limit ?? 100;
  invariant(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, 'TEMP_RECOVERY_LIMIT');
  invariant(options.kinds.length > 0, 'TEMP_RECOVERY_KIND_REQUIRED');
  invariant(
    options.kinds.every((kind) => kind === 'upload' || kind === 'capture'),
    'TEMP_RECOVERY_KIND_INVALID',
  );

  await mkdir(root, { recursive: true, mode: 0o700 });
  const rootPath = await realpath(root);
  const allowedKinds = new Set(options.kinds);
  let scanned = 0;
  let deleted = 0;
  let retained = 0;
  let invalid = 0;

  const dir = await opendir(rootPath);
  for await (const entry of dir) {
    const match = RECOVERABLE_TEMP.exec(entry.name);
    if (!match) continue;
    const kind = match[1] as RecoverableTempKind;
    const operationId = match[2]!;
    if (!allowedKinds.has(kind)) continue;
    if (scanned >= limit) break;
    scanned++;

    const path = join(rootPath, entry.name);
    const candidate = { kind, operationId } as const;
    try {
      const identity = await lstat(path);
      invariant(identity.isDirectory() && !identity.isSymbolicLink(), 'TEMP_OWNER_MISMATCH');
      invariant(dirname(resolve(path)) === rootPath, 'TEMP_ROOT_MISMATCH');
      invariant((await realpath(path)) === path, 'TEMP_OWNER_MISMATCH');

      const markerPath = join(path, marker);
      const markerInfo = await lstat(markerPath);
      invariant(
        markerInfo.isFile() && !markerInfo.isSymbolicLink() && markerInfo.size === 36,
        'TEMP_OWNER_MISMATCH',
      );
      const proof = await readFile(markerPath, 'utf8');
      invariant(UUID.test(proof), 'TEMP_OWNER_MISMATCH');

      if (!(await options.isTerminal(candidate))) {
        retained++;
        continue;
      }

      invariant((await realpath(root)) === rootPath, 'TEMP_ROOT_MISMATCH');
      const current = await lstat(path);
      invariant(
        current.isDirectory() &&
          !current.isSymbolicLink() &&
          current.ino === identity.ino &&
          current.dev === identity.dev,
        'TEMP_OWNER_MISMATCH',
      );
      invariant((await realpath(path)) === path, 'TEMP_OWNER_MISMATCH');
      const currentMarker = await lstat(markerPath);
      invariant(
        currentMarker.isFile() &&
          !currentMarker.isSymbolicLink() &&
          currentMarker.size === proof.length,
        'TEMP_OWNER_MISMATCH',
      );
      invariant((await readFile(markerPath, 'utf8')) === proof, 'TEMP_OWNER_MISMATCH');
      await boundedWorkspace(path);
      await rm(path, { recursive: true, force: false });
      deleted++;
      logger.log('info', 'temp.cleanup_completed', { operationId });
    } catch (error) {
      invalid++;
      logger.log('warn', 'temp.cleanup_failed', { operationId, error });
    }
  }

  return Object.freeze({ scanned, deleted, retained, invalid });
}
