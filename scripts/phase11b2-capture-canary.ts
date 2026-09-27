import 'dotenv/config';

import { pathToFileURL } from 'node:url';

import {
  CaptureScenarioRegistry,
  type ResolvedCaptureScenario,
} from '../packages/application/src/index.js';
import { VISION_CAPTURE_AUTH_PROFILE_KEY } from '../apps/worker-capture/src/auth.js';
import {
  isCaptureActivationEnabled,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';

export const CAPTURE_CANARY_SCENARIO_KEY = 'PRICING_PAGE';
export const CAPTURE_CANARY_BASE_URL = 'https://capture-demo.urvision.fr';

export type CaptureCanaryDryRunPlan = {
  mode: 'DRY_RUN';
  scenarioKey: string;
  scenarioVersionId: string;
  environmentKey: string;
  baseUrl: string;
  authProfileKey: string;
  fixtureMode: string;
  resetBeforeRun: boolean;
  stepTypes: string[];
  outputKeys: string[];
  ephemeralActivationValid: true;
  credentialResolved: false;
  browserLaunched: false;
  networkCalled: false;
  externalSideEffect: false;
};

function fail(code: string): never {
  throw new Error(code);
}

export function captureCanaryMode(args: readonly string[]): 'DRY_RUN' {
  if (args.length === 0 || (args.length === 1 && args[0] === '--dry-run')) {
    return 'DRY_RUN';
  }

  if (args.length === 1 && args[0] === '--execute') {
    fail('CANARY_EXECUTION_NOT_IMPLEMENTED_11B2A');
  }

  fail('CAPTURE_CANARY_USAGE_INVALID');
}

export function assertCaptureCanaryPersistentDefaults(config: RuntimeConfig): void {
  if (
    config.VCE_ENV !== 'LOCAL' ||
    !config.PAUSE_CAPTURE ||
    config.VCE_REAL_PROVIDERS_ENABLED !== 'false'
  ) {
    fail('CAPTURE_CANARY_PERSISTENT_DEFAULTS_UNSAFE');
  }
}

function requireRecord(value: unknown, code: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(code);
  }

  return value as Record<string, unknown>;
}

export function validateCaptureCanaryScenario(
  resolved: ResolvedCaptureScenario,
): CaptureCanaryDryRunPlan {
  const spec = resolved.spec;

  if (spec.identity.scenarioKey !== CAPTURE_CANARY_SCENARIO_KEY) {
    fail('CAPTURE_CANARY_SCENARIO_MISMATCH');
  }

  if (spec.environment.environmentKey !== 'VISION_CAPTURE_DEMO') {
    fail('CAPTURE_CANARY_ENVIRONMENT_MISMATCH');
  }

  if (
    spec.environment.baseUrl !== CAPTURE_CANARY_BASE_URL ||
    spec.environment.allowedOrigins.length !== 1 ||
    spec.environment.allowedOrigins[0] !== CAPTURE_CANARY_BASE_URL
  ) {
    fail('CAPTURE_CANARY_ORIGIN_MISMATCH');
  }

  if (spec.auth.authProfileKey !== VISION_CAPTURE_AUTH_PROFILE_KEY) {
    fail('CAPTURE_CANARY_AUTH_PROFILE_MISMATCH');
  }

  if (
    spec.fixturePolicy.mode !== 'PREPARED_STATE' ||
    spec.fixturePolicy.resetBeforeRun !== false ||
    spec.fixturePolicy.fixtureVersion !== 'marketing-v1'
  ) {
    fail('CAPTURE_CANARY_FIXTURE_POLICY_UNSAFE');
  }

  const inputSchema = requireRecord(spec.inputSchema, 'CAPTURE_CANARY_INPUT_SCHEMA_INVALID');

  const properties = requireRecord(inputSchema.properties, 'CAPTURE_CANARY_INPUT_SCHEMA_INVALID');

  if (inputSchema.type !== 'object' || Object.keys(properties).length !== 0) {
    fail('CAPTURE_CANARY_INPUT_NOT_EMPTY');
  }

  const stepTypes = spec.steps.map((step) => step.type);

  const expectedStepTypes = ['NAVIGATE', 'ASSERT', 'VISUAL_SETTLE', 'SCREENSHOT'];

  if (
    stepTypes.length !== expectedStepTypes.length ||
    stepTypes.some((step, index) => step !== expectedStepTypes[index])
  ) {
    fail('CAPTURE_CANARY_STEPS_UNSAFE');
  }

  const navigate = spec.steps[0];

  if (navigate?.type !== 'NAVIGATE' || navigate.path !== '/tarifs') {
    fail('CAPTURE_CANARY_NAVIGATION_UNSAFE');
  }

  if (
    spec.outputs.length !== 1 ||
    spec.outputs[0]?.role !== 'SCREENSHOT' ||
    spec.outputs[0]?.required !== true ||
    spec.outputs[0]?.key !== 'pricing'
  ) {
    fail('CAPTURE_CANARY_OUTPUT_UNSAFE');
  }

  if (
    !spec.safety.blockDownloads ||
    !spec.safety.blockPopupsByDefault ||
    spec.safety.allowFileUpload ||
    spec.safety.maximumPages !== 1
  ) {
    fail('CAPTURE_CANARY_SAFETY_POLICY_UNSAFE');
  }

  return {
    mode: 'DRY_RUN',
    scenarioKey: spec.identity.scenarioKey,
    scenarioVersionId: spec.identity.captureScenarioVersionId,
    environmentKey: spec.environment.environmentKey,
    baseUrl: spec.environment.baseUrl,
    authProfileKey: spec.auth.authProfileKey,
    fixtureMode: spec.fixturePolicy.mode,
    resetBeforeRun: spec.fixturePolicy.resetBeforeRun,
    stepTypes,
    outputKeys: spec.outputs.map((output) => output.key),
    ephemeralActivationValid: true,
    credentialResolved: false,
    browserLaunched: false,
    networkCalled: false,
    externalSideEffect: false,
  };
}

export async function prepareCaptureCanaryDryRun(
  config: RuntimeConfig,
  registry = new CaptureScenarioRegistry(),
): Promise<CaptureCanaryDryRunPlan> {
  assertCaptureCanaryPersistentDefaults(config);

  const ephemeralActivation: RuntimeConfig = {
    ...config,
    VCE_ENV: 'STAGING_CAPTURE',
    PAUSE_CAPTURE: false,
  };

  if (!isCaptureActivationEnabled(ephemeralActivation)) {
    fail('CAPTURE_CANARY_EPHEMERAL_ACTIVATION_INVALID');
  }

  const resolved = await registry.getByKey(CAPTURE_CANARY_SCENARIO_KEY);

  return validateCaptureCanaryScenario(resolved);
}

async function main() {
  captureCanaryMode(process.argv.slice(2));

  const config = parseConfig(process.env);

  const plan = await prepareCaptureCanaryDryRun(config);

  console.log('===== PHASE 11B-2A CAPTURE CANARY =====');
  console.log(`mode=${plan.mode}`);
  console.log(`scenarioKey=${plan.scenarioKey}`);
  console.log(`scenarioVersionId=${plan.scenarioVersionId}`);
  console.log(`environmentKey=${plan.environmentKey}`);
  console.log(`baseUrl=${plan.baseUrl}`);
  console.log(`authProfileKey=${plan.authProfileKey}`);
  console.log(`fixtureMode=${plan.fixtureMode}`);
  console.log(`resetBeforeRun=${plan.resetBeforeRun}`);
  console.log(`stepTypes=${plan.stepTypes.join(',')}`);
  console.log(`outputKeys=${plan.outputKeys.join(',')}`);
  console.log(`ephemeralActivationValid=${plan.ephemeralActivationValid}`);
  console.log(`credentialResolved=${plan.credentialResolved}`);
  console.log(`browserLaunched=${plan.browserLaunched}`);
  console.log(`networkCalled=${plan.networkCalled}`);
  console.log(`externalSideEffect=${plan.externalSideEffect}`);
  console.log(
    'PASS: Phase 11B-2A dry-run completed with zero credential, browser or network side effects.',
  );
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11B2A_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );

    process.exitCode = 1;
  });
}
