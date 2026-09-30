import 'dotenv/config';

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

import {
  isRenderingActivationEnabled,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';

import {
  RENDER_CANARY_COMPOSITION_KEY,
  RENDER_CANARY_FIXTURE_VERSION,
  validateRenderCanaryFixture,
} from './phase11c2-render-canary.js';

const exec = promisify(execFile);

const moduleDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(moduleDir, '..');

export const RENDER_CANARY_CONFIRMATION = 'EXECUTE_SYNTHETIC_RENDER_CANARY';

type RegressionRunner = (outputDirectory: string) => Promise<void>;

type ExecuteOptions = {
  config: RuntimeConfig;
  confirmation: string;
  outputDirectory?: string;
  runRegression?: RegressionRunner;
};

type RegressionEvidence = {
  fixtureVersion: string;
  finalMaster: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  fileSizeBytes: number;
};

export type RenderCanaryExecutionEvidence = {
  mode: 'EXECUTE';
  fixtureVersion: string;
  compositionKey: string;
  rendererInvoked: true;
  result: 'SUCCEEDED';
  technicalQa: 'PASS';
  chromaExecuted: true;
  outputDirectory: string;
  masterPath: string;
  manifestPath: string;
  masterBytes: number;
  masterSha256: string;
};

function fail(code: string): never {
  throw new Error(code);
}

function record(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(code);
  }

  return value as Record<string, unknown>;
}

export function assertRenderCanaryConfirmation(confirmation: string): void {
  if (confirmation !== RENDER_CANARY_CONFIRMATION) {
    fail('RENDER_CANARY_CONFIRMATION_INVALID');
  }
}

export function assertRenderCanaryExecutionEnvironment(config: RuntimeConfig): void {
  if (
    !isRenderingActivationEnabled(config) ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false' ||
    !config.PAUSE_ALL_PUBLISHING ||
    !config.PAUSE_AI_GENERATION ||
    !config.PAUSE_CAPTURE ||
    !config.PAUSE_ANALYTICS_COLLECTION
  ) {
    fail('RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  }
}

export function parseRenderCanaryExecuteArgs(rawArgs: readonly string[]): {
  confirmation: string;
  outputDirectory?: string;
} {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  if (args.length !== 2 && args.length !== 4) {
    fail('RENDER_CANARY_EXECUTE_USAGE_INVALID');
  }

  if (args[0] !== '--confirm' || typeof args[1] !== 'string') {
    fail('RENDER_CANARY_EXECUTE_USAGE_INVALID');
  }

  if (args.length === 2) {
    return {
      confirmation: args[1],
    };
  }

  if (args[2] !== '--output-dir' || typeof args[3] !== 'string') {
    fail('RENDER_CANARY_EXECUTE_USAGE_INVALID');
  }

  return {
    confirmation: args[1],
    outputDirectory: args[3],
  };
}

async function runRealMediaRegression(outputDirectory: string): Promise<void> {
  await exec('pnpm', ['exec', 'tsx', 'tests/render/media-regression.ts'], {
    cwd: repoRoot,
    env: {
      ...process.env,
      RENDER_CANARY_OUTPUT_DIR: outputDirectory,
    },
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
  }).catch((error) => {
    const wrapped = new Error('RENDER_CANARY_EXECUTOR_FAILED');
    Object.assign(wrapped, { cause: error });
    throw wrapped;
  });
}

async function readRegressionEvidence(path: string): Promise<RegressionEvidence> {
  let raw: unknown;

  try {
    raw = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    fail('RENDER_CANARY_EVIDENCE_INVALID');
  }

  const root = record(raw, 'RENDER_CANARY_EVIDENCE_INVALID');

  if (
    root.result !== 'PASS' ||
    root.fixtureVersion !== RENDER_CANARY_FIXTURE_VERSION ||
    root.technicalQa !== 'PASS' ||
    root.chromaExecuted !== true ||
    typeof root.fileSizeBytes !== 'number' ||
    !Number.isSafeInteger(root.fileSizeBytes) ||
    root.fileSizeBytes <= 0
  ) {
    fail('RENDER_CANARY_EVIDENCE_INVALID');
  }

  const finalMaster = record(root.finalMaster, 'RENDER_CANARY_MASTER_PROBE_INVALID');

  const video = record(finalMaster.video, 'RENDER_CANARY_MASTER_VIDEO_INVALID');

  const audio = record(finalMaster.audio, 'RENDER_CANARY_MASTER_AUDIO_INVALID');

  const color = record(video.color, 'RENDER_CANARY_MASTER_COLOR_INVALID');

  if (
    video.codec !== 'h264' ||
    video.width !== 1080 ||
    video.height !== 1920 ||
    video.pixelFormat !== 'yuv420p' ||
    color.hdrKind !== 'SDR' ||
    color.primaries !== 'bt709' ||
    color.transfer !== 'bt709' ||
    color.matrix !== 'bt709' ||
    audio.sampleRate !== 48000 ||
    audio.channels !== 2
  ) {
    fail('RENDER_CANARY_MASTER_PROFILE_INVALID');
  }

  return {
    fixtureVersion: root.fixtureVersion as string,
    finalMaster,
    diagnostics: record(root.diagnostics, 'RENDER_CANARY_DIAGNOSTICS_INVALID'),
    fileSizeBytes: root.fileSizeBytes,
  };
}

async function sha256File(path: string): Promise<string> {
  const bytes = await readFile(path);

  return createHash('sha256').update(bytes).digest('hex');
}

async function writeCanaryEvidence(
  outputDirectory: string,
  regression: RegressionEvidence,
  masterBytes: number,
  masterSha256: string,
): Promise<string> {
  const manifestPath = join(outputDirectory, 'canary-evidence.json');

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        canary: 'PHASE_11C_2B_SYNTHETIC_RENDER',
        fixtureVersion: RENDER_CANARY_FIXTURE_VERSION,
        compositionKey: RENDER_CANARY_COMPOSITION_KEY,
        result: 'SUCCEEDED',
        rendererInvoked: true,
        technicalQa: 'PASS',
        chromaExecuted: true,
        master: {
          fileName: 'master.mp4',
          fileSizeBytes: masterBytes,
          sha256: masterSha256,
          probe: regression.finalMaster,
        },
        runtime: regression.diagnostics,
        safety: {
          databaseAdapterInvoked: false,
          objectStorageAdapterInvoked: false,
          aiProviderInvoked: false,
          publishingAdapterInvoked: false,
          externalProviderCostUsd: 0,
          syntheticInputsOnly: true,
          localAssetServerExpected: true,
        },
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  await chmod(manifestPath, 0o600);

  return manifestPath;
}

export async function executeReviewedRenderCanary(
  options: ExecuteOptions,
): Promise<RenderCanaryExecutionEvidence> {
  assertRenderCanaryExecutionEnvironment(options.config);

  assertRenderCanaryConfirmation(options.confirmation);

  const plan = validateRenderCanaryFixture();

  const outputDirectory =
    options.outputDirectory ?? (await mkdtemp(join(tmpdir(), 'vce-render-canary-')));

  if (!isAbsolute(outputDirectory)) {
    fail('RENDER_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  }

  await mkdir(outputDirectory, {
    recursive: true,
    mode: 0o700,
  });

  const existing = await readdir(outputDirectory);

  if (existing.length !== 0) {
    fail('RENDER_CANARY_OUTPUT_DIRECTORY_NOT_EMPTY');
  }

  const runRegression = options.runRegression ?? runRealMediaRegression;

  await runRegression(outputDirectory);

  const masterPath = join(outputDirectory, 'master.mp4');

  const regressionEvidencePath = join(outputDirectory, 'media-regression-evidence.json');

  const masterInfo = await stat(masterPath).catch(() => null);

  if (!masterInfo || !masterInfo.isFile() || masterInfo.size <= 0) {
    fail('RENDER_CANARY_MASTER_MISSING');
  }

  const regression = await readRegressionEvidence(regressionEvidencePath);

  if (regression.fileSizeBytes !== masterInfo.size) {
    fail('RENDER_CANARY_MASTER_SIZE_MISMATCH');
  }

  const masterSha256 = await sha256File(masterPath);

  const manifestPath = await writeCanaryEvidence(
    outputDirectory,
    regression,
    masterInfo.size,
    masterSha256,
  );

  await rm(regressionEvidencePath, {
    force: true,
  });

  return {
    mode: 'EXECUTE',
    fixtureVersion: plan.fixtureVersion,
    compositionKey: plan.compositionKey,
    rendererInvoked: true,
    result: 'SUCCEEDED',
    technicalQa: 'PASS',
    chromaExecuted: true,
    outputDirectory,
    masterPath,
    manifestPath,
    masterBytes: masterInfo.size,
    masterSha256,
  };
}

async function main() {
  const args = parseRenderCanaryExecuteArgs(process.argv.slice(2));

  const evidence = await executeReviewedRenderCanary({
    config: parseConfig(process.env),
    confirmation: args.confirmation,
    ...(args.outputDirectory
      ? {
          outputDirectory: args.outputDirectory,
        }
      : {}),
  });

  console.log('===== PHASE 11C-2B REVIEWED RENDER CANARY =====');
  console.log(`mode=${evidence.mode}`);
  console.log(`fixtureVersion=${evidence.fixtureVersion}`);
  console.log(`compositionKey=${evidence.compositionKey}`);
  console.log(`rendererInvoked=${evidence.rendererInvoked}`);
  console.log(`result=${evidence.result}`);
  console.log(`technicalQa=${evidence.technicalQa}`);
  console.log(`chromaExecuted=${evidence.chromaExecuted}`);
  console.log(`masterBytes=${evidence.masterBytes}`);
  console.log(`masterSha256=${evidence.masterSha256}`);
  console.log(`outputDirectory=${evidence.outputDirectory}`);
  console.log(`masterPath=${evidence.masterPath}`);
  console.log(`manifestPath=${evidence.manifestPath}`);
  console.log('PASS: reviewed local Render canary completed.');
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11C2B_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );

    process.exitCode = 1;
  });
}
