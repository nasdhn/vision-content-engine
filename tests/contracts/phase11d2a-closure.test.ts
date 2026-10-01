import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { HUMAN_REVIEW_CANARY_CONFIRMATION } from '../../scripts/phase11d2-human-review-canary-execute.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11D_HUMAN_REVIEW_ACTIVATION.md', 'utf8');

describe('Phase 11D durable Human Review closure', () => {
  it('keeps explicit reviewed execution separate from normal gates', () => {
    expect(HUMAN_REVIEW_CANARY_CONFIRMATION).toBe('APPROVE_DISPOSABLE_HUMAN_REVIEW_CANARY');

    expect(pkg.scripts['canary:review:execute']).toBe(
      'tsx scripts/phase11d2-human-review-canary-execute.ts',
    );

    expect(pkg.scripts['check:phase11d2a']).not.toContain('canary:review:execute');
  });

  it('records the successful durable Human Review path', () => {
    const normalized = doc.replace(/\s+/g, ' ');

    expect(normalized).toContain(
      '**Status:** COMPLETE — durable Human Review path validated; publishing remains disabled.',
    );

    expect(doc).toContain('- reviewed durable Human Review canary: DONE');

    expect(doc).toContain('- Human Review activation: DONE');

    expect(doc).toContain('Phase 11D Human Review is complete.');
  });

  it('freezes the observed safety evidence', () => {
    expect(doc).toContain('Publication count remained exactly `0`');

    expect(doc).toContain('real Creative QA provider was not invoked;');

    expect(doc).toContain('external provider cost was `USD 0`;');

    expect(doc).toContain('remote side effect was `false`.');

    expect(doc).toContain('fb09272d15d9c1961c7d5fe9a5857c38c834ce40822959efc2217ddc55a8630c');
  });
});
