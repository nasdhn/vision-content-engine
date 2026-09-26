import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const rootJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
const runtimeConfig = readFileSync('packages/shared/src/config.ts', 'utf8');
const freeze = readFileSync('docs/26_PHASE8_ANALYTICS_IMPLEMENTATION_FREEZE.md', 'utf8');
const report = readFileSync('docs/PHASE_8_REPORT.md', 'utf8');
const activationChecklist = readFileSync('docs/PHASE_11_ANALYTICS_ACTIVATION_CHECKLIST.md', 'utf8');
const analyticsRead = readFileSync('packages/application/src/analytics-read.ts', 'utf8');
const umami = readFileSync('packages/analytics/src/umami.ts', 'utf8');
const visionIngest = readFileSync('packages/application/src/vision-attribution-ingest.ts', 'utf8');

describe('Phase 8 closure contract', () => {
  it('defines the canonical Phase 8 aggregate gate including both runtime transport smokes', () => {
    expect(rootJson.scripts?.['test:analytics:runtime']).toBe(
      'tsx tests/runtime/analytics-bullmq-smoke.ts',
    );
    expect(rootJson.scripts?.['test:distribution:runtime']).toBe(
      'tsx tests/runtime/distribution-bullmq-smoke.ts',
    );
    expect(rootJson.scripts?.['check:phase8']).toBe(
      'pnpm test:infra && pnpm check && pnpm test:postgres && pnpm test:storage && pnpm test:analytics:runtime && pnpm test:distribution:runtime && pnpm build:web && pnpm test:browser',
    );
  });

  it('preserves default-disabled providers while leaving analytics activation to Phase 11', () => {
    expect(runtimeConfig).toContain(
      "VCE_REAL_PROVIDERS_ENABLED: z.enum(['false', 'true']).default('false')",
    );
    expect(runtimeConfig).toContain('isRealProviderActivationEnabled');
    expect(activationChecklist).toContain('VCE_REAL_PROVIDERS_ENABLED=false');
    expect(activationChecklist).toContain('does not authorize live analytics collection');
  });

  it('records Phase 8 closure while keeping live activation and learning in later boundaries', () => {
    expect(freeze).toContain('## 8H — Phase closure');
    expect(report).toContain('Phase 9 does not start automatically');
    expect(report).toContain('docs/PHASE_11_ANALYTICS_ACTIVATION_CHECKLIST.md');
    expect(report).toContain('NULL');
    expect(report).toContain('DIRECT');
    expect(activationChecklist).toContain('VCE_REAL_PROVIDERS_ENABLED=false');
    expect(activationChecklist).toContain('TikTok Analytics remains `MANUAL_ENTRY`');
  });

  it('preserves evidence-source authority and supported Umami/API-only plus signed-ingest boundaries', () => {
    expect(analyticsRead).toContain("sourceSystem: 'UMAMI'");
    expect(analyticsRead).toContain("sourceSystem: 'VISION_APP'");
    expect(umami).toContain('UMAMI_EVENTS_V1');
    expect(visionIngest).toContain('timingSafeEqual');
    expect(activationChecklist).toContain('there is no direct Umami database coupling');
  });

  it('keeps Phase 9 analysis outputs outside the Phase 8 report contract', () => {
    expect(report).toContain('EvidencePolicy scoring');
    expect(report).toContain('Insight generation');
    expect(report).toContain('Recommendation generation');
    expect(report).toContain('experiment winner declaration');
  });
});
