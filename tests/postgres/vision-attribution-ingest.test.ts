import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence } from '../../packages/database/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import {
  VisionAttributionIngestService,
  signVisionAttributionRequest,
} from '../../packages/application/src/vision-attribution-ingest.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'phase8e-fixture' } as const;
const secret = 'b'.repeat(64);
const now = new Date('2026-09-22T18:00:00.000Z');
const timestamp = String(Math.floor(now.getTime() / 1_000));

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

async function publishedInstagram() {
  const roots = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({ name: 'phase8e', slug: randomUUID() });
    const brief = await unit.createBrief(campaign.id, 'phase8e');
    const briefVersion = await unit.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await unit.createConcept(brief.id);
    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: briefVersion.id,
      title: 'phase8e',
      creatorType: 'HUMAN',
    });
    await unit.submitConcept(conceptVersion.id);
    await unit.decideConcept(conceptVersion.id, 'APPROVED');
    const script = await unit.createScript(concept.id);
    const creativePlan = await unit.createCreativePlan(concept.id);
    const editingPlan = await unit.createEditingPlan(creativePlan.id);
    return { campaign, conceptVersion, script, creativePlan, editingPlan };
  });
  const template = await db.template.create({ data: { key: randomUUID(), name: 'phase8e' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'phase8e' } });
  const editingPlanVersion = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'phase8e-fixture',
      inputSchemaJson: {},
    });
    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profile.id,
    });
    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: roots.script.id,
      conceptVersionId: roots.conceptVersion.id,
      fullText: 'phase8e fixture',
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
    data: { platform: 'INSTAGRAM', displayName: 'Vision Instagram', remoteAccountId: randomUUID() },
  });
  const publication = await db.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'API_AUTOMATED',
      status: 'PUBLISHED',
      publishedAt: new Date('2026-09-20T12:00:00Z'),
      remotePostId: `instagram-${randomUUID()}`,
      remoteUrl: 'https://example.test/instagram',
      metadataJson: {},
    },
  });
  return { publication, campaign: roots.campaign };
}

function signed(event: Record<string, unknown>) {
  const raw = Buffer.from(JSON.stringify(event), 'utf8');
  return {
    raw,
    headers: {
      timestamp,
      signature: signVisionAttributionRequest(secret, timestamp, raw),
    },
  };
}

it('stores a DIRECT Vision event from Publication.trackingCode and derives campaign lineage', async () => {
  const { publication, campaign } = await publishedInstagram();
  const service = new VisionAttributionIngestService(db, { secret, now: () => now });
  const request = signed({
    externalEventId: 'vision-signup-1',
    eventType: 'SIGNUP',
    occurredAt: '2026-09-22T17:59:00.000Z',
    userId: 'user_opaque_123',
    trackingCode: publication.trackingCode,
    metadata: { plan: 'free' },
  });

  const result = await service.ingest(request.raw, request.headers);
  expect(result).toMatchObject({
    kind: 'INGESTED',
    confidenceType: 'DIRECT',
    publicationId: publication.id,
    campaignId: campaign.id,
  });
  const stored = await db.attributionEvent.findFirstOrThrow();
  expect(stored.sourceSystem).toBe('VISION_APP');
  expect(stored.source).toBe('publication_tracking_code');
  expect(stored.externalEventId).toBe('vision-signup-1');
  expect(stored.userId).toBe('user_opaque_123');
  expect(stored.metadataJson).toEqual({ plan: 'free' });
  expect(
    await db.auditEvent.count({ where: { action: 'Analytics.visionAttributionIngested' } }),
  ).toBe(1);
});

it('rejects a signed replay by externalEventId and never duplicates evidence', async () => {
  const { publication } = await publishedInstagram();
  const service = new VisionAttributionIngestService(db, { secret, now: () => now });
  const request = signed({
    externalEventId: 'vision-replay-1',
    eventType: 'ACTIVATION',
    occurredAt: '2026-09-22T17:59:00.000Z',
    trackingCode: publication.trackingCode,
  });
  await service.ingest(request.raw, request.headers);
  await expect(service.ingest(request.raw, request.headers)).rejects.toThrow(
    'VISION_ATTRIBUTION_REPLAY',
  );
  expect(await db.attributionEvent.count()).toBe(1);
});

it('stores typed REVENUE without inventing publication attribution when no tracking code exists', async () => {
  const service = new VisionAttributionIngestService(db, { secret, now: () => now });
  const request = signed({
    externalEventId: 'vision-revenue-1',
    eventType: 'REVENUE',
    occurredAt: '2026-09-22T17:58:00.000Z',
    userId: 'user_opaque_456',
    valueAmountMinor: 3900,
    valueCurrency: 'EUR',
    campaignTrackingCode: 'opaque-campaign-code',
  });
  const result = await service.ingest(request.raw, request.headers);
  expect(result).toMatchObject({
    confidenceType: 'UNKNOWN',
    publicationId: null,
    campaignId: null,
  });
  const stored = await db.attributionEvent.findFirstOrThrow();
  expect(stored.valueAmountMinor).toBe(3900n);
  expect(stored.valueCurrency).toBe('EUR');
  expect(stored.metadataJson).toEqual({ campaignTrackingCode: 'opaque-campaign-code' });
});

it('fails closed on an unknown explicit Publication trackingCode', async () => {
  const service = new VisionAttributionIngestService(db, { secret, now: () => now });
  const request = signed({
    externalEventId: 'vision-bad-tracking-1',
    eventType: 'CUSTOMER',
    occurredAt: '2026-09-22T17:58:00.000Z',
    trackingCode: randomUUID(),
  });
  await expect(service.ingest(request.raw, request.headers)).rejects.toThrow(
    'VISION_ATTRIBUTION_TRACKING_CODE_NOT_FOUND',
  );
  expect(await db.attributionEvent.count()).toBe(0);
});

it('does not create evidence when HMAC authentication fails', async () => {
  const service = new VisionAttributionIngestService(db, { secret, now: () => now });
  const raw = Buffer.from(
    JSON.stringify({
      externalEventId: 'vision-auth-fail-1',
      eventType: 'SIGNUP',
      occurredAt: '2026-09-22T17:58:00.000Z',
    }),
  );
  await expect(
    service.ingest(raw, { timestamp, signature: `v1=${'0'.repeat(64)}` }),
  ).rejects.toThrow('VISION_ATTRIBUTION_AUTH_FAILED');
  expect(await db.attributionEvent.count()).toBe(0);
});
