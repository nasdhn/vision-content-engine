import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const doc = readFileSync('docs/PHASE_11C_RENDERING_ACTIVATION.md', 'utf8');

describe('Phase 11C-3A durable Render canary closure', () => {
  it('defines a dry-run-only durable canary command', () => {
    expect(pkg.scripts['canary:render:durable']).toBe(
      'tsx scripts/phase11c3-durable-render-canary.ts',
    );

    expect(pkg.scripts['check:phase11c3a']).toContain('check:phase11c2c');

    expect(pkg.scripts['check:phase11c3a']).toContain('durable-render-canary-harness.test.ts');

    expect(pkg.scripts['check:phase11c3a']).toContain('phase11c3a-closure.test.ts');

    expect(pkg.scripts['check:phase11c3a']).toContain(
      'phase11c3-durable-render-canary.ts --dry-run',
    );
  });

  it('keeps the durable canary strictly local and disposable', () => {
    expect(doc).toContain('disposable local Postgres database');
    expect(doc).toContain('disposable local S3 bucket');
    expect(doc).toContain('No VPS, production database or application bucket is used.');
  });

  it('records 11C-3A closure without claiming durable execution', () => {
    expect(doc).toContain('- 11C-3A durable Render canary dry-run boundary: DONE');
    expect(doc).toContain('11C-3A itself creates no database, bucket, Render job or media object.');
  });
});
