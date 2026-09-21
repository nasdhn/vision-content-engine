import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { EditingProfileRegistry } from '../../packages/application/src/editing-profile-registry.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';

const human = {
  actorType: 'USER',
  actorId: 'phase5-profile-curator',
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
  const specs = await new EditingProfileRegistry().list();

  const mappings = [];

  for (const spec of specs) {
    mappings.push(
      await persistence.transaction(human, (unit) => unit.editingProfiles.importSeed(spec)),
    );
  }

  return {
    specs,
    mappings,
  };
}

it('imports all seven canonical EditingProfiles idempotently with seed UUIDs as DB version IDs', async () => {
  const first = await importAll();

  const second = await importAll();

  expect(await db.editingProfile.count()).toBe(7);

  expect(await db.editingProfileVersion.count()).toBe(7);

  expect(
    await db.editingProfile.count({
      where: {
        status: 'ACTIVE',
      },
    }),
  ).toBe(7);

  expect(second.mappings).toEqual(first.mappings);

  for (const [index, mapping] of first.mappings.entries()) {
    const spec = first.specs[index]!;

    expect(mapping.specVersionId).toBe(spec.identity.editingProfileVersionId);

    expect(mapping.editingProfileVersionId).toBe(spec.identity.editingProfileVersionId);

    const version = await db.editingProfileVersion.findUniqueOrThrow({
      where: {
        id: mapping.editingProfileVersionId,
      },
      include: {
        editingProfile: true,
      },
    });

    expect(version.version).toBe(1);

    expect(version.editingProfile).toMatchObject({
      key: spec.identity.key,
      name: spec.identity.name,
      status: 'ACTIVE',
    });
  }
});

it('persists every frozen EditingProfile block without semantic loss', async () => {
  const { specs, mappings } = await importAll();

  for (const [index, mapping] of mappings.entries()) {
    const spec = specs[index]!;

    const version = await db.editingProfileVersion.findUniqueOrThrow({
      where: {
        id: mapping.editingProfileVersionId,
      },
    });

    expect(version.pacingRulesJson).toEqual(spec.pacing);

    expect(version.cutRulesJson).toEqual(spec.cuts);

    expect(version.captionRulesJson).toEqual(spec.captions);

    expect(version.focusRulesJson).toEqual(spec.focus);

    expect(version.motionRulesJson).toEqual(spec.motion);

    expect(version.soundRulesJson).toEqual(spec.audio);

    expect(version.hookRulesJson).toEqual(spec.hook);

    expect(version.endingRulesJson).toEqual(spec.ending);

    expect(version.greenScreenRulesJson).toEqual({
      presenter: spec.presenter,
      constraints: spec.constraints,
    });
  }
});

it('rejects same-version seed content drift without rewriting the canonical version', async () => {
  const spec = (await new EditingProfileRegistry().list())[0]!;

  await persistence.transaction(human, (unit) => unit.editingProfiles.importSeed(spec));

  const changed = structuredClone(spec);

  changed.pacing.maxDeadAirMs += 1;

  await expect(
    persistence.transaction(human, (unit) => unit.editingProfiles.importSeed(changed)),
  ).rejects.toThrow('EDITING_PROFILE_SEED_CONTENT_CONFLICT');

  expect(await db.editingProfileVersion.count()).toBe(1);

  const persisted = await db.editingProfileVersion.findUniqueOrThrow({
    where: {
      id: spec.identity.editingProfileVersionId,
    },
  });

  expect(persisted.pacingRulesJson).toEqual(spec.pacing);
});

it('serializes concurrent import of the same seed into one canonical version', async () => {
  const spec = (await new EditingProfileRegistry().list())[0]!;

  const [first, second] = await Promise.all([
    persistence.transaction(human, (unit) => unit.editingProfiles.importSeed(spec)),

    persistence.transaction(human, (unit) => unit.editingProfiles.importSeed(spec)),
  ]);

  expect(second).toEqual(first);

  expect(await db.editingProfile.count()).toBe(1);

  expect(await db.editingProfileVersion.count()).toBe(1);

  expect(first.editingProfileVersionId).toBe(spec.identity.editingProfileVersionId);
});
