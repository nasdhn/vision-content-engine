import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  MountedCaptureAuthStateProvider,
  VISION_CAPTURE_AUTH_PROFILE_KEY,
} from '../../apps/worker-capture/src/index.js';
import { isCaptureActivationEnabled, parseConfig } from '../../packages/shared/src/index.js';
import { configFixture } from '../support/config.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};
const doc = readFileSync('docs/PHASE_11B_CAPTURE_ACTIVATION.md', 'utf8');

describe('Phase 11B-1 closure contract', () => {
  it('restricts authenticated Capture to explicitly unpaused STAGING_CAPTURE', () => {
    const local = parseConfig({ ...configFixture, PAUSE_CAPTURE: 'false' });
    const paused = parseConfig({ ...configFixture, VCE_ENV: 'STAGING_CAPTURE' });
    const active = parseConfig({
      ...configFixture,
      VCE_ENV: 'STAGING_CAPTURE',
      PAUSE_CAPTURE: 'false',
    });
    const production = parseConfig({
      ...configFixture,
      VCE_ENV: 'PRODUCTION',
      PAUSE_CAPTURE: 'false',
    });
    expect(isCaptureActivationEnabled(local)).toBe(false);
    expect(isCaptureActivationEnabled(paused)).toBe(false);
    expect(isCaptureActivationEnabled(active)).toBe(true);
    expect(isCaptureActivationEnabled(production)).toBe(false);
  });

  it('freezes the reviewed V1 profile', () => {
    expect(VISION_CAPTURE_AUTH_PROFILE_KEY).toBe('VISION_CAPTURE_ACCOUNT_V1');
    expect(MountedCaptureAuthStateProvider).toBeTypeOf('function');
  });

  it('defines the reproducible gate', () => {
    expect(pkg.scripts['check:phase11b1']).toContain('check:phase11a4b');
    expect(pkg.scripts['check:phase11b1']).toContain('capture-auth-state.test.ts');
    expect(pkg.scripts['check:phase11b1']).toContain('product-capture-safety.spec.ts');
  });

  it('records durable 11B-1 completion without requiring the document to stay at that phase', () => {
    expect(doc).toContain('11B-1 Capture authentication safety boundary: DONE');
    expect(doc).toContain('`PAUSE_CAPTURE=true`');
  });
});
