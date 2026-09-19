import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { z } from 'zod';

const manifestSchema = z.object({
  fileCount: z.number(),
  files: z.array(z.object({ path: z.string(), sha256: z.string(), sizeBytes: z.number() })),
});

it('preserves all 146 frozen artifacts byte for byte and parses their JSON/TypeScript', async () => {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile('docs/spec-artifacts/spec-v1.0-manifest.json', 'utf8')),
  );
  expect(manifest.fileCount).toBe(146);
  expect(manifest.files).toHaveLength(146);
  for (const entry of manifest.files) {
    const content = await readFile(entry.path);
    expect(createHash('sha256').update(content).digest('hex'), entry.path).toBe(entry.sha256);
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
