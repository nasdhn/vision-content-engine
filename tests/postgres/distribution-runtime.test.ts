import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence } from '../../packages/database/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import {
  DistributionControl,
  DistributionOutboxDispatcher,
  PlatformAccountHealthControl,
} from '../../apps/control/src/index.js';
import { PublishWorkerOrchestrator } from '../../apps/worker-publish/src/index.js';
import { DistributionOperationsService } from '../../packages/application/src/distribution-operations.js';
import {
  FakePublisher,
  StaticPublisherRegistry,
  parseDistributionOutboxEvent,
} from '../../packages/publishing/src/index.js';
import type { PublishQueueJob } from '../../packages/publishing/src/index.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'phase7-reviewer' } as const;

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
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
});

async function approvedRender() {
  const roots = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({ name: 'phase7', slug: randomUUID() });
    const brief = await unit.createBrief(campaign.id, 'phase7');
    const briefVersion = await unit.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await unit.createConcept(brief.id);
    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: briefVersion.id,
      title: 'phase7',
      creatorType: 'HUMAN',
    });
    await unit.submitConcept(conceptVersion.id);
    await unit.decideConcept(conceptVersion.id, 'APPROVED');
    const script = await unit.createScript(concept.id);
    const creativePlan = await unit.createCreativePlan(concept.id);
    const editingPlan = await unit.createEditingPlan(creativePlan.id);
    return { conceptVersion, script, creativePlan, editingPlan };
  });

  const template = await db.template.create({ data: { key: randomUUID(), name: 'phase7' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'phase7' } });
  const lineage = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'phase7-fixture',
      inputSchemaJson: {},
    });
    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profile.id,
    });
    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: roots.script.id,
      conceptVersionId: roots.conceptVersion.id,
      fullText: 'phase7 fixture',
      createdByType: 'HUMAN',
    });
    const creativePlanVersion = await unit.versions.creativePlanVersion({
      creativePlanId: roots.creativePlan.id,
      scriptVersionId: scriptVersion.id,
      primaryFormat: 'short',
      templateVersionId: templateVersion.id,
      editingProfileVersionId: profileVersion.id,
      scenePlanJson: {},
    });
    const editingPlanVersion = await unit.versions.editingPlanVersion({
      editingPlanId: roots.editingPlan.id,
      creativePlanVersionId: creativePlanVersion.id,
      templateVersionId: templateVersion.id,
      editingProfileVersionId: profileVersion.id,
      timelineJson: {},
    });
    return { editingPlanVersion };
  });
  const render = await db.render.create({
    data: { editingPlanVersionId: lineage.editingPlanVersion.id },
  });
  const output = await db.asset.create({
    data: {
      kind: 'VIDEO',
      sourceType: 'RENDER',
      storageProvider: 'fixture',
      bucket: 'private-fixture',
      objectKey: randomUUID(),
      checksumSha256: 'a'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: 1_000_000n,
      width: 1080,
      height: 1920,
      durationMs: 15_000,
      status: 'READY',
    },
  });
  await db.renderAttempt.create({
    data: {
      renderId: render.id,
      attemptNumber: 1,
      status: 'SUCCEEDED',
      outputAssetId: output.id,
      technicalQaJson: { result: 'PASS' },
      creativeQaResult: 'PASS',
    },
  });
  await persistence.transaction(human, async (unit) => {
    await unit.transitionRender(render.id, 'REQUESTED', 'QUEUED');
    await unit.transitionRender(render.id, 'QUEUED', 'RENDERING');
    await unit.transitionRender(render.id, 'RENDERING', 'TECHNICAL_QA');
    await unit.transitionRender(render.id, 'TECHNICAL_QA', 'CREATIVE_QA');
    await unit.transitionRender(render.id, 'CREATIVE_QA', 'READY_FOR_REVIEW');
    await unit.decideRender(render.id, 'APPROVED', output.id);
  });
  return { render, output };
}

function instagramMetadata() {
  return {
    schemaVersion: 'instagram-reel-v1',
    platform: 'INSTAGRAM',
    caption: 'Vision phase 7',
    shareToFeed: true,
  } as const;
}

function instagramCapabilities() {
  return {
    schemaVersion: 'v1',
    canPublishVideo: true,
    canPublishPublic: true,
    supportsNativeScheduling: false,
    deliveryMode: 'API_AUTOMATED',
    limitations: [],
    checkedAt: '2026-09-22T08:00:00.000Z',
  } as const;
}

async function automatedPublication(scheduledAt = new Date('2000-01-01T00:00:00Z')) {
  const { render, output } = await approvedRender();
  const account = await db.platformAccount.create({
    data: {
      platform: 'INSTAGRAM',
      displayName: 'Vision Instagram',
      remoteAccountId: randomUUID(),
      credentialsRef: 'secret-ref://instagram-fixture',
      capabilitiesJson: instagramCapabilities(),
    },
  });
  const publication = await persistence.transaction(human, (unit) =>
    unit.createPublication({
      renderId: render.id,
      platformAccountId: account.id,
      mediaAssetId: output.id,
      deliveryMode: 'API_AUTOMATED',
      metadataJson: instagramMetadata(),
    }),
  );
  await persistence.transaction(human, (unit) =>
    unit.distribution.schedule(publication.id, scheduledAt),
  );
  return { publication, account };
}

async function publishJobFor(publicationId: string) {
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { aggregateId: publicationId, eventType: 'Publication.publish.requested' },
    orderBy: { createdAt: 'desc' },
  });
  return parseDistributionOutboxEvent(event);
}

it('dispatches due automated work once, preserves future work and obeys the kill switch', async () => {
  const due = await automatedPublication();
  const control = new DistributionControl(db);
  await expect(control.dispatchDueOne(true)).resolves.toEqual({ kind: 'PAUSED' });
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: due.publication.id } }),
  ).toHaveProperty('status', 'SCHEDULED');
  const dispatched = await control.dispatchDueOne(false);
  expect(dispatched).toMatchObject({ kind: 'PUBLISH_QUEUED', publicationId: due.publication.id });
  await expect(control.dispatchDueOne(false)).resolves.toEqual({ kind: 'NONE' });
  expect(await db.publicationAttempt.count({ where: { publicationId: due.publication.id } })).toBe(
    1,
  );

  const future = await automatedPublication(new Date('2999-01-01T00:00:00Z'));
  await expect(control.dispatchDueOne(false)).resolves.toEqual({ kind: 'NONE' });
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: future.publication.id } }),
  ).toHaveProperty('status', 'SCHEDULED');
});

it('moves manual TikTok handoff to readiness without a fake provider attempt', async () => {
  const { render, output } = await approvedRender();
  const account = await db.platformAccount.create({
    data: { platform: 'TIKTOK', displayName: 'Vision TikTok', remoteAccountId: randomUUID() },
  });
  const publication = await persistence.transaction(human, (unit) =>
    unit.createPublication({
      renderId: render.id,
      platformAccountId: account.id,
      mediaAssetId: output.id,
      deliveryMode: 'MANUAL_HANDOFF',
      metadataJson: {
        schemaVersion: 'tiktok-manual-handoff-v1',
        platform: 'TIKTOK',
        caption: 'Vision',
        hashtags: ['#vision'],
        commercialDisclosureReminder: true,
      },
    }),
  );
  await persistence.transaction(human, (unit) =>
    unit.distribution.schedule(publication.id, new Date('2000-01-01T00:00:00Z')),
  );
  const result = await new DistributionControl(db).dispatchDueOne(false);
  expect(result).toEqual({ kind: 'MANUAL_READY', publicationId: publication.id });
  expect(await db.publication.findUniqueOrThrow({ where: { id: publication.id } })).toHaveProperty(
    'status',
    'READY_FOR_MANUAL_PUBLISH',
  );
  expect(await db.publicationAttempt.count({ where: { publicationId: publication.id } })).toBe(0);
});

it('dispatches only distribution outbox events through a stable secret-free transport job', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const jobs: PublishQueueJob[] = [];
  const dispatcher = new DistributionOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    'phase7-dispatcher',
  );
  await expect(dispatcher.dispatchOne(true)).resolves.toEqual({ kind: 'PAUSED' });
  const result = await dispatcher.dispatchOne(false);
  expect(result.kind).toBe('DISPATCHED');
  expect(jobs).toHaveLength(1);
  expect(jobs[0]).toMatchObject({ kind: 'PUBLISH', publicationId: created.publication.id });
  expect(JSON.stringify(jobs[0])).not.toMatch(/token|credential|secret/i);
  await expect(dispatcher.dispatchOne()).resolves.toEqual({ kind: 'NONE' });
});

it('publishes once with the fake provider and makes duplicate queue delivery harmless', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const job = await publishJobFor(created.publication.id);
  const fake = new FakePublisher('INSTAGRAM');
  const registry = new StaticPublisherRegistry([fake]);
  const paused = new PublishWorkerOrchestrator(db, registry, {
    pauseAllPublishing: true,
    realProvidersEnabled: false,
  });
  await expect(paused.process(job)).resolves.toEqual({ kind: 'PAUSED' });
  expect(fake.calls).toHaveLength(0);
  const worker = new PublishWorkerOrchestrator(db, registry, {
    pauseAllPublishing: false,
    realProvidersEnabled: false,
    random: () => 0.5,
  });
  await expect(worker.process(job)).resolves.toMatchObject({ kind: 'PUBLISHED' });
  await expect(worker.process(job)).resolves.toMatchObject({ kind: 'SKIP' });
  expect(fake.calls.filter((call) => call.kind === 'PUBLISH')).toHaveLength(1);
  const publication = await db.publication.findUniqueOrThrow({
    where: { id: created.publication.id },
  });
  expect(publication.status).toBe('PUBLISHED');
  expect(publication.remotePostId).toMatch(/^fake-/);
});

it('fails closed before any real-provider side effect when live providers are disabled', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const job = await publishJobFor(created.publication.id);
  let providerCalls = 0;
  const realPublisher = {
    platform: 'INSTAGRAM' as const,
    isRealProvider: true,
    async prepare() {
      providerCalls += 1;
      return {};
    },
    async publish() {
      providerCalls += 1;
      return { responseClass: 'SUCCESS' as const, remotePostId: 'should-not-happen' };
    },
    async reconcile() {
      providerCalls += 1;
      return { kind: 'UNKNOWN' as const };
    },
  };
  const worker = new PublishWorkerOrchestrator(db, new StaticPublisherRegistry([realPublisher]), {
    pauseAllPublishing: false,
    realProvidersEnabled: false,
  });

  await expect(worker.process(job)).resolves.toMatchObject({ kind: 'FAILED' });
  expect(providerCalls).toBe(0);
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: created.publication.id } }),
  ).toHaveProperty('status', 'FAILED');
  expect(
    await db.publicationAttempt.findFirstOrThrow({
      where: { publicationId: created.publication.id },
    }),
  ).toMatchObject({
    status: 'FAILED',
    responseClass: 'PERMANENT_FAILURE',
    failureCode: 'REAL_PROVIDERS_DISABLED',
  });
});

it('treats a redelivered RUNNING attempt as ambiguous instead of calling the provider twice', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const job = await publishJobFor(created.publication.id);
  if (job.kind !== 'PUBLISH') throw new Error('EXPECTED_PUBLISH_JOB');
  await expect(
    persistence.transaction({ actorType: 'WORKER', actorId: 'crashed-worker' }, (unit) =>
      unit.distribution.beginAttempt(job.publicationAttemptId),
    ),
  ).resolves.toMatchObject({ kind: 'READY' });
  await expect(
    persistence.transaction({ actorType: 'WORKER', actorId: 'replacement-worker' }, (unit) =>
      unit.distribution.beginAttempt(job.publicationAttemptId),
    ),
  ).resolves.toMatchObject({ kind: 'UNKNOWN_REDELIVERY' });
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: created.publication.id } }),
  ).toHaveProperty('status', 'PUBLISHING_UNKNOWN');
  const attempt = await db.publicationAttempt.findUniqueOrThrow({
    where: { id: job.publicationAttemptId },
  });
  expect(attempt).toMatchObject({ status: 'FAILED', responseClass: 'UNKNOWN_SIDE_EFFECT' });
});

it('fails closed to PUBLISHING_UNKNOWN and reconciles without a second publish call', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const publishJob = await publishJobFor(created.publication.id);
  const fake = new FakePublisher('INSTAGRAM', {
    publishResults: [
      {
        responseClass: 'UNKNOWN_SIDE_EFFECT',
        failureCode: 'LOST_PROVIDER_RESPONSE',
      },
    ],
    reconcileResults: [{ kind: 'PUBLISHED', remotePostId: 'remote-found' }],
  });
  const worker = new PublishWorkerOrchestrator(db, new StaticPublisherRegistry([fake]), {
    pauseAllPublishing: false,
    realProvidersEnabled: false,
  });
  await expect(worker.process(publishJob)).resolves.toMatchObject({ kind: 'PUBLISHING_UNKNOWN' });
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: created.publication.id } }),
  ).toHaveProperty('status', 'PUBLISHING_UNKNOWN');
  await expect(worker.process(publishJob)).resolves.toMatchObject({ kind: 'SKIP' });
  expect(fake.calls.filter((call) => call.kind === 'PUBLISH')).toHaveLength(1);
  const reconcileEvent = await db.outboxEvent.findFirstOrThrow({
    where: {
      aggregateId: created.publication.id,
      eventType: 'Publication.reconcile.requested',
    },
    orderBy: { createdAt: 'desc' },
  });
  await expect(worker.process(parseDistributionOutboxEvent(reconcileEvent))).resolves.toMatchObject(
    {
      kind: 'PUBLISHED',
    },
  );
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: created.publication.id } }),
  ).toMatchObject({
    status: 'PUBLISHED',
    remotePostId: 'remote-found',
  });
});

it('creates a new append-only attempt only for provably safe retry classes', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const firstJob = await publishJobFor(created.publication.id);
  const fake = new FakePublisher('INSTAGRAM', {
    publishResults: [
      { responseClass: 'TRANSIENT_FAILURE', failureCode: 'SAFE_NETWORK_FAILURE' },
      { responseClass: 'SUCCESS', remotePostId: 'retry-success' },
    ],
  });
  const worker = new PublishWorkerOrchestrator(db, new StaticPublisherRegistry([fake]), {
    pauseAllPublishing: false,
    realProvidersEnabled: false,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 10, jitterRatio: 0 },
  });
  await expect(worker.process(firstJob)).resolves.toMatchObject({ kind: 'RETRY_QUEUED' });
  const attempts = await db.publicationAttempt.findMany({
    where: { publicationId: created.publication.id },
    orderBy: { attemptNumber: 'asc' },
  });
  expect(attempts.map((attempt) => [attempt.attemptNumber, attempt.status])).toEqual([
    [1, 'FAILED'],
    [2, 'QUEUED'],
  ]);
  const publishEvents = await db.outboxEvent.findMany({
    where: {
      aggregateId: created.publication.id,
      eventType: 'Publication.publish.requested',
    },
    orderBy: { createdAt: 'desc' },
  });
  const secondEvent = publishEvents.find((event) => {
    const payload = event.payloadJson as { publicationAttemptId?: string };
    return payload.publicationAttemptId === attempts[1]?.id;
  });
  expect(secondEvent).toBeDefined();
  await expect(worker.process(parseDistributionOutboxEvent(secondEvent!))).resolves.toMatchObject({
    kind: 'PUBLISHED',
  });
  expect(fake.calls.filter((call) => call.kind === 'PUBLISH')).toHaveLength(2);
});

it('refuses scheduling when the automated account is no longer active', async () => {
  const { render, output } = await approvedRender();
  const account = await db.platformAccount.create({
    data: {
      platform: 'INSTAGRAM',
      displayName: 'Vision Instagram',
      remoteAccountId: randomUUID(),
      status: 'REAUTH_REQUIRED',
      credentialsRef: 'secret-ref://instagram-fixture',
      capabilitiesJson: instagramCapabilities(),
    },
  });
  const publication = await persistence.transaction(human, (unit) =>
    unit.createPublication({
      renderId: render.id,
      platformAccountId: account.id,
      mediaAssetId: output.id,
      deliveryMode: 'API_AUTOMATED',
      metadataJson: instagramMetadata(),
    }),
  );
  await expect(
    persistence.transaction(human, (unit) =>
      unit.distribution.schedule(publication.id, new Date('2000-01-01T00:00:00Z')),
    ),
  ).rejects.toThrow('PLATFORM_ACCOUNT_NOT_ACTIVE');
});

it('keeps operator reconciliation idempotent and allows reschedule only while SCHEDULED', async () => {
  const created = await automatedPublication(new Date('2999-01-01T00:00:00Z'));
  const first = new Date('2999-02-01T00:00:00Z');
  await persistence.transaction(human, (unit) =>
    unit.distribution.reschedule(created.publication.id, first),
  );
  expect(
    await db.publication.findUniqueOrThrow({ where: { id: created.publication.id } }),
  ).toMatchObject({
    status: 'SCHEDULED',
    scheduledAt: first,
  });

  await new DistributionControl(db).dispatchDueOne(false);
  await db.publication.update({
    where: { id: created.publication.id },
    data: { status: 'PUBLISHING_UNKNOWN' },
  });

  const firstEvent = await persistence.transaction(human, (unit) =>
    unit.distribution.requestReconciliation(created.publication.id),
  );
  const secondEvent = await persistence.transaction(human, (unit) =>
    unit.distribution.requestReconciliation(created.publication.id),
  );
  expect(secondEvent.id).toBe(firstEvent.id);
  expect(
    await db.outboxEvent.count({
      where: {
        aggregateId: created.publication.id,
        eventType: 'Publication.reconcile.requested',
        status: { in: ['PENDING', 'DISPATCHING', 'DISPATCHED'] },
      },
    }),
  ).toBe(1);
  await expect(
    persistence.transaction(human, (unit) =>
      unit.distribution.reschedule(created.publication.id, new Date('2999-03-01T00:00:00Z')),
    ),
  ).rejects.toThrow('PUBLICATION_RESCHEDULE_NOT_SAFE');
});

it('marks platform accounts REAUTH_REQUIRED on explicit provider auth failure', async () => {
  const created = await automatedPublication();
  await new DistributionControl(db).dispatchDueOne(false);
  const job = await publishJobFor(created.publication.id);
  const fake = new FakePublisher('INSTAGRAM', {
    publishResults: [
      { responseClass: 'PERMANENT_FAILURE', failureCode: 'INSTAGRAM_AUTH_REQUIRED' },
    ],
  });
  const worker = new PublishWorkerOrchestrator(db, new StaticPublisherRegistry([fake]), {
    pauseAllPublishing: false,
    realProvidersEnabled: false,
  });
  await expect(worker.process(job)).resolves.toMatchObject({ kind: 'FAILED' });
  expect(
    await db.platformAccount.findUniqueOrThrow({ where: { id: created.account.id } }),
  ).toHaveProperty('status', 'REAUTH_REQUIRED');
});

it('refreshes account health through the provider boundary without exposing credentials', async () => {
  const created = await automatedPublication(new Date('2999-01-01T00:00:00Z'));
  await db.platformAccount.update({
    where: { id: created.account.id },
    data: { status: 'ERROR' },
  });
  const checkedAt = '2026-09-22T12:00:00.000Z';
  const fake = new FakePublisher('INSTAGRAM', {
    accountHealthResults: [
      {
        kind: 'ACTIVE',
        remoteAccountId: created.account.remoteAccountId,
        capabilities: { ...instagramCapabilities(), checkedAt, limitations: [] },
      },
    ],
  });
  const control = new PlatformAccountHealthControl(db, new StaticPublisherRegistry([fake]), {
    realProvidersEnabled: false,
  });
  await expect(control.refreshOne(created.account.id)).resolves.toMatchObject({ kind: 'CHECKED' });
  expect(
    await db.platformAccount.findUniqueOrThrow({ where: { id: created.account.id } }),
  ).toMatchObject({
    status: 'ACTIVE',
    capabilitiesJson: expect.objectContaining({ checkedAt }),
  });
  expect(fake.calls.filter((call) => call.kind === 'CHECK_ACCOUNT')).toHaveLength(1);
});

it('projects operator controls without leaking credential references or inventing unsafe retry actions', async () => {
  const created = await automatedPublication(new Date('2999-01-01T00:00:00Z'));
  await db.publication.update({
    where: { id: created.publication.id },
    data: { status: 'PUBLISHING_UNKNOWN' },
  });
  const service = new DistributionOperationsService(db, { realProvidersEnabled: false });
  const overview = await service.overview();
  const serialized = JSON.stringify(overview);
  expect(serialized).not.toContain('secret-ref://instagram-fixture');
  expect(overview.publications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        publicationId: created.publication.id,
        actions: { reconcile: true, reschedule: false, cancel: false },
      }),
    ]),
  );
});
