import { randomUUID } from 'node:crypto';
import { postgresFixture } from '../../packages/database/test/support.js';
import { createApi } from '../../apps/api/src/app.js';
import {
  ConceptReviewService,
  DashboardReadService,
  RecordingPackService,
} from '../../packages/application/src/index.js';
import { Persistence } from '../../packages/database/src/index.js';
import { MemoryStorage, recordingGraph } from '../fixtures/recordings/support.js';

const fixture = await postgresFixture();
const recordings = new RecordingPackService(fixture.client, new MemoryStorage());
const dashboard = new DashboardReadService(fixture.client);
const concepts = new ConceptReviewService(fixture.client);

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
  await recordingGraph(fixture.client);

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
