import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { ConceptReviewService } from '../../packages/application/src/concept-review.js';
import { Persistence } from '../../packages/database/src/index.js';
import { postgresFixture } from '../../packages/database/test/support.js';

let fixture: Awaited<ReturnType<typeof postgresFixture>>;
let persistence: Persistence;
let service: ConceptReviewService;

const actor = { actorType: 'USER', actorId: 'dashboard-reviewer' } as const;

beforeAll(async () => {
  fixture = await postgresFixture();
  persistence = new Persistence(fixture.client);
  service = new ConceptReviewService(fixture.client);
});

afterAll(async () => {
  await fixture?.close();
});

async function reviewConcept(title: string) {
  return persistence.transaction(actor, async (u) => {
    const campaign = await u.createCampaign({
      name: 'Concept review',
      slug: randomUUID(),
    });
    const brief = await u.createBrief(campaign.id, 'Vision short-form');
    const briefVersion = await u.versions.briefVersion({
      briefId: brief.id,
      payloadJson: { source: 'phase6b-test' },
    });
    const concept = await u.createConcept(brief.id);
    const conceptVersion = await u.versions.conceptVersion({
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
    await u.submitConcept(conceptVersion.id);
    return { campaign, brief, briefVersion, concept, conceptVersion };
  });
}

it('reads the exact latest version queued for human review', async () => {
  const graph = await reviewConcept('Concept exact');
  const queue = await service.queue();
  const detail = await service.detail(graph.conceptVersion.id);

  expect(queue).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        conceptId: graph.concept.id,
        conceptVersionId: graph.conceptVersion.id,
        title: 'Concept exact',
        hook: 'Voici la preuve avant la promesse.',
      }),
    ]),
  );

  expect(detail).toMatchObject({
    conceptId: graph.concept.id,
    conceptVersionId: graph.conceptVersion.id,
    status: 'AWAITING_REVIEW',
    isLatest: true,
    decisionAllowed: true,
  });
});

it('persists a structured rejection reason and optional reviewer comment', async () => {
  const graph = await reviewConcept('Concept à rejeter');

  const result = await service.decide(actor, graph.conceptVersion.id, {
    decision: 'REJECTED',
    reasonCode: 'HOOK_WEAK',
    comment: 'Le hook doit montrer le résultat plus tôt.',
  });

  expect(result).toMatchObject({
    conceptVersionId: graph.conceptVersion.id,
    decision: 'REJECTED',
    reasonCode: 'HOOK_WEAK',
    comment: 'Le hook doit montrer le résultat plus tôt.',
  });

  expect(
    await fixture.client.approval.findUniqueOrThrow({
      where: { id: result.approvalId },
    }),
  ).toMatchObject({
    subjectType: 'CONCEPT',
    conceptVersionId: graph.conceptVersion.id,
    decision: 'REJECTED',
    reasonCode: 'HOOK_WEAK',
    actorType: 'USER',
    actorId: 'dashboard-reviewer',
  });
});

it('fails closed when the reviewed tab targets a stale ConceptVersion', async () => {
  const graph = await reviewConcept('Ancienne version');

  const latest = await persistence.transaction(actor, async (u) => {
    const version = await u.versions.conceptVersion({
      conceptId: graph.concept.id,
      briefVersionId: graph.briefVersion.id,
      title: 'Nouvelle version',
      creatorType: 'HUMAN',
    });
    await u.submitConcept(version.id);
    return version;
  });

  const staleDetail = await service.detail(graph.conceptVersion.id);

  expect(staleDetail).toMatchObject({
    isLatest: false,
    decisionAllowed: false,
    latestConceptVersionId: latest.id,
  });

  await expect(
    service.decide(actor, graph.conceptVersion.id, {
      decision: 'APPROVED',
    }),
  ).rejects.toThrow('STALE_VERSION');

  expect(
    await fixture.client.approval.count({
      where: { conceptVersionId: graph.conceptVersion.id },
    }),
  ).toBe(0);
});
