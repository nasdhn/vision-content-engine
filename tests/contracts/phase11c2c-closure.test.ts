import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const phaseDoc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

const evidence = readFileSync('docs/PHASE_11C_RENDER_CANARY_EVIDENCE.md', 'utf8');

describe('Phase 11C-2C reviewed Render canary evidence', () => {
  it('records successful reviewed synthetic execution without claiming durable worker activation', () => {
    expect(phaseDoc).toContain('- 11C-2C reviewed local synthetic Rendering canary: DONE');
    expect(phaseDoc).toContain('Human Review activation: NOT STARTED');
  });

  it('freezes the exact retained master identity', () => {
    expect(evidence).toContain('51f824a81640173890743911932f9811e72077415413fcd600078f8311aad382');
    expect(evidence).toContain('`1079697` bytes');
    expect(evidence).toContain('Technical QA: `PASS`');
    expect(evidence).toContain('Review outcome: `PASS_FOR_SYNTHETIC_FIXTURE`');
  });

  it('does not misrepresent the synthetic fixture as creative approval', () => {
    expect(evidence).toContain(
      'This does not approve the creative quality of a real production video.',
    );
    expect(evidence).toContain('440 Hz sine wave');
  });

  it('defines a reproducible evidence closure gate', () => {
    expect(pkg.scripts['check:phase11c2c']).toContain('check:phase11c2b');
    expect(pkg.scripts['check:phase11c2c']).toContain('phase11c2c-closure.test.ts');
  });
});
