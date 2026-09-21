import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { TemplateRuntimeContractSchema } from '../../packages/contracts/src/index.js';
import { TemplateRegistry } from '../../packages/application/src/template-registry.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';

const human = {
  actorType: 'USER',
  actorId: 'phase5-template-curator',
} as const;

let fixture: Awaited<ReturnType<typeof postgresFixture>>;

let db: ReturnType<typeof createDatabaseClient>;

let persistence: Persistence;

beforeAll(async () => {
  fixture = await postgresFixture();

  db = fixture.client;

  persistence = new Persistence(db);
});

afterAll(async () => {
  await fixture?.close();
});

beforeEach(async () => {
  const tables = await db.$queryRaw<
    {
      tablename: string;
    }[]
  >`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename <> '_prisma_migrations'
    `;

  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
});

async function importAll() {
  const templates = await new TemplateRegistry().list();

  const mappings = [];

  for (const template of templates)
    mappings.push(
      await persistence.transaction(human, (unit) => unit.templates.importSeed(template.artifact)),
    );

  return {
    templates,
    mappings,
  };
}

it('imports all five canonical TemplateVersions idempotently using frozen UUIDs', async () => {
  const first = await importAll();

  const second = await importAll();

  expect(await db.template.count()).toBe(5);

  expect(await db.templateVersion.count()).toBe(5);

  expect(
    await db.template.count({
      where: {
        status: 'ACTIVE',
      },
    }),
  ).toBe(5);

  expect(second.mappings).toEqual(first.mappings);

  for (const [index, mapping] of first.mappings.entries()) {
    const template = first.templates[index]!;

    expect(mapping.templateVersionId).toBe(template.identity.templateVersionId);

    const version = await db.templateVersion.findUniqueOrThrow({
      where: {
        id: mapping.templateVersionId,
      },
    });

    expect(version.version).toBe(1);

    expect(TemplateRuntimeContractSchema.parse(version.capabilitiesJson)).toEqual(template.spec);
  }
});

it('persists renderer slots and canonical social canvas without semantic loss', async () => {
  const { templates, mappings } = await importAll();

  for (const [index, mapping] of mappings.entries()) {
    const spec = templates[index]!.spec;

    const version = await db.templateVersion.findUniqueOrThrow({
      where: {
        id: mapping.templateVersionId,
      },
    });

    expect(version.requiredSlotsJson).toEqual(spec.requiredSlots);

    expect(version.optionalSlotsJson).toEqual(spec.optionalSlots);

    expect(version.supportedAspectRatiosJson).toEqual(['9:16']);

    expect(version.rendererVersion).toBe(spec.rendererApiVersion);
  }
});

it('rejects same-version template drift without rewriting the canonical version', async () => {
  const template = (await new TemplateRegistry().list())[0]!;

  await persistence.transaction(human, (unit) => unit.templates.importSeed(template.artifact));

  const changed = structuredClone(template.artifact);

  changed.compositionKey = 'tampered-composition';

  await expect(
    persistence.transaction(human, (unit) => unit.templates.importSeed(changed)),
  ).rejects.toThrow('TEMPLATE_SEED_CONTENT_CONFLICT');

  expect(await db.templateVersion.count()).toBe(1);
});

it('serializes concurrent import of one template into a single canonical version', async () => {
  const template = (await new TemplateRegistry().list())[0]!;

  const [first, second] = await Promise.all([
    persistence.transaction(human, (unit) => unit.templates.importSeed(template.artifact)),

    persistence.transaction(human, (unit) => unit.templates.importSeed(template.artifact)),
  ]);

  expect(second).toEqual(first);

  expect(await db.template.count()).toBe(1);

  expect(await db.templateVersion.count()).toBe(1);

  expect(first.templateVersionId).toBe(template.identity.templateVersionId);
});
