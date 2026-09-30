import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import fixtureSpec from '../tests/fixtures/media/phase5-media-fixtures.json' with { type: 'json' };

import {
  isRenderingActivationEnabled,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';

export const RENDER_CANARY_FIXTURE_VERSION = 'phase5-media-v1';
export const RENDER_CANARY_COMPOSITION_KEY = 'green-screen-explainer-v1';
export const RENDER_CANARY_CHROMA_PROFILE_KEY = 'GREENSCREEN_STANDARD_V1';
export const RENDER_CANARY_COLOR_PROFILE_KEY = 'SDR_BT709_SOCIAL_V1';
export const RENDER_CANARY_CODEC_PROFILE_KEY = 'SOCIAL_H264_AAC_V1';
export const RENDER_CANARY_AUDIO_PROFILE_KEY = 'SOCIAL_VOICE_MASTER_V1';

export type RenderCanaryDryRunPlan = Readonly<{
  mode: 'DRY_RUN';
  fixtureVersion: string;
  compositionKey: string;
  durationMs: number;
  width: number;
  height: number;
  fps: number;
  syntheticInputKinds: readonly string[];
  diagnosticFixtureKinds: readonly string[];
  chromaProfileKey: string;
  colorProfileKey: string;
  codecProfileKey: string;
  audioProfileKey: string;
  expectedVideoCodec: 'h264';
  expectedPixelFormat: 'yuv420p';
  expectedDynamicRange: 'SDR';
  expectedColorPrimaries: 'bt709';
  expectedAudioSampleRate: 48000;
  expectedAudioChannels: 2;
  ephemeralActivationValid: true;
  rendererInvoked: false;
  databaseAccessed: false;
  objectStorageAccessed: false;
  aiProviderCalled: false;
  networkCalled: false;
  publicationSideEffect: false;
  externalSideEffect: false;
}>;

function fail(code: string): never {
  throw new Error(code);
}

export function renderCanaryMode(args: readonly string[]): 'DRY_RUN' {
  if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
    return 'DRY_RUN';
  }

  if (args.length === 1 && args[0] === '--execute') {
    fail('CANARY_EXECUTION_NOT_IMPLEMENTED_11C2A');
  }

  fail('RENDER_CANARY_USAGE_INVALID');
}

export function assertRenderCanaryPersistentDefaults(config: RuntimeConfig): void {
  if (
    config.VCE_ENV !== 'LOCAL' ||
    !config.PAUSE_RENDERING ||
    !config.PAUSE_ALL_PUBLISHING ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false'
  ) {
    fail('RENDER_CANARY_PERSISTENT_DEFAULTS_UNSAFE');
  }
}

export function validateRenderCanaryFixture(): Omit<
  RenderCanaryDryRunPlan,
  'ephemeralActivationValid'
> {
  if (fixtureSpec.fixtureVersion !== RENDER_CANARY_FIXTURE_VERSION) {
    fail('RENDER_CANARY_FIXTURE_VERSION_MISMATCH');
  }

  if (
    fixtureSpec.durationMs !== 1200 ||
    fixtureSpec.canvas.width !== 1080 ||
    fixtureSpec.canvas.height !== 1920 ||
    fixtureSpec.canvas.fps !== 30
  ) {
    fail('RENDER_CANARY_CANVAS_MISMATCH');
  }

  const expectedRecipes = ['product', 'presenter', 'voice', 'blackSilence'] as const;

  for (const key of expectedRecipes) {
    if (
      typeof fixtureSpec.recipes[key] !== 'string' ||
      fixtureSpec.recipes[key].trim().length === 0
    ) {
      fail('RENDER_CANARY_RECIPE_MISSING');
    }
  }

  const requiredAssertions = [
    'renderer executes chroma preprocessing',
    'renderer executes captions and voice layers',
    'final master passes technical QA as H264/yuv420p/BT709 with audio',
  ];

  for (const assertion of requiredAssertions) {
    if (!fixtureSpec.assertions.includes(assertion)) {
      fail('RENDER_CANARY_ASSERTION_MISSING');
    }
  }

  return {
    mode: 'DRY_RUN',
    fixtureVersion: fixtureSpec.fixtureVersion,
    compositionKey: RENDER_CANARY_COMPOSITION_KEY,
    durationMs: fixtureSpec.durationMs,
    width: fixtureSpec.canvas.width,
    height: fixtureSpec.canvas.height,
    fps: fixtureSpec.canvas.fps,
    syntheticInputKinds: ['PRODUCT_VIDEO', 'PRESENTER_GREEN_SCREEN', 'VOICE_AUDIO'],
    diagnosticFixtureKinds: ['BLACK_SILENCE'],
    chromaProfileKey: RENDER_CANARY_CHROMA_PROFILE_KEY,
    colorProfileKey: RENDER_CANARY_COLOR_PROFILE_KEY,
    codecProfileKey: RENDER_CANARY_CODEC_PROFILE_KEY,
    audioProfileKey: RENDER_CANARY_AUDIO_PROFILE_KEY,
    expectedVideoCodec: 'h264',
    expectedPixelFormat: 'yuv420p',
    expectedDynamicRange: 'SDR',
    expectedColorPrimaries: 'bt709',
    expectedAudioSampleRate: 48000,
    expectedAudioChannels: 2,
    rendererInvoked: false,
    databaseAccessed: false,
    objectStorageAccessed: false,
    aiProviderCalled: false,
    networkCalled: false,
    publicationSideEffect: false,
    externalSideEffect: false,
  };
}

export function prepareRenderCanaryDryRun(config: RuntimeConfig): RenderCanaryDryRunPlan {
  assertRenderCanaryPersistentDefaults(config);

  const ephemeralActivation: RuntimeConfig = {
    ...config,
    VCE_ENV: 'STAGING_CAPTURE',
    PAUSE_RENDERING: false,
  };

  if (!isRenderingActivationEnabled(ephemeralActivation)) {
    fail('RENDER_CANARY_EPHEMERAL_ACTIVATION_INVALID');
  }

  return {
    ...validateRenderCanaryFixture(),
    ephemeralActivationValid: true,
  };
}

async function main() {
  renderCanaryMode(process.argv.slice(2));

  const config = parseConfig(process.env);
  const plan = prepareRenderCanaryDryRun(config);

  console.log('===== PHASE 11C-2A RENDER CANARY =====');
  console.log(`mode=${plan.mode}`);
  console.log(`fixtureVersion=${plan.fixtureVersion}`);
  console.log(`compositionKey=${plan.compositionKey}`);
  console.log(`durationMs=${plan.durationMs}`);
  console.log(`canvas=${plan.width}x${plan.height}@${plan.fps}`);
  console.log(`syntheticInputKinds=${plan.syntheticInputKinds.join(',')}`);
  console.log(`diagnosticFixtureKinds=${plan.diagnosticFixtureKinds.join(',')}`);
  console.log(`chromaProfileKey=${plan.chromaProfileKey}`);
  console.log(`colorProfileKey=${plan.colorProfileKey}`);
  console.log(`codecProfileKey=${plan.codecProfileKey}`);
  console.log(`audioProfileKey=${plan.audioProfileKey}`);
  console.log(`ephemeralActivationValid=${plan.ephemeralActivationValid}`);
  console.log(`rendererInvoked=${plan.rendererInvoked}`);
  console.log(`databaseAccessed=${plan.databaseAccessed}`);
  console.log(`objectStorageAccessed=${plan.objectStorageAccessed}`);
  console.log(`aiProviderCalled=${plan.aiProviderCalled}`);
  console.log(`networkCalled=${plan.networkCalled}`);
  console.log(`publicationSideEffect=${plan.publicationSideEffect}`);
  console.log(`externalSideEffect=${plan.externalSideEffect}`);
  console.log(
    'PASS: Phase 11C-2A dry-run completed with zero render, DB, object-storage, AI, network or publication side effects.',
  );
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11C2A_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );
    process.exitCode = 1;
  });
}
