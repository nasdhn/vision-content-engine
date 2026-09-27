import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { parseConfig } from '../../packages/shared/src/config.js';
import { configFixture } from '../support/config.js';

const root = JSON.parse(readFileSync('package.json', 'utf8')) as {
  scripts: Record<string, string>;
};

const activation = readFileSync('docs/PHASE_11A_GENERATION_ACTIVATION.md', 'utf8');
const report = readFileSync('docs/PHASE_11A_4B_REPORT.md', 'utf8');
const contract = readFileSync('packages/contracts/src/concept-generation.ts', 'utf8');
const repository = readFileSync('packages/database/src/concept-generation.ts', 'utf8');
const worker = readFileSync('apps/worker-ai/src/concept-generation-worker.ts', 'utf8');
const runtime = readFileSync('apps/worker-ai/src/concept-generation-runtime.ts', 'utf8');

describe('Phase 11A-4B closure contract', () => {
  it('defines the reproducible aggregate gate on top of 11A-4A', () => {
    expect(root.scripts['check:phase11a4b']).toBe(
      'pnpm check:phase11a4a && ' +
        'pnpm exec vitest run ' +
        'tests/unit/concept-generation-worker-runtime.test.ts ' +
        'tests/contracts/phase11a4b-closure.test.ts && ' +
        'pnpm exec vitest run --config vitest.postgres.config.ts ' +
        'tests/postgres/concept-generation.test.ts ' +
        'tests/postgres/concept-generation-worker.test.ts ' +
        'tests/postgres/persistence.test.ts',
    );
  });

  it('freezes the canonical durable generation identity', () => {
    expect(contract).toContain("CONCEPT_GENERATION_QUEUE_NAME = 'ai'");
    expect(contract).toContain("CONCEPT_GENERATION_JOB_TYPE = 'AI'");
    expect(contract).toContain("kind: z.literal('CONCEPT_GENERATION')");
    expect(contract).toContain('ConceptGeneration.requestBound');

    expect(repository).toContain('new Versions(tx, systemActor).briefVersion');
    expect(repository).toContain("workflowType: 'CONCEPT_GENERATION'");
    expect(repository).toContain('jobType: CONCEPT_GENERATION_JOB_TYPE');
  });

  it('keeps generation checkpoint-first before another provider execution', () => {
    const checkpointIndex = worker.indexOf('outputCheckpointForRequest');
    const invocationIndex = worker.indexOf('modelInvocation.findUnique');
    const createIndex = worker.indexOf('createConcepts');

    expect(checkpointIndex).toBeGreaterThan(-1);
    expect(invocationIndex).toBeGreaterThan(checkpointIndex);
    expect(createIndex).toBeGreaterThan(invocationIndex);

    expect(worker).toContain('applyCreatorCheckpoint');
    expect(worker).toContain("claimJob('ai'");
  });

  it('uses the canonical worker-ai polled lifecycle', () => {
    expect(runtime).toContain('startPolledWorkerRuntime');
    expect(runtime).toContain("'worker-ai'");
    expect(runtime).toContain('orchestrator.processOne.bind(orchestrator)');
  });

  it('keeps normal real-provider execution fail-closed', () => {
    const config = parseConfig(configFixture);

    expect(config.VCE_ENV).toBe('LOCAL');
    expect(config.VCE_REAL_PROVIDERS_ENABLED).toBe('false');
    expect(config.PAUSE_AI_GENERATION).toBe(true);
  });

  it('records 11A-4B complete without starting Capture', () => {
    expect(activation).toContain('11A-4B durable asynchronous Creator path: **DONE**');
    expect(activation).toContain('Capture activation: **NOT STARTED**');

    expect(report).toContain('**Status:** COMPLETE');
    expect(report).toContain('Phase 11 Capture activation is **NOT STARTED**');
    expect(report).toContain('no Prisma schema change');
    expect(report).toContain('no new package dependency');
  });
});
