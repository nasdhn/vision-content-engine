import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence } from '../../packages/database/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { AnalyticsControl, AnalyticsOutboxDispatcher } from '../../apps/control/src/index.js';
import { AnalyticsWorkerOrchestrator } from '../../apps/worker-analytics/src/index.js';
import {
  EMPTY_CANONICAL_METRICS,
  FakeAnalyticsCollector,
  StaticAnalyticsCollectorRegistry,
} from '../../packages/analytics/src/index.js';
import type { AnalyticsCollectionJob } from '../../packages/analytics/src/index.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'phase8-fixture' } as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  persistence = new Persistence(db);
});

afterAll(async () => fixture?.close());

beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')}`,
  );
});

async function publishedYoutube() {
  const roots = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({ name: 'phase8', slug: randomUUID() });
    const brief = await unit.createBrief(campaign.id, 'phase8');
    const briefVersion = await unit.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await unit.createConcept(brief.id);
    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: briefVersion.id,
      title: 'phase8',
      creatorType: 'HUMAN',
    });
    await unit.submitConcept(conceptVersion.id);
    await unit.decideConcept(conceptVersion.id, 'APPROVED');
    const script = await unit.createScript(concept.id);
    const creativePlan = await unit.createCreativePlan(concept.id);
    const editingPlan = await unit.createEditingPlan(creativePlan.id);
    return { conceptVersion, script, creativePlan, editingPlan };
  });
  const template = await db.template.create({ data: { key: randomUUID(), name: 'phase8' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'phase8' } });
  const lineage = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'phase8-fixture',
      inputSchemaJson: {},
    });
    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profile.id,
    });
    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: roots.script.id,
      conceptVersionId: roots.conceptVersion.id,
      fullText: 'phase8 fixture',
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
    return editingPlanVersion;
  });
  const render = await db.render.create({
    data: { editingPlanVersionId: lineage.id, status: 'APPROVED' },
  });
  const account = await db.platformAccount.create({
    data: {
      platform: 'YOUTUBE',
      displayName: 'Vision YouTube',
      remoteAccountId: randomUUID(),
      credentialsRef: 'secret-ref://youtube-fixture',
    },
  });
  const publication = await db.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'API_AUTOMATED',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-09-01T00:00:00Z'),
      remotePostId: `video-${randomUUID()}`,
      remoteUrl: 'https://youtube.test/short',
      metadataJson: {},
    },
  });
  return { publication, account };
}

it('plans six immutable collection intents once from publishedAt', async () => {
  const { publication } = await publishedYoutube();
  const control = new AnalyticsControl(db);
  const first = await control.planPublication(publication.id);
  expect(first.kind).toBe('PLANNED');
  const second = await control.planPublication(publication.id);
  expect(second.kind).toBe('EXISTING');
  expect(await db.workflowRun.count({ where: { workflowType: 'ANALYTICS' } })).toBe(1);
  expect(await db.jobAttempt.count({ where: { queueName: 'vce-analytics' } })).toBe(6);
  const events = await db.outboxEvent.findMany({
    where: { eventType: 'Analytics.collection.requested' },
    orderBy: { availableAt: 'asc' },
  });
  expect(events).toHaveLength(6);
  expect(events[0]?.availableAt).toEqual(new Date('2026-09-01T01:00:00Z'));
  expect(events[5]?.availableAt).toEqual(new Date('2026-10-01T00:00:00Z'));
});

it('dispatches a secret-free job and duplicate worker delivery cannot duplicate raw evidence', async () => {
  const { publication } = await publishedYoutube();
  await new AnalyticsControl(db).planPublication(publication.id);
  const jobs: AnalyticsCollectionJob[] = [];
  const dispatcher = new AnalyticsOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    'phase8-dispatcher',
  );
  const dispatched = await dispatcher.dispatchOne();
  expect(dispatched.kind).toBe('DISPATCHED');
  expect(jobs).toHaveLength(1);
  expect(JSON.stringify(jobs[0])).not.toMatch(/token|credential|secret/i);

  const observation = {
    collectedAt: '2026-09-01T01:00:05.000Z',
    providerSchemaVersion: 'fake-youtube-v1',
    rawPayload: { rows: [{ views: 0 }] },
    metrics: { ...EMPTY_CANONICAL_METRICS, views: 0n },
    otherMetrics: null,
    availability: { status: 'AVAILABLE' as const, unavailableMetrics: [], notes: [] },
    comparability: { crossPlatformViewsComparable: false, notes: ['fixture'] },
    normalizerVersion: 'fake-youtube-normalizer-v1',
    metricSemanticsVersion: 'canonical-metrics-v1',
  };
  const fake = new FakeAnalyticsCollector('YOUTUBE', observation);
  const worker = new AnalyticsWorkerOrchestrator(db, new StaticAnalyticsCollectorRegistry([fake]), {
    realProvidersEnabled: false,
  });
  const first = await worker.process(jobs[0]);
  expect(first.kind).toBe('COLLECTED');
  const second = await worker.process(jobs[0]);
  expect(second.kind).toBe('ALREADY_DONE');
  expect(fake.callCount()).toBe(1);
  expect(await db.metricSnapshotRaw.count()).toBe(1);
  expect(await db.metricSnapshotNormalized.count()).toBe(1);
  const raw = await db.metricSnapshotRaw.findFirstOrThrow();
  expect(raw.payloadJson).toEqual({ rows: [{ views: 0 }] });
  const normalized = await db.metricSnapshotNormalized.findFirstOrThrow();
  expect(normalized.views).toBe(0n);
  expect(normalized.likes).toBeNull();
});

it('stores a valid not-yet-available observation as NULL rather than fabricated zero', async () => {
  const { publication } = await publishedYoutube();
  await new AnalyticsControl(db).planPublication(publication.id);
  const event = await db.outboxEvent.findFirstOrThrow({
    where: { eventType: 'Analytics.collection.requested' },
    orderBy: { availableAt: 'asc' },
  });
  const jobs: AnalyticsCollectionJob[] = [];
  const dispatcher = new AnalyticsOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    'phase8-delay',
  );
  await dispatcher.dispatchOne();
  const fake = new FakeAnalyticsCollector('YOUTUBE', {
    collectedAt: event.availableAt.toISOString(),
    providerSchemaVersion: 'fake-youtube-v1',
    rawPayload: { dataAvailable: false },
    metrics: EMPTY_CANONICAL_METRICS,
    otherMetrics: null,
    availability: {
      status: 'NOT_YET_AVAILABLE',
      unavailableMetrics: ['views'],
      notes: ['provider delay'],
    },
    comparability: { crossPlatformViewsComparable: false, notes: [] },
    normalizerVersion: 'fake-youtube-normalizer-v1',
    metricSemanticsVersion: 'canonical-metrics-v1',
  });
  await new AnalyticsWorkerOrchestrator(db, new StaticAnalyticsCollectorRegistry([fake]), {
    realProvidersEnabled: false,
  }).process(jobs[0]);
  const normalized = await db.metricSnapshotNormalized.findFirstOrThrow();
  expect(normalized.views).toBeNull();
  expect(normalized.availabilityJson).toMatchObject({ status: 'NOT_YET_AVAILABLE' });
});

it('fails closed before a real analytics provider can run', async () => {
  const { publication } = await publishedYoutube();
  await new AnalyticsControl(db).planPublication(publication.id);
  const jobs: AnalyticsCollectionJob[] = [];
  const dispatcher = new AnalyticsOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    {
      enqueue: async (job) => {
        jobs.push(job);
      },
    },
    'phase8-real-provider-gate',
  );
  await dispatcher.dispatchOne();
  let called = false;
  const realCollector = {
    platform: 'YOUTUBE' as const,
    isRealProvider: true,
    collect: async () => {
      called = true;
      throw new Error('SHOULD_NOT_RUN');
    },
  };
  const worker = new AnalyticsWorkerOrchestrator(
    db,
    new StaticAnalyticsCollectorRegistry([realCollector]),
    { realProvidersEnabled: false },
  );
  await expect(worker.process(jobs[0])).rejects.toThrow('REAL_ANALYTICS_PROVIDERS_DISABLED');
  expect(called).toBe(false);
  expect(await db.metricSnapshotRaw.count()).toBe(0);
  const untouchedJob = await db.jobAttempt.findUniqueOrThrow({
    where: { id: jobs[0]!.jobAttemptId },
  });
  expect(untouchedJob.status).toBe('QUEUED');
  expect(untouchedJob.leaseToken).toBeNull();
});

it('allows only one concurrent analytics owner to reach the provider', async () => {
  const { publication } = await publishedYoutube();
  await new AnalyticsControl(db).planPublication(publication.id);
  const jobs: AnalyticsCollectionJob[] = [];
  await new AnalyticsOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    { enqueue: async (job) => void jobs.push(job) },
    'phase10g-analytics-concurrency',
  ).dispatchOne();

  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => (started = resolve));
  const barrier = new Promise<void>((resolve) => (release = resolve));
  let calls = 0;
  const collector = {
    platform: 'YOUTUBE' as const,
    isRealProvider: false,
    async collect() {
      calls += 1;
      started();
      await barrier;
      return {
        collectedAt: '2026-09-01T01:00:05.000Z',
        providerSchemaVersion: 'phase10g-v1',
        rawPayload: { views: 1 },
        metrics: { ...EMPTY_CANONICAL_METRICS, views: 1n },
        otherMetrics: null,
        availability: { status: 'AVAILABLE' as const, unavailableMetrics: [], notes: [] },
        comparability: { crossPlatformViewsComparable: false, notes: [] },
        normalizerVersion: 'phase10g-v1',
        metricSemanticsVersion: 'canonical-metrics-v1',
      };
    },
  };
  const registry = new StaticAnalyticsCollectorRegistry([collector]);
  const firstWorker = new AnalyticsWorkerOrchestrator(db, registry, {
    realProvidersEnabled: false,
    workerId: 'phase10g-analytics-one',
    leaseConfig: { durationMs: 60_000, heartbeatIntervalMs: 30_000 },
  });
  const secondWorker = new AnalyticsWorkerOrchestrator(db, registry, {
    realProvidersEnabled: false,
    workerId: 'phase10g-analytics-two',
    leaseConfig: { durationMs: 60_000, heartbeatIntervalMs: 30_000 },
  });
  const first = firstWorker.process(jobs[0]);
  await entered;
  await expect(secondWorker.process(jobs[0])).resolves.toMatchObject({ kind: 'BUSY' });
  expect(calls).toBe(1);
  release();
  await expect(first).resolves.toMatchObject({ kind: 'COLLECTED' });
});

it('reclaims an expired analytics lease and fences the stale owner from persistence', async () => {
  const { publication } = await publishedYoutube();
  await new AnalyticsControl(db).planPublication(publication.id);
  const jobs: AnalyticsCollectionJob[] = [];
  await new AnalyticsOutboxDispatcher(
    db,
    { durationMs: 60_000, heartbeatIntervalMs: 10_000 },
    { enqueue: async (job) => void jobs.push(job) },
    'phase10g-analytics-recovery',
  ).dispatchOne();

  let releaseFirst!: () => void;
  let firstStarted!: () => void;
  const entered = new Promise<void>((resolve) => (firstStarted = resolve));
  const firstBarrier = new Promise<void>((resolve) => (releaseFirst = resolve));
  let calls = 0;
  const collector = {
    platform: 'YOUTUBE' as const,
    isRealProvider: false,
    async collect() {
      calls += 1;
      if (calls === 1) {
        firstStarted();
        await firstBarrier;
      }
      return {
        collectedAt: '2026-09-01T01:00:05.000Z',
        providerSchemaVersion: 'phase10g-v1',
        rawPayload: { views: calls },
        metrics: { ...EMPTY_CANONICAL_METRICS, views: BigInt(calls) },
        otherMetrics: null,
        availability: { status: 'AVAILABLE' as const, unavailableMetrics: [], notes: [] },
        comparability: { crossPlatformViewsComparable: false, notes: [] },
        normalizerVersion: 'phase10g-v1',
        metricSemanticsVersion: 'canonical-metrics-v1',
      };
    },
  };
  const registry = new StaticAnalyticsCollectorRegistry([collector]);
  const firstWorker = new AnalyticsWorkerOrchestrator(db, registry, {
    realProvidersEnabled: false,
    workerId: 'phase10g-stale-one',
    leaseConfig: { durationMs: 60_000, heartbeatIntervalMs: 30_000 },
  });
  const secondWorker = new AnalyticsWorkerOrchestrator(db, registry, {
    realProvidersEnabled: false,
    workerId: 'phase10g-stale-two',
    leaseConfig: { durationMs: 60_000, heartbeatIntervalMs: 30_000 },
  });

  const first = firstWorker.process(jobs[0]);
  await entered;
  await db.$executeRaw`
    UPDATE "JobAttempt"
    SET "leaseAcquiredAt"='2000-01-01T00:00:00Z',
        "heartbeatAt"='2000-01-01T00:00:01Z',
        "leaseExpiresAt"='2000-01-01T00:00:02Z'
    WHERE "id"=${jobs[0]!.jobAttemptId}::uuid
  `;
  await expect(secondWorker.process(jobs[0])).resolves.toMatchObject({ kind: 'COLLECTED' });
  releaseFirst();
  await expect(first).rejects.toThrow('STALE_LEASE');
  expect(calls).toBe(2);
  expect(await db.metricSnapshotRaw.count()).toBe(1);
  expect(await db.metricSnapshotNormalized.count()).toBe(1);
});
