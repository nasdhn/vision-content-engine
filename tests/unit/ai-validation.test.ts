import { describe, expect, it } from 'vitest';
import {
  CreatorInputSchema,
  CreatorOutputSchema,
  CreativeDirectorInputSchema,
  CreativeDirectorOutputSchema,
  PatternVersionSpecSchema,
} from '../../packages/contracts/src/index.js';
import {
  validateCreator,
  validateDirector,
  validateClaims,
  getPrompt,
} from '../../packages/ai/src/index.js';
import {
  canonicalJson,
  contentHash,
  assertNoSecrets,
  textHash,
} from '../../packages/contracts/src/canonical.js';
import { selectPatterns } from '../../packages/application/src/pattern-selector.js';
import creatorInput from '../fixtures/phase2/creator-input.json' with { type: 'json' };
import creatorOutput from '../fixtures/phase2/creator-output.json' with { type: 'json' };
import directorInput from '../fixtures/phase2/director-input.json' with { type: 'json' };
import directorOutput from '../fixtures/phase2/director-output.json' with { type: 'json' };
import seed from '../../packages/application/pattern-seeds/PROBLEM_TO_SOLUTION.json' with { type: 'json' };
const now = new Date('2026-09-20T00:00:00Z');
const ci = () => CreatorInputSchema.parse(creatorInput);
const co = () => CreatorOutputSchema.parse(creatorOutput);
const di = () => CreativeDirectorInputSchema.parse(directorInput);
const dout = () => CreativeDirectorOutputSchema.parse(directorOutput);
const policy = { minDurationSec: 5, maxDurationSec: 60, recentHooks: [], now };

it('validates both canonical golden input/output pairs', () => {
  expect(() => validateCreator(ci(), co(), policy)).not.toThrow();
  expect(() => validateDirector(di(), dout(), now)).not.toThrow();
});
it('rejects unknown AI output fields', () => {
  expect(CreatorOutputSchema.safeParse({ ...co(), publishNow: true }).success).toBe(false);
  expect(CreativeDirectorOutputSchema.safeParse({ ...dout(), command: 'fixture' }).success).toBe(
    false,
  );
});
it('rejects whitespace-only required copy beyond the structural min-length contract', () => {
  const output = co();
  output.concepts[0]!.title = '   ';
  expect(() => validateCreator(ci(), output, policy)).toThrow('EMPTY_REQUIRED_FIELD');
  const director = dout();
  director.script.fullText = ' ';
  director.script.segments[0]!.text = ' ';
  expect(() => validateDirector(di(), director, now)).toThrow('EMPTY_REQUIRED_FIELD');
});
describe('Creator constraints', () => {
  it.each([
    'pattern',
    'idea',
    'count',
    'format',
    'duration',
    'duplicate',
    'recent',
    'similarity',
  ] as const)('rejects %s violations', (kind) => {
    const input = ci();
    const output = co();
    const c = output.concepts[0]!;
    if (kind === 'pattern') c.selectedPatternVersionId = '018f0000-0000-7000-8000-000000000099';
    if (kind === 'idea') c.ideaId = '018f0000-0000-7000-8000-000000000099';
    if (kind === 'count') output.concepts.push(structuredClone(c));
    if (kind === 'format') c.formatRecommendation.primaryFormat = 'FOUNDER_STORY';
    if (kind === 'duration') c.formatRecommendation.targetDurationSec = 999;
    if (kind === 'duplicate') {
      input.generationConstraints.requestedConceptCount = 2;
      output.concepts.push({ ...structuredClone(c), clientKey: 'other' });
    }
    if (kind === 'similarity')
      input.contentMemory.push({
        conceptVersionId: input.briefVersion.id,
        publicationIds: [],
        topic: c.title,
        angle: c.angle,
        platforms: [],
      });
    expect(() =>
      validateCreator(input, output, {
        ...policy,
        recentHooks: kind === 'recent' ? [c.hook.toUpperCase()] : [],
      }),
    ).toThrow();
  });
});
describe('Director constraints', () => {
  it.each([
    'template',
    'profile',
    'asset',
    'capture',
    'segment',
    'script',
    'voice',
    'cta',
    'duration',
  ] as const)('rejects %s violations', (kind) => {
    const input = di();
    const output = dout();
    const id = '018f0000-0000-7000-8000-000000000099';
    if (kind === 'template') output.creativePlan.templateVersionId = id;
    if (kind === 'profile') output.creativePlan.editingProfileVersionId = id;
    if (kind === 'asset') output.creativePlan.requiredExistingAssetIds.push(id);
    if (kind === 'capture')
      output.creativePlan.captureRequests.push({
        clientKey: 'capture',
        captureScenarioVersionId: id,
        scenarioInput: {},
        desiredOutputs: [],
        editorialPurpose: 'fixture',
      });
    if (kind === 'segment') output.creativePlan.scenes[0]!.scriptSegmentRefs = ['unknown'];
    if (kind === 'script') output.script.segments[0]!.text = 'different';
    if (kind === 'voice') input.productionCapabilities.naturalVoiceAvailable = false;
    if (kind === 'cta') output.creativePlan.cta.text = 'unapproved CTA';
    if (kind === 'duration') output.creativePlan.targetDurationSec = 999;
    expect(() => validateDirector(input, output, now)).toThrow();
  });
});
it('requires valid, current, matching evidence for VERIFIED claims', () => {
  const k = di().brandKnowledge;
  const claims = dout().factualClaims;
  expect(() => validateClaims(k, claims, [claims[0]!.text], now)).not.toThrow();
  expect(() =>
    validateClaims(k, [{ ...claims[0]!, verifiedClaimIds: ['unknown'] }], [], now),
  ).toThrow('UNKNOWN_VERIFIED_CLAIM');
  expect(() =>
    validateClaims(k, [{ ...claims[0]!, text: 'Une affirmation inventée.' }], [], now),
  ).toThrow('CLAIM_EVIDENCE_MISMATCH');
  k.claims.verified[0]!.validUntil = '2020-01-01T00:00:00Z';
  expect(() => validateClaims(k, claims, [], now)).toThrow('EXPIRED_CLAIM');
});
it('rejects forbidden and hidden unsourced numerical claims', () => {
  const k = ci().brandKnowledge;
  expect(() => validateClaims(k, [], ['Résultat garanti !'], now)).toThrow('FORBIDDEN_CLAIM');
  expect(() => validateClaims(k, [], ['Vous gagnez 90% du temps.'], now)).toThrow(
    'UNSOURCED_NUMERICAL_CLAIM',
  );
  expect(() =>
    validateClaims(
      k,
      [
        {
          text: '90% gagnés',
          type: 'EXTERNAL_STAT',
          verifiedClaimIds: [],
          disposition: 'HUMAN_REVIEW_REQUIRED',
        },
      ],
      [],
      now,
    ),
  ).toThrow('UNSOURCED_NUMERICAL_CLAIM');
});
it('accepts sourced decimal facts but rejects an additional hidden numeric assertion', () => {
  const k = ci().brandKnowledge;
  k.claims.verified[0]!.text = 'La mesure de test vaut 2.5.';
  const claims = [
    {
      text: 'La mesure de test vaut 2.5.',
      type: 'PRODUCT_FACT' as const,
      verifiedClaimIds: [k.claims.verified[0]!.id],
      disposition: 'VERIFIED' as const,
    },
  ];
  expect(() => validateClaims(k, claims, [claims[0]!.text], now)).not.toThrow();
  expect(() =>
    validateClaims(k, claims, [`${claims[0]!.text} Avec 99% de garantie.`], now),
  ).toThrow('UNSOURCED_NUMERICAL_CLAIM');
});
it('permits a curated deliberate semantic variant while retaining exact hook protection', () => {
  const input = ci();
  const output = co();
  const c = output.concepts[0]!;
  input.contentMemory.push({
    conceptVersionId: input.briefVersion.id,
    publicationIds: [],
    topic: c.title,
    angle: c.angle,
    platforms: [],
  });
  const variant = {
    conceptVersionId: input.briefVersion.id,
    keepConstant: ['angle'],
    change: ['hook'],
    reason: 'Compare framing',
  };
  expect(() =>
    validateCreator(input, output, { ...policy, deliberateVariant: variant }),
  ).not.toThrow();
  expect(() =>
    validateCreator(input, output, {
      ...policy,
      deliberateVariant: variant,
      recentHooks: [c.hook],
    }),
  ).toThrow('DUPLICATE_HOOK');
});
it('hashes canonical JSON reproducibly without silently losing values', () => {
  expect(contentHash({ a: 1, b: [2] })).toBe(contentHash({ b: [2], a: 1 }));
  expect(() => canonicalJson({ a: undefined })).toThrow('NON_JSON_VALUE');
  expect(() => assertNoSecrets({ apiKey: 'fixture-not-a-real-secret' })).toThrow(
    'SECRET_IN_CONTEXT',
  );
});
it('resolves exact repository prompts and verifies content hashes', () => {
  for (const key of ['creator', 'creative-director']) {
    const prompt = getPrompt(key, '1.0.0');
    expect(prompt.contentHash).toBe(textHash(prompt.content));
    expect(Object.isFrozen(prompt)).toBe(true);
  }
  expect(() => getPrompt('creator', 'latest')).toThrow('PROMPT_NOT_FOUND');
});
const context = {
  audience: 'Freelancers',
  useCase: 'Lead qualification',
  topic: 'qualification',
  angle: 'demo',
  proofType: 'product',
  formats: ['PROBLEM_SOLUTION'],
  platforms: ['INSTAGRAM'],
  productProof: true,
  humanPresence: true,
  externalEvidence: true,
  excludeIds: [],
  recent: [],
};
const selectionPolicy = {
  mode: 'BALANCED' as const,
  seed: 'fixture',
  limit: 2,
  explorationSlots: 1,
  fatiguePenalty: 1,
};
it('excludes hard incompatibilities with explanations', () => {
  const p = { id: 'p', status: 'ACTIVE', spec: PatternVersionSpecSchema.parse(seed) };
  const result = selectPatterns([p], { ...context, productProof: false }, selectionPolicy);
  expect(result.candidates).toEqual([]);
  expect(result.excluded[0]!.reasons).toContain('PRODUCT_PROOF_REQUIRED');
  p.spec.constraints.requiresHumanPresence = true;
  expect(
    selectPatterns([p], { ...context, humanPresence: false }, selectionPolicy).excluded[0]!.reasons,
  ).toContain('HUMAN_PRESENCE_REQUIRED');
  p.spec.constraints.requiresExternalClaimEvidence = true;
  expect(
    selectPatterns([p], { ...context, externalEvidence: false }, selectionPolicy).excluded[0]!
      .reasons,
  ).toContain('EXTERNAL_EVIDENCE_REQUIRED');
});
it('uses seeded exploration and combination fatigue without a universal score', () => {
  const p = { id: 'p', status: 'ACTIVE', spec: PatternVersionSpecSchema.parse(seed) };
  const other = structuredClone(p);
  other.id = 'other';
  other.spec.identity.patternKey = 'other';
  const recent = [
    {
      patternVersionId: 'p',
      audience: context.audience,
      topic: context.topic,
      angle: context.angle,
      hookShape: p.spec.structure.hook.shape,
      proofType: 'product',
      primaryFormat: 'PROBLEM_SOLUTION',
      platform: 'INSTAGRAM',
    },
  ];
  const result = selectPatterns(
    [p, other],
    { ...context, recent },
    { ...selectionPolicy, mode: 'EXPLORE' },
  );
  expect(result).toEqual(
    selectPatterns([other, p], { ...context, recent }, { ...selectionPolicy, mode: 'EXPLORE' }),
  );
  expect(result.candidates[0]!.patternVersionId).toBe('other');
  expect(result.candidates[1]!.cautions).toEqual(['COMBINATION_FATIGUE:1']);
  expect(result.candidates[0]).not.toHaveProperty('score');
  expect(
    selectPatterns([p], { ...context, recent, audience: 'Other audience' }, selectionPolicy)
      .candidates[0]!.cautions,
  ).toEqual([]);
});
