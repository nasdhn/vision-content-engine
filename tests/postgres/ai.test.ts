import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import {
  Persistence,
  InvocationRepository,
  createDatabaseClient,
  KnowledgePayloadSchema,
  Leases,
} from '../../packages/database/src/index.js';
import { AIProviderGateway, ProviderFailure } from '../../packages/ai/src/index.js';
import type { ModelPolicy, ProviderRequest } from '../../packages/ai/src/index.js';
import { AIContentService } from '../../packages/application/src/index.js';
import type { CreatorOptions, DirectorOptions } from '../../packages/application/src/index.js';
import {
  CreatorInputSchema,
  CreatorOutputSchema,
  CreativeDirectorInputSchema,
} from '../../packages/contracts/src/index.js';
import { contentHash } from '../../packages/contracts/src/canonical.js';
import { FakeAIProvider, SimulatedRealAIProvider, reply } from '../support/ai-provider.js';
import knowledgeFixture from '../fixtures/phase2/knowledge.json' with { type: 'json' };
import outputFixture from '../fixtures/phase2/creator-output.json' with { type: 'json' };
import directorFixture from '../fixtures/phase2/director-output.json' with { type: 'json' };
let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let second: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'fixture-curator' } as const;
const policy: ModelPolicy = {
  capability: 'CREATOR',
  maxAttempts: 3,
  timeoutMs: 1000,
  fallbackPolicy: 'NONE',
  maxInputTokens: 100000,
  maxOutputTokens: 2000,
  maxEstimatedCost: 0.5,
};
const budget = {
  key: 'fixture-budget',
  from: '2020-01-01T00:00:00Z',
  to: '2100-01-01T00:00:00Z',
  limit: '10',
  currency: 'EUR',
};
beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  second = createDatabaseClient(fixture.url);
  persistence = new Persistence(db);
});
afterAll(async () => {
  await second?.$disconnect();
  await fixture?.close();
});
beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')}`);
});
function generated(request: ProviderRequest, hook?: string) {
  const input = CreatorInputSchema.parse(request.envelope.input);
  const output = structuredClone(outputFixture);
  output.concepts[0]!.selectedPatternVersionId = input.patternCandidates[0]!.patternVersionId;
  if (hook) output.concepts[0]!.hook = hook;
  return output;
}
function service(
  providers: readonly (FakeAIProvider | SimulatedRealAIProvider)[] = [
    new FakeAIProvider(async (request) => reply(generated(request))),
  ],
  paused = () => false,
  client = db,
  realProvidersEnabled = () => false,
) {
  const gateway = new AIProviderGateway(
    new InvocationRepository(client),
    providers,
    paused,
    undefined,
    realProvidersEnabled,
  );
  return { service: new AIContentService(client, gateway), gateway, providers };
}
async function setup() {
  const source = await persistence.transaction(human, (u) =>
    u.knowledge.createSource({
      sourceType: 'MANUAL_REFERENCE',
      title: 'Synthetic fixture evidence',
      metadataJson: { fixture: true },
    }),
  );
  const {
    id: _id,
    key: _key,
    version: _version,
    contentHash: _hash,
    effectiveAt: _date,
    ...payload
  } = knowledgeFixture;
  void [_id, _key, _version, _hash, _date];
  payload.claims.verified[0]!.sourceIds = [source.id];
  const knowledge = await persistence.transaction(human, async (u) => {
    const k = await u.knowledge.createSnapshot('vision', '2020-01-01T00:00:00Z', payload);
    await u.knowledge.activate(k.id);
    return k;
  });
  const brief = await persistence.transaction(human, async (u) => {
    const c = await u.createCampaign({ name: 'fixture', slug: randomUUID() });
    const b = await u.createBrief(c.id, 'fixture');
    return u.versions.briefVersion({
      briefId: b.id,
      payloadJson: { objective: 'Demonstrate a fictional workflow' },
    });
  });
  const app = service();
  const seeds = await app.service.seedPatterns(human);
  const options: CreatorOptions = {
    requestId: randomUUID(),
    knowledgeSnapshotId: knowledge.id,
    briefVersionId: brief.id,
    ideaIds: [],
    generationConstraints: {
      requestedConceptCount: 1,
      targetPlatforms: ['INSTAGRAM'],
      allowedPrimaryFormats: ['PROBLEM_SOLUTION'],
      diversity: {},
      explorationPolicy: { mode: 'BALANCED' },
    },
    selection: {
      audience: 'Freelancers',
      useCase: 'Lead qualification',
      topic: 'fixture',
      angle: 'fixture',
      proofType: 'fixture',
      formats: ['PROBLEM_SOLUTION'],
      platforms: ['INSTAGRAM'],
      productProof: true,
      humanPresence: true,
      externalEvidence: true,
      excludeIds: [],
      recent: [],
    },
    selectionPolicy: {
      mode: 'BALANCED',
      seed: 'fixture',
      limit: 3,
      explorationSlots: 1,
      fatiguePenalty: 1,
    },
    duration: { minDurationSec: 5, maxDurationSec: 60 },
  };
  return { ...app, options, knowledge, payload, seeds, brief, source };
}
async function directorSetup() {
  const b = await setup();
  const created = await b.service.createConcepts(b.options, policy, budget);
  const cv = created.versions[0]!;
  await persistence.transaction(human, (u) => u.decideConcept(cv.id, 'APPROVED'));
  const template = await db.template.create({
    data: { key: 'fixture-template', name: 'fixture', status: 'ACTIVE' },
  });
  const profile = await db.editingProfile.create({
    data: { key: 'fixture-profile', name: 'fixture', status: 'ACTIVE' },
  });
  const { tv, pv } = await persistence.transaction(human, async (u) => ({
    tv: await u.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'fixture-only',
      inputSchemaJson: {},
      minDurationMs: 5000,
      maxDurationMs: 60000,
      supportedAspectRatiosJson: ['9:16'],
    }),
    pv: await u.versions.editingProfileVersion({ editingProfileId: profile.id }),
  }));
  const options: DirectorOptions = {
    requestId: randomUUID(),
    knowledgeSnapshotId: b.knowledge.id,
    conceptVersionId: cv.id,
    templateVersionIds: [tv.id],
    editingProfileVersionIds: [pv.id],
    captureScenarioVersionIds: [],
    assetIds: [],
    productionCapabilities: {
      naturalVoiceAvailable: true,
      greenScreenPresenterAvailable: false,
      playwrightCaptureAvailable: false,
    },
    constraints: {
      targetAspectRatio: '9:16',
      targetPlatforms: ['INSTAGRAM'],
      minDurationSec: 5,
      maxDurationSec: 60,
    },
  };
  const provider = new FakeAIProvider(async (request) => {
    const input = CreativeDirectorInputSchema.parse(request.envelope.input);
    const out = structuredClone(directorFixture);
    out.creativePlan.templateVersionId = input.templateCandidates[0]!.templateVersionId;
    out.creativePlan.editingProfileVersionId =
      input.editingProfileCandidates[0]!.editingProfileVersionId;
    return reply(out);
  });
  return { ...b, cv, options, ...service([provider]), provider, tv, pv };
}
it('imports the eight immutable pattern seeds idempotently with explicit ID mappings', async () => {
  const b = await setup();
  expect(b.seeds).toHaveLength(8);
  expect(await b.service.seedPatterns(human)).toEqual(b.seeds);
  expect(await db.patternVersion.count()).toBe(8);
  expect(b.seeds.every((s) => s.specVersionId !== s.patternVersionId)).toBe(true);
  await persistence.transaction(human, (u) => u.patterns.deprecate(b.seeds[0]!.patternId));
  await b.service.seedPatterns(human);
  expect(
    (await db.pattern.findUniqueOrThrow({ where: { id: b.seeds[0]!.patternId } })).status,
  ).toBe('DEPRECATED');
});
it('serializes snapshot versions/activation while preserving historical content', async () => {
  const b = await setup();
  const before = await db.knowledgeSnapshot.findUniqueOrThrow({ where: { id: b.knowledge.id } });
  const other = new Persistence(second);
  const rows = await Promise.all(
    ['one', 'two'].map((label, i) =>
      (i ? other : persistence).transaction(human, async (u) => {
        const row = await u.knowledge.createSnapshot('vision', '2020-01-01T00:00:00Z', {
          ...b.payload,
          visualIdentity: { allowedAssetIds: [], notes: [label] },
        });
        await u.knowledge.activate(row.id);
        return row;
      }),
    ),
  );
  expect(rows.map((r) => r.version).sort()).toEqual([2, 3]);
  expect(await db.knowledgeSnapshot.count({ where: { status: 'ACTIVE' } })).toBe(1);
  expect(
    (await db.knowledgeSnapshot.findUniqueOrThrow({ where: { id: before.id } })).payloadJson,
  ).toEqual(before.payloadJson);
  expect(
    await persistence.transaction(human, (u) => u.knowledge.snapshot(before.id)),
  ).toHaveProperty('contentHash', before.contentHash);
});
it('rejects missing source references and secret-bearing knowledge without writes', async () => {
  const b = await setup();
  b.payload.claims.verified[0]!.sourceIds = [randomUUID()];
  await expect(
    persistence.transaction(human, (u) =>
      u.knowledge.createSnapshot('bad', '2020-01-01T00:00:00Z', b.payload),
    ),
  ).rejects.toThrow('SOURCE_REFERENCE_NOT_FOUND');
  await expect(
    persistence.transaction(human, (u) =>
      u.knowledge.createSource({
        sourceType: 'MANUAL_REFERENCE',
        title: 'bad',
        metadataJson: { apiKey: 'fixture' },
      }),
    ),
  ).rejects.toThrow('SECRET_IN_CONTEXT');
  expect(await db.sourceReference.count()).toBe(1);
  expect(await db.knowledgeSnapshot.count()).toBe(1);
});
it('creates unapproved candidate versions and exact invocation/attempt/audit/outbox lineage', async () => {
  const b = await setup();
  const result = await b.service.createConcepts(b.options, policy, budget);
  expect(result.versions).toHaveLength(1);
  expect(await db.approval.count()).toBe(0);
  expect(
    await db.concept.findUnique({ where: { id: result.versions[0]!.conceptId } }),
  ).toHaveProperty('status', 'AWAITING_REVIEW');
  const invocation = await db.modelInvocation.findUniqueOrThrow({
    where: { id: b.options.requestId },
    include: { attempts: true, costEntries: true },
  });
  expect(invocation).toMatchObject({
    status: 'SUCCEEDED',
    knowledgeSnapshotId: b.knowledge.id,
    attemptCount: 1,
    inputSchemaVersion: '1.0.0',
    outputSchemaVersion: '1.0.0',
    promptKey: 'creator',
  });
  expect(invocation.outputHash).toBe(contentHash(result.output));
  expect(invocation.attempts[0]).toMatchObject({
    provider: 'deterministic-fixture',
    model: 'fixture-v1',
    status: 'SUCCEEDED',
    requestPayloadRef: null,
    responsePayloadRef: null,
  });
  expect(invocation.costEntries).toHaveLength(1);
  expect(result.versions[0]!.creatorModelInvocationId).toBe(invocation.id);
  expect(await db.auditEvent.count({ where: { action: 'Content.claimEvidence' } })).toBe(1);
  expect(await db.outboxEvent.count({ where: { eventType: 'Concept.submitted' } })).toBe(1);
});
it('repairs malformed schema under the same prompt, knowledge and contract', async () => {
  const b = await setup();
  let n = 0;
  const provider = new FakeAIProvider(async (r) =>
    ++n === 1 ? reply({ invalid: true }) : reply(generated(r)),
  );
  await service([provider]).service.createConcepts(b.options, policy, budget);
  expect(provider.calls).toHaveLength(2);
  expect(provider.calls[1]!.repair?.errors.length).toBeGreaterThan(0);
  expect(provider.calls[1]!.envelope).toEqual(provider.calls[0]!.envelope);
  expect(
    await db.modelInvocationAttempt.findMany({
      orderBy: { attemptNumber: 'asc' },
      select: { status: true },
    }),
  ).toEqual([{ status: 'REJECTED_SCHEMA' }, { status: 'SUCCEEDED' }]);
});
it('records actual provider/model on allowed fallback after a transient error', async () => {
  const b = await setup();
  const first = FakeAIProvider.scripted([new ProviderFailure('PROVIDER_5XX', false)], 'primary');
  const fallback = new FakeAIProvider(async (r) => reply(generated(r)), 'fallback');
  await service([first, fallback]).service.createConcepts(
    b.options,
    { ...policy, fallbackPolicy: 'SAME_CONTRACT_ALLOWED', preferredModel: 'primary' },
    budget,
  );
  const attempts = await db.modelInvocationAttempt.findMany({ orderBy: { attemptNumber: 'asc' } });
  expect(attempts.map((a) => a.model)).toEqual(['primary', 'fallback']);
  expect((await db.modelInvocation.findFirstOrThrow()).requestedModel).toBe('primary');
});
it.each(['unknown-reference', 'forbidden', 'numerical'] as const)(
  'does not retry or persist content after %s validation failure',
  async (mode) => {
    const b = await setup();
    const provider = new FakeAIProvider(async (r) => {
      const out = generated(r);
      if (mode === 'unknown-reference') out.concepts[0]!.selectedPatternVersionId = randomUUID();
      if (mode === 'forbidden') out.concepts[0]!.hook = 'Résultat garanti !';
      if (mode === 'numerical') out.concepts[0]!.hook = 'Gagnez 90% de temps.';
      return reply(out);
    });
    await expect(
      service([provider]).service.createConcepts(b.options, policy, budget),
    ).rejects.toThrow();
    expect(provider.calls).toHaveLength(1);
    expect(await db.conceptVersion.count()).toBe(0);
    expect((await db.modelInvocation.findFirstOrThrow()).status).toBe('FAILED');
  },
);
it('bounds invalid-JSON repairs by maxAttempts and never advances the workflow', async () => {
  const b = await setup();
  const provider = new FakeAIProvider(async () => ({ body: 'not JSON' }));
  await expect(
    service([provider]).service.createConcepts(b.options, { ...policy, maxAttempts: 2 }, budget),
  ).rejects.toThrow('INVALID_JSON');
  expect(provider.calls).toHaveLength(2);
  expect(await db.modelInvocationAttempt.count()).toBe(2);
  expect((await db.modelInvocation.findFirstOrThrow()).status).toBe('REJECTED_SCHEMA');
  expect(await db.concept.count()).toBe(0);
});
it('times out a nonresponding provider with bounded attempts and conservative accounting', async () => {
  const b = await setup();
  const provider = new FakeAIProvider(async () => new Promise(() => {}));
  await expect(
    service([provider]).service.createConcepts(
      b.options,
      { ...policy, timeoutMs: 10, maxAttempts: 1 },
      budget,
    ),
  ).rejects.toThrow('TIMEOUT');
  const attempt = await db.modelInvocationAttempt.findFirstOrThrow();
  expect(attempt).toMatchObject({ status: 'FAILED', failureCode: 'TIMEOUT', costAmount: null });
  expect(attempt.validationJson).toMatchObject({ accountedCost: '0.1' });
});
it('blocks budgets before provider calls and retries cannot bypass the reservation', async () => {
  const b = await setup();
  await expect(
    b.service.createConcepts(b.options, policy, { ...budget, limit: '0.1' }),
  ).rejects.toThrow('COST_BUDGET_BLOCK');
  expect(b.providers[0]!.calls).toHaveLength(0);
  const provider = new FakeAIProvider(async () => ({ body: 'bad' }));
  await expect(
    service([provider]).service.createConcepts(
      b.options,
      { ...policy, maxEstimatedCost: 0.15 },
      budget,
    ),
  ).rejects.toThrow('COST_BUDGET_BLOCK');
  expect(provider.calls).toHaveLength(1);
});
it('releases unused reservation after a known nonbillable failure', async () => {
  const b = await setup();
  const provider = FakeAIProvider.scripted([new ProviderFailure('PERMANENT', false)]);
  const small = { ...budget, limit: '0.5' };
  await expect(
    service([provider]).service.createConcepts(b.options, policy, small),
  ).rejects.toThrow('PERMANENT');
  const invocation = await db.modelInvocation.findFirstOrThrow();
  expect(invocation.validationJson).toMatchObject({ budgetConsumed: '0.00000000' });
  await expect(
    b.service.createConcepts({ ...b.options, requestId: randomUUID() }, policy, small),
  ).resolves.toHaveProperty('versions');
});
it('serializes competing durable budget reservations across clients', async () => {
  const b = await setup();
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const provider = new FakeAIProvider(async (r) => {
    entered();
    await wait;
    return reply(generated(r));
  });
  const first = service([provider]).service.createConcepts(b.options, policy, {
    ...budget,
    limit: '0.5',
  });
  await started;
  try {
    await expect(
      service(undefined, undefined, second).service.createConcepts(
        { ...b.options, requestId: randomUUID() },
        policy,
        { ...budget, limit: '0.5' },
      ),
    ).rejects.toThrow('COST_BUDGET_BLOCK');
  } finally {
    release();
  }
  await first;
  expect(await db.modelInvocation.count()).toBe(1);
});
it('fails closed before durable invocation writes when a REAL provider is disabled', async () => {
  const b = await setup();
  const provider = new SimulatedRealAIProvider(async (request) => reply(generated(request)));

  await expect(
    service([provider]).service.createConcepts(b.options, policy, budget),
  ).rejects.toThrow('REAL_PROVIDERS_DISABLED');

  expect(provider.calls).toHaveLength(0);
  expect(await db.modelInvocation.count()).toBe(0);
});

it('runs a simulated REAL provider only behind the explicit activation gate', async () => {
  const b = await setup();
  const provider = new SimulatedRealAIProvider(async (request) => reply(generated(request)));

  const result = await service(
    [provider],
    () => false,
    db,
    () => true,
  ).service.createConcepts(b.options, policy, budget);

  expect(result.versions).toHaveLength(1);
  expect(provider.calls).toHaveLength(1);

  const attempt = await db.modelInvocationAttempt.findFirstOrThrow();

  expect(attempt).toMatchObject({
    provider: 'simulated-real',
    model: 'simulated-real-v1',
    status: 'SUCCEEDED',
  });

  expect(await db.costEntry.count()).toBe(1);
});

it('honors pause before execution and between repair attempts', async () => {
  const b = await setup();
  await expect(
    service(undefined, () => true).service.createConcepts(b.options, policy, budget),
  ).rejects.toThrow('AI_GENERATION_PAUSED');
  expect(await db.modelInvocation.count()).toBe(0);
  let paused = false;
  const provider = new FakeAIProvider(async () => {
    paused = true;
    return reply({ invalid: true });
  });
  await expect(
    service([provider], () => paused).service.createConcepts(b.options, policy, budget),
  ).rejects.toThrow('AI_GENERATION_PAUSED');
  expect(provider.calls).toHaveLength(1);
});
it('rejects replay and atomically rolls back result consumption with application writes', async () => {
  const b = await setup();
  const context = await b.service.creatorContext(b.options);
  const result = await b.gateway.generateStructured(
    {
      requestId: b.options.requestId,
      capability: 'CREATOR',
      purpose: 'fixture',
      prompt: { key: 'creator', version: '1.0.0' },
      knowledgeSnapshot: context.input.brandKnowledge,
      input: context.input,
    },
    { input: CreatorInputSchema, output: CreatorOutputSchema, validate: () => {} },
    policy,
    budget,
  );
  await expect(
    persistence.transaction(human, async (u) => {
      await u.consumeInvocation(result.modelInvocationId, result.output);
      await u.createConcept(b.brief.briefId);
      throw new Error('ROLLBACK');
    }),
  ).rejects.toThrow('ROLLBACK');
  expect(await db.concept.count()).toBe(0);
  await persistence.transaction(human, (u) =>
    u.consumeInvocation(result.modelInvocationId, result.output),
  );
  await expect(
    persistence.transaction(human, (u) =>
      u.consumeInvocation(result.modelInvocationId, result.output),
    ),
  ).rejects.toThrow('INVOCATION_ALREADY_APPLIED');
  await expect(b.service.createConcepts(b.options, policy, budget)).rejects.toThrow(
    'INVOCATION_ALREADY_EXISTS',
  );
});
it('keeps exact historical approval through Creative Director and retains claim provenance', async () => {
  const b = await directorSetup();
  // Newer revision does not replace the existing exact approval.
  await persistence.transaction(human, (u) =>
    u.versions.conceptVersion({
      conceptId: b.cv.conceptId,
      briefVersionId: b.brief.id,
      title: 'New unapproved revision',
      creatorType: 'HUMAN',
    }),
  );
  const result = await b.service.createCreativePlan(
    b.options,
    { ...policy, capability: 'CREATIVE_DIRECTOR' },
    budget,
  );
  expect(result.scriptVersion.conceptVersionId).toBe(b.cv.id);
  expect(result.creativePlanVersion).toMatchObject({
    scriptVersionId: result.scriptVersion.id,
    templateVersionId: b.tv.id,
    editingProfileVersionId: b.pv.id,
  });
  expect(await db.approval.count()).toBe(1);
  // Phase 3 materializes the exact immutable Creative Director requirement atomically.
  expect(await db.recordingRequest.count()).toBe(1);
  expect(await db.recordingRequest.findFirst()).toMatchObject({
    creativePlanVersionId: result.creativePlanVersion.id,
    status: 'READY_TO_RECORD',
  });
  expect(await db.captureRun.count()).toBe(0);
  const evidence = await db.auditEvent.findFirstOrThrow({
    where: { subjectVersionId: result.creativePlanVersion.id, action: 'Content.claimEvidence' },
  });
  expect(evidence.afterJson).toMatchObject({
    knowledgeSnapshotId: b.knowledge.id,
    claims: [{ verifiedClaimIds: ['fixture-fact'] }],
  });
});
it('blocks Creative Director before any provider call for an unapproved exact version', async () => {
  const b = await directorSetup();
  const cv = await persistence.transaction(human, (u) =>
    u.versions.conceptVersion({
      conceptId: b.cv.conceptId,
      briefVersionId: b.brief.id,
      title: 'Not approved',
      creatorType: 'HUMAN',
    }),
  );
  await expect(
    b.service.createCreativePlan(
      { ...b.options, conceptVersionId: cv.id },
      { ...policy, capability: 'CREATIVE_DIRECTOR' },
      budget,
    ),
  ).rejects.toThrow('CONCEPT_APPROVAL_REQUIRED');
  expect(b.provider.calls).toHaveLength(0);
});
it('rejects duplicate generated scripts without creating another immutable version', async () => {
  const b = await directorSetup();
  const p = { ...policy, capability: 'CREATIVE_DIRECTOR' as const };
  await b.service.createCreativePlan(b.options, p, budget);
  await expect(
    b.service.createCreativePlan({ ...b.options, requestId: randomUUID() }, p, budget),
  ).rejects.toThrow('DUPLICATE_SCRIPT');
  expect(await db.scriptVersion.count()).toBe(1);
  expect(await db.creativePlanVersion.count()).toBe(1);
});
it('reconstructs published content memory through exact existing persistence lineage', async () => {
  const b = await directorSetup();
  const created = await b.service.createCreativePlan(
    b.options,
    { ...policy, capability: 'CREATIVE_DIRECTOR' },
    budget,
  );
  const editing = await persistence.transaction(human, async (u) => {
    const root = await u.createEditingPlan(created.creativePlanVersion.creativePlanId);
    return u.versions.editingPlanVersion({
      editingPlanId: root.id,
      creativePlanVersionId: created.creativePlanVersion.id,
      templateVersionId: b.tv.id,
      editingProfileVersionId: b.pv.id,
      timelineJson: {},
    });
  });
  // Historical read-model fixture only: no media/render/publishing engine is executed.
  const render = await db.render.create({
    data: { editingPlanVersionId: editing.id, status: 'APPROVED' },
  });
  const asset = await db.asset.create({
    data: {
      kind: 'VIDEO',
      sourceType: 'RENDER',
      status: 'READY',
      storageProvider: 'fixture',
      bucket: 'fixture',
      objectKey: randomUUID(),
    },
  });
  const account = await db.platformAccount.create({
    data: { platform: 'INSTAGRAM', displayName: 'fixture', remoteAccountId: 'fixture-only' },
  });
  const publication = await db.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      mediaAssetId: asset.id,
      deliveryMode: 'API_AUTOMATED',
      metadataJson: {},
      status: 'PUBLISHED',
      publishedAt: new Date('2020-01-01T00:00:00Z'),
    },
  });
  const creator = await service().service.creatorContext({
    requestId: randomUUID(),
    knowledgeSnapshotId: b.knowledge.id,
    briefVersionId: b.brief.id,
    ideaIds: [],
    generationConstraints: {
      requestedConceptCount: 1,
      targetPlatforms: ['INSTAGRAM'],
      allowedPrimaryFormats: ['PROBLEM_SOLUTION'],
      diversity: {},
      explorationPolicy: { mode: 'BALANCED' },
    },
    selection: {
      audience: 'Freelancers',
      useCase: 'Lead qualification',
      topic: 'fixture',
      angle: 'fixture',
      proofType: 'fixture',
      formats: ['PROBLEM_SOLUTION'],
      platforms: ['INSTAGRAM'],
      productProof: true,
      humanPresence: true,
      externalEvidence: true,
      excludeIds: [],
      recent: [],
    },
    selectionPolicy: {
      mode: 'BALANCED',
      seed: 'fixture',
      limit: 3,
      explorationSlots: 1,
      fatiguePenalty: 1,
    },
    duration: { minDurationSec: 5, maxDurationSec: 60 },
  });
  expect(creator.input.contentMemory.find((v) => v.conceptVersionId === b.cv.id)).toMatchObject({
    publicationIds: [publication.id],
    platforms: ['INSTAGRAM'],
  });
  expect(creator.input.contentMemory[0]).not.toHaveProperty('performance');
});
it('rejects changed immutable source payload hashes before a provider call', async () => {
  const b = await setup();
  // Simulated privileged DB corruption, not an application update path.
  await db.knowledgeSnapshot.update({
    where: { id: b.knowledge.id },
    data: {
      payloadJson: KnowledgePayloadSchema.parse({
        ...b.payload,
        product: { ...b.payload.product, description: 'tampered' },
      }),
    },
  });
  await expect(b.service.createConcepts(b.options, policy, budget)).rejects.toThrow(
    'KNOWLEDGE_HASH_MISMATCH',
  );
  expect(b.providers[0]!.calls).toHaveLength(0);
});

it('rejects forged knowledge context even when its snapshot ID and declared hash are real', async () => {
  const b = await setup();
  const context = await b.service.creatorContext(b.options);
  context.input.brandKnowledge.product.description = 'Forged context';
  await expect(
    b.gateway.generateStructured(
      {
        requestId: randomUUID(),
        capability: 'CREATOR',
        purpose: 'fixture',
        prompt: { key: 'creator', version: '1.0.0' },
        knowledgeSnapshot: context.input.brandKnowledge,
        input: context.input,
      },
      { input: CreatorInputSchema, output: CreatorOutputSchema, validate: () => {} },
      policy,
      budget,
    ),
  ).rejects.toThrow('KNOWLEDGE_CONTEXT_MISMATCH');
  expect(b.providers[0]!.calls).toHaveLength(0);
});
it('blocks input token budgets before execution and accounts output token violations', async () => {
  const b = await setup();
  await expect(
    b.service.createConcepts(b.options, { ...policy, maxInputTokens: 1 }, budget),
  ).rejects.toThrow('INPUT_OR_CURRENCY_BUDGET');
  expect(b.providers[0]!.calls).toHaveLength(0);
  const provider = new FakeAIProvider(async (r) => ({
    ...reply(generated(r)),
    usage: { inputTokens: 1, outputTokens: 99999, costAmount: '0.01', currency: 'EUR' },
  }));
  await expect(
    service([provider]).service.createConcepts(
      { ...b.options, requestId: randomUUID() },
      policy,
      budget,
    ),
  ).rejects.toThrow('TOKEN_BUDGET_EXCEEDED');
  expect(provider.calls).toHaveLength(1);
  expect(await db.costEntry.count()).toBe(1);
  expect(await db.conceptVersion.count()).toBe(0);
});
it('permits the exact remaining budget and blocks the next reservation', async () => {
  const b = await setup();
  const limit = { ...budget, limit: '0.51' };
  await b.service.createConcepts(b.options, policy, limit);
  const other = service([
    new FakeAIProvider(async (r) => reply(generated(r, 'Une autre démonstration concrète ?'))),
  ]);
  await other.service.createConcepts({ ...b.options, requestId: randomUUID() }, policy, limit);
  await expect(
    other.service.createConcepts({ ...b.options, requestId: randomUUID() }, policy, limit),
  ).rejects.toThrow('COST_BUDGET_BLOCK');
  expect(await db.modelInvocation.count()).toBe(2);
});
it('allows a genuinely free deterministic call under an explicit zero cost ceiling', async () => {
  const b = await setup();
  const provider = new FakeAIProvider(
    async (r) => ({
      body: JSON.stringify(generated(r)),
      usage: { costAmount: '0', currency: 'EUR' },
    }),
    'free-fixture',
    '0',
  );
  await service([provider]).service.createConcepts(
    b.options,
    { ...policy, maxEstimatedCost: 0 },
    { ...budget, limit: '0' },
  );
  expect((await db.modelInvocation.findFirstOrThrow()).costAmount?.toString()).toBe('0');
});
it('rejects a globally allowed format incompatible with the exact selected PatternVersion', async () => {
  const b = await setup();
  const pattern = await db.pattern.findUniqueOrThrow({
    where: { key: 'PROBLEM_TO_SOLUTION' },
    include: { versions: true },
  });
  const id = pattern.versions[0]!.id;
  const provider = new FakeAIProvider(async (r) => {
    const output = generated(r);
    output.concepts[0]!.selectedPatternVersionId = id;
    output.concepts[0]!.formatRecommendation.primaryFormat = 'FOUNDER_STORY';
    return reply(output);
  });
  const options = {
    ...b.options,
    selectionPolicy: { ...b.options.selectionPolicy, limit: 8 },
    generationConstraints: {
      ...b.options.generationConstraints,
      allowedPrimaryFormats: ['PROBLEM_SOLUTION', 'FOUNDER_STORY'] as (
        'PROBLEM_SOLUTION' | 'FOUNDER_STORY'
      )[],
    },
  };
  await expect(service([provider]).service.createConcepts(options, policy, budget)).rejects.toThrow(
    'PATTERN_FORMAT_INCOMPATIBLE',
  );
  expect(await db.conceptVersion.count()).toBe(0);
});
it('deduplicates simultaneous generated hooks atomically across invocation results', async () => {
  const b = await setup();
  let count = 0;
  let ready!: () => void;
  const both = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const provider = new FakeAIProvider(async (r) => {
    if (++count === 2) ready();
    await both;
    return reply(generated(r));
  });
  const outcomes = await Promise.allSettled([
    service([provider]).service.createConcepts(b.options, policy, budget),
    service([provider], undefined, second).service.createConcepts(
      { ...b.options, requestId: randomUUID() },
      policy,
      budget,
    ),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(await db.conceptVersion.count()).toBe(1);
  expect(await db.auditEvent.count({ where: { action: 'ModelInvocation.applied' } })).toBe(1);
});
it('fences stale AI worker results through the existing Phase 1 lease API', async () => {
  const b = await setup();
  const leases = new Leases(
    db,
    { durationMs: 60000, heartbeatIntervalMs: 10000 },
    { AI: 'SAFE_RETRY' },
  );
  const job = await persistence.transaction(human, (u) =>
    u.enqueueJob({ queueName: 'ai', jobType: 'AI', operationId: randomUUID(), attemptNumber: 1 }),
  );
  const claim = await leases.claimJob('ai', 'fixture-worker');
  const provider = new FakeAIProvider(async (r) => {
    await db.$executeRaw`UPDATE "JobAttempt" SET "leaseAcquiredAt" = '2000-01-01T00:00:00Z', "heartbeatAt" = '2000-01-01T00:00:01Z', "leaseExpiresAt" = '2000-01-01T00:00:02Z' WHERE id = ${job.id}::uuid`;
    return reply(generated(r));
  });
  await expect(
    service([provider]).service.createConcepts(b.options, policy, budget, {
      leases,
      jobId: job.id,
      leaseToken: claim!.leaseToken!,
    }),
  ).rejects.toThrow('STALE_LEASE');
  expect(await db.conceptVersion.count()).toBe(0);
  expect(await db.auditEvent.count({ where: { action: 'ModelInvocation.applied' } })).toBe(0);
  expect((await db.modelInvocation.findFirstOrThrow()).status).toBe('SUCCEEDED');
  expect(await db.costEntry.count()).toBe(1);
});
it('commits successful AI worker results atomically with JobAttempt completion', async () => {
  const b = await setup();
  const leases = new Leases(
    db,
    { durationMs: 60000, heartbeatIntervalMs: 10000 },
    { AI: 'SAFE_RETRY' },
  );
  const job = await persistence.transaction(human, (u) =>
    u.enqueueJob({ queueName: 'ai', jobType: 'AI', operationId: randomUUID(), attemptNumber: 1 }),
  );
  const claim = await leases.claimJob('ai', 'fixture-worker');
  await b.service.createConcepts(b.options, policy, budget, {
    leases,
    jobId: job.id,
    leaseToken: claim!.leaseToken!,
  });
  expect((await db.jobAttempt.findUniqueOrThrow({ where: { id: job.id } })).status).toBe(
    'SUCCEEDED',
  );
  expect(await db.conceptVersion.count()).toBe(1);
  expect(await db.outboxEvent.count({ where: { eventType: 'JobAttempt.succeeded' } })).toBe(1);
});
