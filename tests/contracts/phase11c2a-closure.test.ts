import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { isRenderingActivationEnabled, parseConfig } from '../../packages/shared/src/index.js';
import { configFixture } from '../support/config.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

describe('Phase 11C-2A closure contract', () => {
  it('keeps production Rendering disabled', () => {
    const production = parseConfig({
      ...configFixture,
      VCE_ENV: 'PRODUCTION',
      PAUSE_RENDERING: 'false',
    });

    expect(isRenderingActivationEnabled(production)).toBe(false);
  });

  it('freezes a dry-run-only canary command', () => {
    expect(pkg.scripts['canary:render']).toBe('tsx scripts/phase11c2-render-canary.ts');

    expect(pkg.scripts['check:phase11c2a']).toContain('check:phase11c1');
    expect(pkg.scripts['check:phase11c2a']).toContain('render-canary-harness.test.ts');
    expect(pkg.scripts['check:phase11c2a']).toContain('phase11c2a-closure.test.ts');
    expect(pkg.scripts['check:phase11c2a']).toContain('phase11c2-render-canary.ts --dry-run');
  });

  it('records 11C-2A without claiming real Render execution', () => {
    expect(doc).toContain('11C-2A COMPLETE — deterministic dry-run Rendering canary harness');
    expect(doc).toContain('reviewed real Rendering canary: NOT STARTED');
    expect(doc).toContain('durable real Render execution: NOT STARTED');
  });

  it('records zero external side effects for the dry-run', () => {
    expect(doc).toContain('No Remotion render is invoked by the 11C-2A harness');
    expect(doc).toContain('No database or object-storage operation is performed');
    expect(doc).toContain('No AI provider or publishing adapter is invoked');
  });
});
