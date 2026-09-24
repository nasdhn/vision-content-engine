import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { UmamiImportService } from '../../packages/application/src/umami-import.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { Persistence } from '../../packages/database/src/index.js';
import type { createDatabaseClient } from '../../packages/database/src/index.js';
import { UmamiEventsClient } from '../../packages/analytics/src/umami.js';
import {
  EnvironmentSecretResolver,
  umamiCredentialResolver,
} from '../../packages/shared/src/secrets.js';
import { emit } from '../../packages/database/src/transaction.js';
import type { UmamiEventRow } from '../../packages/analytics/src/umami.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
const human = { actorType: 'USER', actorId: 'phase8f-fixture' } as const;

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

async function lineage() {
  const roots = await persistence.transaction(human, async (unit) => {
    const campaign = await unit.createCampaign({ name: 'phase8f', slug: randomUUID() });
    const brief = await unit.createBrief(campaign.id, 'phase8f');
    const briefVersion = await unit.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
    const concept = await unit.createConcept(brief.id);
    const conceptVersion = await unit.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: briefVersion.id,
      title: 'phase8f',
      creatorType: 'HUMAN',
    });
    await unit.submitConcept(conceptVersion.id);
    await unit.decideConcept(conceptVersion.id, 'APPROVED');
    const script = await unit.createScript(concept.id);
    const creativePlan = await unit.createCreativePlan(concept.id);
    const editingPlan = await unit.createEditingPlan(creativePlan.id);
    return { campaign, conceptVersion, script, creativePlan, editingPlan };
  });
  const template = await db.template.create({ data: { key: randomUUID(), name: 'phase8f' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'phase8f' } });
  const editingPlanVersion = await persistence.transaction(human, async (unit) => {
    const templateVersion = await unit.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'phase8f-fixture',
      inputSchemaJson: {},
    });
    const profileVersion = await unit.versions.editingProfileVersion({
      editingProfileId: profile.id,
    });
    const scriptVersion = await unit.versions.scriptVersion({
      scriptId: roots.script.id,
      conceptVersionId: roots.conceptVersion.id,
      fullText: 'phase8f fixture',
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
  return { campaign: roots.campaign, render };
}

async function published(
  platform: 'YOUTUBE' | 'INSTAGRAM' | 'TIKTOK',
  publishedAt: string,
  existing?: Awaited<ReturnType<typeof lineage>>,
) {
  const base = existing ?? (await lineage());
  const account = await db.platformAccount.create({
    data: { platform, displayName: `Vision ${platform}`, remoteAccountId: randomUUID() },
  });
  const publication = await db.publication.create({
    data: {
      renderId: base.render.id,
      platformAccountId: account.id,
      deliveryMode: platform === 'TIKTOK' ? 'MANUAL_HANDOFF' : 'API_AUTOMATED',
      status: 'PUBLISHED',
      publishedAt: new Date(publishedAt),
      remotePostId: `${platform.toLowerCase()}-${randomUUID()}`,
      remoteUrl: `https://example.test/${platform.toLowerCase()}`,
      metadataJson: {},
    },
  });
  return { ...base, publication };
}

function umamiEvent(overrides: Partial<UmamiEventRow> = {}): UmamiEventRow {
  return {
    id: randomUUID(),
    websiteId: randomUUID(),
    sessionId: randomUUID(),
    createdAt: '2026-09-22T18:00:00.000Z',
    urlPath: '/',
    urlQuery: '',
    referrerPath: '',
    referrerQuery: '',
    referrerDomain: '',
    pageTitle: 'Vision',
    eventType: 1,
    eventName: '',
    ...overrides,
  };
}

function client(rows: UmamiEventRow[]) {
  return {
    async fetchEvents() {
      return {
        providerSchemaVersion: 'umami-events-api-v1' as const,
        websiteId: rows[0]?.websiteId ?? randomUUID(),
        rows,
        rawPages: [],
        totalCount: rows.length,
      };
    },
  };
}

const window = {
  startAt: new Date('2026-09-22T00:00:00.000Z'),
  endAt: new Date('2026-09-23T00:00:00.000Z'),
};

it('imports a DIRECT Umami website visit from utm_content Publication.trackingCode', async () => {
  const { publication, campaign } = await published('YOUTUBE', '2026-09-22T17:00:00.000Z');
  const row = umamiEvent({
    urlQuery: `utm_source=youtube&utm_medium=organic_social&utm_campaign=vision&utm_content=${publication.trackingCode}`,
    referrerDomain: 'youtube.com',
  });
  const service = new UmamiImportService(db, client([row]));

  const summary = await service.importWindow(window);
  expect(summary).toMatchObject({
    fetched: 1,
    websiteVisitsImported: 1,
    direct: 1,
    inferred: 0,
    unknown: 0,
  });

  const stored = await db.attributionEvent.findFirstOrThrow();
  expect(stored).toMatchObject({
    sourceSystem: 'UMAMI',
    eventType: 'WEBSITE_VISIT',
    externalEventId: row.id,
    confidenceType: 'DIRECT',
    publicationId: publication.id,
    campaignId: campaign.id,
    externalVisitorId: row.sessionId,
    source: 'umami_utm_content_tracking_code',
  });
  expect(stored.metadataJson).toMatchObject({
    botExclusionApplied: false,
    countsAsWebsiteVisit: true,
    rawEvent: { id: row.id, urlQuery: row.urlQuery },
  });
});

it('keeps a platform visit UNKNOWN when inference is not explicitly enabled', async () => {
  await published('INSTAGRAM', '2026-09-22T17:50:00.000Z');
  const row = umamiEvent({ urlQuery: 'utm_source=instagram&utm_medium=organic_social' });
  const service = new UmamiImportService(db, client([row]));

  const summary = await service.importWindow(window);
  expect(summary).toMatchObject({ direct: 0, inferred: 0, unknown: 1 });
  expect(await db.attributionEvent.findFirstOrThrow()).toMatchObject({
    confidenceType: 'UNKNOWN',
    publicationId: null,
    source: 'umami_unknown',
  });
});

it('marks INFERRED only when an explicit temporal policy has exactly one platform candidate', async () => {
  const { publication, campaign } = await published('INSTAGRAM', '2026-09-22T17:50:00.000Z');
  const row = umamiEvent({
    urlQuery: 'utm_source=instagram&utm_medium=organic_social',
    referrerDomain: 'instagram.com',
  });
  const service = new UmamiImportService(db, client([row]), {
    enabled: true,
    maxAgeMinutes: 30,
  });

  const summary = await service.importWindow(window);
  expect(summary.inferred).toBe(1);
  expect(await db.attributionEvent.findFirstOrThrow()).toMatchObject({
    confidenceType: 'INFERRED',
    publicationId: publication.id,
    campaignId: campaign.id,
    source: 'umami_platform_temporal_inference',
  });
});

it('does not downgrade an unresolved explicit utm_content token into temporal inference', async () => {
  await published('YOUTUBE', '2026-09-22T17:50:00.000Z');
  const row = umamiEvent({
    urlQuery: `utm_source=youtube&utm_medium=organic_social&utm_content=${randomUUID()}`,
    referrerDomain: 'youtube.com',
  });
  const service = new UmamiImportService(db, client([row]), {
    enabled: true,
    maxAgeMinutes: 30,
  });

  const summary = await service.importWindow(window);
  expect(summary.unknown).toBe(1);
  expect(await db.attributionEvent.findFirstOrThrow()).toMatchObject({
    confidenceType: 'UNKNOWN',
    publicationId: null,
    source: 'umami_unknown',
  });
});

it('preserves UNKNOWN when temporal inference has multiple plausible publications', async () => {
  const base = await lineage();
  await published('INSTAGRAM', '2026-09-22T17:40:00.000Z', base);
  await published('INSTAGRAM', '2026-09-22T17:50:00.000Z', base);
  const row = umamiEvent({ urlQuery: 'utm_source=instagram&utm_medium=organic_social' });
  const service = new UmamiImportService(db, client([row]), {
    enabled: true,
    maxAgeMinutes: 30,
  });

  const summary = await service.importWindow(window);
  expect(summary.unknown).toBe(1);
  expect(await db.attributionEvent.findFirstOrThrow()).toMatchObject({
    confidenceType: 'UNKNOWN',
    publicationId: null,
    campaignId: null,
  });
});

it('uses source-event idempotence and never duplicates a website visit', async () => {
  const row = umamiEvent();
  const service = new UmamiImportService(db, client([row]));
  const first = await service.importWindow(window);
  const second = await service.importWindow(window);

  expect(first.websiteVisitsImported).toBe(1);
  expect(second.websiteVisitsExisting).toBe(1);
  expect(await db.attributionEvent.count({ where: { sourceSystem: 'UMAMI' } })).toBe(1);
});

it('preserves custom Umami events as marketing observations without counting them as website visits or excluding suspicious traffic', async () => {
  const row = umamiEvent({
    eventName: 'pricing-cta-click',
    referrerDomain: 'datacenter-looking.example',
    urlQuery: 'utm_source=linkedin&utm_campaign=vision',
  });
  const service = new UmamiImportService(db, client([row]));

  const first = await service.importWindow(window);
  const second = await service.importWindow(window);
  expect(first).toMatchObject({
    marketingObservationsImported: 1,
    websiteVisitsImported: 0,
  });
  expect(second.marketingObservationsExisting).toBe(1);
  expect(await db.attributionEvent.count()).toBe(0);

  const audit = await db.auditEvent.findFirstOrThrow({
    where: { action: 'Analytics.umamiMarketingObservationImported' },
  });
  expect(audit.subjectId).toBe(row.id);
  expect(audit.metadataJson).toMatchObject({
    botExclusionApplied: false,
    rawEvent: {
      eventName: 'pricing-cta-click',
      referrerDomain: 'datacenter-looking.example',
    },
  });
  expect(
    await db.auditEvent.count({
      where: { action: 'Analytics.umamiMarketingObservationImported', subjectId: row.id },
    }),
  ).toBe(1);
});

it('resolves analytics credentials at the HTTP boundary and keeps persisted events, audits and Outbox secret-free', async () => {
  const sentinel = ['VERY', 'FAKE', 'ANALYTICS', 'DO_NOT_USE'].join('_');
  const rows = [umamiEvent(), umamiEvent({ eventName: 'pricing-cta-click' })];
  let calls = 0;
  const secrets = new EnvironmentSecretResolver({ UMAMI_BEARER_TOKEN: sentinel }, [
    'UMAMI_BEARER_TOKEN',
  ]);
  const source = new UmamiEventsClient(
    umamiCredentialResolver(secrets, 'https://stats.example.test/api', rows[0]!.websiteId),
    {
      fetchImpl: async (url, options) => {
        calls++;
        expect(new Headers(options?.headers).get('authorization')).toBe(`Bearer ${sentinel}`);
        expect(String(url)).not.toContain(sentinel);
        return Response.json({ data: rows, count: 2, page: 1, pageSize: 500 });
      },
    },
  );
  const service = new UmamiImportService(db, source);
  expect(calls).toBe(0);
  const summary = await service.importWindow(window);
  expect(calls).toBe(1);
  expect(summary).toMatchObject({ websiteVisitsImported: 1, marketingObservationsImported: 1 });
  const events = await db.attributionEvent.findMany();
  const audits = await db.auditEvent.findMany();
  expect(events.length).toBeGreaterThan(0);
  expect(audits.length).toBeGreaterThan(0);
  await db.$transaction((tx) =>
    emit(tx, {
      eventType: 'Analytics.imported',
      aggregateType: 'AttributionEvent',
      aggregateId: events[0]!.id,
      payloadJson: { id: events[0]!.id },
    }),
  );
  const outbox = await db.outboxEvent.findMany();
  expect(outbox.length).toBeGreaterThan(0);
  for (const value of [summary, events, audits, outbox])
    expect(JSON.stringify(value)).not.toContain(sentinel);
  await expect(
    db.$transaction((tx) =>
      emit(tx, {
        eventType: 'Analytics.imported',
        aggregateType: 'AttributionEvent',
        aggregateId: events[0]!.id,
        payloadJson: { accessToken: sentinel },
      }),
    ),
  ).rejects.toThrow('SECRET_IN_CONTEXT');
  const count = await db.attributionEvent.count();
  await expect(
    new UmamiImportService(
      db,
      client([umamiEvent({ cookies: [{ value: sentinel }] })]),
    ).importWindow(window),
  ).rejects.toThrow('SECRET_IN_CONTEXT');
  expect(await db.attributionEvent.count()).toBe(count);
  expect(await db.outboxEvent.count()).toBe(outbox.length);
});
