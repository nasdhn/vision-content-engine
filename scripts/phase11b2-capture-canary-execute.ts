import 'dotenv/config';

import { chmod, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CaptureScenarioRegistry } from '../packages/application/src/index.js';
import {
  MountedCaptureAuthStateProvider,
  VISION_CAPTURE_AUTH_PROFILE_KEY,
  executeCaptureScenario,
  type CaptureExecutionResult,
  type CaptureExecutorInput,
  type CaptureFixtureManager,
} from '../apps/worker-capture/src/index.js';
import {
  isCaptureActivationEnabled,
  parseConfig,
  type RuntimeConfig,
} from '../packages/shared/src/index.js';
import {
  CAPTURE_CANARY_SCENARIO_KEY,
  validateCaptureCanaryScenario,
} from './phase11b2-capture-canary.js';

export const CAPTURE_CANARY_CONFIRMATION = 'EXECUTE_PRICING_PAGE_CAPTURE_DEMO';

type CaptureExecute = (input: CaptureExecutorInput) => Promise<CaptureExecutionResult>;

type ExecuteOptions = {
  config: RuntimeConfig;
  confirmation: string;
  storageStatePath: string;
  execute?: CaptureExecute;
  outputDirectory?: string;
  registry?: CaptureScenarioRegistry;
};

export type CaptureCanaryExecutionEvidence = {
  mode: 'EXECUTE';
  scenarioKey: string;
  scenarioVersionId: string;
  environmentKey: string;
  baseUrl: string;
  authProfileKey: string;
  credentialResolved: true;
  executorInvoked: true;
  result: 'SUCCEEDED';
  outputDirectory: string;
  manifestPath: string;
  producedOutputKeys: string[];
};

function fail(code: string): never {
  throw new Error(code);
}

export function assertCaptureCanaryExecutionEnvironment(config: RuntimeConfig): void {
  if (!isCaptureActivationEnabled(config) || config.VCE_REAL_PROVIDERS_ENABLED !== 'false') {
    fail('CAPTURE_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  }
}

export function assertCaptureCanaryConfirmation(confirmation: string): void {
  if (confirmation !== CAPTURE_CANARY_CONFIRMATION) {
    fail('CAPTURE_CANARY_CONFIRMATION_INVALID');
  }
}

export function parseCaptureCanaryExecuteArgs(rawArgs: readonly string[]): {
  confirmation: string;
  storageStatePath: string;
} {
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;

  if (
    args.length !== 4 ||
    args[0] !== '--confirm' ||
    args[2] !== '--storage-state' ||
    typeof args[1] !== 'string' ||
    typeof args[3] !== 'string'
  ) {
    fail('CAPTURE_CANARY_EXECUTE_USAGE_INVALID');
  }

  return {
    confirmation: args[1],
    storageStatePath: args[3],
  };
}

class ReviewedPreparedStateFixtureManager implements CaptureFixtureManager {
  async prepare(
    policy: Parameters<CaptureFixtureManager['prepare']>[0],
    input: Readonly<Record<string, unknown>>,
  ) {
    if (
      policy.mode !== 'PREPARED_STATE' ||
      policy.resetBeforeRun !== false ||
      policy.fixtureVersion !== 'marketing-v1'
    ) {
      fail('CAPTURE_CANARY_FIXTURE_POLICY_UNSAFE');
    }

    if (Object.keys(input).length !== 0) {
      fail('CAPTURE_CANARY_INPUT_NOT_EMPTY');
    }

    return {};
  }
}

async function verifyRequiredPricingOutput(execution: CaptureExecutionResult): Promise<string[]> {
  if (execution.result !== 'SUCCEEDED') {
    fail(execution.failureCode ?? 'CAPTURE_CANARY_EXECUTION_FAILED');
  }

  const pricing = execution.files.find(
    (file) =>
      file.key === 'pricing' && file.role === 'SCREENSHOT' && file.required && !file.diagnostic,
  );

  if (!pricing) {
    fail('CAPTURE_CANARY_REQUIRED_OUTPUT_MISSING');
  }

  const info = await stat(pricing.path);

  if (!info.isFile() || info.size <= 0) {
    fail('CAPTURE_CANARY_REQUIRED_OUTPUT_INVALID');
  }

  return ['pricing'];
}

async function writeEvidence(
  outputDirectory: string,
  execution: CaptureExecutionResult,
): Promise<string> {
  const manifestPath = join(outputDirectory, 'canary-evidence.json');

  await writeFile(
    manifestPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        canary: 'PHASE_11B_2B_PRICING_PAGE',
        scenarioKey: CAPTURE_CANARY_SCENARIO_KEY,
        result: execution.result,
        failureCode: execution.failureCode ?? null,
        executedStepCount: execution.executedStepCount,
        assertions: execution.assertions,
        diagnostics: execution.diagnostics,
        runtime: execution.runtime,
        files: execution.files.map((file) => ({
          key: file.key,
          role: file.role,
          required: file.required,
          diagnostic: file.diagnostic,
          fileName: basename(file.path),
        })),
      },
      null,
      2,
    )}\n`,
    { mode: 0o600 },
  );

  await chmod(manifestPath, 0o600);

  return manifestPath;
}

export async function executeReviewedCaptureCanary(
  options: ExecuteOptions,
): Promise<CaptureCanaryExecutionEvidence> {
  assertCaptureCanaryExecutionEnvironment(options.config);
  assertCaptureCanaryConfirmation(options.confirmation);

  if (!isAbsolute(options.storageStatePath)) {
    fail('CAPTURE_AUTH_STATE_PATH_NOT_ABSOLUTE');
  }

  const registry = options.registry ?? new CaptureScenarioRegistry();

  const resolved = await registry.getByKey(CAPTURE_CANARY_SCENARIO_KEY);

  const plan = validateCaptureCanaryScenario(resolved);

  const authStateProvider = new MountedCaptureAuthStateProvider(options.storageStatePath, () =>
    isCaptureActivationEnabled(options.config),
  );

  await authStateProvider.storageStatePath(VISION_CAPTURE_AUTH_PROFILE_KEY);

  const outputDirectory =
    options.outputDirectory ?? (await mkdtemp(join(tmpdir(), 'vce-capture-canary-')));

  if (!isAbsolute(outputDirectory)) {
    fail('CAPTURE_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  }

  await mkdir(outputDirectory, {
    recursive: true,
    mode: 0o700,
  });

  const execute = options.execute ?? executeCaptureScenario;

  const execution = await execute({
    scenario: resolved.spec,
    input: {},
    outputDirectory,
    fixtureManager: new ReviewedPreparedStateFixtureManager(),
    authStateProvider,
  });

  const producedOutputKeys = await verifyRequiredPricingOutput(execution);

  const manifestPath = await writeEvidence(outputDirectory, execution);

  return {
    mode: 'EXECUTE',
    scenarioKey: plan.scenarioKey,
    scenarioVersionId: plan.scenarioVersionId,
    environmentKey: plan.environmentKey,
    baseUrl: plan.baseUrl,
    authProfileKey: plan.authProfileKey,
    credentialResolved: true,
    executorInvoked: true,
    result: 'SUCCEEDED',
    outputDirectory,
    manifestPath,
    producedOutputKeys,
  };
}

async function main() {
  const args = parseCaptureCanaryExecuteArgs(process.argv.slice(2));

  const evidence = await executeReviewedCaptureCanary({
    config: parseConfig(process.env),
    confirmation: args.confirmation,
    storageStatePath: args.storageStatePath,
  });

  console.log('===== PHASE 11B-2B REVIEWED CAPTURE CANARY =====');
  console.log(`mode=${evidence.mode}`);
  console.log(`scenarioKey=${evidence.scenarioKey}`);
  console.log(`scenarioVersionId=${evidence.scenarioVersionId}`);
  console.log(`environmentKey=${evidence.environmentKey}`);
  console.log(`baseUrl=${evidence.baseUrl}`);
  console.log(`authProfileKey=${evidence.authProfileKey}`);
  console.log(`credentialResolved=${evidence.credentialResolved}`);
  console.log(`executorInvoked=${evidence.executorInvoked}`);
  console.log(`result=${evidence.result}`);
  console.log(`producedOutputKeys=${evidence.producedOutputKeys.join(',')}`);
  console.log(`outputDirectory=${evidence.outputDirectory}`);
  console.log(`manifestPath=${evidence.manifestPath}`);
  console.log('PASS: reviewed Capture canary completed.');
}

const entryPoint =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (entryPoint) {
  main().catch((error: unknown) => {
    console.error(
      `PHASE_11B2B_CANARY_FAILED:${error instanceof Error ? error.message : 'UNKNOWN_ERROR'}`,
    );
    process.exitCode = 1;
  });
}
