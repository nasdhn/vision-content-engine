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

const historicalManifestPath = 'docs/spec-artifacts/spec-v1.0-manifest.json';
const appendedDocuments = new Set([
  'docs/DECISIONS.md',
  'docs/SPEC_STATUS.md',
  'docs/19_SPEC_V1_FINAL_VALIDATION.md',
]);
const sha256 = (content: string | Buffer) => createHash('sha256').update(content).digest('hex');

it('preserves spec-v1.0 and recovers all 146 historical artifacts by reversing only the amendment', async () => {
  const bytes = await readFile(historicalManifestPath);
  expect(sha256(bytes)).toBe('dede443b3889ddbb614b24f0bd2abfd85603e6f39b50bc14eb951455ef3229cd');
  const manifest = manifestSchema.parse(JSON.parse(bytes.toString()));
  expect(manifest.specVersion).toBe('spec-v1.0');
  expect(manifest.fileCount).toBe(146);
  expect(manifest.files).toHaveLength(146);
  for (const entry of manifest.files) {
    let original = await readFile(entry.path);
    if (entry.path === 'docs/spec-artifacts/schema.prisma') {
      original = Buffer.from(original.toString().replaceAll(' @db.Timestamptz(3)', ''));
    } else if (appendedDocuments.has(entry.path)) {
      // These three records are append-only: their original bytes must remain intact.
      original = original.subarray(0, entry.sizeBytes);
    }
    expect(sha256(original), entry.path).toBe(entry.sha256);
    expect(original.length, entry.path).toBe(entry.sizeBytes);
  }
});

it('validates the current spec-v1.0.1 manifest and parses its JSON/TypeScript', async () => {
  const historical = manifestSchema.parse(
    JSON.parse(await readFile(historicalManifestPath, 'utf8')),
  );
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile('docs/spec-artifacts/spec-v1.0.1-manifest.json', 'utf8')),
  );
  expect(manifest.specVersion).toBe('spec-v1.0.1');
  expect(manifest.fileCount).toBe(149);
  expect(manifest.files).toHaveLength(149);
  expect(manifest.files.map((entry) => entry.path)).toEqual(
    [
      ...historical.files.map((entry) => entry.path),
      historicalManifestPath,
      'docs/20_TIME_SEMANTICS_AMENDMENT.md',
      'docs/adr/ADR-0024-utc-instants-timestamptz.md',
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
    expect(fields).toHaveLength(97);
    expect(fields.filter((field) => field[1] === 'DateTime?')).toHaveLength(24);
    for (const field of fields) {
      expect(field[2]?.match(/@db\.Timestamptz\(3\)/g), field[0]).toHaveLength(1);
    }
  }
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
