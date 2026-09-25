import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

import { CaptureScenarioVersionSpecSchema } from '@vision/contracts';
import { Persistence } from '@vision/database';
import type { Actor, Prisma, PrismaClient, UnitOfWork } from '@vision/database';
import { mediaType, probeFile, CapacityGuard, CAPACITY_DEFAULTS } from '@vision/media';
import type { MediaProbe, PrivateStorage } from '@vision/media';
import { DomainError, invariant } from '@vision/domain';

import type { CaptureExecutionResult, CaptureLocalOutput } from './executor.js';

export const MAX_CAPTURE_ASSET_BYTES = CAPACITY_DEFAULTS.maxArtifactBytes;

type CaptureAssetMetadata = Parameters<UnitOfWork['captures']['finishAsset']>[1];

export type StagedCaptureAsset = {
  assetId: string;
  outputKey: string;
  role: CaptureLocalOutput['role'];
  diagnostic: boolean;
  sequence?: number;
  metadata: CaptureAssetMetadata;
  evidence: Prisma.InputJsonValue;
};

type LocalInspection = {
  metadata: CaptureAssetMetadata;
  technical: Record<string, unknown>;
};

function ownedPath(outputDirectory: string, filePath: string) {
  return Promise.all([realpath(outputDirectory), realpath(filePath)]).then(([root, file]) => {
    const rel = relative(root, file);

    invariant(
      rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel),
      'CAPTURE_OUTPUT_PATH_INVALID',
    );

    return file;
  });
}

async function hashLocalFile(path: string, capacity: CapacityGuard) {
  const info = await stat(path);

  invariant(info.isFile(), 'CAPTURE_OUTPUT_NOT_FILE');

  invariant(info.size > 0, 'CAPTURE_OUTPUT_EMPTY');

  invariant(
    info.size <= Math.min(MAX_CAPTURE_ASSET_BYTES, capacity.policy.maxArtifactBytes),
    'CAPTURE_OUTPUT_TOO_LARGE',
  );

  const hash = createHash('sha256');

  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
  }

  return {
    size: info.size,
    checksumSha256: hash.digest('hex'),
  };
}

async function pngDimensions(path: string) {
  const file = await open(path, 'r');

  try {
    const header = Buffer.alloc(24);

    const { bytesRead } = await file.read(header, 0, header.length, 0);

    invariant(bytesRead === header.length, 'CAPTURE_IMAGE_INVALID');

    invariant(
      header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
      'CAPTURE_IMAGE_INVALID',
    );

    const width = header.readUInt32BE(16);
    const height = header.readUInt32BE(20);

    invariant(width > 0 && height > 0, 'CAPTURE_IMAGE_INVALID');

    return {
      width,
      height,
    };
  } finally {
    await file.close();
  }
}

async function validateZip(path: string) {
  const file = await open(path, 'r');

  try {
    const header = Buffer.alloc(4);

    const { bytesRead } = await file.read(header, 0, header.length, 0);

    invariant(
      bytesRead === header.length &&
        header[0] === 0x50 &&
        header[1] === 0x4b &&
        ((header[2] === 0x03 && header[3] === 0x04) ||
          (header[2] === 0x05 && header[3] === 0x06) ||
          (header[2] === 0x07 && header[3] === 0x08)),
      'CAPTURE_TRACE_INVALID',
    );
  } finally {
    await file.close();
  }
}

async function inspectLocalOutput(
  output: CaptureLocalOutput,
  path: string,
  probe: (file: string) => Promise<MediaProbe>,
  capacity: CapacityGuard,
): Promise<LocalInspection> {
  const local = await hashLocalFile(path, capacity);

  if (output.role === 'VIDEO') {
    const result = await probe(path);

    invariant(result.video, 'CAPTURE_VIDEO_STREAM_REQUIRED');

    return {
      metadata: {
        kind: 'VIDEO',
        checksumSha256: local.checksumSha256,
        mimeType: mediaType(result),
        sizeBytes: BigInt(local.size),
        durationMs: result.durationMs,
        width: result.video.width,
        height: result.video.height,
        fps: result.video.fps,
        audioChannels: result.audio?.channels ?? null,
        sampleRate: result.audio?.sampleRate ?? null,
      },
      technical: {
        probe: result,
      },
    };
  }

  if (output.role === 'SCREENSHOT' || output.role === 'FRAME') {
    const dimensions = await pngDimensions(path);

    return {
      metadata: {
        kind: 'IMAGE',
        checksumSha256: local.checksumSha256,
        mimeType: 'image/png',
        sizeBytes: BigInt(local.size),
        durationMs: null,
        width: dimensions.width,
        height: dimensions.height,
        fps: null,
        audioChannels: null,
        sampleRate: null,
      },
      technical: {
        format: 'png',
        ...dimensions,
      },
    };
  }

  await validateZip(path);

  return {
    metadata: {
      kind: 'OTHER',
      checksumSha256: local.checksumSha256,
      mimeType: 'application/zip',
      sizeBytes: BigInt(local.size),
      durationMs: null,
      width: null,
      height: null,
      fps: null,
      audioChannels: null,
      sampleRate: null,
    },
    technical: {
      format: 'zip',
    },
  };
}

export class CaptureAssetStager {
  private readonly persistence: Persistence;

  constructor(
    private readonly db: PrismaClient,
    private readonly storage: PrivateStorage,
    private readonly probe: (file: string) => Promise<MediaProbe> = probeFile,
    private readonly capacity = new CapacityGuard(),
  ) {
    this.persistence = new Persistence(db);
  }

  private async verify(key: string, checksum: string, expectedSize: number) {
    const hash = createHash('sha256');

    let size = 0;

    for await (const chunk of await this.storage.get(key)) {
      size += chunk.byteLength;

      invariant(
        size <= expectedSize && size <= MAX_CAPTURE_ASSET_BYTES,
        'STORED_OBJECT_SIZE_MISMATCH',
      );

      hash.update(chunk);
    }

    invariant(
      size === expectedSize && hash.digest('hex') === checksum,
      'STORED_OBJECT_CHECKSUM_MISMATCH',
    );
  }

  async stage(
    actor: Actor,
    captureRunId: string,
    scenarioInput: unknown,
    result: CaptureExecutionResult,
    outputDirectory: string,
  ): Promise<StagedCaptureAsset[]> {
    invariant(
      actor.actorType === 'WORKER' && actor.actorId?.trim(),
      'CAPTURE_WORKER_ACTOR_REQUIRED',
    );

    const scenario = CaptureScenarioVersionSpecSchema.parse(scenarioInput);

    if (result.result === 'SUCCEEDED') {
      for (const output of scenario.outputs) {
        if (!output.required) continue;

        invariant(
          result.files.some(
            (file) => !file.diagnostic && file.key === output.key && file.role === output.role,
          ),
          'CAPTURE_REQUIRED_OUTPUT_MISSING',
        );
      }
    }

    const staged: StagedCaptureAsset[] = [];
    const begunAssetIds: string[] = [];

    try {
      for (const output of result.files) {
        const path = await ownedPath(outputDirectory, output.path);

        let sequence: number | undefined;

        if (output.diagnostic) {
          invariant(!output.required, 'CAPTURE_DIAGNOSTIC_REQUIRED_INVALID');
        } else {
          const index = scenario.outputs.findIndex(
            (candidate) => candidate.key === output.key && candidate.role === output.role,
          );

          invariant(index >= 0, 'CAPTURE_OUTPUT_NOT_DECLARED');

          const declared = scenario.outputs[index]!;

          invariant(declared.required === output.required, 'CAPTURE_OUTPUT_CONTRACT_MISMATCH');

          sequence = index;
        }

        const created = await this.persistence.transaction(actor, (unit) =>
          unit.captures.beginAsset({
            captureRunId,
            role: output.role,
            bucket: this.storage.bucket,
            ...(sequence !== undefined ? { sequence } : {}),
          }),
        );

        begunAssetIds.push(created.asset.id);

        try {
          const inspected = await inspectLocalOutput(output, path, this.probe, this.capacity);

          const size = Number(inspected.metadata.sizeBytes);

          invariant(Number.isSafeInteger(size) && size > 0, 'CAPTURE_OUTPUT_SIZE_INVALID');

          await this.storage.put(created.asset.objectKey, path, size, inspected.metadata.mimeType);

          await this.verify(created.asset.objectKey, inspected.metadata.checksumSha256, size);

          staged.push({
            assetId: created.asset.id,
            outputKey: output.key,
            role: output.role,
            diagnostic: output.diagnostic,
            ...(sequence !== undefined ? { sequence } : {}),
            metadata: inspected.metadata,
            evidence: {
              assetId: created.asset.id,
              outputKey: output.key,
              diagnostic: output.diagnostic,
              verification: 'SHA256_READBACK',
              technical: {
                ...inspected.technical,
                runtime: result.runtime,
              },
            } as Prisma.InputJsonValue,
          });
        } catch (error) {
          const code = error instanceof DomainError ? error.code : 'CAPTURE_ASSET_STAGE_FAILED';

          try {
            await this.persistence.transaction(actor, (unit) =>
              unit.captures.failAsset(created.asset.id, code),
            );
          } catch {
            // Preserve the original stable staging failure.
          }

          throw new DomainError(code);
        }
      }

      // The creator of the workspace owns cleanup after durable finalization.
      return staged;
    } catch (error) {
      const code = error instanceof DomainError ? error.code : 'CAPTURE_ASSET_STAGE_FAILED';

      /*
       * Staging is all-or-nothing for this CaptureRun attempt.
       * Durable private bytes may remain for diagnostics, but every
       * Asset begun by this attempt must leave UPLOADING state.
       */
      for (const assetId of begunAssetIds) {
        try {
          await this.persistence.transaction(actor, (unit) =>
            unit.captures.failAsset(assetId, code),
          );
        } catch {
          // Preserve the original stable staging failure.
        }
      }

      throw new DomainError(code);
    }
  }
}

export async function finalizeStagedCaptureAssets(
  unit: UnitOfWork,
  assets: readonly StagedCaptureAsset[],
) {
  for (const asset of assets) {
    await unit.captures.finishAsset(asset.assetId, asset.metadata, asset.evidence);
  }
}
