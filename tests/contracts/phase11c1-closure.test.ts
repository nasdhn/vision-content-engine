import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isRenderingActivationEnabled, parseConfig } from '../../packages/shared/src/index.js';
import { configFixture } from '../support/config.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

describe('Phase 11C-1 closure contract', () => {
  it('restricts Rendering to explicitly unpaused STAGING_CAPTURE', () => {
    const local = parseConfig({
      ...configFixture,
      PAUSE_RENDERING: 'false',
    });

    const paused = parseConfig({
      ...configFixture,
      VCE_ENV: 'STAGING_CAPTURE',
    });

    const active = parseConfig({
      ...configFixture,
      VCE_ENV: 'STAGING_CAPTURE',
      PAUSE_RENDERING: 'false',
    });

    const production = parseConfig({
      ...configFixture,
      VCE_ENV: 'PRODUCTION',
      PAUSE_RENDERING: 'false',
    });

    expect(isRenderingActivationEnabled(local)).toBe(false);
    expect(isRenderingActivationEnabled(paused)).toBe(false);
    expect(isRenderingActivationEnabled(active)).toBe(true);
    expect(isRenderingActivationEnabled(production)).toBe(false);
  });

  it('keeps Rendering paused by default', () => {
    expect(parseConfig(configFixture).PAUSE_RENDERING).toBe(true);
  });

  it('defines the reproducible 11C-1 gate', () => {
    expect(pkg.scripts['check:phase11c1']).toContain('check:phase11b2b');
    expect(pkg.scripts['check:phase11c1']).toContain('phase11c1-closure.test.ts');
    expect(pkg.scripts['check:phase11c1']).toContain('tests/render/remotion-smoke.ts');
  });

  it('records durable 11C-1 closure without requiring the document to stay at that phase', () => {
    expect(doc).toContain('- 11C-1 Rendering activation safety boundary: DONE');
    expect(doc).toContain('`PAUSE_RENDERING=true`');
    expect(doc).toContain('`LOCAL` and `PRODUCTION` remain disabled');
  });
});
