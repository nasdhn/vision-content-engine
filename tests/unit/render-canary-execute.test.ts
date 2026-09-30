import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';

import {
  RENDER_CANARY_CONFIRMATION,
  assertRenderCanaryConfirmation,
  assertRenderCanaryExecutionEnvironment,
  executeReviewedRenderCanary,
  parseRenderCanaryExecuteArgs,
} from '../../scripts/phase11c2-render-canary-execute.js';

import { configFixture } from '../support/config.js';

const cleanup: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanup.splice(0).map((path) =>
      rm(path, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

function activeConfig() {
  return parseConfig({
    ...configFixture,
    VCE_ENV: 'STAGING_CAPTURE',
    PAUSE_RENDERING: 'false',
  });
}

describe('Phase 11C-2B reviewed Render canary execution', () => {
  it('requires the exact confirmation and parses optional absolute output directory', () => {
    expect(parseRenderCanaryExecuteArgs(['--confirm', RENDER_CANARY_CONFIRMATION])).toEqual({
      confirmation: 'EXECUTE_SYNTHETIC_RENDER_CANARY',
    });

    expect(
      parseRenderCanaryExecuteArgs([
        '--',
        '--confirm',
        RENDER_CANARY_CONFIRMATION,
        '--output-dir',
        '/tmp/render-canary',
      ]),
    ).toEqual({
      confirmation: 'EXECUTE_SYNTHETIC_RENDER_CANARY',
      outputDirectory: '/tmp/render-canary',
    });

    expect(() => assertRenderCanaryConfirmation('wrong')).toThrow(
      'RENDER_CANARY_CONFIRMATION_INVALID',
    );
  });

  it('permits execution only with Rendering activated and every unrelated work class paused', () => {
    expect(() => assertRenderCanaryExecutionEnvironment(parseConfig(configFixture))).toThrow(
      'RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID',
    );

    expect(() => assertRenderCanaryExecutionEnvironment(activeConfig())).not.toThrow();

    expect(() =>
      assertRenderCanaryExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'STAGING_CAPTURE',
          PAUSE_RENDERING: 'false',
          PAUSE_ALL_PUBLISHING: 'false',
        }),
      ),
    ).toThrow('RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');

    expect(() =>
      assertRenderCanaryExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'PRODUCTION',
          PAUSE_RENDERING: 'false',
        }),
      ),
    ).toThrow('RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  });

  it('creates sanitized retained evidence with a fake runner and no real render', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vce-render-canary-test-'));

    cleanup.push(dir);

    const fakeRunner = async (outputDirectory: string) => {
      const master = Buffer.from('synthetic-master-for-test');

      await writeFile(join(outputDirectory, 'master.mp4'), master);

      await writeFile(
        join(outputDirectory, 'media-regression-evidence.json'),
        JSON.stringify({
          result: 'PASS',
          fixtureVersion: 'phase5-media-v1',
          generatedFixtures: {},
          finalMaster: {
            probeVersion: 'ffprobe-v1',
            container: 'mov,mp4,m4a,3gp,3g2,mj2',
            durationMs: 1200,
            video: {
              codec: 'h264',
              width: 1080,
              height: 1920,
              fps: 30,
              rotationDeg: 0,
              pixelFormat: 'yuv420p',
              color: {
                hdrKind: 'SDR',
                primaries: 'bt709',
                transfer: 'bt709',
                matrix: 'bt709',
                range: 'tv',
              },
            },
            audio: {
              codec: 'aac',
              sampleRate: 48000,
              channels: 2,
            },
          },
          technicalQa: 'PASS',
          chromaExecuted: true,
          fileSizeBytes: master.length,
          diagnostics: {
            rendererVersion: 'v1',
            remotionVersion: '4.0.526',
            ffmpegVersion: 'synthetic-test',
            elapsedMs: 1,
            logs: ['chroma:test:GREENSCREEN_STANDARD_V1'],
          },
        }),
      );
    };

    const result = await executeReviewedRenderCanary({
      config: activeConfig(),
      confirmation: RENDER_CANARY_CONFIRMATION,
      outputDirectory: dir,
      runRegression: fakeRunner,
    });

    expect(result).toMatchObject({
      mode: 'EXECUTE',
      fixtureVersion: 'phase5-media-v1',
      compositionKey: 'green-screen-explainer-v1',
      rendererInvoked: true,
      result: 'SUCCEEDED',
      technicalQa: 'PASS',
      chromaExecuted: true,
    });

    const files = await readdir(dir);

    expect(files.sort()).toEqual(['canary-evidence.json', 'master.mp4']);

    const manifest = await readFile(result.manifestPath, 'utf8');

    expect(manifest).not.toContain(dir);
    expect(manifest).not.toContain('DATABASE_URL');
    expect(manifest).not.toContain('S3_SECRET_ACCESS_KEY');
    expect(manifest).toContain('"externalProviderCostUsd": 0');
  });
});
