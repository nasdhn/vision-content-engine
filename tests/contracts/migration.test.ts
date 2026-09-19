import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { transitions } from '../../packages/domain/src/index.js';

it('keeps the initial migration additive and faithful to the reviewed canonical preview', async () => {
  const migration = await readFile(
    'prisma/migrations/20260919000000_initial_canonical/migration.sql',
    'utf8',
  );
  const preview = await readFile('infra/migration-preview/initial.generated.sql', 'utf8');
  const leases = await readFile(
    'docs/spec-artifacts/final-reconciliation/durable-lease-constraints.sql',
    'utf8',
  );
  expect(migration.startsWith(`BEGIN;\n\n${preview}`)).toBe(true);
  expect(migration.endsWith(`${leases}\nCOMMIT;\n`)).toBe(true);
  expect(migration.match(/^CREATE TABLE /gm)).toHaveLength(50);
  expect(migration.match(/^CREATE TYPE /gm)).toHaveLength(49);
  expect(migration.match(/FOREIGN KEY/g)).toHaveLength(72);
  expect(migration.match(/^CREATE (?:UNIQUE )?INDEX /gm)).toHaveLength(107);
  expect(migration.match(/\bCHECK\s*\(/g)).toHaveLength(6);
  expect(migration.match(/TIMESTAMPTZ\(3\)/g)).toHaveLength(103);
  expect(migration).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE)\b/m);
  expect(migration).not.toMatch(/ON DELETE CASCADE|\bTIMESTAMP\(/);
});
it('represents every frozen state in the Phase 1 state machines', async () => {
  const schema = await readFile('docs/spec-artifacts/schema.prisma', 'utf8');
  for (const [machine, enumName] of Object.entries({
    workflow: 'WorkflowStatus',
    job: 'JobAttemptStatus',
    outbox: 'OutboxStatus',
    concept: 'ConceptStatus',
    render: 'RenderStatus',
  }) as [keyof typeof transitions, string][]) {
    const states = schema
      .match(new RegExp(`enum ${enumName} \\{([^}]+)\\}`))![1]!
      .trim()
      .split(/\s+/);
    expect(Object.keys(transitions[machine]).sort()).toEqual(states.sort());
    for (const targets of Object.values(transitions[machine]))
      for (const target of targets) expect(states).toContain(target);
  }
});
