import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
const runtimeConfig = readFileSync('packages/shared/src/config.ts', 'utf8');
const freeze = readFileSync('docs/25_PHASE7_DISTRIBUTION_IMPLEMENTATION_FREEZE.md', 'utf8');
const report = readFileSync('docs/PHASE_7_REPORT.md', 'utf8');
const activationChecklist = readFileSync(
  'docs/PHASE_11_DISTRIBUTION_ACTIVATION_CHECKLIST.md',
  'utf8',
);

describe('Phase 7 closure contract', () => {
  it('defines the canonical Phase 7 aggregate gate including infra and BullMQ transport smoke', () => {
    expect(rootJson.scripts?.['test:distribution:runtime']).toBe(
      'tsx tests/runtime/distribution-bullmq-smoke.ts',
    );
    expect(rootJson.scripts?.['check:phase7']).toBe(
      'pnpm test:infra && pnpm check && pnpm test:postgres && pnpm test:storage && pnpm test:distribution:runtime && pnpm build:web && pnpm test:browser',
    );
  });

  it('keeps real providers impossible to activate from the Phase 7 runtime configuration', () => {
    expect(runtimeConfig).toContain(
      "VCE_REAL_PROVIDERS_ENABLED: z.literal('false').default('false')",
    );
    expect(runtimeConfig).toContain('PAUSE_ALL_PUBLISHING: boolean.default(true)');
  });

  it('records closure and keeps live activation plus Analytics in later phases', () => {
    expect(freeze).toContain('## 7F — Phase closure');
    expect(report).toContain('Phase 8 does not start automatically');
    expect(report).toContain('Phase 11');
    expect(activationChecklist).toContain('VCE_REAL_PROVIDERS_ENABLED');
    expect(activationChecklist).toContain('TikTok remains MANUAL_HANDOFF');
  });
});
