import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import {
  EditingIntelligenceContextBuilder,
  EditingProfileRegistry,
  TemplateRegistry,
} from '../../packages/application/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';

const human = {
  actorType: 'USER',
  actorId: 'phase5-editing-context',
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

async function setup() {
  const template = await new TemplateRegistry().getByKey('PRODUCT_DEMO');

  const profile = await new EditingProfileRegistry().getByKey('FAST_PRODUCT_DEMO');

  await persistence.transaction(human, async (unit) => {
    await unit.templates.importSeed(template.artifact);

    await unit.editingProfiles.importSeed(profile);
  });

  const requiredAsset = await db.asset.create({
    data: {
      kind: 'VIDEO',

      sourceType: 'UPLOAD',

      storageProvider: 'fixture',

      bucket: 'fixture',

      objectKey: randomUUID(),

      status: 'READY',

      durationMs: 10_000,

      width: 1080,

      height: 1920,

      fps: 30,
    },
  });

  const graph = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({
      name: 'fixture',

      slug: randomUUID(),
    });

    const brief = await unit.createBrief(campaign.id, 'fixture');

    const briefVersion = await unit.versions.briefVersion({
      briefId: brief.id,

      payloadJson: {},
    });

    const concept = await unit.createConcept(brief.id);

    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,

      briefVersionId: briefVersion.id,

      title: 'Démonstration Vision',

      angle: 'Montrer le résultat immédiatement',

      hook: 'Voilà le résultat.',

      audience: 'Freelances',

      objective: 'Démonstration',

      hypothesis: 'La preuve produit retient mieux.',

      creatorType: 'HUMAN',
    });

    await unit.submitConcept(conceptVersion.id);

    await unit.decideConcept(conceptVersion.id, 'APPROVED');

    const script = await unit.createScript(concept.id);

    const creativePlan = await unit.createCreativePlan(concept.id);

    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: script.id,

      conceptVersionId: conceptVersion.id,

      language: 'fr',

      fullText: 'Voilà le résultat obtenu avec Vision.',

      segmentsJson: [
        {
          id: 'line-1',

          text: 'Voilà le résultat obtenu avec Vision.',

          purpose: 'hook',
        },
      ],

      estimatedDurationMs: 10_000,

      voiceMode: 'NATURAL_USER_VOICE',

      createdByType: 'HUMAN',
    });

    const creativePlanVersion = await unit.versions.creativePlanVersion({
      creativePlanId: creativePlan.id,

      scriptVersionId: scriptVersion.id,

      targetDurationMs: 10_000,

      primaryFormat: 'PRODUCT_DEMO',

      templateVersionId: template.identity.templateVersionId,

      editingProfileVersionId: profile.identity.editingProfileVersionId,

      scenePlanJson: [
        {
          id: 'scene-1',

          purpose: 'product-proof',
        },
      ],

      requiredRecordingsJson: [],

      requiredCapturesJson: [],

      requiredAssetsJson: [requiredAsset.id],

      ctaJson: {
        type: 'TRY',

        text: 'Essaie Vision',
      },

      platformConsiderationsJson: [],
    });

    await unit.markProductionReady(script.id, creativePlan.id);

    const readiness = await unit.recordings.refresh(creativePlanVersion.id);

    expect(readiness.ready).toBe(true);

    return {
      creativePlanVersion,
      creativePlan,
    };
  });

  return {
    template,
    profile,
    requiredAsset,
    ...graph,
  };
}

it('builds the frozen Editing Intelligence input from canonical persisted lineage', async () => {
  const data = await setup();

  const context = await new EditingIntelligenceContextBuilder(db).build({
    creativePlanVersionId: data.creativePlanVersion.id,
  });

  expect(context.input.creativePlanVersion.templateVersionId).toBe(
    data.template.identity.templateVersionId,
  );

  expect(context.input.creativePlanVersion.editingProfileVersionId).toBe(
    data.profile.identity.editingProfileVersionId,
  );

  expect(context.input.editingProfile.policy).toMatchObject({
    pacing: data.profile.pacing,

    constraints: data.profile.constraints,
  });

  expect(context.input.template.capabilities).toMatchObject({
    templateVersionId: data.template.identity.templateVersionId,

    compositionKey: data.template.spec.compositionKey,
  });

  expect(context.input.assets).toEqual([
    expect.objectContaining({
      assetId: data.requiredAsset.id,

      semanticRole: 'REQUIRED_EXISTING',
    }),
  ]);

  expect(context.input.renderConstraints).toEqual({
    width: 1080,

    height: 1920,

    allowedFps: [30, 60],
  });

  expect(context.input.allowedMotionPresets.length).toBeGreaterThan(0);

  expect(context.input.allowedTransitionPresets).toContain('CUT');
});

it('fails closed if a required existing Asset is no longer READY', async () => {
  const data = await setup();

  await db.asset.update({
    where: {
      id: data.requiredAsset.id,
    },

    data: {
      status: 'ARCHIVED',
    },
  });

  await expect(
    new EditingIntelligenceContextBuilder(db).build({
      creativePlanVersionId: data.creativePlanVersion.id,
    }),
  ).rejects.toThrow('EDITING_REQUIRED_ASSET_UNAVAILABLE');
});

it('refuses to build Editing Intelligence context before canonical production readiness', async () => {
  const data = await setup();

  await db.creativePlan.update({
    where: {
      id: data.creativePlan.id,
    },

    data: {
      status: 'WAITING_FOR_INPUTS',
    },
  });

  await expect(
    new EditingIntelligenceContextBuilder(db).build({
      creativePlanVersionId: data.creativePlanVersion.id,
    }),
  ).rejects.toThrow('CREATIVE_PLAN_NOT_READY_FOR_EDITING');
});
