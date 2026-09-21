import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';

import { AIProviderGateway } from '../../packages/ai/src/index.js';
import type { ModelPolicy, ProviderRequest } from '../../packages/ai/src/index.js';
import {
  EditingIntelligenceOutputSchema,
  TechnicalQaReportSchema,
} from '../../packages/contracts/src/index.js';
import {
  EditingIntelligenceService,
  EditingProfileRegistry,
  RenderPayloadBuilder,
  TemplateRegistry,
} from '../../packages/application/src/index.js';
import type { Prisma, createDatabaseClient } from '../../packages/database/src/index.js';
import { InvocationRepository, Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { FakeAIProvider, reply } from '../support/ai-provider.js';

import knowledgeFixture from '../fixtures/phase2/knowledge.json' with { type: 'json' };

const human = {
  actorType: 'USER',
  actorId: 'phase5-editing-ai',
} as const;

const policy: ModelPolicy = {
  capability: 'EDITING_INTELLIGENCE',

  maxAttempts: 2,

  timeoutMs: 1_000,

  fallbackPolicy: 'NONE',

  maxInputTokens: 100_000,

  maxOutputTokens: 4_000,

  maxEstimatedCost: 0.5,
};

const budget = {
  key: 'phase5-editing-ai',

  from: '2020-01-01T00:00:00Z',

  to: '2100-01-01T00:00:00Z',

  limit: '10',

  currency: 'EUR',
};

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
  const source = await persistence.transaction(human, (unit) =>
    unit.knowledge.createSource({
      sourceType: 'MANUAL_REFERENCE',

      title: 'Editing fixture evidence',

      metadataJson: {
        fixture: true,
      },
    }),
  );

  const {
    id: _id,
    key: _key,
    version: _version,
    contentHash: _contentHash,
    effectiveAt: _effectiveAt,
    ...payload
  } = structuredClone(knowledgeFixture);

  void [_id, _key, _version, _contentHash, _effectiveAt];

  payload.claims.verified[0]!.sourceIds = [source.id];

  const knowledge = await persistence.transaction(human, async (unit) => {
    const snapshot = await unit.knowledge.createSnapshot('vision', '2020-01-01T00:00:00Z', payload);

    await unit.knowledge.activate(snapshot.id);

    return snapshot;
  });

  const template = await new TemplateRegistry().getByKey('PRODUCT_DEMO');

  const profile = await new EditingProfileRegistry().getByKey('FAST_PRODUCT_DEMO');

  await persistence.transaction(human, async (unit) => {
    await unit.templates.importSeed(template.artifact);

    await unit.editingProfiles.importSeed(profile);
  });

  const productAsset = await db.asset.create({
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

      title: 'Vision product proof',

      angle: 'Résultat immédiat',

      hook: 'Voilà le résultat.',

      audience: 'Freelances',

      objective: 'Démonstration',

      hypothesis: 'La preuve produit retient.',

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

      requiredAssetsJson: [productAsset.id],

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
    };
  });

  return {
    knowledge,
    template,
    profile,
    productAsset,
    ...graph,
  };
}

function validOutput(request: ProviderRequest) {
  const input = request.envelope.input as {
    assets: {
      assetId: string;
    }[];
  };

  const assetId = input.assets[0]!.assetId;

  return EditingIntelligenceOutputSchema.parse({
    masterDurationMs: 10_000,

    selectedAssets: [
      {
        assetId,
        role: 'PRODUCT_CAPTURE',

        sourceInMs: 0,

        sourceOutMs: 10_000,

        reason: 'Preuve produit principale.',
      },
    ],

    timeline: [
      {
        id: 'product-main',

        startMs: 0,

        endMs: 10_000,

        layer: 'PRODUCT',

        zIndex: 10,

        source: {
          type: 'ASSET',

          assetId,
        },

        composition: {
          opacity: 1,

          region: {
            x: 0,

            y: 0,

            width: 1,

            height: 1,
          },

          scaleMode: 'CROP',
        },

        purpose: 'Montrer la preuve Vision.',
      },
    ],

    productFocus: [
      {
        startMs: 1_000,

        endMs: 5_000,

        assetId,

        region: {
          x: 0.2,

          y: 0.2,

          width: 0.7,

          height: 0.4,
        },

        behavior: 'STATIC_CROP',

        reason: 'Maintenir le résultat lisible.',
      },
    ],

    captions: [],

    onScreenText: [],

    presenter: [],

    audio: {
      sfx: [],
    },

    transitions: [],

    renderSettings: {
      width: 1080,

      height: 1920,

      fps: 30,

      codecProfileKey: 'SOCIAL_H264_AAC_V1',

      audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
    },

    rationale: {
      hookStrategy: 'Preuve immédiatement visible.',

      pacingStrategy: 'Rapide mais lisible.',

      attentionStrategy: 'Un seul focus produit dominant.',

      proofStrategy: 'La capture Vision reste prioritaire.',

      endingStrategy: 'Fin nette sans temps mort.',
    },
  });
}

function service(provider: FakeAIProvider) {
  const gateway = new AIProviderGateway(new InvocationRepository(db), [provider], () => false);

  return new EditingIntelligenceService(db, gateway);
}

it('generates and persists a hard-validated EditingPlan through the production AI gateway', async () => {
  const data = await setup();

  const provider = new FakeAIProvider(async (request) => reply(validOutput(request)));

  const requestId = randomUUID();

  const result = await service(provider).generatePlan(
    {
      requestId,

      knowledgeSnapshotId: data.knowledge.id,

      creativePlanVersionId: data.creativePlanVersion.id,
    },

    policy,
    budget,
  );

  expect(provider.calls).toHaveLength(1);

  expect(provider.calls[0]!.envelope.capability).toBe('EDITING_INTELLIGENCE');

  expect(provider.calls[0]!.envelope.prompt).toMatchObject({
    key: 'editing-intelligence',

    version: '1.0.0',
  });

  expect(result.output.selectedAssets[0]!.assetId).toBe(data.productAsset.id);

  const invocation = await db.modelInvocation.findUniqueOrThrow({
    where: {
      id: requestId,
    },
  });

  expect(invocation).toMatchObject({
    status: 'SUCCEEDED',

    promptKey: 'editing-intelligence',

    promptVersion: '1.0.0',

    knowledgeSnapshotId: data.knowledge.id,
  });
  expect(await db.editingPlanVersion.count()).toBe(1);

  const editingVersion = await db.editingPlanVersion.findFirstOrThrow();

  expect(editingVersion.modelInvocationId).toBe(requestId);

  expect(editingVersion.planSpecJson).toEqual(result.output);

  expect(editingVersion.timelineJson).toEqual(result.output.timeline);

  expect(editingVersion.captionPlanJson).toEqual(result.output.captions);

  expect(editingVersion.audioPlanJson).toEqual(result.output.audio);

  expect(editingVersion.visualFocusJson).toEqual(result.output.productFocus);

  expect(editingVersion.transitionPlanJson).toEqual(result.output.transitions);

  expect(editingVersion.greenScreenPlanJson).toEqual(result.output.presenter);

  expect(editingVersion.renderSettingsJson).toEqual(result.output.renderSettings);

  expect(
    await db.editingPlan.findUniqueOrThrow({
      where: {
        id: editingVersion.editingPlanId,
      },
    }),
  ).toMatchObject({
    status: 'READY',
  });

  expect(
    await db.auditEvent.count({
      where: {
        action: 'ModelInvocation.applied',
        subjectId: requestId,
      },
    }),
  ).toBe(1);
});

it('pins exact RenderInputAssets and compiles a deterministic RenderPayload', async () => {
  const data = await setup();

  const provider = new FakeAIProvider(async (request) => reply(validOutput(request)));

  const result = await service(provider).generatePlan(
    {
      requestId: randomUUID(),
      knowledgeSnapshotId: data.knowledge.id,
      creativePlanVersionId: data.creativePlanVersion.id,
    },
    policy,
    budget,
  );

  const editingVersion = await db.editingPlanVersion.findFirstOrThrow();

  const render = await persistence.transaction(human, (unit) =>
    unit.requestRender(editingVersion.id),
  );

  expect(
    await db.renderInputAsset.findMany({
      where: {
        renderId: render.id,
      },
      orderBy: {
        sequence: 'asc',
      },
    }),
  ).toEqual([
    expect.objectContaining({
      renderId: render.id,
      assetId: data.productAsset.id,
      role: 'PRODUCT_CAPTURE',
      slotKey: null,
      sequence: 0,
    }),
  ]);

  await persistence.transaction(human, (unit) =>
    unit.transitionRender(render.id, 'REQUESTED', 'QUEUED'),
  );

  const renderAttempt = await persistence.transaction(human, (unit) =>
    unit.createRenderAttempt(render.id, 'render-worker-fixture-v1'),
  );

  await expect(
    persistence.transaction(human, (unit) =>
      unit.createRenderAttempt(render.id, 'render-worker-duplicate'),
    ),
  ).rejects.toThrow('ACTIVE_RENDER_ATTEMPT_EXISTS');

  const payload = await new RenderPayloadBuilder(db).build({
    renderId: render.id,
    renderAttemptId: renderAttempt.id,
    resolvedAssets: [
      {
        assetId: data.productAsset.id,
        localUri: `/render-work/${renderAttempt.id}/product.mp4`,
        kind: 'VIDEO',
        probe: {
          assetId: data.productAsset.id,
          container: 'mp4',
          durationMs: 10_000,
          video: {
            codec: 'h264',
            width: 1080,
            height: 1920,
            fps: 30,
            color: {
              hdrKind: 'SDR',
            },
          },
          probeVersion: 'fixture-v1',
        },
      },
    ],
  });

  expect(renderAttempt).toMatchObject({
    renderId: render.id,
    attemptNumber: 1,
    status: 'QUEUED',
    workerVersion: 'render-worker-fixture-v1',
    rendererVersion: 'v1',
  });

  expect(payload.editingPlan).toEqual(result.output);

  expect(payload.provenance).toMatchObject({
    editingPlanVersionId: editingVersion.id,
    templateVersionId: data.template.identity.templateVersionId,
    editingProfileVersionId: data.profile.identity.editingProfileVersionId,
    colorProfileKey: 'SDR_BT709_SOCIAL_V1',
    codecProfileKey: 'SOCIAL_H264_AAC_V1',
    audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
  });
});

it('refuses Render intent when a previously selected input Asset is no longer READY', async () => {
  const data = await setup();

  const provider = new FakeAIProvider(async (request) => reply(validOutput(request)));

  await service(provider).generatePlan(
    {
      requestId: randomUUID(),
      knowledgeSnapshotId: data.knowledge.id,
      creativePlanVersionId: data.creativePlanVersion.id,
    },
    policy,
    budget,
  );

  const editingVersion = await db.editingPlanVersion.findFirstOrThrow();

  await db.asset.update({
    where: {
      id: data.productAsset.id,
    },
    data: {
      status: 'ARCHIVED',
    },
  });

  await expect(
    persistence.transaction(human, (unit) => unit.requestRender(editingVersion.id)),
  ).rejects.toThrow('RENDER_INPUT_NOT_READY');

  expect(await db.render.count()).toBe(0);
  expect(await db.renderInputAsset.count()).toBe(0);
});

it('refuses READY promotion without exact validated invocation evidence', async () => {
  const data = await setup();

  await expect(
    persistence.transaction(human, async (unit) => {
      const editingPlan = await unit.ensureEditingPlan(data.creativePlanVersion.creativePlanId);

      const version = await unit.versions.editingPlanVersion({
        editingPlanId: editingPlan.id,
        creativePlanVersionId: data.creativePlanVersion.id,
        editingProfileVersionId: data.profile.identity.editingProfileVersionId,
        templateVersionId: data.template.identity.templateVersionId,
        timelineJson: {},
      });

      return unit.markEditingPlanReady(version.id);
    }),
  ).rejects.toThrow('EDITING_PLAN_VALIDATED_SPEC_REQUIRED');

  expect(await db.editingPlanVersion.count()).toBe(0);
});

it('rejects an Editing Intelligence output that passes JSON schema but violates hard renderer rules', async () => {
  const data = await setup();

  const provider = new FakeAIProvider(async (request) => {
    const output = validOutput(request);

    output.timeline[0]!.composition.motionPresetKey = 'INVENTED_AI_ZOOM';

    return reply(output);
  });

  const requestId = randomUUID();

  await expect(
    service(provider).generatePlan(
      {
        requestId,

        knowledgeSnapshotId: data.knowledge.id,

        creativePlanVersionId: data.creativePlanVersion.id,
      },

      policy,
      budget,
    ),
  ).rejects.toThrow('PRESET_UNKNOWN');

  expect(provider.calls).toHaveLength(1);

  expect(await db.editingPlanVersion.count()).toBe(0);

  expect(
    await db.modelInvocation.findUniqueOrThrow({
      where: {
        id: requestId,
      },
    }),
  ).toMatchObject({
    status: 'FAILED',

    failureCode: 'PRESET_UNKNOWN',
  });
});

it('persists the deterministic render worker lifecycle through technical QA to creative QA', async () => {
  const data = await setup();
  const provider = new FakeAIProvider(async (request) => reply(validOutput(request)));

  await service(provider).generatePlan(
    {
      requestId: randomUUID(),
      knowledgeSnapshotId: data.knowledge.id,
      creativePlanVersionId: data.creativePlanVersion.id,
    },
    policy,
    budget,
  );

  const editingVersion = await db.editingPlanVersion.findFirstOrThrow();
  const render = await persistence.transaction(human, (unit) =>
    unit.requestRender(editingVersion.id),
  );
  await persistence.transaction(human, (unit) =>
    unit.transitionRender(render.id, 'REQUESTED', 'QUEUED'),
  );
  const attempt = await persistence.transaction(human, (unit) =>
    unit.createRenderAttempt(render.id, 'render-worker-v1'),
  );

  const worker = { actorType: 'WORKER', actorId: 'render-worker-fixture' } as const;
  await persistence.transaction(worker, (unit) => unit.startRenderAttempt(render.id, attempt.id));
  await persistence.transaction(worker, (unit) =>
    unit.enterRenderTechnicalQa(render.id, attempt.id),
  );

  const output = await persistence.transaction(worker, (unit) =>
    unit.reserveRenderOutputAsset(attempt.id, {
      storageProvider: 'fixture',
      bucket: 'fixture',
      objectKey: `renders/${render.id}/attempts/1/master.mp4`,
      mimeType: 'video/mp4',
    }),
  );

  const qa = TechnicalQaReportSchema.parse({
    result: 'PASS',
    probe: {
      assetId: output.id,
      container: 'mov,mp4,m4a,3gp,3g2,mj2',
      durationMs: 10_000,
      video: {
        codec: 'h264',
        width: 1080,
        height: 1920,
        fps: 30,
        pixelFormat: 'yuv420p',
        rotationDeg: 0,
        color: {
          primaries: 'bt709',
          transfer: 'bt709',
          matrix: 'bt709',
          range: 'tv',
          hdrKind: 'SDR',
        },
      },
      probeVersion: 'ffprobe-v1',
    },
    checks: [],
    rendererVersion: 'v1',
    colorProfileKey: 'SDR_BT709_SOCIAL_V1',
    codecProfileKey: 'SOCIAL_H264_AAC_V1',
    audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
  });

  await persistence.transaction(worker, async (unit) => {
    await unit.markRenderOutputAssetReady(output.id, {
      checksumSha256: 'a'.repeat(64),
      sizeBytes: 1_000_000n,
      width: 1080,
      height: 1920,
      durationMs: 10_000,
      fps: 30,
    });
    await unit.succeedRenderAttempt(
      render.id,
      attempt.id,
      output.id,
      qa as unknown as Prisma.InputJsonValue,
    );
  });

  expect(await db.render.findUniqueOrThrow({ where: { id: render.id } })).toMatchObject({
    status: 'CREATIVE_QA',
  });
  expect(await db.renderAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({
    status: 'SUCCEEDED',
    outputAssetId: output.id,
    technicalQaJson: qa,
  });
  expect(await db.asset.findUniqueOrThrow({ where: { id: output.id } })).toMatchObject({
    status: 'READY',
    checksumSha256: 'a'.repeat(64),
  });
});
