import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import {
  assertLocalBootstrap,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';

export const DURABLE_RENDER_CANARY_FIXTURE_VERSION = 'phase11c3-disposable-durable-render-v1';

export const DURABLE_RENDER_CANARY_EXECUTION_CONFIRMATION =
  'EXECUTE_DISPOSABLE_DURABLE_RENDER_CANARY';

export type DurableRenderCanaryDryRunPlan = Readonly<{
  mode: 'DRY_RUN';
  fixtureVersion: string;
  databaseScope: 'DISPOSABLE_LOCAL_POSTGRES';
  objectStorageScope: 'DISPOSABLE_LOCAL_S3_BUCKET';
  renderWorkerPath: 'RenderWorkerOrchestrator.execute';
  expectedDurableStages: readonly [
    'RENDER_JOB',
    'RENDER_ATTEMPT',
    'INPUT_ASSET_MATERIALIZATION',
    'REMOTION_RENDER',
    'TECHNICAL_QA',
    'PRIVATE_OBJECT_UPLOAD',
    'OUTPUT_ASSET_READY',
    'JOB_SUCCEEDED',
  ];
  persistentEnvironment: 'LOCAL';
  persistentRenderingPaused: true;
  databaseCreated: false;
  bucketCreated: false;
  renderJobCreated: false;
  orchestratorInvoked: false;
  rendererInvoked: false;
  objectUploaded: false;
  aiProviderCalled: false;
  publicationSideEffect: false;
  remoteSideEffect: false;
}>;

function fail(code: string): never {
  throw new Error(code);
}

export function durableRenderCanaryMode(args: readonly string[]): 'DRY_RUN' {
  if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
    return 'DRY_RUN';
  }

  if (args.includes('--execute')) {
    fail('DURABLE_RENDER_CANARY_EXECUTION_NOT_IMPLEMENTED_11C3A');
  }

  fail('DURABLE_RENDER_CANARY_USAGE_INVALID');
}

export function assertDurableRenderCanaryLocalDefaults(config: RuntimeConfig): void {
  assertLocalBootstrap(config);

  if (
    !config.PAUSE_RENDERING ||
    !config.PAUSE_CAPTURE ||
    !config.PAUSE_AI_GENERATION ||
    !config.PAUSE_ALL_PUBLISHING ||
    !config.PAUSE_ANALYTICS_COLLECTION ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false'
  ) {
    fail('DURABLE_RENDER_CANARY_LOCAL_DEFAULTS_UNSAFE');
  }
}

export function prepareDurableRenderCanaryDryRun(
  config: RuntimeConfig,
): DurableRenderCanaryDryRunPlan {
  assertDurableRenderCanaryLocalDefaults(config);

  return {
    mode: 'DRY_RUN',
    fixtureVersion: DURABLE_RENDER_CANARY_FIXTURE_VERSION,
    databaseScope: 'DISPOSABLE_LOCAL_POSTGRES',
    objectStorageScope: 'DISPOSABLE_LOCAL_S3_BUCKET',
    renderWorkerPath: 'RenderWorkerOrchestrator.execute',
    expectedDurableStages: [
      'RENDER_JOB',
      'RENDER_ATTEMPT',
      'INPUT_ASSET_MATERIALIZATION',
      'REMOTION_RENDER',
      'TECHNICAL_QA',
      'PRIVATE_OBJECT_UPLOAD',
      'OUTPUT_ASSET_READY',
      'JOB_SUCCEEDED',
    ],
    persistentEnvironment: 'LOCAL',
    persistentRenderingPaused: true,
    databaseCreated: false,
    bucketCreated: false,
    renderJobCreated: false,
    orchestratorInvoked: false,
    rendererInvoked: false,
    objectUploaded: false,
    aiProviderCalled: false,
    publicationSideEffect: false,
    remoteSideEffect: false,
  };
}

async function main() {
  durableRenderCanaryMode(process.argv.slice(2));

  const plan = prepareDurableRenderCanaryDryRun(parseConfig(process.env));

  console.log('===== PHASE 11C-3A DURABLE RENDER CANARY =====');
  console.log(`mode=${plan.mode}`);
  console.log(`fixtureVersion=${plan.fixtureVersion}`);
  console.log(`databaseScope=${plan.databaseScope}`);
  console.log(`objectStorageScope=${plan.objectStorageScope}`);
  console.log(`renderWorkerPath=${plan.renderWorkerPath}`);
  console.log(`expectedDurableStages=${plan.expectedDurableStages.join(',')}`);
  console.log(`persistentEnvironment=${plan.persistentEnvironment}`);
  console.log(`persistentRenderingPaused=${plan.persistentRenderingPaused}`);
  console.log(`databaseCreated=${plan.databaseCreated}`);
  console.log(`bucketCreated=${plan.bucketCreated}`);
  console.log(`renderJobCreated=${plan.renderJobCreated}`);
  console.log(`orchestratorInvoked=${plan.orchestratorInvoked}`);
  console.log(`rendererInvoked=${plan.rendererInvoked}`);
  console.log(`objectUploaded=${plan.objectUploaded}`);
  console.log(`aiProviderCalled=${plan.aiProviderCalled}`);
  console.log(`publicationSideEffect=${plan.publicationSideEffect}`);
  console.log(`remoteSideEffect=${plan.remoteSideEffect}`);

  console.log(
    'PASS: Phase 11C-3A dry-run completed with zero DB, S3, Render, AI, publication or remote side effects.',
  );
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11C3A_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );
    process.exitCode = 1;
  });
}
