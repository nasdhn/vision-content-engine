import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/index.js';

import {
  RENDER_CANARY_CONFIRMATION,
  assertRenderCanaryExecutionEnvironment,
  parseRenderCanaryExecuteArgs,
} from '../../scripts/phase11c2-render-canary-execute.js';

import { configFixture } from '../support/config.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

describe('Phase 11C-2B closure contract', () => {
  it('freezes the reviewed execution confirmation', () => {
    expect(RENDER_CANARY_CONFIRMATION).toBe('EXECUTE_SYNTHETIC_RENDER_CANARY');

    expect(parseRenderCanaryExecuteArgs(['--confirm', RENDER_CANARY_CONFIRMATION])).toEqual({
      confirmation: 'EXECUTE_SYNTHETIC_RENDER_CANARY',
    });
  });

  it('requires STAGING_CAPTURE Rendering activation with unrelated work paused', () => {
    expect(() => assertRenderCanaryExecutionEnvironment(parseConfig(configFixture))).toThrow(
      'RENDER_CANARY_EXECUTION_ENVIRONMENT_INVALID',
    );

    expect(() =>
      assertRenderCanaryExecutionEnvironment(
        parseConfig({
          ...configFixture,
          VCE_ENV: 'STAGING_CAPTURE',
          PAUSE_RENDERING: 'false',
        }),
      ),
    ).not.toThrow();
  });

  it('defines the reproducible 11C-2B gate without executing the real canary', () => {
    expect(pkg.scripts['check:phase11c2b']).toContain('tests/render/media-regression.ts');

    expect(pkg.scripts['canary:render:execute']).toBe(
      'tsx scripts/phase11c2-render-canary-execute.ts',
    );

    expect(pkg.scripts['check:phase11c2b']).toContain('check:phase11c2a');

    expect(pkg.scripts['check:phase11c2b']).toContain('render-canary-execute.test.ts');

    expect(pkg.scripts['check:phase11c2b']).toContain('phase11c2b-closure.test.ts');

    expect(pkg.scripts['check:phase11c2b']).not.toContain('canary:render:execute');
  });

  it('records durable code closure without claiming that the reviewed real canary ran', () => {
    expect(doc).toContain('- 11C-2B explicit reviewed execution command: DONE');

    expect(doc).toContain('Code closure does not claim that the reviewed real canary has run.');

    expect(doc).toContain('durable real Render execution: NOT STARTED');
  });
});
