import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';

import {
  assertDurableRenderCanaryLocalDefaults,
  durableRenderCanaryMode,
  prepareDurableRenderCanaryDryRun,
} from '../../scripts/phase11c3-durable-render-canary.js';

import { configFixture } from '../support/config.js';

describe('Phase 11C-3A durable Render canary harness', () => {
  it('supports dry-run only and explicitly rejects execution', () => {
    expect(durableRenderCanaryMode([])).toBe('DRY_RUN');

    expect(durableRenderCanaryMode(['--dry-run'])).toBe('DRY_RUN');

    expect(() => durableRenderCanaryMode(['--execute'])).toThrow(
      'DURABLE_RENDER_CANARY_EXECUTION_NOT_IMPLEMENTED_11C3A',
    );
  });

  it('requires fail-closed LOCAL defaults', () => {
    expect(() => assertDurableRenderCanaryLocalDefaults(parseConfig(configFixture))).not.toThrow();

    expect(() =>
      assertDurableRenderCanaryLocalDefaults(
        parseConfig({
          ...configFixture,
          PAUSE_RENDERING: 'false',
        }),
      ),
    ).toThrow('DURABLE_RENDER_CANARY_LOCAL_DEFAULTS_UNSAFE');

    expect(() =>
      assertDurableRenderCanaryLocalDefaults(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'STAGING_CAPTURE',
        }),
      ),
    ).toThrow();
  });

  it('freezes disposable local durable topology with zero side effects', () => {
    const plan = prepareDurableRenderCanaryDryRun(parseConfig(configFixture));

    expect(plan).toMatchObject({
      mode: 'DRY_RUN',
      fixtureVersion: 'phase11c3-disposable-durable-render-v1',
      databaseScope: 'DISPOSABLE_LOCAL_POSTGRES',
      objectStorageScope: 'DISPOSABLE_LOCAL_S3_BUCKET',
      renderWorkerPath: 'RenderWorkerOrchestrator.execute',
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
    });

    expect(plan.expectedDurableStages).toEqual([
      'RENDER_JOB',
      'RENDER_ATTEMPT',
      'INPUT_ASSET_MATERIALIZATION',
      'REMOTION_RENDER',
      'TECHNICAL_QA',
      'PRIVATE_OBJECT_UPLOAD',
      'OUTPUT_ASSET_READY',
      'JOB_SUCCEEDED',
    ]);
  });
});
