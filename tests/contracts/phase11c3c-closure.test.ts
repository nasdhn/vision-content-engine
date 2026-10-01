import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

const evidence = readFileSync('docs/PHASE_11C_DURABLE_RENDER_CANARY_EVIDENCE.md', 'utf8');

describe('Phase 11C-3C durable Render canary evidence', () => {
  it('records successful durable Render execution', () => {
    expect(doc).toContain('- 11C-3C reviewed disposable durable Render canary: DONE');
    expect(doc).toContain('Next canonical phase: Human Review.');
  });

  it('freezes exact durable state and master identity', () => {
    expect(evidence).toContain('Render status: `CREATIVE_QA`');
    expect(evidence).toContain('RenderAttempt status: `SUCCEEDED`');
    expect(evidence).toContain('JobAttempt status: `SUCCEEDED`');
    expect(evidence).toContain('Output Asset status: `READY`');
    expect(evidence).toContain('Technical QA: `PASS`');
    expect(evidence).toContain('51f824a81640173890743911932f9811e72077415413fcd600078f8311aad382');
  });

  it('freezes cleanup and zero-external-side-effect evidence', () => {
    expect(evidence).toContain('Disposable database destroyed: `true`');
    expect(evidence).toContain('Disposable bucket destroyed: `true`');
    expect(evidence).toContain('Worker temporary directory destroyed: `true`');
    expect(evidence).toContain('Remote side effect: `false`');
    expect(evidence).toContain('External provider cost: `USD 0`');
  });

  it('does not misrepresent synthetic determinism as creative approval', () => {
    expect(evidence).toContain(
      'It does not constitute creative-quality approval for production content.',
    );
    expect(evidence).toContain('synthetic 440 Hz audio tone');
  });

  it('defines cumulative 11C-3C closure without executing the real canary', () => {
    expect(pkg.scripts['check:phase11c3c']).toContain('check:phase11c3b');
    expect(pkg.scripts['check:phase11c3c']).toContain('phase11c3c-closure.test.ts');
    expect(pkg.scripts['check:phase11c3c']).not.toContain('canary:render:durable:execute');
  });
});
