import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { RENDER_REJECTION_REASON_CODES } from '../../packages/application/src/render-review.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11D_HUMAN_REVIEW_ACTIVATION.md', 'utf8');

describe('Phase 11D-1 Human Review activation boundary', () => {
  it('freezes Human Review as the fourth progressive activation step', () => {
    expect(doc).toContain('**Status:** 11D-1 COMPLETE');

    expect(doc).toContain('- 11D-1 Human Review safety boundary: DONE');

    expect(doc).toContain('- reviewed durable Human Review canary: NOT STARTED');

    expect(doc).toContain('- TikTok manual handoff activation: NOT STARTED');
  });

  it('freezes exact human-review safety invariants', () => {
    expect(doc.replace(/\s+/g, ' ')).toContain(
      'A Render can be acted on by Human Review only when it is `READY_FOR_REVIEW`.',
    );

    expect(doc).toContain(
      'The client cannot select or substitute the Asset that becomes approved.',
    );

    expect(doc).toContain('Neither approval nor rejection creates a Publication.');

    expect(doc).toContain('Human Review therefore remains a hard gate before Distribution.');
  });

  it('keeps structured rejection reasons frozen', () => {
    expect(RENDER_REJECTION_REASON_CODES).toEqual([
      'PACING_TOO_SLOW',
      'PACING_TOO_FAST',
      'CUTS_TOO_MECHANICAL',
      'CAPTIONS_TOO_BUSY',
      'PRODUCT_NOT_VISIBLE_ENOUGH',
      'HOOK_VISUALLY_WEAK',
      'SOUND_TOO_BUSY',
      'CTA_TOO_LONG',
      'GREEN_SCREEN_BAD_PLACEMENT',
      'SCRIPT_VISUAL_MISMATCH',
      'OTHER',
    ]);
  });

  it('defines a cumulative Human Review gate without running a durable canary', () => {
    const gate = pkg.scripts['check:phase11d1'];

    expect(gate).toContain('check:phase11c3c');
    expect(gate).toContain('phase11b2c-closure.test.ts');
    expect(gate).toContain('phase11d1-closure.test.ts');
    expect(gate).toContain('render-review-api.test.ts');
    expect(gate).toContain('render-review.test.ts');
    expect(gate).toContain('render-review.spec.ts');
    expect(gate).toContain('build:web');

    expect(gate).not.toContain('canary:render');
    expect(gate).not.toContain('canary:capture:execute');
    expect(gate).not.toContain('publish');
  });
});
