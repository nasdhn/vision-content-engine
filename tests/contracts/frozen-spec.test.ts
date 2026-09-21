import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { z } from 'zod';

const manifestSchema = z.object({
  specVersion: z.string(),
  fileCount: z.number(),
  files: z.array(z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number() })),
});

const historicalManifests = [
  {
    version: 'spec-v1.0',
    count: 146,
    hash: 'dede443b3889ddbb614b24f0bd2abfd85603e6f39b50bc14eb951455ef3229cd',
  },
  {
    version: 'spec-v1.0.1',
    count: 149,
    hash: '82871f4b71028843455715094b52713e9f010773fe61d110bef4d41fb11c1d1f',
  },
  {
    version: 'spec-v1.0.2',
    count: 153,
    hash: 'c6962f0bd4eddc7351bfc891cc76256c1fd2e209c536b845ebb14a74aea401cc',
  },
] as const;
const manifestPath = (version: string) => `docs/spec-artifacts/${version}-manifest.json`;
const leaseDefinitions = {
  JobAttempt: {
    fields: {
      leaseToken: 'String? @db.Uuid',
      leaseAcquiredAt: 'DateTime? @db.Timestamptz(3)',
      heartbeatAt: 'DateTime? @db.Timestamptz(3)',
      leaseExpiresAt: 'DateTime? @db.Timestamptz(3)',
    },
    index: '@@index([status, leaseExpiresAt])',
  },
  OutboxEvent: {
    fields: {
      claimOwner: 'String?',
      claimToken: 'String? @db.Uuid',
      claimedAt: 'DateTime? @db.Timestamptz(3)',
      claimHeartbeatAt: 'DateTime? @db.Timestamptz(3)',
      claimExpiresAt: 'DateTime? @db.Timestamptz(3)',
    },
    index: '@@index([status, availableAt, claimExpiresAt])',
  },
} as const;

/** Reverse only the nine declared fields and two indexes to recover historical schema bytes. */
function withoutDurableLeases(schema: string): string {
  for (const [model, definition] of Object.entries(leaseDefinitions)) {
    schema = schema.replace(new RegExp(`model ${model} \\{[^}]*\\}`), (block) =>
      block
        .split('\n')
        .filter(
          (line) =>
            !Object.hasOwn(definition.fields, line.trim().split(/\s+/)[0] ?? '') &&
            line.trim() !== definition.index,
        )
        .join('\n'),
    );
  }
  return schema;
}
function withoutPhase5EditingPlanSpec(schema: string): string {
  return schema
    .split('\n')
    .filter((line) => !/^\s*planSpecJson\s+Json\?\s*$/.test(line))
    .join('\n');
}

const appendedDocuments = new Set([
  'docs/04_WORKFLOWS.md',
  'docs/10_DASHBOARD_UX.md',
  'docs/DECISIONS.md',
  'docs/SPEC_STATUS.md',
  'docs/19_SPEC_V1_FINAL_VALIDATION.md',
]);
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

it.each(historicalManifests)(
  'preserves $version manifest and every historical artifact',
  async ({ version, count, hash }) => {
    const bytes = await readFile(manifestPath(version));
    expect(sha256(bytes)).toBe(hash);
    const manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
    expect(manifest.specVersion).toBe(version);
    expect(manifest.fileCount).toBe(count);
    expect(manifest.files).toHaveLength(count);
    for (const entry of manifest.files) {
      let original = await readFile(entry.path);
      if (entry.path === 'docs/spec-artifacts/schema.prisma') {
        let schema = withoutPhase5EditingPlanSpec(original.toString());
        if (version !== 'spec-v1.0.2') schema = withoutDurableLeases(schema);
        if (version === 'spec-v1.0') schema = schema.replaceAll(' @db.Timestamptz(3)', '');
        original = Buffer.from(schema);
      } else if (appendedDocuments.has(entry.path)) {
        // Original bytes remain intact; only dated amendment appendices may follow them.
        original = original.subarray(0, entry.sizeBytes);
      }
      expect(sha256(original), entry.path).toBe(entry.sha256);
      expect(original.length, entry.path).toBe(entry.sizeBytes);
    }
  },
);

it('validates the current spec-v1.0.3 manifest and parses its JSON/TypeScript', async () => {
  const historical = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath('spec-v1.0.2'), 'utf8')),
  );
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(manifestPath('spec-v1.0.3'), 'utf8')),
  );
  expect(manifest.specVersion).toBe('spec-v1.0.3');
  expect(manifest.fileCount).toBe(156);
  expect(manifest.files).toHaveLength(156);
  expect(manifest.files.map((entry) => entry.path)).toEqual(
    [
      ...historical.files.map((entry) => entry.path),
      manifestPath('spec-v1.0.2'),
      'docs/22_PHASE5_EDITING_PLAN_PERSISTENCE_AMENDMENT.md',
      'docs/adr/ADR-0026-editing-plan-lossless-snapshot.md',
    ].sort(),
  );
  for (const entry of manifest.files) {
    const content = await readFile(entry.path);
    expect(sha256(content), entry.path).toBe(entry.sha256);
    expect(content.length, entry.path).toBe(entry.sizeBytes);
    if (entry.path.endsWith('.json'))
      expect(() => JSON.parse(content.toString()), entry.path).not.toThrow();
    if (entry.path.endsWith('.ts')) {
      const result = ts.transpileModule(content.toString(), {
        fileName: entry.path,
        reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
      });
      expect(
        result.diagnostics?.filter(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
        ),
        entry.path,
      ).toEqual([]);
    }
  }
});

it('copies the canonical Prisma model without semantic changes', async () => {
  const canonical = await readFile('docs/spec-artifacts/schema.prisma', 'utf8');
  const runtime = await readFile('prisma/schema.prisma', 'utf8');
  // Prisma 7.10's formatter moves @unique before @default on four fields.
  // Permit only that observed ordering change and whitespace; preserve every token otherwise.
  const normalize = (schema: string) =>
    schema
      .replace(/@default\(uuid\(7\)\)\s+@unique/g, '@unique @default(uuid(7))')
      .replace(/\s/g, '');
  expect(normalize(runtime) === normalize(canonical)).toBe(true);
  expect([...runtime.matchAll(/^model /gm)]).toHaveLength(50);
  expect([...runtime.matchAll(/^enum /gm)]).toHaveLength(49);
  for (const schema of [canonical, runtime]) {
    const fields = [...schema.matchAll(/^\s+\w+\s+(DateTime\??)\s*([^\n]*)$/gm)];
    expect(fields).toHaveLength(103);
    expect(fields.filter((field) => field[1] === 'DateTime?')).toHaveLength(30);
    for (const field of fields) {
      expect(field[2]?.match(/@db\.Timestamptz\(3\)/g), field[0]).toHaveLength(1);
    }
  }
});

it('declares the exact nullable lease/claim fields, native types and recovery indexes', async () => {
  for (const path of ['docs/spec-artifacts/schema.prisma', 'prisma/schema.prisma']) {
    const schema = await readFile(path, 'utf8');
    for (const [model, definition] of Object.entries(leaseDefinitions)) {
      const block = schema.match(new RegExp(`model ${model} \\{[^}]*\\}`))?.[0];
      expect(block, model).toBeDefined();
      for (const [field, type] of Object.entries(definition.fields)) {
        const matches = [...(block ?? '').matchAll(new RegExp(`^\\s+${field}\\s+([^\n]+)$`, 'gm'))];
        expect(matches, `${path}:${model}.${field}`).toHaveLength(1);
        expect(matches[0]?.[1]?.replace(/\s/g, '')).toBe(type.replace(/\s/g, ''));
      }
      expect(block).toContain(definition.index);
    }
  }
  const sql = await readFile('infra/migration-preview/initial.generated.sql', 'utf8');
  expect(sql.match(/TIMESTAMPTZ\(3\)/g)).toHaveLength(103);
  expect(sql).not.toMatch(/\bTIMESTAMP\s*\(/);
  for (const [model, definition] of Object.entries(leaseDefinitions)) {
    const table = sql.match(new RegExp(`CREATE TABLE "${model}" \\([\\s\\S]*?\n\\);`))?.[0];
    for (const [field, type] of Object.entries(definition.fields)) {
      const native = type.includes('Timestamptz')
        ? 'TIMESTAMPTZ(3)'
        : type.includes('Uuid')
          ? 'UUID'
          : 'TEXT';
      expect(table).toContain(`"${field}" ${native},`);
    }
  }
  expect(sql).toContain(
    'CREATE INDEX "JobAttempt_status_leaseExpiresAt_idx" ON "JobAttempt"("status", "leaseExpiresAt");',
  );
  expect(sql).toContain(
    'CREATE INDEX "OutboxEvent_status_availableAt_claimExpiresAt_idx" ON "OutboxEvent"("status", "availableAt", "claimExpiresAt");',
  );
});

it('defines manual lease CHECKs with active presence and nullable historical time ordering', async () => {
  const sql = await readFile(
    'docs/spec-artifacts/final-reconciliation/durable-lease-constraints.sql',
    'utf8',
  );
  expect(sql.match(/ADD CONSTRAINT/g)).toHaveLength(4);
  for (const [model, state, owner, token, acquired, heartbeat, expires, presence, order] of [
    [
      'JobAttempt',
      'RUNNING',
      'workerId',
      'leaseToken',
      'leaseAcquiredAt',
      'heartbeatAt',
      'leaseExpiresAt',
      'running_lease_required',
      'lease_time_order',
    ],
    [
      'OutboxEvent',
      'DISPATCHING',
      'claimOwner',
      'claimToken',
      'claimedAt',
      'claimHeartbeatAt',
      'claimExpiresAt',
      'dispatching_claim_required',
      'claim_time_order',
    ],
  ] as const) {
    const block = sql
      .match(new RegExp(`ALTER TABLE "${model}"([\\s\\S]*?);`))?.[1]
      ?.replace(/\s+/g, ' ');
    expect(block).toContain(
      `ADD CONSTRAINT "${model}_${presence}" CHECK ( "status" <> '${state}' OR (`,
    );
    for (const field of [owner, token, acquired, heartbeat, expires])
      expect(block).toContain(`"${field}" IS NOT NULL`);
    expect(block).toContain(`ADD CONSTRAINT "${model}_${order}" CHECK (`);
    expect(block).toContain(
      `("${expires}" IS NULL OR "${acquired}" IS NULL OR "${expires}" > "${acquired}")`,
    );
    expect(block).toContain(
      `("${heartbeat}" IS NULL OR "${acquired}" IS NULL OR "${heartbeat}" >= "${acquired}")`,
    );
  }
  expect(sql).not.toMatch(/\b(?:CURRENT_TIMESTAMP|NOW|clock_timestamp)\b/i);
});

it('retains exactly the canonical workspace boundaries', async () => {
  for (const [directory, expected] of [
    [
      'apps',
      [
        'web',
        'api',
        'control',
        'worker-ai',
        'worker-capture',
        'worker-render',
        'worker-publish',
        'worker-analytics',
      ],
    ],
    [
      'packages',
      [
        'domain',
        'application',
        'contracts',
        'database',
        'ai',
        'media',
        'publishing',
        'analytics',
        'observability',
        'shared',
      ],
    ],
  ] as const) {
    const directories = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
    expect(directories.sort()).toEqual([...expected].sort());
    for (const name of directories) {
      const content = JSON.parse(await readFile(join(directory, name, 'package.json'), 'utf8')) as {
        name: string;
        private: boolean;
      };
      expect(content.name).toBe(`@vision/${name}`);
      expect(content.private).toBe(true);
    }
  }
});

it('retains the approved isolated reopening decision without changing frozen manifests', async () => {
  const workflows = await readFile('docs/04_WORKFLOWS.md', 'utf8');
  const ux = await readFile('docs/10_DASHBOARD_UX.md', 'utf8');
  const decisions = await readFile('docs/DECISIONS.md', 'utf8');
  expect(workflows).toContain('Additional transition: `ACCEPTED → UPLOADED`');
  expect(workflows).toContain('Take mutation, request status and current input readiness');
  expect(ux).toContain('reject or deselect the last selected take without a replacement');
  expect(decisions).toContain('D-186 — RecordingRequest reopening');
});
