import { createHash, randomUUID } from 'node:crypto';
import { postgresFixture } from '../../packages/database/test/support.js';
import { createApi } from '../../apps/api/src/app.js';
import {
  ConceptReviewService,
  DashboardReadService,
  ProductionReadService,
  RecordingPackService,
  RenderReviewService,
} from '../../packages/application/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { MemoryStorage, recordingGraph } from '../fixtures/recordings/support.js';

const fixture = await postgresFixture();
const storage = new MemoryStorage();
const recordings = new RecordingPackService(fixture.client, storage);
const dashboard = new DashboardReadService(fixture.client);
const concepts = new ConceptReviewService(fixture.client);
const production = new ProductionReadService(fixture.client);
const review = new RenderReviewService(fixture.client, storage);

const app = await createApi(
  {
    postgres: async () => {},
    redis: async () => {},
    storage: async () => {},
  },
  {
    auth: {
      accessKey: 'fixture-local-recording-access-key',
      origin: 'http://localhost:5174',
    },
    recordings,
    dashboard,
    concepts,
    production,
    review,
  },
);

let closing = false;

async function close() {
  if (closing) return;
  closing = true;
  await app.close();
  await fixture.close();
  process.exit(0);
}

process.once('SIGTERM', () => {
  void close();
});

process.once('SIGINT', () => {
  void close();
});

try {
  // Keep the Phase 6C Recording Pack fixture isolated from the Phase 6D final-review
  // fixture. A READY_FOR_REVIEW render on the same CreativePlanVersion would make
  // ProductionReadService correctly project the next action as final review instead of
  // the still-pending human recording action, invalidating the 6C regression scenario.
  await recordingGraph(fixture.client);
  const reviewRecording = await recordingGraph(fixture.client);

  // The review-only graph must not alter Dashboard/Attention production counts. Its
  // RecordingRequest is outside the scenario under test, so mark it accepted and archive
  // the CreativePlan before attaching render-review lineage.
  await fixture.client.recordingRequest.update({
    where: { id: reviewRecording.request.id },
    data: { status: 'ACCEPTED', completedAt: new Date() },
  });
  await fixture.client.creativePlan.update({
    where: { id: reviewRecording.plan.id },
    data: { status: 'ARCHIVED' },
  });

  const editingPlan = await fixture.client.editingPlan.create({
    data: { creativePlanId: reviewRecording.plan.id, status: 'READY' },
  });
  const editingPlanVersion = await fixture.client.editingPlanVersion.create({
    data: {
      editingPlanId: editingPlan.id,
      version: 1,
      creativePlanVersionId: reviewRecording.cpv.id,
      editingProfileVersionId: reviewRecording.pv.id,
      templateVersionId: reviewRecording.tv.id,
      timelineJson: {},
    },
  });

  for (let index = 1; index <= 3; index++) {
    const render = await fixture.client.render.create({
      data: {
        editingPlanVersionId: editingPlanVersion.id,
        status: 'READY_FOR_REVIEW',
      },
    });
    const attemptId = randomUUID();
    const bytes = Buffer.from(`fixture-private-render-${index}`);
    const objectKey = `renders/${render.id}/attempts/${index}/master.mp4`;
    const output = await fixture.client.asset.create({
      data: {
        kind: 'VIDEO',
        sourceType: 'RENDER',
        sourceEntityType: 'RenderAttempt',
        sourceEntityId: attemptId,
        storageProvider: 'S3',
        bucket: storage.bucket,
        objectKey,
        checksumSha256: createHash('sha256').update(bytes).digest('hex'),
        mimeType: 'video/mp4',
        sizeBytes: BigInt(bytes.byteLength),
        width: 1080,
        height: 1920,
        durationMs: 10_000,
        fps: 30,
        status: 'READY',
      },
    });
    storage.objects.set(objectKey, bytes);
    await fixture.client.renderAttempt.create({
      data: {
        id: attemptId,
        renderId: render.id,
        attemptNumber: 1,
        status: 'SUCCEEDED',
        outputAssetId: output.id,
        technicalQaJson: {
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
          checks: [{ key: 'MASTER_DIMENSIONS', status: 'PASS' }],
          rendererVersion: 'browser-fixture-v1',
          colorProfileKey: 'SDR_BT709_SOCIAL_V1',
          codecProfileKey: 'SOCIAL_H264_AAC_V1',
          audioProfileKey: 'SOCIAL_VOICE_MASTER_V1',
        },
        creativeQaResult: 'PASS_WITH_WARNINGS',
        creativeQaJson: {
          result: 'PASS_WITH_WARNINGS',
          evaluatedDimensions: ['PACING', 'CTA'],
          notEvaluatedDimensions: [],
          issues: [
            {
              code: 'CTA_TOO_LONG',
              severity: 'WARNING',
              startMs: 8_500,
              endMs: 9_800,
              explanation: 'Le CTA mérite une dernière inspection humaine.',
              suggestedFix: 'Vérifier que le CTA reste naturel.',
            },
          ],
          summary: 'Rendu exploitable avec un avertissement non critique.',
        },
      },
    });
  }

  const persistence = new Persistence(fixture.client);
  for (const title of ['Concept à approuver', 'Concept à rejeter']) {
    await persistence.transaction(
      { actorType: 'USER', actorId: 'browser-fixture' },
      async (unit) => {
        const campaign = await unit.createCampaign({
          name: 'Vision',
          slug: `browser-${randomUUID()}`,
        });
        const brief = await unit.createBrief(campaign.id, 'Short-form Vision');
        const briefVersion = await unit.versions.briefVersion({
          briefId: brief.id,
          payloadJson: { source: 'browser-fixture' },
        });
        const concept = await unit.createConcept(brief.id);
        const version = await unit.versions.conceptVersion({
          conceptId: concept.id,
          briefVersionId: briefVersion.id,
          title,
          hook: 'Voici la preuve avant la promesse.',
          angle: 'Résultat d’abord',
          audience: 'Freelances',
          objective: 'Montrer Vision en action',
          hypothesis: 'La preuve concrète augmente la rétention.',
          rationale: 'Le produit apparaît immédiatement.',
          creatorType: 'HUMAN',
        });
        await unit.submitConcept(version.id);
      },
    );
  }

  await app.listen(3100, '127.0.0.1');
} catch {
  await close();
}
