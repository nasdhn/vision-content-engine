import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const phaseDoc = readFileSync('docs/PHASE_11B_CAPTURE_ACTIVATION.md', 'utf8');

const evidence = readFileSync('docs/PHASE_11B_CAPTURE_CANARY_EVIDENCE.md', 'utf8');

describe('Phase 11B-2C reviewed Capture canary evidence', () => {
  it('records the reviewed remote Capture canary as complete', () => {
    expect(phaseDoc).toContain('**Status:** 11B-2C COMPLETE');

    expect(phaseDoc).toContain('- 11B-2C reviewed authenticated Capture canary: DONE');

    expect(phaseDoc).toContain('Phase 11B Capture activation evidence is complete.');
  });

  it('freezes exact screenshot identity and successful execution', () => {
    expect(evidence).toContain('Execution: `SUCCEEDED`');
    expect(evidence).toContain('Executed steps: `4`');
    expect(evidence).toContain('Required locator `pricing-primary-card`: visible');
    expect(evidence).toContain('Size: `106133` bytes');
    expect(evidence).toContain('18738b4e43dd5215a9e24249d571fb0c6d9600765ccd9b7b92c8fd3a8effa778');
  });

  it('freezes the security boundary and known limitation', () => {
    expect(evidence).toContain('Storage-state credential committed to Git: `false`');
    expect(evidence).toContain('Customer data used: `false`');
    expect(evidence).toContain('External provider cost: `USD 0`');
    expect(evidence).toContain('The selected `/tarifs` target is a public route.');
    expect(evidence.replace(/\s+/g, ' ')).toContain(
      'It does not independently prove access to protected-session-only product content.',
    );
  });

  it('defines a closure gate that never executes the remote canary', () => {
    expect(pkg.scripts['check:phase11b2c']).toContain('check:phase11b2b');
    expect(pkg.scripts['check:phase11b2c']).toContain('phase11b2c-closure.test.ts');
    expect(pkg.scripts['check:phase11b2c']).not.toContain('canary:capture:execute');
  });
});
