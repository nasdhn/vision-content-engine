import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { postgresFixture } from '../../packages/database/test/support.js';
import {
  Persistence,
  Leases,
  outboxDelivery,
  createDatabaseClient,
} from '../../packages/database/src/index.js';
import { lock } from '../../packages/database/src/transaction.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let db: ReturnType<typeof createDatabaseClient>;
let second: ReturnType<typeof createDatabaseClient>;
let persistence: Persistence;
let leases: Leases;
const human = { actorType: 'USER', actorId: 'fixture-reviewer' } as const;
const config = { durationMs: 60000, heartbeatIntervalMs: 10000 };
beforeAll(async () => {
  fixture = await postgresFixture();
  db = fixture.client;
  second = createDatabaseClient(fixture.url);
  persistence = new Persistence(db);
  leases = new Leases(db, config, { PURE: 'SAFE_RETRY', PUBLISH: 'RECONCILE' });
});
afterAll(async () => {
  await second?.$disconnect();
  await fixture?.close();
});
beforeEach(async () => {
  const tables = await db.$queryRaw<
    { tablename: string }[]
  >`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  // The fixture owns this isolated disposable DB. Application tables are never truncated.
  await db.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')}`);
});
async function base(approve = true) {
  return persistence.transaction(human, async (u) => {
    const campaign = await u.createCampaign({ name: 'fixture', slug: randomUUID() });
    const brief = await u.createBrief(campaign.id, 'fixture');
    const bv = await u.versions.briefVersion({
      briefId: brief.id,
      payloadJson: { original: true },
    });
    const concept = await u.createConcept(brief.id);
    const cv = await u.versions.conceptVersion({
      conceptId: concept.id,
      briefVersionId: bv.id,
      title: 'fixture',
      creatorType: 'HUMAN',
    });
    const script = await u.createScript(concept.id);
    const creative = await u.createCreativePlan(concept.id);
    const editing = await u.createEditingPlan(creative.id);
    if (approve) {
      await u.submitConcept(cv.id);
      await u.decideConcept(cv.id, 'APPROVED');
    }
    return { campaign, brief, bv, concept, cv, script, creative, editing };
  });
}
async function content() {
  const b = await base();
  const template = await db.template.create({ data: { key: randomUUID(), name: 'fixture' } });
  const profile = await db.editingProfile.create({ data: { key: randomUUID(), name: 'fixture' } });
  return persistence.transaction(human, async (u) => {
    const tv = await u.versions.templateVersion({
      templateId: template.id,
      rendererVersion: 'fixture-only',
      inputSchemaJson: {},
    });
    const pv = await u.versions.editingProfileVersion({ editingProfileId: profile.id });
    const sv = await u.versions.scriptVersion({
      scriptId: b.script.id,
      conceptVersionId: b.cv.id,
      fullText: 'fixture',
      createdByType: 'HUMAN',
    });
    const cpv = await u.versions.creativePlanVersion({
      creativePlanId: b.creative.id,
      scriptVersionId: sv.id,
      primaryFormat: 'fixture',
      templateVersionId: tv.id,
      editingProfileVersionId: pv.id,
      scenePlanJson: {},
    });
    const epv = await u.versions.editingPlanVersion({
      editingPlanId: b.editing.id,
      creativePlanVersionId: cpv.id,
      templateVersionId: tv.id,
      editingProfileVersionId: pv.id,
      timelineJson: {},
    });
    const render = await u.requestRender(epv.id);
    return { ...b, tv, pv, sv, cpv, epv, render };
  });
}
async function asset() {
  return db.asset.create({
    data: {
      kind: 'VIDEO',
      sourceType: 'RENDER',
      storageProvider: 'fixture',
      bucket: 'fixture',
      objectKey: randomUUID(),
      status: 'READY',
    },
  });
}
async function reviewedRender() {
  const c = await content();
  const output = await asset();
  await db.renderAttempt.create({
    data: {
      renderId: c.render.id,
      attemptNumber: 1,
      status: 'SUCCEEDED',
      outputAssetId: output.id,
      technicalQaJson: { fixture: true },
      creativeQaResult: 'PASS',
    },
  });
  await persistence.transaction(human, async (u) => {
    await u.transitionRender(c.render.id, 'REQUESTED', 'QUEUED');
    await u.transitionRender(c.render.id, 'QUEUED', 'RENDERING');
    await u.transitionRender(c.render.id, 'RENDERING', 'TECHNICAL_QA');
    await u.transitionRender(c.render.id, 'TECHNICAL_QA', 'CREATIVE_QA');
    await u.transitionRender(c.render.id, 'CREATIVE_QA', 'READY_FOR_REVIEW');
  });
  return { ...c, output };
}
async function job(jobType = 'PURE', queueName = 'fixture') {
  return persistence.transaction(human, (u) =>
    u.enqueueJob({ queueName, jobType, operationId: randomUUID(), attemptNumber: 1 }),
  );
}
async function expireJob(id: string) {
  await db.$executeRaw`UPDATE "JobAttempt" SET "leaseAcquiredAt" = '2000-01-01T00:00:00Z', "heartbeatAt" = '2000-01-01T00:00:01Z', "leaseExpiresAt" = '2000-01-01T00:00:02Z' WHERE "id" = ${id}::uuid`;
}
async function expireOutbox(id: string) {
  await db.$executeRaw`UPDATE "OutboxEvent" SET "claimedAt" = '2000-01-01T00:00:00Z', "claimHeartbeatAt" = '2000-01-01T00:00:01Z', "claimExpiresAt" = '2000-01-01T00:00:02Z' WHERE "id" = ${id}::uuid`;
}

it('deploys the reviewed migration once with exact catalog constraints and UTC types', async () => {
  fixture.migrate();
  const migrations = await db.$queryRaw<
    {
      migration_name: string;
      checksum: string;
    }[]
  >`
    SELECT migration_name, checksum
    FROM _prisma_migrations
    WHERE finished_at IS NOT NULL
    ORDER BY migration_name
  `;

  expect(migrations.map((migration) => migration.migration_name)).toEqual([
    '20260919000000_initial_canonical',
    '20260921120000_phase5_editing_plan_spec',
  ]);

  for (const migration of migrations) {
    const sql = await readFile(`prisma/migrations/${migration.migration_name}/migration.sql`);

    expect(migration.checksum).toBe(createHash('sha256').update(sql).digest('hex'));
  }

  const [planSpecColumn] = await db.$queryRaw<
    {
      data_type: string;
      is_nullable: string;
    }[]
  >`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'EditingPlanVersion'
        AND column_name = 'planSpecJson'
    `;

  expect(planSpecColumn).toEqual({
    data_type: 'jsonb',
    is_nullable: 'YES',
  });
  const [catalog] = await db.$queryRaw<
    {
      tables: number;
      enums: number;
      fk: number;
      checks: number;
      indexes: number;
      temporal: number;
      wrong: number;
    }[]
  >`
    SELECT (SELECT count(*)::int FROM pg_tables WHERE schemaname='public' AND tablename <> '_prisma_migrations') AS tables,
    (SELECT count(*)::int FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype='e') AS enums,
    (SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='f') AS fk,
    (SELECT count(*)::int FROM pg_constraint WHERE connamespace='public'::regnamespace AND contype='c') AS checks,
    (SELECT count(*)::int FROM pg_indexes WHERE schemaname='public' AND tablename <> '_prisma_migrations') AS indexes,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND table_name <> '_prisma_migrations' AND data_type='timestamp with time zone' AND datetime_precision=3) AS temporal,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema='public' AND data_type='timestamp without time zone') AS wrong`;
  expect(catalog).toEqual({
    tables: 50,
    enums: 49,
    fk: 72,
    checks: 6,
    indexes: 157,
    temporal: 103,
    wrong: 0,
  });
  expect(await db.$queryRaw`SHOW TimeZone`).toEqual([{ TimeZone: 'UTC' }]);
});

it('enforces every Approval subject/nullability combination in PostgreSQL', async () => {
  const c = await content();
  for (const subjectType of ['CONCEPT', 'RENDER'] as const) {
    for (const conceptVersionId of [null, c.cv.id])
      for (const renderId of [null, c.render.id]) {
        const query = db.approval.create({
          data: {
            subjectType,
            conceptVersionId,
            renderId,
            decision: 'APPROVED',
            actorType: 'USER',
            actorId: 'fixture',
          },
        });
        if (
          (subjectType === 'CONCEPT' && conceptVersionId && !renderId) ||
          (subjectType === 'RENDER' && renderId && !conceptVersionId)
        )
          await expect(query).resolves.toHaveProperty('id');
        else await expect(query).rejects.toThrow();
      }
  }
});
it('enforces one ACTIVE knowledge snapshot per key with other historical statuses retained', async () => {
  const input = {
    key: 'fixture',
    contentHash: 'a',
    effectiveAt: new Date('2026-01-01T00:00:00Z'),
    payloadJson: {},
  };
  await db.knowledgeSnapshot.create({ data: { ...input, version: 1, status: 'ACTIVE' } });
  await expect(
    db.knowledgeSnapshot.create({
      data: { ...input, contentHash: 'b', version: 2, status: 'ACTIVE' },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await expect(
    db.knowledgeSnapshot.create({
      data: { ...input, contentHash: 'c', version: 3, status: 'DEPRECATED' },
    }),
  ).resolves.toHaveProperty('id');
});
it('enforces REVENUE completeness and attribution source/event idempotence', async () => {
  const data = {
    sourceSystem: 'MANUAL' as const,
    confidenceType: 'DIRECT' as const,
    eventType: 'REVENUE' as const,
    occurredAt: new Date('2026-01-01T00:00:00Z'),
  };
  for (const values of [{}, { valueAmountMinor: 0n }, { valueCurrency: 'EUR' }])
    await expect(
      db.attributionEvent.create({ data: { ...data, ...values, externalEventId: randomUUID() } }),
    ).rejects.toThrow();
  const row = await db.attributionEvent.create({
    data: { ...data, externalEventId: 'fixture', valueAmountMinor: 0n, valueCurrency: 'EUR' },
  });
  expect(row.valueAmountMinor).toBe(0n);
  await expect(
    db.attributionEvent.create({
      data: { ...data, externalEventId: 'fixture', valueAmountMinor: 1n, valueCurrency: 'EUR' },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await expect(
    db.attributionEvent.create({
      data: { ...data, eventType: 'SIGNUP', externalEventId: 'signup' },
    }),
  ).resolves.toHaveProperty('id');
});
it('enforces active lease fields and ordering while retaining optional terminal metadata', async () => {
  const j = await job();
  const token = randomUUID();
  const complete = {
    status: 'RUNNING' as const,
    workerId: 'fixture',
    leaseToken: token,
    leaseAcquiredAt: new Date('2026-01-01T00:00:00Z'),
    heartbeatAt: new Date('2026-01-01T00:00:00Z'),
    leaseExpiresAt: new Date('2026-01-01T00:01:00Z'),
  };
  for (const field of [
    'workerId',
    'leaseToken',
    'leaseAcquiredAt',
    'heartbeatAt',
    'leaseExpiresAt',
  ])
    await expect(
      db.jobAttempt.update({ where: { id: j.id }, data: { ...complete, [field]: null } }),
    ).rejects.toThrow();
  await expect(
    db.jobAttempt.update({
      where: { id: j.id },
      data: { ...complete, leaseExpiresAt: complete.leaseAcquiredAt },
    }),
  ).rejects.toThrow();
  await expect(
    db.jobAttempt.update({
      where: { id: j.id },
      data: { ...complete, heartbeatAt: new Date('2025-01-01T00:00:00Z') },
    }),
  ).rejects.toThrow();
  await db.jobAttempt.update({ where: { id: j.id }, data: complete });
  await expect(
    db.jobAttempt.update({ where: { id: j.id }, data: { status: 'SUCCEEDED' } }),
  ).resolves.toHaveProperty('leaseToken', token);
  await expect(
    db.jobAttempt.create({
      data: {
        queueName: 'fixture',
        jobType: 'fixture',
        operationId: randomUUID(),
        attemptNumber: 1,
        status: 'FAILED',
      },
    }),
  ).resolves.toHaveProperty('leaseToken', null);
});
it('enforces active outbox fields and ordering with nullable historical claims', async () => {
  const e = await db.outboxEvent.create({
    data: {
      eventType: 'fixture',
      aggregateType: 'fixture',
      aggregateId: 'fixture',
      payloadJson: {},
    },
  });
  const complete = {
    status: 'DISPATCHING' as const,
    claimOwner: 'fixture',
    claimToken: randomUUID(),
    claimedAt: new Date('2026-01-01T00:00:00Z'),
    claimHeartbeatAt: new Date('2026-01-01T00:00:00Z'),
    claimExpiresAt: new Date('2026-01-01T00:01:00Z'),
  };
  for (const field of [
    'claimOwner',
    'claimToken',
    'claimedAt',
    'claimHeartbeatAt',
    'claimExpiresAt',
  ])
    await expect(
      db.outboxEvent.update({ where: { id: e.id }, data: { ...complete, [field]: null } }),
    ).rejects.toThrow();
  await expect(
    db.outboxEvent.update({
      where: { id: e.id },
      data: { ...complete, claimExpiresAt: complete.claimedAt },
    }),
  ).rejects.toThrow();
  await expect(
    db.outboxEvent.update({
      where: { id: e.id },
      data: { ...complete, claimHeartbeatAt: new Date('2025-01-01T00:00:00Z') },
    }),
  ).rejects.toThrow();
  await db.outboxEvent.update({ where: { id: e.id }, data: complete });
  await expect(
    db.outboxEvent.update({ where: { id: e.id }, data: { status: 'DISPATCHED' } }),
  ).resolves.toHaveProperty('claimToken', complete.claimToken);
  await expect(
    db.outboxEvent.create({
      data: {
        eventType: 'fixture',
        aggregateType: 'fixture',
        aggregateId: 'fixture',
        payloadJson: {},
        status: 'FAILED',
      },
    }),
  ).resolves.toHaveProperty('claimToken', null);
});
it('rolls back domain, version, approval, audit and outbox together', async () => {
  await expect(
    persistence.transaction(human, async (u) => {
      const campaign = await u.createCampaign({ name: 'rollback', slug: 'rollback' });
      const brief = await u.createBrief(campaign.id, 'rollback');
      const bv = await u.versions.briefVersion({ briefId: brief.id, payloadJson: {} });
      const concept = await u.createConcept(brief.id);
      const cv = await u.versions.conceptVersion({
        conceptId: concept.id,
        briefVersionId: bv.id,
        title: 'rollback',
        creatorType: 'HUMAN',
      });
      await u.submitConcept(cv.id);
      await u.decideConcept(cv.id, 'APPROVED');
      throw new Error('INJECTED_FAILURE');
    }),
  ).rejects.toThrow('INJECTED_FAILURE');
  for (const delegate of [
    db.campaign,
    db.briefVersion,
    db.conceptVersion,
    db.approval,
    db.auditEvent,
    db.outboxEvent,
  ])
    expect(await (delegate.count as () => Promise<number>)()).toBe(0);
});
it('serializes concurrent version allocation and preserves prior payload bytes', async () => {
  const b = await base();
  const original = await db.briefVersion.findUniqueOrThrow({ where: { id: b.bv.id } });
  const results = await Promise.all(
    [persistence, new Persistence(second)].map((p, n) =>
      p.transaction(human, (u) =>
        u.versions.briefVersion({ briefId: b.brief.id, payloadJson: { revision: n } }),
      ),
    ),
  );
  expect(results.map((x) => x.version).sort()).toEqual([2, 3]);
  expect(await db.briefVersion.findUnique({ where: { id: b.bv.id } })).toEqual(original);
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.briefVersion({ briefId: b.brief.id, payloadJson: {}, version: 42 } as Parameters<
        typeof u.versions.briefVersion
      >[0]),
    ),
  ).rejects.toThrow('IMMUTABLE_VERSION_INPUT');
  await expect(
    db.briefVersion.create({ data: { briefId: b.brief.id, version: 1, payloadJson: {} } }),
  ).rejects.toMatchObject({ code: 'P2002' });
  await expect(db.brief.delete({ where: { id: b.brief.id } })).rejects.toMatchObject({
    code: 'P2003',
  });
});
it('requires exact approved ConceptVersion and rejects SYSTEM gate decisions', async () => {
  const b = await base(false);
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.scriptVersion({
        scriptId: b.script.id,
        conceptVersionId: b.cv.id,
        fullText: 'blocked',
        createdByType: 'HUMAN',
      }),
    ),
  ).rejects.toThrow('CONCEPT_APPROVAL_REQUIRED');
  await persistence.transaction(human, (u) => u.submitConcept(b.cv.id));
  await expect(
    persistence.transaction({ actorType: 'SYSTEM' }, (u) => u.decideConcept(b.cv.id, 'APPROVED')),
  ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  await persistence.transaction(human, (u) => u.decideConcept(b.cv.id, 'APPROVED'));
  const revised = await persistence.transaction(human, (u) =>
    u.versions.conceptVersion({
      conceptId: b.concept.id,
      briefVersionId: b.bv.id,
      title: 'revision',
      creatorType: 'HUMAN',
    }),
  );
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.scriptVersion({
        scriptId: b.script.id,
        conceptVersionId: revised.id,
        fullText: 'blocked',
        createdByType: 'HUMAN',
      }),
    ),
  ).rejects.toThrow('CONCEPT_APPROVAL_REQUIRED');
  await expect(persistence.transaction(human, (u) => u.submitConcept(b.cv.id))).rejects.toThrow(
    'STALE_VERSION',
  );
  expect(await db.approval.count({ where: { conceptVersionId: b.cv.id } })).toBe(1);
});
it('rejects mixed brief/concept/script roots despite individually valid foreign keys', async () => {
  const a = await base();
  const b = await base();
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.conceptVersion({
        conceptId: a.concept.id,
        briefVersionId: b.bv.id,
        title: 'wrong',
        creatorType: 'HUMAN',
      }),
    ),
  ).rejects.toThrow('LINEAGE_MISMATCH');
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.scriptVersion({
        scriptId: a.script.id,
        conceptVersionId: b.cv.id,
        fullText: 'wrong',
        createdByType: 'HUMAN',
      }),
    ),
  ).rejects.toThrow('LINEAGE_MISMATCH');
});
it('pins exact template/profile and creative/script roots through editing versions', async () => {
  const a = await content();
  const b = await content();
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.creativePlanVersion({
        creativePlanId: a.creative.id,
        scriptVersionId: b.sv.id,
        primaryFormat: 'fixture',
        templateVersionId: a.tv.id,
        editingProfileVersionId: a.pv.id,
        scenePlanJson: {},
      }),
    ),
  ).rejects.toThrow('LINEAGE_MISMATCH');
  for (const mismatch of [
    { templateVersionId: b.tv.id },
    { editingProfileVersionId: b.pv.id },
    { creativePlanVersionId: b.cpv.id },
  ]) {
    await expect(
      persistence.transaction(human, (u) =>
        u.versions.editingPlanVersion({
          editingPlanId: a.editing.id,
          creativePlanVersionId: a.cpv.id,
          templateVersionId: a.tv.id,
          editingProfileVersionId: a.pv.id,
          timelineJson: {},
          ...mismatch,
        }),
      ),
    ).rejects.toThrow('LINEAGE_MISMATCH');
  }
});
it('serializes competing human decisions without duplicate approvals', async () => {
  const b = await base(false);
  await persistence.transaction(human, (u) => u.submitConcept(b.cv.id));
  const outcomes = await Promise.allSettled(
    [persistence, new Persistence(second)].map((p) =>
      p.transaction(human, (u) => u.decideConcept(b.cv.id, 'APPROVED')),
    ),
  );
  expect(outcomes.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
  expect(await db.approval.count()).toBe(1);
});
it('guards final review and exact master/derived publication media without a provider', async () => {
  const c = await reviewedRender();
  const unrelated = await asset();
  const account = await db.platformAccount.create({
    data: { platform: 'TIKTOK', displayName: 'fixture', remoteAccountId: 'fixture' },
  });
  const data = {
    renderId: c.render.id,
    platformAccountId: account.id,
    mediaAssetId: c.output.id,
    deliveryMode: 'MANUAL_HANDOFF' as const,
    metadataJson: {},
  };
  await expect(persistence.transaction(human, (u) => u.createPublication(data))).rejects.toThrow(
    'RENDER_APPROVAL_REQUIRED',
  );
  await expect(
    persistence.transaction({ actorType: 'SYSTEM' }, (u) =>
      u.decideRender(c.render.id, 'APPROVED', c.output.id),
    ),
  ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  await expect(
    persistence.transaction(human, (u) => u.decideRender(c.render.id, 'APPROVED', unrelated.id)),
  ).rejects.toThrow('RENDER_OUTPUT_MISMATCH');
  await persistence.transaction(human, (u) => u.decideRender(c.render.id, 'APPROVED', c.output.id));
  const published = await persistence.transaction(human, (u) => u.createPublication(data));
  expect(published.status).toBe('DRAFT');
  expect(published.trackingCode).toMatch(/^[0-9a-f-]{36}$/);
  await expect(
    persistence.transaction(human, (u) =>
      u.createPublication({ ...data, mediaAssetId: unrelated.id }),
    ),
  ).rejects.toThrow('MEDIA_LINEAGE_MISMATCH');
  await expect(
    persistence.transaction(human, (u) =>
      u.createPublication({ ...data, deliveryMode: 'API_AUTOMATED' }),
    ),
  ).rejects.toThrow('TIKTOK_MANUAL_ONLY');
  await db.assetDerivation.create({
    data: {
      sourceAssetId: c.output.id,
      derivedAssetId: unrelated.id,
      type: 'PLATFORM_DERIVATIVE',
      platform: 'TIKTOK',
      transformationProfileKey: 'fixture',
      transformationProfileVersion: '1',
    },
  });
  await expect(
    persistence.transaction(human, (u) =>
      u.createPublication({ ...data, mediaAssetId: unrelated.id }),
    ),
  ).resolves.toHaveProperty('mediaAssetId', unrelated.id);
});
it('persists workflow transitions, attempts, exact decimal costs and audit in one transaction', async () => {
  const result = await persistence.transaction(human, async (u) => {
    const workflow = await u.createWorkflow({
      workflowType: 'RENDER',
      rootEntityType: 'fixture',
      rootEntityId: 'fixture',
    });
    await u.transitionWorkflow(workflow.id, 'PENDING', 'RUNNING', 'fixture');
    await u.transitionWorkflow(workflow.id, 'RUNNING', 'WAITING');
    const attempt = await u.enqueueJob({
      workflowRunId: workflow.id,
      queueName: 'fixture',
      jobType: 'PURE',
      operationId: randomUUID(),
      attemptNumber: 1,
    });
    const cost = await u.recordCost({
      category: 'OTHER',
      amount: '0.12345678',
      currency: 'EUR',
      occurredAt: new Date('2026-01-01T00:00:00Z'),
      relatedEntityType: 'JobAttempt',
      relatedEntityId: attempt.id,
    });
    return { workflow, attempt, cost };
  });
  expect(result.cost.amount.toString()).toBe('0.12345678');
  expect(await db.auditEvent.count({ where: { subjectId: result.cost.id } })).toBe(1);
  await expect(
    persistence.transaction(human, (u) =>
      u.transitionWorkflow(result.workflow.id, 'RUNNING', 'SUCCEEDED'),
    ),
  ).rejects.toThrow('STALE_STATE');
  await expect(
    db.jobAttempt.create({
      data: {
        queueName: 'fixture',
        jobType: 'PURE',
        operationId: result.attempt.operationId,
        attemptNumber: 1,
      },
    }),
  ).rejects.toMatchObject({ code: 'P2002' });
});
it('permits exactly one concurrent claimant and fences stale completion after takeover', async () => {
  const j = await job();
  const competitor = new Leases(second, config, { PURE: 'SAFE_RETRY' });
  const claims = await Promise.all([
    leases.claimJob('fixture', 'one'),
    competitor.claimJob('fixture', 'two'),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  const original = claims.find(Boolean)!;
  await leases.heartbeatJob(j.id, original.leaseToken!);
  await expireJob(j.id);
  await expect(leases.heartbeatJob(j.id, original.leaseToken!)).rejects.toThrow('STALE_LEASE');
  await expect(leases.finishJob(j.id, original.leaseToken!, 'SUCCEEDED')).rejects.toThrow(
    'STALE_LEASE',
  );
  const recovered = await competitor.claimJob('fixture', 'restarted');
  expect(recovered?.id).toBe(j.id);
  expect(recovered?.leaseToken).not.toBe(original.leaseToken);
  await expect(leases.finishJob(j.id, original.leaseToken!, 'FAILED')).rejects.toThrow(
    'STALE_LEASE',
  );
  const terminal = await competitor.finishJob(j.id, recovered!.leaseToken!, 'SUCCEEDED');
  expect(terminal.leaseToken).toBe(recovered?.leaseToken);
  expect(await leases.claimJob('fixture', 'again')).toBeNull();
});
it('does not turn publication reconciliation or unspecified policies into expired-job retries', async () => {
  for (const type of ['PUBLISH', 'UNSPECIFIED']) {
    const j = await job(type, type);
    const claim = await leases.claimJob(type, 'one');
    expect(claim?.id).toBe(j.id);
    await expireJob(j.id);
    expect(await leases.claimJob(type, 'two')).toBeNull();
  }
});
it('uses PostgreSQL time despite a skewed worker clock', async () => {
  const j = await job();
  const mock = vi.spyOn(Date, 'now').mockReturnValue(0);
  try {
    const claim = await leases.claimJob('fixture', 'clock-skew');
    expect(claim?.leaseAcquiredAt?.getUTCFullYear()).toBeGreaterThan(2020);
    await leases.heartbeatJob(j.id, claim!.leaseToken!);
    expect((await leases.finishJob(j.id, claim!.leaseToken!, 'SUCCEEDED')).status).toBe(
      'SUCCEEDED',
    );
  } finally {
    mock.mockRestore();
  }
});
it('reads lease expiry after a lock wait, rejecting an owner whose lease expired while blocked', async () => {
  const j = await job();
  const claim = await leases.claimJob('fixture', 'old');
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const blocker = second.$transaction(
    async (tx) => {
      await lock(tx, 'JobAttempt', j.id);
      locked();
      await barrier;
      await tx.$executeRaw`UPDATE "JobAttempt" SET "leaseAcquiredAt" = '2000-01-01T00:00:00Z', "heartbeatAt" = '2000-01-01T00:00:01Z', "leaseExpiresAt" = '2000-01-01T00:00:02Z' WHERE "id" = ${j.id}::uuid`;
    },
    { timeout: 10000 },
  );
  await ready;
  const pending = leases.finishJob(j.id, claim!.leaseToken!, 'SUCCEEDED');
  // Synchronize on PostgreSQL lock state, not a sleep or guessed timing window.
  let observed = false;
  try {
    for (let i = 0; i < 500; i++) {
      const rows = await second.$queryRaw<
        { blocked: boolean }[]
      >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock') AS blocked`;
      if (rows[0]?.blocked) {
        observed = true;
        break;
      }
    }
  } finally {
    release();
  }
  await blocker;
  await expect(pending).rejects.toThrow('STALE_LEASE');
  expect(observed).toBe(true);
});
it('SKIP LOCKED avoids a busy job instead of double claiming it', async () => {
  const j = await job();
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((r) => {
    locked = r;
  });
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  const held = second.$transaction(async (tx) => {
    await lock(tx, 'JobAttempt', j.id);
    locked();
    await barrier;
  });
  await ready;
  try {
    expect(await leases.claimJob('fixture', 'other')).toBeNull();
  } finally {
    release();
    await held;
  }
});
it('reclaims outbox after enqueue/mark loss using stable deduplication identity', async () => {
  const e = await db.outboxEvent.create({
    data: {
      eventType: 'fixture',
      aggregateType: 'fixture',
      aggregateId: 'fixture',
      payloadJson: {},
    },
  });
  const initial = await leases.claimOutbox('one');
  expect(initial?.id).toBe(e.id);
  const transport = new Set<string>();
  transport.add(outboxDelivery(initial!).deduplicationKey);
  await leases.heartbeatOutbox(e.id, initial!.claimToken!);
  await expireOutbox(e.id);
  await expect(leases.heartbeatOutbox(e.id, initial!.claimToken!)).rejects.toThrow('STALE_LEASE');
  const recovered = await new Leases(second, config, {}).claimOutbox('two');
  expect(recovered?.claimToken).not.toBe(initial?.claimToken);
  transport.add(outboxDelivery(recovered!).deduplicationKey);
  expect(transport.size).toBe(1);
  for (const status of ['DISPATCHED', 'FAILED'] as const)
    await expect(leases.finishOutbox(e.id, initial!.claimToken!, status)).rejects.toThrow(
      'STALE_LEASE',
    );
  await leases.finishOutbox(e.id, recovered!.claimToken!, 'DISPATCHED');
  expect(await leases.claimOutbox('three')).toBeNull();
  expect((await db.outboxEvent.findUniqueOrThrow({ where: { id: e.id } })).attemptCount).toBe(2);
});
it('outbox claims are exclusive and respect availableAt', async () => {
  const future = await db.outboxEvent.create({
    data: {
      eventType: 'fixture',
      aggregateType: 'fixture',
      aggregateId: 'fixture',
      payloadJson: {},
      availableAt: new Date('2100-01-01T00:00:00Z'),
    },
  });
  expect(await leases.claimOutbox('early')).toBeNull();
  await db.outboxEvent.update({
    where: { id: future.id },
    data: { availableAt: new Date('2000-01-01T00:00:00Z') },
  });
  const results = await Promise.all([
    leases.claimOutbox('one'),
    new Leases(second, config, {}).claimOutbox('two'),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
});
it('maintains explicit SQL NULL versus observed zero', async () => {
  const c = await reviewedRender();
  await persistence.transaction(human, (u) => u.decideRender(c.render.id, 'APPROVED', c.output.id));
  const account = await db.platformAccount.create({
    data: { platform: 'TIKTOK', displayName: 'fixture', remoteAccountId: 'fixture' },
  });
  const publication = await persistence.transaction(human, (u) =>
    u.createPublication({
      renderId: c.render.id,
      platformAccountId: account.id,
      mediaAssetId: c.output.id,
      deliveryMode: 'MANUAL_HANDOFF',
      metadataJson: {},
    }),
  );
  const raw = await db.metricSnapshotRaw.create({
    data: {
      publicationId: publication.id,
      platform: 'TIKTOK',
      collectedAt: new Date(),
      collectionMethod: 'MANUAL_ENTRY',
      collectionOperationId: randomUUID(),
      payloadJson: {},
    },
  });
  const metric = await db.metricSnapshotNormalized.create({
    data: {
      publicationId: publication.id,
      rawSnapshotId: raw.id,
      collectedAt: new Date(),
      normalizerVersion: 'fixture',
      metricSemanticsVersion: 'fixture',
      views: 0n,
    },
  });
  expect(metric.views).toBe(0n);
  expect(metric.likes).toBeNull();
});

it('atomically commits a fenced job result, cost, audit and outbox; callback failure rolls all back', async () => {
  const j = await job();
  const claim = await leases.claimJob('fixture', 'owner');
  await expect(
    leases.finishJob(j.id, claim!.leaseToken!, 'SUCCEEDED', undefined, async (u) => {
      await u.createCampaign({ name: 'failed-result', slug: 'failed-result' });
      await u.recordCost({
        category: 'OTHER',
        amount: '0.00000001',
        currency: 'EUR',
        occurredAt: new Date('2026-01-01T00:00:00Z'),
      });
      throw new Error('RESULT_PERSISTENCE_FAILED');
    }),
  ).rejects.toThrow('RESULT_PERSISTENCE_FAILED');
  expect(await db.campaign.count()).toBe(0);
  expect(await db.costEntry.count()).toBe(0);
  expect((await db.jobAttempt.findUniqueOrThrow({ where: { id: j.id } })).status).toBe('RUNNING');
  await leases.finishJob(j.id, claim!.leaseToken!, 'SUCCEEDED', undefined, async (u) => {
    await u.createCampaign({ name: 'result', slug: 'result' });
  });
  expect(await db.campaign.count()).toBe(1);
  expect(await db.outboxEvent.count({ where: { eventType: 'Campaign.created' } })).toBe(1);
  expect(await db.auditEvent.count({ where: { action: 'Campaign.created' } })).toBe(1);
});
it('rejects missing/stale owners before invoking a result callback', async () => {
  const callback = vi.fn();
  await expect(
    leases.finishJob(randomUUID(), randomUUID(), 'SUCCEEDED', undefined, callback),
  ).rejects.toThrow('STALE_LEASE');
  const j = await job();
  const claimed = await leases.claimJob('fixture', 'owner');
  await expireJob(j.id);
  await expect(
    leases.finishJob(j.id, claimed!.leaseToken!, 'SUCCEEDED', undefined, callback),
  ).rejects.toThrow('STALE_LEASE');
  expect(callback).not.toHaveBeenCalled();
});

async function reviseConcept(b: Awaited<ReturnType<typeof base>>, store = persistence) {
  return store.transaction(human, (u) =>
    u.versions.conceptVersion({
      conceptId: b.concept.id,
      briefVersionId: b.bv.id,
      title: 'new revision',
      creatorType: 'HUMAN',
    }),
  );
}
it('keeps implicit historical submission and approval stale even during explicit review', async () => {
  const b = await base(false);
  const latest = await reviseConcept(b);
  await expect(persistence.transaction(human, (u) => u.submitConcept(b.cv.id))).rejects.toThrow(
    'STALE_VERSION',
  );
  await expect(
    persistence.transaction(human, (u) => u.decideConcept(b.cv.id, 'APPROVED')),
  ).rejects.toThrow('STALE_VERSION');
  await persistence.transaction(human, (u) => u.selectConceptVersionForReview(b.cv.id));
  await expect(
    persistence.transaction(human, (u) => u.decideConcept(b.cv.id, 'APPROVED')),
  ).rejects.toThrow('STALE_VERSION');
  await expect(
    persistence.transaction(human, (u) => u.decideConcept(latest.id, 'APPROVED')),
  ).rejects.toThrow('EXPLICIT_SELECTION_REQUIRED');
  expect(await db.approval.count()).toBe(0);
});
it('durably submits a historical subject without fabricating a pending Approval', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  expect(selection.conceptVersionId).toBe(b.cv.id);
  expect(await db.auditEvent.findUnique({ where: { id: selection.selectionId } })).toMatchObject({
    subjectId: b.concept.id,
    subjectVersionId: b.cv.id,
    actorType: 'USER',
    action: 'Concept.versionSelectedForReview',
  });
  expect((await db.concept.findUniqueOrThrow({ where: { id: b.concept.id } })).status).toBe(
    'AWAITING_REVIEW',
  );
  expect(await db.approval.count()).toBe(0);
  const approval = await new Persistence(second).transaction(human, (u) =>
    u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
  );
  expect(approval).toMatchObject({
    conceptVersionId: b.cv.id,
    subjectType: 'CONCEPT',
    decision: 'APPROVED',
    actorType: 'USER',
  });
  expect(
    await db.auditEvent.findFirst({
      where: { subjectId: selection.selectionId, action: 'ConceptReviewSelection.decided' },
    }),
  ).toMatchObject({ subjectVersionId: b.cv.id, afterJson: { approvalId: approval.id } });
});
it('keeps an explicitly selected subject valid across revisions and pins downstream approval lineage', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  await reviseConcept(b, new Persistence(second));
  expect((await db.concept.findUniqueOrThrow({ where: { id: b.concept.id } })).status).toBe(
    'AWAITING_REVIEW',
  );
  const approval = await persistence.transaction(human, (u) =>
    u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
  );
  const latest = await reviseConcept(b);
  expect(await db.approval.findUnique({ where: { id: approval.id } })).toEqual(approval);
  expect(await db.conceptVersion.findUnique({ where: { id: b.cv.id } })).toEqual(b.cv);
  const script = await persistence.transaction(human, (u) =>
    u.versions.scriptVersion({
      scriptId: b.script.id,
      conceptVersionId: b.cv.id,
      fullText: 'historical approved input',
      createdByType: 'HUMAN',
    }),
  );
  expect(script.conceptVersionId).toBe(b.cv.id);
  await expect(
    persistence.transaction(human, (u) =>
      u.versions.scriptVersion({
        scriptId: b.script.id,
        conceptVersionId: latest.id,
        fullText: 'unapproved',
        createdByType: 'HUMAN',
      }),
    ),
  ).rejects.toThrow('CONCEPT_APPROVAL_REQUIRED');
});
it('allows explicit selection during an implicit review without approving its formerly latest version', async () => {
  const b = await base(false);
  const latest = await reviseConcept(b);
  await persistence.transaction(human, (u) => u.submitConcept(latest.id));
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  await expect(
    persistence.transaction(human, (u) => u.decideConcept(latest.id, 'APPROVED')),
  ).rejects.toThrow('EXPLICIT_SELECTION_REQUIRED');
  expect(
    await persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
  ).toHaveProperty('conceptVersionId', b.cv.id);
});
it('serializes simultaneous historical selection and revision without losing the selected subject', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const [selection] = await Promise.all([
    persistence.transaction(human, (u) => u.selectConceptVersionForReview(b.cv.id)),
    reviseConcept(b, new Persistence(second)),
  ]);
  expect((await db.concept.findUniqueOrThrow({ where: { id: b.concept.id } })).status).toBe(
    'AWAITING_REVIEW',
  );
  expect(
    await persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
  ).toHaveProperty('conceptVersionId', b.cv.id);
});
it('serializes selected approval racing with a new version without repinning the decision', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  const [approval, latest] = await Promise.all([
    persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
    reviseConcept(b, new Persistence(second)),
  ]);
  expect(approval.conceptVersionId).toBe(b.cv.id);
  expect(await db.approval.count({ where: { conceptVersionId: latest.id } })).toBe(0);
  expect(await db.approval.count()).toBe(1);
});
it('permits only one concurrent decision for an explicit selection and rejects replay', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  const outcomes = await Promise.allSettled([
    persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
    new Persistence(second).transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'REJECTED'),
    ),
  ]);
  expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(await db.approval.count()).toBe(1);
  expect(
    await db.auditEvent.count({
      where: { subjectId: selection.selectionId, action: 'ConceptReviewSelection.decided' },
    }),
  ).toBe(1);
  await expect(
    persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
  ).rejects.toThrow('CONCEPT_SELECTION_RESOLVED');
});
it('does not let a competing explicit selection overwrite the durable review subject', async () => {
  const b = await base(false);
  const latest = await reviseConcept(b);
  const results = await Promise.allSettled([
    persistence.transaction(human, (u) => u.selectConceptVersionForReview(b.cv.id)),
    new Persistence(second).transaction(human, (u) => u.selectConceptVersionForReview(latest.id)),
  ]);
  const winners = results.filter((r) => r.status === 'fulfilled');
  expect(winners).toHaveLength(1);
  const winner = winners[0]!;
  const approval = await persistence.transaction(human, (u) =>
    u.decideSelectedConcept(winner.value.selectionId, 'APPROVED'),
  );
  expect(approval.conceptVersionId).toBe(winner.value.conceptVersionId);
});
it('requires a trusted USER for selection and decision and rejects fabricated selection handles', async () => {
  const b = await base(false);
  await reviseConcept(b);
  for (const actor of [
    { actorType: 'SYSTEM' as const },
    { actorType: 'WORKER' as const, actorId: 'worker' },
    { actorType: 'AI' as const, actorId: 'ai' },
    { actorType: 'USER' as const },
  ]) {
    await expect(
      persistence.transaction(actor, (u) => u.selectConceptVersionForReview(b.cv.id)),
    ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
    await expect(
      persistence.transaction(actor, (u) => u.decideSelectedConcept(randomUUID(), 'APPROVED')),
    ).rejects.toThrow('HUMAN_APPROVAL_REQUIRED');
  }
  await expect(
    persistence.transaction(human, (u) => u.decideSelectedConcept(randomUUID(), 'APPROVED')),
  ).rejects.toThrow('INVALID_CONCEPT_SELECTION');
  const ordinaryAudit = await persistence.transaction(human, (u) =>
    u.audit('unrelated', 'Concept', b.concept.id, b.cv.id),
  );
  await expect(
    persistence.transaction(human, (u) => u.decideSelectedConcept(ordinaryAudit.id, 'APPROVED')),
  ).rejects.toThrow('INVALID_CONCEPT_SELECTION');
  expect(await db.approval.count()).toBe(0);
});
it('consumes rejected selections while preserving subsequent default latest review behavior', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  await persistence.transaction(human, (u) =>
    u.decideSelectedConcept(selection.selectionId, 'REJECTED'),
  );
  const latest = await reviseConcept(b);
  expect((await db.concept.findUniqueOrThrow({ where: { id: b.concept.id } })).status).toBe(
    'DRAFT',
  );
  await persistence.transaction(human, (u) => u.submitConcept(latest.id));
  await persistence.transaction(human, (u) => u.decideConcept(latest.id, 'APPROVED'));
  await expect(
    persistence.transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
  ).rejects.toThrow('CONCEPT_SELECTION_RESOLVED');
  expect(await db.approval.findFirst({ where: { conceptVersionId: b.cv.id } })).toHaveProperty(
    'decision',
    'REJECTED',
  );
});
it('rolls back selection state, subject audit and submission outbox atomically', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const before = await db.outboxEvent.count();
  await expect(
    persistence.transaction(human, async (u) => {
      await u.selectConceptVersionForReview(b.cv.id);
      throw new Error('ROLLBACK_SELECTION');
    }),
  ).rejects.toThrow('ROLLBACK_SELECTION');
  expect(await db.auditEvent.count({ where: { action: 'Concept.versionSelectedForReview' } })).toBe(
    0,
  );
  expect(await db.outboxEvent.count()).toBe(before);
  expect((await db.concept.findUniqueOrThrow({ where: { id: b.concept.id } })).status).toBe(
    'DRAFT',
  );
});
it('rolls back a selected decision with its consumption marker and keeps the selection usable', async () => {
  const b = await base(false);
  await reviseConcept(b);
  const selection = await persistence.transaction(human, (u) =>
    u.selectConceptVersionForReview(b.cv.id),
  );
  const before = await db.outboxEvent.count();
  await expect(
    persistence.transaction(human, async (u) => {
      await u.decideSelectedConcept(selection.selectionId, 'APPROVED');
      throw new Error('ROLLBACK_DECISION');
    }),
  ).rejects.toThrow('ROLLBACK_DECISION');
  expect(await db.approval.count()).toBe(0);
  expect(
    await db.auditEvent.count({
      where: { subjectId: selection.selectionId, action: 'ConceptReviewSelection.decided' },
    }),
  ).toBe(0);
  expect(await db.outboxEvent.count()).toBe(before);
  expect(
    await new Persistence(second).transaction(human, (u) =>
      u.decideSelectedConcept(selection.selectionId, 'APPROVED'),
    ),
  ).toHaveProperty('conceptVersionId', b.cv.id);
});
