import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';

import {
  DURABLE_RENDER_CANARY_CONFIRMATION,
  assertDurableRenderCanaryConfirmation,
  assertDurableRenderExecutionEnvironment,
  parseDurableRenderExecuteArgs,
} from '../../scripts/phase11c3-durable-render-canary-execute.js';

import { configFixture } from '../support/config.js';

describe('Phase 11C-3B durable Render execution command', () => {
  it('requires exact confirmation and absolute evidence directory', () => {
    expect(DURABLE_RENDER_CANARY_CONFIRMATION).toBe('EXECUTE_DISPOSABLE_DURABLE_RENDER_CANARY');

    expect(
      parseDurableRenderExecuteArgs([
        '--confirm',
        DURABLE_RENDER_CANARY_CONFIRMATION,
        '--output-dir',
        '/tmp/vce-durable-render',
      ]),
    ).toEqual({
      confirmation: DURABLE_RENDER_CANARY_CONFIRMATION,
      outputDirectory: '/tmp/vce-durable-render',
    });

    expect(() => assertDurableRenderCanaryConfirmation('wrong')).toThrow(
      'DURABLE_RENDER_CANARY_CONFIRMATION_INVALID',
    );

    expect(() =>
      parseDurableRenderExecuteArgs([
        '--confirm',
        DURABLE_RENDER_CANARY_CONFIRMATION,
        '--output-dir',
        'relative/path',
      ]),
    ).toThrow('DURABLE_RENDER_CANARY_OUTPUT_PATH_NOT_ABSOLUTE');
  });

  it('requires LOCAL bootstrap and every unrelated work class paused', () => {
    expect(() => assertDurableRenderExecutionEnvironment(parseConfig(configFixture))).not.toThrow();

    expect(() =>
      assertDurableRenderExecutionEnvironment(
        parseConfig({
          ...configFixture,
          PAUSE_RENDERING: 'false',
        }),
      ),
    ).toThrow('DURABLE_RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');

    expect(() =>
      assertDurableRenderExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'STAGING_CAPTURE',
        }),
      ),
    ).toThrow();

    expect(() =>
      assertDurableRenderExecutionEnvironment(
        parseConfig({
          ...configFixture,
          PAUSE_ALL_PUBLISHING: 'false',
        }),
      ),
    ).toThrow('DURABLE_RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID');
  });
});
