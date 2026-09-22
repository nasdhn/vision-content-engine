import { afterAll, beforeAll, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';

import { SupportingReadService } from '../../packages/application/src/supporting-read.js';
import { postgresFixture } from '../../packages/database/test/support.js';
import { recordingGraph } from '../fixtures/recordings/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let service: SupportingReadService;

beforeAll(async () => {
  fixture = await postgresFixture();
  service = new SupportingReadService(fixture.client, {
    environment: 'LOCAL',
    webOrigin: 'http://localhost:5174',
    safety: {
      pauseAllPublishing: true,
      pauseAiGeneration: true,
      pauseCapture: true,
      pauseRendering: true,
      pauseAnalyticsCollection: true,
      realProvidersEnabled: false,
    },
  });
});

afterAll(async () => {
  await fixture?.close();
});

async function publicationFixture() {
  const graph = await recordingGraph(fixture.client);
  const editingPlan = await fixture.client.editingPlan.create({
    data: { creativePlanId: graph.plan.id, status: 'READY' },
  });
  const editingPlanVersion = await fixture.client.editingPlanVersion.create({
    data: {
      editingPlanId: editingPlan.id,
      version: 1,
      creativePlanVersionId: graph.cpv.id,
      editingProfileVersionId: graph.pv.id,
      templateVersionId: graph.tv.id,
      timelineJson: {},
    },
  });
  const media = await fixture.client.asset.create({
    data: {
      kind: 'VIDEO',
      storageProvider: 'S3',
      bucket: 'private-secret-bucket',
      objectKey: `private/${randomUUID()}.mp4`,
      checksumSha256: 'a'.repeat(64),
      mimeType: 'video/mp4',
      sizeBytes: BigInt(2048),
      width: 1080,
      height: 1920,
      durationMs: 12000,
      fps: 30,
      status: 'READY',
      sourceType: 'RENDER',
      sourceEntityType: 'RenderAttempt',
      sourceEntityId: randomUUID(),
    },
  });
  const render = await fixture.client.render.create({
    data: {
      editingPlanVersionId: editingPlanVersion.id,
      status: 'APPROVED',
      approvedAssetId: media.id,
    },
  });
  const account = await fixture.client.platformAccount.create({
    data: {
      platform: 'INSTAGRAM',
      displayName: 'Vision Browser',
      remoteAccountId: randomUUID(),
      status: 'ACTIVE',
      credentialsRef: 'secret://platform/account',
      capabilitiesJson: { publish: true },
    },
  });
  const publication = await fixture.client.publication.create({
    data: {
      renderId: render.id,
      platformAccountId: account.id,
      deliveryMode: 'API_AUTOMATED',
      status: 'PUBLISHED',
      scheduledAt: new Date('2026-09-22T08:30:00.000Z'),
      publishedAt: new Date('2026-09-22T08:31:00.000Z'),
      remotePostId: randomUUID(),
      remoteUrl: 'https://example.test/vision-post',
      mediaAssetId: media.id,
      metadataJson: {},
    },
  });
  return { graph, media, render, account, publication };
}

it('reads calendar, published state and settings without creating Phase 7 capabilities', async () => {
  const seeded = await publicationFixture();

  const calendar = await service.calendar();
  const published = await service.published();
  const settings = await service.settingsSummary();

  expect(calendar).toMatchObject({ readOnly: true, schedulingAvailable: false });
  expect(calendar.entries).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        publicationId: seeded.publication.id,
        platform: 'INSTAGRAM',
        status: 'PUBLISHED',
      }),
    ]),
  );
  expect(published).toMatchObject({ readOnly: true, remotePublishingAvailable: false });
  expect(settings).toMatchObject({
    publicationMutationAvailable: false,
    analyticsEvidenceAvailable: true,
    platformAccounts: [
      expect.objectContaining({
        id: seeded.account.id,
        credentialsConfigured: true,
      }),
    ],
  });

  const serialized = JSON.stringify({ calendar, published, settings });
  expect(serialized).not.toContain('secret://platform/account');
  expect(serialized).not.toContain('credentialsRef');
});

it('reads safe asset metadata and lineage without exposing private storage identifiers', async () => {
  const seeded = await publicationFixture();
  const list = await service.assets();
  const detail = await service.asset(seeded.media.id);

  expect(list).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        assetId: seeded.media.id,
        sizeBytes: '2048',
        usage: expect.objectContaining({ approvedRenders: 1, publications: 1 }),
      }),
    ]),
  );
  expect(detail).toMatchObject({
    assetId: seeded.media.id,
    width: 1080,
    height: 1920,
    derivation: { parent: null, children: [] },
  });

  const serialized = JSON.stringify({ list, detail });
  expect(serialized).not.toContain('private-secret-bucket');
  expect(serialized).not.toContain(seeded.media.objectKey);
  expect(serialized).not.toContain('objectKey');
  expect(serialized).not.toContain('bucket');
});

it('reads pattern and template versions without exposing raw JSON editors', async () => {
  const pattern = await fixture.client.pattern.create({
    data: { key: `RESULT_FIRST_${randomUUID()}`, name: 'Result first', status: 'ACTIVE' },
  });
  const version = await fixture.client.patternVersion.create({
    data: {
      patternId: pattern.id,
      version: 1,
      description: 'Montrer la preuve avant l’explication.',
      whenToUse: 'Quand une preuve produit concrète existe.',
      sourceType: 'INTERNAL',
      confidence: 0.9,
      sourceMetadataJson: { privateEditorPayload: 'not-for-dashboard' },
    },
  });
  const graph = await recordingGraph(fixture.client);

  const patterns = await service.patterns();
  const templates = await service.templates();

  expect(patterns).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        patternId: pattern.id,
        latestVersion: expect.objectContaining({ id: version.id, version: 1 }),
      }),
    ]),
  );
  expect(templates).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        latestVersion: expect.objectContaining({ id: graph.tv.id, version: 1 }),
      }),
    ]),
  );
  expect(JSON.stringify({ patterns, templates })).not.toContain('privateEditorPayload');
  expect(JSON.stringify({ patterns, templates })).not.toContain('capabilitiesJson');
});
