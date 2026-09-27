import { describe, expect, it } from 'vitest';

import { CaptureScenarioRegistry } from '../../packages/application/src/index.js';
import { parseConfig } from '../../packages/shared/src/index.js';
import {
  CAPTURE_CANARY_BASE_URL,
  CAPTURE_CANARY_SCENARIO_KEY,
  assertCaptureCanaryPersistentDefaults,
  captureCanaryMode,
  prepareCaptureCanaryDryRun,
} from '../../scripts/phase11b2-capture-canary.js';
import { configFixture } from '../support/config.js';

describe('Phase 11B-2A Capture canary harness', () => {
  it('supports dry-run only and explicitly rejects execution', () => {
    expect(captureCanaryMode([])).toBe('DRY_RUN');

    expect(captureCanaryMode(['--dry-run'])).toBe('DRY_RUN');

    expect(() => captureCanaryMode(['--execute'])).toThrow(
      'CANARY_EXECUTION_NOT_IMPLEMENTED_11B2A',
    );

    expect(() => captureCanaryMode(['--unknown'])).toThrow('CAPTURE_CANARY_USAGE_INVALID');
  });

  it('requires persistent LOCAL paused defaults', () => {
    const safe = parseConfig(configFixture);

    expect(() => assertCaptureCanaryPersistentDefaults(safe)).not.toThrow();

    const captureUnpaused = parseConfig({
      ...configFixture,
      PAUSE_CAPTURE: 'false',
    });

    expect(() => assertCaptureCanaryPersistentDefaults(captureUnpaused)).toThrow(
      'CAPTURE_CANARY_PERSISTENT_DEFAULTS_UNSAFE',
    );

    const staging = parseConfig({
      ...configFixture,
      VCE_ENV: 'STAGING_CAPTURE',
    });

    expect(() => assertCaptureCanaryPersistentDefaults(staging)).toThrow(
      'CAPTURE_CANARY_PERSISTENT_DEFAULTS_UNSAFE',
    );
  });

  it('selects the immutable low-side-effect PRICING_PAGE scenario', async () => {
    const config = parseConfig(configFixture);

    const plan = await prepareCaptureCanaryDryRun(config, new CaptureScenarioRegistry());

    expect(plan).toMatchObject({
      mode: 'DRY_RUN',
      scenarioKey: CAPTURE_CANARY_SCENARIO_KEY,
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

    expect(plan.scenarioVersionId).toBe('018f3000-0000-7000-8000-000000000004');
  });
});
