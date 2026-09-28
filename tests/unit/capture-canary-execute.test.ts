import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  CaptureExecutionResult,
  CaptureExecutorInput,
} from '../../apps/worker-capture/src/index.js';
import { parseConfig } from '../../packages/shared/src/index.js';
import {
  CAPTURE_CANARY_CONFIRMATION,
  assertCaptureCanaryConfirmation,
  assertCaptureCanaryExecutionEnvironment,
  executeReviewedCaptureCanary,
  parseCaptureCanaryExecuteArgs,
} from '../../scripts/phase11b2-capture-canary-execute.js';
import { configFixture } from '../support/config.js';

const roots: string[] = [];

async function workspace() {
  const root = await mkdtemp(join(tmpdir(), 'vce-11b2b-'));
  roots.push(root);
  return root;
}

async function storageState(root: string) {
  const path = join(root, 'state.json');
  await writeFile(
    path,
    JSON.stringify({
      cookies: [],
      origins: [],
    }),
    { mode: 0o600 },
  );
  await chmod(path, 0o600);
  return path;
}

function activeConfig() {
  return parseConfig({
    ...configFixture,
    VCE_ENV: 'STAGING_CAPTURE',
    PAUSE_CAPTURE: 'false',
  });
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) =>
      rm(root, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

describe('Phase 11B-2B reviewed Capture canary execution', () => {
  it('requires the explicit CLI confirmation and storage-state arguments', () => {
    expect(
      parseCaptureCanaryExecuteArgs([
        '--confirm',
        CAPTURE_CANARY_CONFIRMATION,
        '--storage-state',
        '/tmp/state.json',
      ]),
    ).toEqual({
      confirmation: CAPTURE_CANARY_CONFIRMATION,
      storageStatePath: '/tmp/state.json',
    });

    expect(() => parseCaptureCanaryExecuteArgs([])).toThrow('CAPTURE_CANARY_EXECUTE_USAGE_INVALID');
  });

  it('requires STAGING_CAPTURE, unpaused Capture and the exact confirmation phrase', () => {
    expect(() => assertCaptureCanaryExecutionEnvironment(parseConfig(configFixture))).toThrow(
      'CAPTURE_CANARY_EXECUTION_ENVIRONMENT_INVALID',
    );

    expect(() => assertCaptureCanaryExecutionEnvironment(activeConfig())).not.toThrow();

    expect(() => assertCaptureCanaryConfirmation('wrong')).toThrow(
      'CAPTURE_CANARY_CONFIRMATION_INVALID',
    );

    expect(() => assertCaptureCanaryConfirmation(CAPTURE_CANARY_CONFIRMATION)).not.toThrow();
  });

  it('validates the complete envelope with a fake executor and no browser or network', async () => {
    const root = await workspace();
    const statePath = await storageState(root);
    const outputDirectory = join(root, 'output');

    const execute = vi.fn(
      async (request: CaptureExecutorInput): Promise<CaptureExecutionResult> => {
        const scenario = request.scenario as {
          fixturePolicy: Parameters<CaptureExecutorInput['fixtureManager']['prepare']>[0];
          auth: { authProfileKey: string };
        };

        await request.fixtureManager.prepare(scenario.fixturePolicy, request.input);

        await request.authStateProvider.storageStatePath(scenario.auth.authProfileKey);

        const screenshot = join(request.outputDirectory, 'screenshots', 'pricing.png');

        await mkdir(dirname(screenshot), {
          recursive: true,
          mode: 0o700,
        });

        await writeFile(screenshot, Buffer.from('fake-evidence'), { mode: 0o600 });

        return {
          result: 'SUCCEEDED',
          executedStepCount: 4,
          assertions: [],
          markedMoments: [],
          files: [
            {
              key: 'pricing',
              role: 'SCREENSHOT',
              path: screenshot,
              required: true,
              diagnostic: false,
            },
          ],
          warnings: [],
          diagnostics: {
            consoleErrorCount: 0,
            pageErrorCount: 0,
            requestFailureCount: 0,
          },
          runtime: {
            playwrightVersion: 'fake-no-browser',
            browserVersion: 'fake-no-browser',
            workerVersion: 'phase11b2b-test',
          },
        };
      },
    );

    const evidence = await executeReviewedCaptureCanary({
      config: activeConfig(),
      confirmation: CAPTURE_CANARY_CONFIRMATION,
      storageStatePath: statePath,
      outputDirectory,
      execute,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(evidence).toMatchObject({
      mode: 'EXECUTE',
      scenarioKey: 'PRICING_PAGE',
      scenarioVersionId: '018f3000-0000-7000-8000-000000000004',
      environmentKey: 'VISION_CAPTURE_DEMO',
      baseUrl: 'https://capture-demo.urvision.fr',
      authProfileKey: 'VISION_CAPTURE_ACCOUNT_V1',
      credentialResolved: true,
      executorInvoked: true,
      result: 'SUCCEEDED',
      producedOutputKeys: ['pricing'],
    });

    const manifest = await readFile(evidence.manifestPath, 'utf8');

    expect(manifest).toContain('PHASE_11B_2B_PRICING_PAGE');
    expect(manifest).not.toContain(statePath);
  });

  it('fails closed if the required pricing screenshot is absent', async () => {
    const root = await workspace();
    const statePath = await storageState(root);

    await expect(
      executeReviewedCaptureCanary({
        config: activeConfig(),
        confirmation: CAPTURE_CANARY_CONFIRMATION,
        storageStatePath: statePath,
        outputDirectory: join(root, 'output'),
        execute: async () => ({
          result: 'SUCCEEDED',
          executedStepCount: 4,
          assertions: [],
          markedMoments: [],
          files: [],
          warnings: [],
          diagnostics: {
            consoleErrorCount: 0,
            pageErrorCount: 0,
            requestFailureCount: 0,
          },
          runtime: {
            playwrightVersion: 'fake',
            browserVersion: 'fake',
            workerVersion: 'fake',
          },
        }),
      }),
    ).rejects.toThrow('CAPTURE_CANARY_REQUIRED_OUTPUT_MISSING');
  });
});
