import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import {
  BrowserProfileSchema,
  CaptureSafetyPolicySchema,
  CaptureScenarioVersionSpecSchema,
} from '@vision/contracts';
import { assertNoSecrets } from '@vision/contracts/canonical';
import { invariant } from '@vision/domain';

const record = z.record(z.string(), z.unknown());

const browserRegistrySchema = z
  .object({
    version: z.string().min(1),
    profiles: record,
  })
  .strict();

const safetyRegistrySchema = z
  .object({
    version: z.string().min(1),
    policies: record,
  })
  .strict();

const environmentSchema = z
  .object({
    environmentKey: z.string().min(1),
    allowedOrigins: z.array(z.string().url()).min(1),
    baseUrl: z.string().url(),
  })
  .strict();

export type CaptureScenarioSpec = z.infer<typeof CaptureScenarioVersionSpecSchema>;

export type ResolvedCaptureScenario = {
  artifact: Record<string, unknown>;
  browserProfileKey: string;
  safetyPolicyKey: string;
  spec: CaptureScenarioSpec;
};

export class CaptureScenarioRegistry {
  private cache?: Promise<ResolvedCaptureScenario[]>;

  constructor(
    private readonly root = fileURLToPath(new URL('../capture-seeds/', import.meta.url)),
  ) {}

  async list(): Promise<ResolvedCaptureScenario[]> {
    this.cache ??= this.load();
    return [...(await this.cache)];
  }

  async getByKey(key: string): Promise<ResolvedCaptureScenario> {
    const scenario = (await this.list()).find((entry) => entry.spec.identity.scenarioKey === key);
    invariant(scenario, 'CAPTURE_SCENARIO_NOT_FOUND');
    return scenario;
  }

  async getBySpecVersionId(id: string): Promise<ResolvedCaptureScenario> {
    const scenario = (await this.list()).find(
      (entry) => entry.spec.identity.captureScenarioVersionId === id,
    );
    invariant(scenario, 'CAPTURE_SCENARIO_VERSION_NOT_FOUND');
    return scenario;
  }

  private async load(): Promise<ResolvedCaptureScenario[]> {
    const browsers = browserRegistrySchema.parse(
      JSON.parse(await readFile(join(this.root, 'browser-profiles.json'), 'utf8')),
    );
    const policies = safetyRegistrySchema.parse(
      JSON.parse(await readFile(join(this.root, 'safety-policies.json'), 'utf8')),
    );

    const files = (await readdir(join(this.root, 'scenarios')))
      .filter((name) => name.endsWith('.json'))
      .sort();

    const scenarios: ResolvedCaptureScenario[] = [];

    for (const file of files) {
      const artifact = record.parse(
        JSON.parse(await readFile(join(this.root, 'scenarios', file), 'utf8')),
      );

      assertNoSecrets(artifact);

      const browserProfileKey = z.string().min(1).parse(artifact.browserProfileKey);
      const safetyPolicyKey = z.string().min(1).parse(artifact.safetyPolicyKey);

      const browserInput = browsers.profiles[browserProfileKey];
      const safetyInput = policies.policies[safetyPolicyKey];

      invariant(browserInput, 'CAPTURE_BROWSER_PROFILE_NOT_FOUND');
      invariant(safetyInput, 'CAPTURE_SAFETY_POLICY_NOT_FOUND');

      const runtimeInput = Object.fromEntries(
        Object.entries(artifact).filter(
          ([key]) => !['browserProfileKey', 'safetyPolicyKey'].includes(key),
        ),
      );

      const environment = environmentSchema.parse(runtimeInput.environment);
      const browser = BrowserProfileSchema.parse(browserInput);
      const safety = CaptureSafetyPolicySchema.parse({
        ...record.parse(safetyInput),
        allowedOrigins: environment.allowedOrigins,
      });

      const spec = CaptureScenarioVersionSpecSchema.parse({
        ...runtimeInput,
        browser,
        safety,
      });

      invariant(
        spec.environment.allowedOrigins.includes(new URL(spec.environment.baseUrl).origin),
        'CAPTURE_BASE_ORIGIN_NOT_ALLOWED',
      );

      for (const step of spec.steps) {
        if (step.type === 'NAVIGATE') {
          invariant(step.path.startsWith('/'), 'CAPTURE_NAVIGATION_MUST_BE_RELATIVE');

          const target = new URL(step.path, spec.environment.baseUrl);

          invariant(
            spec.environment.allowedOrigins.includes(target.origin),
            'CAPTURE_ORIGIN_BLOCKED',
          );

          invariant(
            !spec.safety.prohibitedPathPatterns.some(
              (pattern) => target.pathname === pattern || target.pathname.startsWith(`${pattern}/`),
            ),
            'CAPTURE_PROHIBITED_PATH',
          );
        }

        if (step.type === 'VISUAL_SETTLE') {
          invariant(
            step.durationMs <= spec.timeouts.visualSettleMaxMs,
            'CAPTURE_VISUAL_SETTLE_EXCEEDS_POLICY',
          );
        }
      }

      const outputKeys = spec.outputs.map((output) => output.key);
      invariant(new Set(outputKeys).size === outputKeys.length, 'CAPTURE_DUPLICATE_OUTPUT_KEY');

      const screenshotKeys = new Set(
        spec.steps.flatMap((step) => (step.type === 'SCREENSHOT' ? [step.outputKey] : [])),
      );

      for (const output of spec.outputs) {
        if (output.required && output.role === 'SCREENSHOT') {
          invariant(screenshotKeys.has(output.key), 'CAPTURE_REQUIRED_SCREENSHOT_MISSING');
        }

        if (output.required && output.role === 'VIDEO') {
          invariant(spec.browser.recordVideo, 'CAPTURE_REQUIRED_VIDEO_DISABLED');
        }
      }

      scenarios.push({
        artifact,
        browserProfileKey,
        safetyPolicyKey,
        spec,
      });
    }

    invariant(scenarios.length === 5, 'CAPTURE_SEED_COUNT_MISMATCH');

    const keys = scenarios.map((entry) => entry.spec.identity.scenarioKey);
    const ids = scenarios.map((entry) => entry.spec.identity.captureScenarioVersionId);

    invariant(new Set(keys).size === keys.length, 'CAPTURE_DUPLICATE_SCENARIO_KEY');
    invariant(new Set(ids).size === ids.length, 'CAPTURE_DUPLICATE_SCENARIO_VERSION_ID');

    return scenarios;
  }
}
