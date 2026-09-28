import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  CAPTURE_CANARY_BASE_URL,
  CAPTURE_CANARY_SCENARIO_KEY,
  captureCanaryMode,
  prepareCaptureCanaryDryRun,
} from '../../scripts/phase11b2-capture-canary.js';
import { CaptureScenarioRegistry } from '../../packages/application/src/index.js';
import { parseConfig } from '../../packages/shared/src/index.js';
import { configFixture } from '../support/config.js';

const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const documentation = readFileSync('docs/PHASE_11B_CAPTURE_ACTIVATION.md', 'utf8');

describe('Phase 11B-2A closure contract', () => {
  it('keeps the canary dry-run only', () => {
    expect(captureCanaryMode([])).toBe('DRY_RUN');
    expect(captureCanaryMode(['--dry-run'])).toBe('DRY_RUN');

    expect(() => captureCanaryMode(['--execute'])).toThrow(
      'CANARY_EXECUTION_NOT_IMPLEMENTED_11B2A',
    );
  });

  it('freezes PRICING_PAGE as the low-side-effect canary', async () => {
    const plan = await prepareCaptureCanaryDryRun(
      parseConfig(configFixture),
      new CaptureScenarioRegistry(),
    );

    expect(plan).toMatchObject({
      mode: 'DRY_RUN',
      scenarioKey: CAPTURE_CANARY_SCENARIO_KEY,
      scenarioVersionId: '018f3000-0000-7000-8000-000000000004',
      environmentKey: 'VISION_CAPTURE_DEMO',
      baseUrl: CAPTURE_CANARY_BASE_URL,
      authProfileKey: 'VISION_CAPTURE_ACCOUNT_V1',
      fixtureMode: 'PREPARED_STATE',
      resetBeforeRun: false,
      stepTypes: ['NAVIGATE', 'ASSERT', 'VISUAL_SETTLE', 'SCREENSHOT'],
      outputKeys: ['pricing'],
      ephemeralActivationValid: true,
      credentialResolved: false,
      browserLaunched: false,
      networkCalled: false,
      externalSideEffect: false,
    });
  });

  it('freezes the reproducible dry-run gate', () => {
    expect(packageJson.scripts['canary:capture']).toBe('tsx scripts/phase11b2-capture-canary.ts');

    expect(packageJson.scripts['check:phase11b2a']).toBe(
      'pnpm check:phase11b1 && ' +
        'pnpm exec vitest run ' +
        'tests/unit/capture-canary-harness.test.ts && ' +
        'pnpm exec tsx ' +
        'scripts/phase11b2-capture-canary.ts ' +
        '--dry-run',
    );
  });

  it('records completion without claiming a remote canary', () => {
    expect(documentation).toContain('11B-2A dry-run Capture canary harness: DONE');

    expect(documentation).toContain('`credentialResolved=false`');

    expect(documentation).toContain('`browserLaunched=false`');

    expect(documentation).toContain('`networkCalled=false`');

    expect(documentation).toContain('`externalSideEffect=false`');
  });
});
