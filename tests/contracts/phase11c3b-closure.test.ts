import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { DURABLE_RENDER_CANARY_CONFIRMATION } from '../../scripts/phase11c3-durable-render-canary-execute.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

const s3FixtureSource = readFileSync('packages/media/test/s3-fixture.ts', 'utf8');

describe('Phase 11C-3B durable Render execution closure', () => {
  it('freezes the exact reviewed confirmation', () => {
    expect(DURABLE_RENDER_CANARY_CONFIRMATION).toBe('EXECUTE_DISPOSABLE_DURABLE_RENDER_CANARY');
  });

  it('defines a code-only closure gate that never invokes the real durable canary', () => {
    expect(pkg.scripts['canary:render:durable:execute']).toBe(
      'tsx scripts/phase11c3-durable-render-canary-execute.ts',
    );

    expect(pkg.scripts['check:phase11c3b']).toContain('check:phase11c3a');

    expect(pkg.scripts['check:phase11c3b']).toContain('durable-render-canary-execute.test.ts');

    expect(pkg.scripts['check:phase11c3b']).toContain('phase11c3b-closure.test.ts');

    expect(pkg.scripts['check:phase11c3b']).toContain('render-recovery.test.ts');

    expect(pkg.scripts['check:phase11c3b']).toContain('test:storage');

    expect(pkg.scripts['check:phase11c3b']).not.toContain('canary:render:durable:execute');
  });

  it('tracks worker-created objects so the disposable bucket can be destroyed', () => {
    expect(s3FixtureSource).toContain('track(key: string)');
  });

  it('records code closure without claiming the durable canary ran', () => {
    expect(doc).toContain('- 11C-3B explicit disposable durable Render execution command: DONE');

    expect(doc).toContain('reviewed disposable durable Render canary: NOT STARTED');

    expect(doc).toContain(
      'Code closure does not claim that the disposable durable canary has run.',
    );
  });
});
