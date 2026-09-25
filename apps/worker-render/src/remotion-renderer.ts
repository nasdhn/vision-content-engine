import { tmpdir } from 'node:os';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { bundle } from '@remotion/bundler';
import { makeCancelSignal, renderMedia, selectComposition } from '@remotion/renderer';

import {
  VIDEO_ENGINE_PROFILES,
  type ValidatedRenderPayload,
  type VideoRenderer,
} from '@vision/application';
import { invariant, DomainError } from '@vision/domain';
import { ffmpegVersion, CapacityGuard, renderWorkingBytes } from '@vision/media';

import { startLocalAssetServer } from './asset-server.js';
import { normalizeHdrToSdr, postprocessSocialMaster, preprocessGreenScreen } from './ffmpeg.js';

const REMOTION_VERSION = '4.0.526';

const moduleDir = dirname(fileURLToPath(import.meta.url));
const entryPoint = resolve(moduleDir, 'remotion-entry.tsx');

function codedError(code: string, cause: unknown) {
  if (
    cause instanceof DomainError &&
    ['INSUFFICIENT_LOCAL_CAPACITY', 'LOCAL_CAPACITY_UNAVAILABLE', 'ARTIFACT_TOO_LARGE'].includes(
      cause.code,
    )
  )
    return cause;
  const error = new Error(code);
  Object.assign(error, { cause });
  return error;
}

async function getBundle(workDir: string) {
  return bundle({
    entryPoint,
    outDir: join(workDir, 'bundle'),
    enableCaching: false,
    publicDir: null,
    onProgress: () => undefined,
  }).catch((error) => {
    throw codedError('REMOTION_RENDER_FAILED', error);
  });
}

function audioExpected(payload: ValidatedRenderPayload) {
  const audio = payload.editingPlan.audio;
  return Boolean(audio.voice || audio.music || audio.sfx.length > 0);
}

function profileRecord(
  registry: Readonly<Record<string, unknown>>,
  key: string,
  code: string,
): Readonly<Record<string, unknown>> {
  const value = registry[key];
  invariant(value && typeof value === 'object' && !Array.isArray(value), code);
  return value as Readonly<Record<string, unknown>>;
}

function profileNumber(profile: Readonly<Record<string, unknown>>, key: string, code: string) {
  const value = profile[key];
  invariant(typeof value === 'number' && Number.isFinite(value), code);
  return value;
}

export class RemotionVideoRenderer implements VideoRenderer {
  constructor(private readonly capacity = new CapacityGuard()) {}
  async render(
    input: ValidatedRenderPayload,
    options: Readonly<{ workDir: string; signal?: AbortSignal; capacity?: CapacityGuard }>,
  ) {
    const capacity = options.capacity ?? this.capacity;
    const sizes = await Promise.all(
      input.resolvedAssets.map((asset) => capacity.file(asset.localUri)),
    );
    const requested = renderWorkingBytes(sizes, capacity.policy.maxArtifactBytes);
    await capacity.require(options.workDir, requested);
    await capacity.require(tmpdir(), requested);
    const startedAt = Date.now();
    const logs: string[] = [];
    const preparedDir = join(options.workDir, 'prepared');
    const renderDir = join(options.workDir, 'render');
    await mkdir(preparedDir, { recursive: true });
    await mkdir(renderDir, { recursive: true });

    const overridePaths = new Map<string, string>();

    for (const asset of input.resolvedAssets) {
      if (asset.kind !== 'VIDEO') continue;

      let currentPath = asset.localUri;
      const hdrKind = asset.probe.video?.color?.hdrKind;

      if (hdrKind && hdrKind !== 'SDR') {
        const normalized = join(preparedDir, `${asset.assetId}.sdr.mp4`);
        try {
          await normalizeHdrToSdr({
            sourcePath: currentPath,
            outputPath: normalized,
            capacity,
            ...(options.signal ? { signal: options.signal } : {}),
          });
        } catch (error) {
          throw codedError('HDR_NORMALIZATION_FAILED', error);
        }
        currentPath = normalized;
        logs.push(`normalized-hdr:${asset.assetId}:${hdrKind}`);
      }

      const presenterCue = input.editingPlan.presenter.find((cue) => cue.assetId === asset.assetId);

      if (presenterCue) {
        const chromaProfile = profileRecord(
          VIDEO_ENGINE_PROFILES.chroma,
          presenterCue.chromaKeyProfileKey,
          'CHROMA_PROFILE_INVALID',
        );
        const keyed = join(preparedDir, `${asset.assetId}.chroma.webm`);

        try {
          await preprocessGreenScreen({
            sourcePath: currentPath,
            outputPath: keyed,
            profile: chromaProfile,
            capacity,
            ...(options.signal ? { signal: options.signal } : {}),
          });
        } catch (error) {
          throw codedError('FFMPEG_FAILED', error);
        }

        currentPath = keyed;
        logs.push(`chroma:${asset.assetId}:${presenterCue.chromaKeyProfileKey}`);
      }

      if (currentPath !== asset.localUri) overridePaths.set(asset.assetId, currentPath);
    }

    const server = await startLocalAssetServer({
      payload: input,
      overridePaths,
    });

    try {
      const serveUrl = await getBundle(options.workDir);
      let composition;
      try {
        composition = await selectComposition({
          serveUrl,
          id: input.template.compositionKey,
          inputProps: server.payload,
          logLevel: 'error',
          onBrowserLog: () => undefined,
          ...(process.env.REMOTION_BROWSER_EXECUTABLE
            ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
            : {}),
        });
      } catch (error) {
        throw codedError('REMOTION_RENDER_FAILED', error);
      }

      const remotionOutput = join(renderDir, 'remotion.mp4');
      const { cancelSignal, cancel } = makeCancelSignal();
      const abort = () => cancel();

      if (options.signal?.aborted) abort();
      options.signal?.addEventListener('abort', abort, { once: true });

      try {
        await renderMedia({
          serveUrl,
          composition,
          codec: 'h264',
          audioCodec: 'aac',
          pixelFormat: 'yuv420p',
          crf: 18,
          x264Preset: 'medium',
          outputLocation: remotionOutput,
          inputProps: server.payload,
          logLevel: 'error',
          overwrite: false,
          concurrency: process.env.RENDER_CONCURRENCY ?? '50%',
          cancelSignal,
          ...(process.env.REMOTION_BROWSER_EXECUTABLE
            ? { browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE }
            : {}),
          onBrowserLog: () => {
            if (logs.length < 100) logs.push('browser-output-suppressed');
          },
        });
      } catch (error) {
        throw codedError('REMOTION_RENDER_FAILED', error);
      } finally {
        options.signal?.removeEventListener('abort', abort);
      }

      await capacity.file(remotionOutput);
      const audioProfile = profileRecord(
        VIDEO_ENGINE_PROFILES.audio,
        input.provenance.audioProfileKey,
        'AUDIO_PROFILE_INVALID',
      );
      const finalOutput = join(renderDir, 'master.mp4');

      try {
        await postprocessSocialMaster({
          sourcePath: remotionOutput,
          outputPath: finalOutput,
          fps: input.renderSettings.fps,
          audioExpected: audioExpected(input),
          integratedTargetLufs: profileNumber(
            audioProfile,
            'integratedTargetLufs',
            'AUDIO_PROFILE_INVALID',
          ),
          truePeakCeilingDb: profileNumber(
            audioProfile,
            'truePeakCeilingDb',
            'AUDIO_PROFILE_INVALID',
          ),
          sampleRate: profileNumber(audioProfile, 'sampleRate', 'AUDIO_PROFILE_INVALID'),
          channels: profileNumber(audioProfile, 'channels', 'AUDIO_PROFILE_INVALID'),
          capacity,
          ...(options.signal ? { signal: options.signal } : {}),
        });
      } catch (error) {
        throw codedError('NORMALIZATION_FAILED', error);
      }

      await capacity.file(finalOutput);
      return {
        outputPath: finalOutput,
        diagnostics: {
          rendererVersion: input.provenance.rendererVersion,
          remotionVersion: REMOTION_VERSION,
          ffmpegVersion: await ffmpegVersion(),
          elapsedMs: Date.now() - startedAt,
          logs,
        },
      } as const;
    } finally {
      await server.close();
    }
  }
}
