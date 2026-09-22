import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence } from '../../packages/database/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import {
  TikTokManualAnalyticsService,
  DashboardReadService,
} from '../../packages/application/src/index.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'phase8b-fixture' } as const;

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

async function publishedTikTok(publishedAt = new Date('2026-09-10T00:00:00Z')) {
  const roots = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({ name: 'phase8b', slug: randomUUID() });
    const brief = await unit.createBrief(campaign.id, 'phase8b');
    const briefVersion = await unit.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await unit.createConcept(brief.id);
    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: briefVersion.id,
      title: 'phase8b',
      creatorType: 'HUMAN',
    });
    await unit.submitConcept(conceptVersion.id);
    await unit.decideConcept(conceptVersion.id, 'APPROVED');
    const script = await unit.createScript(concept.id);
    const creativePlan = await unit.createCreativePlan(concept.id);
    const editingPlan = await unit.createEditingPlan(creativePlan.id);
    return { conceptVersion, script, creativePlan, editingPlan };
  });
  const template = await db.template.create({ data: { key: randomUUID(), name: 'phase8b' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'phase8b' } });
  const editingPlanVersion = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'phase8b-fixture',
      inputSchemaJson: {},
    });
    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profile.id,
    });
    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: roots.script.id,
      conceptVersionId: roots.conceptVersion.id,
      fullText: 'phase8b fixture',
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
    return unit.versions.editingPlanVersion({
      editingPlanId: roots.editingPlan.id,
      creativePlanVersionId: creativePlanVersion.id,
      templateVersionId: templateVersion.id,
      editingProfileVersionId: profileVersion.id,
      timelineJson: {},
    });
  });
  const render = await db.render.create({
    data: { editingPlanVersionId: editingPlanVersion.id, status: 'APPROVED' },
  });
  const account = await db.platformAccount.create({
    data: { platform: 'TIKTOK', displayName: 'Vision TikTok', remoteAccountId: randomUUID() },
  });
  const publication = await db.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'MANUAL_HANDOFF',
      status: 'PUBLISHED',
      publishedAt,
      remotePostId: `tiktok-${randomUUID()}`,
      remoteUrl: 'https://example.test/tiktok',
      metadataJson: {},
    },
  });
  return publication;
}

it('plans exactly the three required TikTok manual prompts without BullMQ outbox work', async () => {
  const publication = await publishedTikTok();
  const first = await persistence.transaction(human, (unit) =>
    unit.analytics.planPublication(publication.id),
  );
  expect(first.kind).toBe('MANUAL_PLANNED');
  const second = await persistence.transaction(human, (unit) =>
    unit.analytics.planPublication(publication.id),
  );
  expect(second.kind).toBe('EXISTING');
  const jobs = await db.jobAttempt.findMany({ orderBy: { jobType: 'asc' } });
  expect(jobs).toHaveLength(3);
  expect(jobs.every((job) => job.queueName === 'vce-analytics-manual')).toBe(true);
  expect(jobs.map((job) => job.jobType).sort()).toEqual(
    [
      'ANALYTICS_MANUAL:TIKTOK:T_PLUS_24H',
      'ANALYTICS_MANUAL:TIKTOK:T_PLUS_72H',
      'ANALYTICS_MANUAL:TIKTOK:T_PLUS_7D',
    ].sort(),
  );
  expect(
    await db.outboxEvent.count({
      where: { eventType: 'Analytics.collection.requested' },
    }),
  ).toBe(0);
});

it('stores exact manual evidence, preserves omitted fields as NULL and fences duplicate submission', async () => {
  const publication = await publishedTikTok();
  await persistence.transaction(human, (unit) => unit.analytics.planPublication(publication.id));
  const job = await db.jobAttempt.findFirstOrThrow({
    where: { jobType: 'ANALYTICS_MANUAL:TIKTOK:T_PLUS_24H' },
  });
  const first = await persistence.transaction(human, (unit) =>
    unit.analytics.completeManualTikTok(job.id, { views: 123, likes: 0 }),
  );
  expect(first.kind).toBe('COLLECTED');
  const raw = await db.metricSnapshotRaw.findFirstOrThrow();
  expect(raw.collectionMethod).toBe('MANUAL_ENTRY');
  expect(raw.payloadJson).toEqual({ views: 123, likes: 0 });
  const normalized = await db.metricSnapshotNormalized.findFirstOrThrow();
  expect(normalized.views).toBe(123n);
  expect(normalized.likes).toBe(0n);
  expect(normalized.comments).toBeNull();
  expect(normalized.availabilityJson).toMatchObject({ status: 'AVAILABLE' });
  const second = await persistence.transaction(human, (unit) =>
    unit.analytics.completeManualTikTok(job.id, { views: 999 }),
  );
  expect(second.kind).toBe('EXISTING');
  expect(await db.metricSnapshotRaw.count()).toBe(1);
  expect(await db.metricSnapshotNormalized.count()).toBe(1);
  expect(await db.auditEvent.count({ where: { action: 'Analytics.manualSnapshotEntered' } })).toBe(
    1,
  );
});

it('projects due/upcoming prompts and only materially overdue prompts into Needs Attention', async () => {
  const publication = await publishedTikTok(new Date('2026-09-10T00:00:00Z'));
  await persistence.transaction(human, (unit) => unit.analytics.planPublication(publication.id));
  const manual = new TikTokManualAnalyticsService(db);
  const overview = await manual.overview(new Date('2026-09-14T12:00:00Z'));
  expect(overview.summary).toEqual({ due: 0, overdue: 2, upcoming: 1, completed: 0 });
  const attention = await new DashboardReadService(db).attention();
  const manualAttention = attention.filter((item) => item.kind === 'ANALYTICS_MANUAL');
  expect(manualAttention).toHaveLength(3);
  expect(manualAttention.every((item) => item.targetRoute === '/analytics')).toBe(true);
});
