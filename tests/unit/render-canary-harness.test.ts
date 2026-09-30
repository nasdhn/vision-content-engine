import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';
import {
  assertRenderCanaryPersistentDefaults,
  prepareRenderCanaryDryRun,
  renderCanaryMode,
} from '../../scripts/phase11c2-render-canary.js';
import { configFixture } from '../support/config.js';

describe('Phase 11C-2A Rendering canary harness', () => {
  it('supports dry-run only and explicitly rejects execution', () => {
    expect(renderCanaryMode([])).toBe('DRY_RUN');
    expect(renderCanaryMode(['--dry-run'])).toBe('DRY_RUN');

    expect(() => renderCanaryMode(['--execute'])).toThrow('CANARY_EXECUTION_NOT_IMPLEMENTED_11C2A');

    expect(() => renderCanaryMode(['--unknown'])).toThrow('RENDER_CANARY_USAGE_INVALID');
  });

  it('requires persistent LOCAL paused safety defaults', () => {
    expect(() => assertRenderCanaryPersistentDefaults(parseConfig(configFixture))).not.toThrow();

    expect(() =>
      assertRenderCanaryPersistentDefaults(
        parseConfig({
          ...configFixture,
          PAUSE_RENDERING: 'false',
        }),
      ),
    ).toThrow('RENDER_CANARY_PERSISTENT_DEFAULTS_UNSAFE');

    expect(() =>
      assertRenderCanaryPersistentDefaults(
        parseConfig({
          ...configFixture,
          PAUSE_ALL_PUBLISHING: 'false',
        }),
      ),
    ).toThrow('RENDER_CANARY_PERSISTENT_DEFAULTS_UNSAFE');

    expect(() =>
      assertRenderCanaryPersistentDefaults(
        parseConfig({
          ...configFixture,
          VCE_REAL_PROVIDERS_ENABLED: 'true',
        }),
      ),
    ).toThrow('RENDER_CANARY_PERSISTENT_DEFAULTS_UNSAFE');
  });

  it('freezes the representative Phase 5 media regression fixture without side effects', () => {
    const plan = prepareRenderCanaryDryRun(parseConfig(configFixture));

    expect(plan).toMatchObject({
      mode: 'DRY_RUN',
      fixtureVersion: 'phase5-media-v1',
      compositionKey: 'green-screen-explainer-v1',
      durationMs: 1200,
      width: 1080,
      height: 1920,
      fps: 30,
      chromaProfileKey: 'GREENSCREEN_STANDARD_V1',
      colorProfileKey: 'SDR_BT709_SOCIAL_V1',
      codecProfileKey: 'SOCIAL_H264_AAC_V1',
      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
      expectedVideoCodec: 'h264',
      expectedPixelFormat: 'yuv420p',
      expectedDynamicRange: 'SDR',
      expectedColorPrimaries: 'bt709',
      expectedAudioSampleRate: 48000,
      expectedAudioChannels: 2,
      ephemeralActivationValid: true,
      rendererInvoked: false,
      databaseAccessed: false,
      objectStorageAccessed: false,
      aiProviderCalled: false,
      networkCalled: false,
      publicationSideEffect: false,
      externalSideEffect: false,
    });

    expect(plan.syntheticInputKinds).toEqual([
      'PRODUCT_VIDEO',
      'PRESENTER_GREEN_SCREEN',
      'VOICE_AUDIO',
    ]);

    expect(plan.diagnosticFixtureKinds).toEqual(['BLACK_SILENCE']);
  });
});
