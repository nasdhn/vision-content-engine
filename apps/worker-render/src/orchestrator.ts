import { StructuredLogger, observeOperation } from '@vision/observability';
import { extname, join } from 'node:path';
import { mkdir, stat, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import {
  RenderPayloadBuilder,
  evaluateTechnicalQa,
  type RenderPayloadBuildOptions,
  type VideoRenderer,
} from '@vision/application';
import type { Prisma, PrismaClient } from '@vision/database';
import { Persistence } from '@vision/database';
import { invariant } from '@vision/domain';
import {
  CapacityGuard,
  createOwnedTemp,
  renderWorkingBytes,
  inspectBlackAndSilence,
  materializePrivateObject,
  probeRenderFile,
  sha256File,
  type MediaProbe,
  type PrivateStorage,
} from '@vision/media';

const workerActor = (workerId: string) => ({ actorType: 'WORKER', actorId: workerId }) as const;

function safeExtension(objectKey: string, mimeType: string | null, kind: string) {
  const ext = extname(objectKey).toLowerCase();
  if (/^\.[a-z0-9]{1,8}$/.test(ext)) return ext;
  if (mimeType === 'video/mp4') return '.mp4';
  if (mimeType === 'video/webm') return '.webm';
  if (mimeType === 'audio/wav') return '.wav';
  if (mimeType === 'audio/mpeg') return '.mp3';
  if (mimeType === 'audio/webm') return '.webm';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  if (kind === 'VIDEO') return '.mp4';
  if (kind === 'AUDIO') return '.wav';
  if (kind === 'IMAGE') return '.png';
  return '.bin';
}

function resolvedKind(kind: string): 'VIDEO' | 'AUDIO' | 'IMAGE' | 'FONT' | 'OTHER' {
  if (kind === 'VIDEO' || kind === 'AUDIO' || kind === 'IMAGE' || kind === 'FONT') return kind;
  return 'OTHER';
}

function wrapProbe(assetId: string, probe: MediaProbe) {
  return {
    assetId,
    container: probe.container,
    durationMs: probe.durationMs,
    ...(probe.video ? { video: probe.video } : {}),
    ...(probe.audio ? { audio: probe.audio } : {}),
    probeVersion: probe.probeVersion,
  } as const;
}

function failureCode(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const stable = new Set([
    'INSUFFICIENT_LOCAL_CAPACITY',
    'LOCAL_CAPACITY_UNAVAILABLE',
    'INVALID_CAPACITY_REQUEST',
    'ARTIFACT_TOO_LARGE',
    'INVALID_ARTIFACT_SIZE',
    'ARTIFACT_SIZE_MISMATCH',
    'INPUT_ASSET_MISSING',
    'INPUT_CHECKSUM_MISMATCH',
    'INPUT_PROBE_FAILED',
    'INPUT_UNSUPPORTED',
    'INPUT_COLOR_PROFILE_UNSUPPORTED',
    'HDR_NORMALIZATION_FAILED',
    'TEMPLATE_CONTRACT_FAILED',
    'EDITING_PLAN_INVALID',
    'ASSET_TRIM_INVALID',
    'PRESET_UNKNOWN',
    'COLLISION_VALIDATION_FAILED',
    'NORMALIZATION_FAILED',
    'REMOTION_RENDER_FAILED',
    'FFMPEG_FAILED',
    'OUTPUT_MISSING',
    'OUTPUT_PROBE_FAILED',
    'TECHNICAL_QA_FAILED',
    'OBJECT_UPLOAD_FAILED',
    'INTERNAL_RENDER_ERROR',
  ]);

  if (stable.has(message)) return message;
  if (message === 'RENDER_INPUT_NOT_READY') return 'INPUT_ASSET_MISSING';
  if (message === 'RENDER_INPUT_LINEAGE_MISMATCH' || message === 'RENDER_INPUT_ASSET_SET_MISMATCH')
    return 'EDITING_PLAN_INVALID';
  if (message === 'RENDERER_VERSION_MISMATCH' || message === 'RENDERER_API_VERSION_MISMATCH')
    return 'TEMPLATE_CONTRACT_FAILED';
  if (message === 'CHROMA_PROFILE_INVALID' || message === 'AUDIO_PROFILE_INVALID')
    return 'PRESET_UNKNOWN';
  if (/checksum/i.test(message)) return 'INPUT_CHECKSUM_MISMATCH';
  if (/probe|media_unreadable|no_media_stream/i.test(message)) return 'INPUT_PROBE_FAILED';
  if (/ffmpeg/i.test(message)) return 'FFMPEG_FAILED';
  if (/remotion|chromium|chrome/i.test(message)) return 'REMOTION_RENDER_FAILED';
  return 'INTERNAL_RENDER_ERROR';
}

async function reconcileImmutableUpload(input: {
  storage: PrivateStorage;
  objectKey: string;
  sourcePath: string;
  sizeBytes: number;
  checksumSha256: string;
  mimeType: string;
  reconciliationPath: string;
  capacity: CapacityGuard;
}) {
  try {
    await input.storage.put(input.objectKey, input.sourcePath, input.sizeBytes, input.mimeType);
    return;
  } catch (putError) {
    try {
      await materializePrivateObject({
        storage: input.storage,
        objectKey: input.objectKey,
        targetPath: input.reconciliationPath,
        expectedChecksumSha256: input.checksumSha256,
        expectedSizeBytes: input.sizeBytes,
        capacity: input.capacity,
      });
      return;
    } catch {
      const error = new Error('OBJECT_UPLOAD_FAILED');
      Object.assign(error, { cause: putError });
      throw error;
    }
  }
}

export type RenderWorkerExecutionResult = Readonly<{
  renderId: string;
  renderAttemptId: string;
  outputAssetId: string;
  technicalQa: unknown;
  diagnostics: unknown;
}>;

export class RenderWorkerOrchestrator {
  private readonly persistence: Persistence;
  private readonly payloadBuilder: RenderPayloadBuilder;

  constructor(
    private readonly db: PrismaClient,
    private readonly storage: PrivateStorage,
    private readonly renderer: VideoRenderer,
    private readonly options: Readonly<{
      workerId: string;
      workerVersion: string;
      storageProvider: string;
      workRoot: string;
      capacity?: CapacityGuard;
    }>,
  ) {
    invariant(options.workerId.trim(), 'WORKER_REQUIRED');
    invariant(options.workerVersion.trim(), 'WORKER_VERSION_REQUIRED');
    invariant(options.storageProvider.trim(), 'STORAGE_PROVIDER_REQUIRED');
    invariant(options.workRoot.trim(), 'WORK_ROOT_REQUIRED');
    this.persistence = new Persistence(db);
    this.payloadBuilder = new RenderPayloadBuilder(db);
  }

  async execute(input: {
    renderId: string;
    renderAttemptId: string;
    signal?: AbortSignal;
  }): Promise<RenderWorkerExecutionResult> {
    return observeOperation(
      new StructuredLogger('worker-render'),
      { renderId: input.renderId, renderAttemptId: input.renderAttemptId },
      () => this.executeJob(input),
    );
  }

  private async executeJob(input: {
    renderId: string;
    renderAttemptId: string;
    signal?: AbortSignal;
  }): Promise<RenderWorkerExecutionResult> {
    const actor = workerActor(this.options.workerId);
    for (const id of [input.renderId, input.renderAttemptId])
      invariant(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id), 'INVALID_TEMP_OWNER');
    const capacity =
      this.options.capacity ??
      new CapacityGuard(undefined, undefined, new StructuredLogger('worker-render'));
    let workspace: Awaited<ReturnType<typeof createOwnedTemp>> | undefined;
    let outputAssetId: string | null = null;
    let technicalQa: Prisma.InputJsonValue | undefined;

    try {
      await this.persistence.transaction(actor, (unit) =>
        unit.startRenderAttempt(input.renderId, input.renderAttemptId),
      );

      const attempt = await this.db.renderAttempt.findUniqueOrThrow({
        where: { id: input.renderAttemptId },
      });
      invariant(attempt.renderId === input.renderId, 'RENDER_ATTEMPT_LINEAGE_MISMATCH');
      invariant(attempt.workerVersion === this.options.workerVersion, 'WORKER_VERSION_MISMATCH');

      const render = await this.db.render.findUniqueOrThrow({
        where: { id: input.renderId },
        include: {
          inputAssets: {
            include: { asset: true },
            orderBy: [{ sequence: 'asc' }, { assetId: 'asc' }],
          },
        },
      });

      const inputSizes = render.inputAssets.map(({ asset }) =>
        capacity.artifactSize(Number(asset.sizeBytes)),
      );
      const requestedBytes = renderWorkingBytes(inputSizes, capacity.policy.maxArtifactBytes);
      await capacity.require(this.options.workRoot, requestedBytes, input.renderAttemptId);
      await capacity.require(tmpdir(), requestedBytes, input.renderAttemptId);
      workspace = await createOwnedTemp(
        this.options.workRoot,
        'render',
        input.renderAttemptId,
        new StructuredLogger('worker-render'),
      );
      const workDir = workspace.path;
      const inputDir = join(workDir, 'inputs');
      await mkdir(inputDir, { mode: 0o700 });

      const resolvedAssets: RenderPayloadBuildOptions['resolvedAssets'] = [];
      for (const [index, inputAsset] of render.inputAssets.entries()) {
        const asset = inputAsset.asset;
        invariant(asset.status === 'READY' && asset.deletedAt === null, 'INPUT_ASSET_MISSING');
        invariant(asset.bucket === this.storage.bucket, 'INPUT_ASSET_MISSING');
        invariant(asset.storageProvider === this.options.storageProvider, 'INPUT_ASSET_MISSING');

        const localPath = join(
          inputDir,
          `${String(index).padStart(3, '0')}-${asset.id}${safeExtension(asset.objectKey, asset.mimeType, asset.kind)}`,
        );

        const materialized = await materializePrivateObject({
          storage: this.storage,
          objectKey: asset.objectKey,
          targetPath: localPath,
          expectedChecksumSha256: asset.checksumSha256,
          expectedSizeBytes: Number(asset.sizeBytes),
          capacity,
        });

        const kind = resolvedKind(asset.kind);
        const probe =
          kind === 'VIDEO' || kind === 'AUDIO'
            ? wrapProbe(asset.id, await probeRenderFile(localPath))
            : { assetId: asset.id, probeVersion: 'metadata-v1' };

        resolvedAssets.push({
          assetId: asset.id,
          localUri: localPath,
          kind,
          probe,
          checksumSha256: materialized.checksumSha256,
        });
      }

      const payload = await this.payloadBuilder.build({
        renderId: input.renderId,
        renderAttemptId: input.renderAttemptId,
        resolvedAssets,
      });

      const rendered = await this.renderer.render(payload, {
        workDir,
        capacity,
        ...(input.signal ? { signal: input.signal } : {}),
      });

      const outputStat = await stat(rendered.outputPath).catch(() => null);
      invariant(
        outputStat !== null && outputStat.isFile() && outputStat.size > 0,
        'OUTPUT_MISSING',
      );
      invariant(
        (await realpath(rendered.outputPath)).startsWith(`${workDir}/`),
        'OUTPUT_PATH_INVALID',
      );
      const outputSizeBytes = await capacity.file(rendered.outputPath);

      await this.persistence.transaction(actor, (unit) =>
        unit.enterRenderTechnicalQa(input.renderId, input.renderAttemptId),
      );

      const objectKey = `renders/${input.renderId}/attempts/${attempt.attemptNumber}/master.mp4`;
      const outputAsset = await this.persistence.transaction(actor, (unit) =>
        unit.reserveRenderOutputAsset(input.renderAttemptId, {
          storageProvider: this.options.storageProvider,
          bucket: this.storage.bucket,
          objectKey,
          mimeType: 'video/mp4',
        }),
      );
      outputAssetId = outputAsset.id;

      let outputProbe: MediaProbe;
      try {
        outputProbe = await probeRenderFile(rendered.outputPath);
      } catch (error) {
        const wrapped = new Error('OUTPUT_PROBE_FAILED');
        Object.assign(wrapped, { cause: error });
        throw wrapped;
      }

      const measured = await inspectBlackAndSilence(rendered.outputPath).catch((error) => {
        const wrapped = new Error('TECHNICAL_QA_FAILED');
        Object.assign(wrapped, { cause: error });
        throw wrapped;
      });

      const probe = wrapProbe(outputAsset.id, outputProbe);
      const qa = evaluateTechnicalQa({
        payload,
        probe,
        measurements: {
          fileSizeBytes: outputSizeBytes,
          ...measured,
        },
      });
      const qaJson = qa as unknown as Prisma.InputJsonValue;
      technicalQa = qaJson;

      if (qa.result !== 'PASS') {
        await this.persistence.transaction(actor, async (unit) => {
          await unit.markRenderOutputAssetFailed(outputAsset.id);
          await unit.failRenderAttempt(input.renderId, input.renderAttemptId, {
            failureCode: 'TECHNICAL_QA_FAILED',
            technicalQaJson: qaJson,
          });
        });
        throw new Error('TECHNICAL_QA_FAILED');
      }

      const checksumSha256 = await sha256File(rendered.outputPath);
      await reconcileImmutableUpload({
        storage: this.storage,
        objectKey,
        sourcePath: rendered.outputPath,
        sizeBytes: outputSizeBytes,
        checksumSha256,
        mimeType: 'video/mp4',
        reconciliationPath: join(workDir, 'reconciliation-master.mp4'),
        capacity,
      });

      invariant(outputProbe.video, 'OUTPUT_PROBE_FAILED');

      await this.persistence.transaction(actor, async (unit) => {
        await unit.markRenderOutputAssetReady(outputAsset.id, {
          checksumSha256,
          sizeBytes: BigInt(outputSizeBytes),
          width: outputProbe.video!.width,
          height: outputProbe.video!.height,
          durationMs: outputProbe.durationMs,
          fps: outputProbe.video!.fps,
          ...(outputProbe.audio
            ? {
                audioChannels: outputProbe.audio.channels,
                sampleRate: outputProbe.audio.sampleRate,
              }
            : {}),
        });
        await unit.succeedRenderAttempt(
          input.renderId,
          input.renderAttemptId,
          outputAsset.id,
          qaJson,
        );
      });

      return {
        renderId: input.renderId,
        renderAttemptId: input.renderAttemptId,
        outputAssetId: outputAsset.id,
        technicalQa: qa,
        diagnostics: rendered.diagnostics,
      };
    } catch (error) {
      const attempt = await this.db.renderAttempt.findUnique({
        where: { id: input.renderAttemptId },
      });

      if (attempt && (attempt.status === 'QUEUED' || attempt.status === 'RUNNING')) {
        const outputAsset = outputAssetId
          ? await this.db.asset.findUnique({ where: { id: outputAssetId } })
          : null;

        await this.persistence
          .transaction(actor, async (unit) => {
            if (outputAssetId && outputAsset?.status === 'UPLOADING')
              await unit.markRenderOutputAssetFailed(outputAssetId);

            await unit.failRenderAttempt(input.renderId, input.renderAttemptId, {
              failureCode: failureCode(error),
              failureMessage: failureCode(error),
              ...(technicalQa !== undefined ? { technicalQaJson: technicalQa } : {}),
            });
          })
          .catch(() => undefined);
      }

      throw error;
    } finally {
      await workspace?.cleanup();
    }
  }
}
