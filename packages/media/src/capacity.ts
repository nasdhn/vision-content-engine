import { statfs, lstat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { invariant, DomainError } from '@vision/domain';
import { capacityPolicy, type CapacityPolicy, MIB } from '@vision/shared';
import { StructuredLogger } from '@vision/observability';

type DiskStats = { bavail: bigint; bsize: bigint; blocks: bigint };
export type DiskReader = (path: string) => Promise<DiskStats>;
export const CAPACITY_SCRATCH_BYTES = 256 * MIB;
const disk: DiskReader = async (path) => {
  // Probe the nearest existing ancestor without materializing the configured work root.
  for (let depth = 0; depth < 64; depth++) {
    try {
      return await statfs(path, { bigint: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(path) === path) throw error;
      path = dirname(path);
    }
  }
  throw new Error('LOCAL_CAPACITY_UNAVAILABLE');
};
export class CapacityGuard {
  readonly policy: CapacityPolicy;
  constructor(
    policy: CapacityPolicy = capacityPolicy(),
    private readonly readDisk: DiskReader = disk,
    private readonly logger = new StructuredLogger('api'),
  ) {
    this.policy = capacityPolicy(policy);
  }
  async freeBytes(path: string) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const stats = await Promise.race([
        this.readDisk(path),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('LOCAL_CAPACITY_UNAVAILABLE')), 1000);
        }),
      ]);
      invariant(
        typeof stats.bavail === 'bigint' &&
          typeof stats.bsize === 'bigint' &&
          typeof stats.blocks === 'bigint' &&
          stats.bavail >= 0n &&
          stats.bsize > 0n &&
          stats.blocks >= stats.bavail &&
          stats.bavail * stats.bsize <= BigInt(Number.MAX_SAFE_INTEGER),
        'LOCAL_CAPACITY_UNAVAILABLE',
      );
      return Number(stats.bavail * stats.bsize);
    } catch {
      this.logger.log('warn', 'capacity.check_failed', { errorCode: 'LOCAL_CAPACITY_UNAVAILABLE' });
      throw new DomainError('LOCAL_CAPACITY_UNAVAILABLE');
    } finally {
      clearTimeout(timer);
    }
  }
  async require(path: string, requestedBytes: number, operationId?: string) {
    invariant(
      Number.isSafeInteger(requestedBytes) && requestedBytes >= 0,
      'INVALID_CAPACITY_REQUEST',
    );
    const required = BigInt(this.policy.minimumFreeBytes) + BigInt(requestedBytes);
    invariant(required <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_CAPACITY_REQUEST');
    const freeBytes = await this.freeBytes(path);
    if (BigInt(freeBytes) < required) {
      this.logger.log('warn', 'capacity.insufficient', {
        operationId,
        freeBytes,
        requiredBytes: Number(required),
        errorCode: 'INSUFFICIENT_LOCAL_CAPACITY',
      });
      throw new DomainError('INSUFFICIENT_LOCAL_CAPACITY');
    }
    return { freeBytes, requiredBytes: Number(required) };
  }
  artifactSize(size: number, limit = this.policy.maxArtifactBytes) {
    invariant(Number.isSafeInteger(limit) && limit > 0, 'INVALID_CAPACITY_POLICY');
    invariant(Number.isSafeInteger(size) && size > 0, 'INVALID_ARTIFACT_SIZE');
    if (size > limit) {
      this.logger.log('warn', 'artifact.too_large', {
        artifactSizeBytes: size,
        errorCode: 'ARTIFACT_TOO_LARGE',
      });
      throw new DomainError('ARTIFACT_TOO_LARGE');
    }
    return size;
  }
  async file(path: string, limit = this.policy.maxArtifactBytes) {
    const info = await lstat(path);
    invariant(info.isFile() && !info.isSymbolicLink(), 'ARTIFACT_NOT_FILE');
    return this.artifactSize(info.size, limit);
  }
  async read(path: string) {
    const limits = this.policy;
    try {
      const localFreeBytes = await this.freeBytes(path);
      return {
        available: true as const,
        sampledAt: new Date().toISOString(),
        localFreeBytes,
        status:
          localFreeBytes < limits.minimumFreeBytes
            ? ('INSUFFICIENT' as const)
            : BigInt(localFreeBytes) <
                BigInt(limits.minimumFreeBytes) + BigInt(limits.maxUploadBytes)
              ? ('LOW' as const)
              : ('HEALTHY' as const),
        limits,
      };
    } catch {
      return { available: false as const, sampledAt: new Date().toISOString(), limits };
    }
  }
}
/** Conservative working-set allowance, not a prediction of encoded size. */
export function renderWorkingBytes(inputBytes: readonly number[], maxArtifactBytes: number) {
  invariant(
    Number.isSafeInteger(maxArtifactBytes) && maxArtifactBytes > 0,
    'INVALID_CAPACITY_POLICY',
  );
  let size = BigInt(CAPACITY_SCRATCH_BYTES) + 3n * BigInt(maxArtifactBytes);
  for (const bytes of inputBytes) {
    invariant(
      Number.isSafeInteger(bytes) && bytes > 0 && bytes <= maxArtifactBytes,
      'INVALID_ARTIFACT_SIZE',
    );
    size += BigInt(bytes) + 2n * BigInt(maxArtifactBytes);
  }
  invariant(size <= BigInt(Number.MAX_SAFE_INTEGER), 'INVALID_CAPACITY_REQUEST');
  return Number(size);
}
