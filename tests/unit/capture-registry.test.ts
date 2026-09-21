import { expect, it } from 'vitest';
import { CaptureScenarioRegistry } from '../../packages/application/src/capture-registry.js';

it('loads exactly the five canonical resolved capture scenarios', async () => {
  const scenarios = await new CaptureScenarioRegistry().list();

  expect(scenarios.map((entry) => entry.spec.identity.scenarioKey).sort()).toEqual([
    'AGENT_QUERY_TO_RESULTS',
    'AGENT_RESULT_DETAIL',
    'LANDING_PRODUCT_PROOF',
    'MISSION_RUNNING_TO_DONE',
    'PRICING_PAGE',
  ]);

  for (const entry of scenarios) {
    expect(entry.spec.environment.allowedOrigins).toContain(
      new URL(entry.spec.environment.baseUrl).origin,
    );

    expect(entry.spec.browser.browser).toBe('CHROMIUM');

    expect(entry.spec.safety.maximumPages).toBe(1);
    expect(entry.spec.safety.blockDownloads).toBe(true);
    expect(entry.spec.safety.blockPopupsByDefault).toBe(true);

    const screenshotKeys = new Set(
      entry.spec.steps.flatMap((step) => (step.type === 'SCREENSHOT' ? [step.outputKey] : [])),
    );

    for (const output of entry.spec.outputs) {
      if (output.required && output.role === 'SCREENSHOT') {
        expect(screenshotKeys.has(output.key)).toBe(true);
      }

      if (output.required && output.role === 'VIDEO') {
        expect(entry.spec.browser.recordVideo).toBe(true);
      }
    }

    expect(JSON.stringify(entry.artifact)).not.toContain('networkidle');
  }
});

it('resolves scenarios by canonical key and spec version id', async () => {
  const registry = new CaptureScenarioRegistry();

  const pricing = await registry.getByKey('PRICING_PAGE');

  expect(await registry.getBySpecVersionId(pricing.spec.identity.captureScenarioVersionId)).toEqual(
    pricing,
  );

  await expect(registry.getByKey('UNKNOWN')).rejects.toThrow('CAPTURE_SCENARIO_NOT_FOUND');
});
