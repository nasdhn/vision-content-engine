import type { z } from 'zod';
import { z as schema } from 'zod';
import type {
  BrandKnowledgeSnapshotSchema,
  ProposedClaimSchema,
  CreatorInputSchema,
  CreatorOutputSchema,
  CreativeDirectorInputSchema,
  CreativeDirectorOutputSchema,
} from '@vision/contracts';
import { normalize } from '@vision/contracts/canonical';
import { invariant } from '@vision/domain';

type Knowledge = z.infer<typeof BrandKnowledgeSnapshotSchema>;
type Claim = z.infer<typeof ProposedClaimSchema>;
export function validateClaims(knowledge: Knowledge, claims: Claim[], copy: string[], now: Date) {
  const evidence = [...knowledge.claims.verified, ...knowledge.commercial.pricingClaims];
  const texts = [...copy, ...claims.map((c) => c.text)];
  for (const forbidden of knowledge.claims.forbidden) {
    invariant(
      !texts.some((s) => normalize(s).includes(normalize(forbidden.patternOrMeaning))),
      'FORBIDDEN_CLAIM',
    );
  }
  for (const claim of claims) {
    const refs = claim.verifiedClaimIds.map((id) => evidence.find((c) => c.id === id));
    invariant(refs.every(Boolean), 'UNKNOWN_VERIFIED_CLAIM');
    invariant(
      refs.every(
        (r) =>
          (!r!.validFrom || new Date(r!.validFrom) <= now) &&
          (!r!.validUntil || now < new Date(r!.validUntil)),
      ),
      'EXPIRED_CLAIM',
    );
    const factual = ['PRODUCT_FACT', 'PRICING_FACT', 'EXTERNAL_STAT'].includes(claim.type);
    if (claim.disposition === 'VERIFIED' && factual) {
      invariant(refs.length > 0, 'UNSOURCED_CLAIM');
      // Conservative deterministic acceptance: a reference ID alone cannot substantiate new prose.
      invariant(
        refs.some((r) => normalize(r!.text) === normalize(claim.text) && r!.type === claim.type),
        'CLAIM_EVIDENCE_MISMATCH',
      );
    }
    if (claim.type === 'EXTERNAL_STAT' || /\p{N}/u.test(claim.text)) {
      invariant(
        claim.disposition === 'VERIFIED' &&
          refs.length > 0 &&
          refs.some((r) => normalize(r!.text) === normalize(claim.text)),
        'UNSOURCED_NUMERICAL_CLAIM',
      );
    }
  }
  // Declaring an empty claims list must not hide numerical assertions in generated copy.
  for (const text of copy) {
    let unmatched = normalize(text);
    for (const e of evidence) {
      if (
        claims.some(
          (c) =>
            c.disposition === 'VERIFIED' &&
            c.verifiedClaimIds.includes(e.id) &&
            normalize(c.text) === normalize(e.text),
        )
      )
        unmatched = unmatched.replaceAll(normalize(e.text), '');
    }
    invariant(!/\p{N}/u.test(unmatched), 'UNSOURCED_NUMERICAL_CLAIM');
  }
}
const unique = (values: string[], code: string) =>
  invariant(new Set(values.map(normalize)).size === values.length, code);
function similarity(a: string, b: string) {
  const x = new Set(normalize(a).split(' '));
  const y = new Set(normalize(b).split(' '));
  return [...x].filter((s) => y.has(s)).length / new Set([...x, ...y]).size;
}
export type CreatorValidationPolicy = {
  minDurationSec: number;
  maxDurationSec: number;
  recentHooks: string[];
  now: Date;
  deliberateVariant?: {
    conceptVersionId: string;
    keepConstant: string[];
    change: string[];
    reason: string;
  };
};
export function validateCreator(
  input: z.infer<typeof CreatorInputSchema>,
  output: z.infer<typeof CreatorOutputSchema>,
  policy: CreatorValidationPolicy,
) {
  invariant(
    output.concepts.length > 0 &&
      output.concepts.length <= input.generationConstraints.requestedConceptCount,
    'CONCEPT_COUNT_INVALID',
  );
  unique(
    output.concepts.map((c) => c.clientKey),
    'DUPLICATE_CLIENT_KEY',
  );
  unique(
    output.concepts.map((c) => c.hook),
    'DUPLICATE_HOOK',
  );
  for (const concept of output.concepts) {
    invariant(
      [
        concept.clientKey,
        concept.title,
        concept.angle,
        concept.hook,
        concept.audience,
        concept.objective,
        concept.hypothesis,
        ...Object.values(concept.rationale),
      ].every((s) => s.trim().length > 0),
      'EMPTY_REQUIRED_FIELD',
    );
    invariant(
      input.patternCandidates.some((p) => p.patternVersionId === concept.selectedPatternVersionId),
      'UNKNOWN_PATTERN_VERSION',
    );
    invariant(!concept.ideaId || input.ideas.some((i) => i.id === concept.ideaId), 'UNKNOWN_IDEA');
    invariant(
      input.generationConstraints.allowedPrimaryFormats.includes(
        concept.formatRecommendation.primaryFormat,
      ),
      'FORMAT_NOT_ALLOWED',
    );
    invariant(
      concept.formatRecommendation.targetDurationSec >= policy.minDurationSec &&
        concept.formatRecommendation.targetDurationSec <= policy.maxDurationSec,
      'DURATION_OUT_OF_BOUNDS',
    );
    invariant(
      !policy.recentHooks.some((hook) => normalize(hook) === normalize(concept.hook)),
      'DUPLICATE_HOOK',
    );
    const diversity = input.generationConstraints.diversity;
    invariant(
      !diversity.maxSamePatternCount ||
        output.concepts.filter(
          (c) => c.selectedPatternVersionId === concept.selectedPatternVersionId,
        ).length <= diversity.maxSamePatternCount,
      'PATTERN_DIVERSITY',
    );
    invariant(
      !diversity.maxSameAngleCount ||
        output.concepts.filter((c) => normalize(c.angle) === normalize(concept.angle)).length <=
          diversity.maxSameAngleCount,
      'ANGLE_DIVERSITY',
    );
    if (diversity.avoidRecentSemanticSimilarityAbove !== undefined) {
      invariant(
        !input.contentMemory.some(
          (m) =>
            m.conceptVersionId !== policy.deliberateVariant?.conceptVersionId &&
            similarity(`${m.topic} ${m.angle}`, `${concept.title} ${concept.angle}`) >
              diversity.avoidRecentSemanticSimilarityAbove!,
        ),
        'RECENT_SIMILARITY',
      );
    }
    validateClaims(
      input.brandKnowledge,
      concept.factualClaims,
      [concept.title, concept.hook, concept.angle, concept.hypothesis],
      policy.now,
    );
  }
}
export function validateDirector(
  input: z.infer<typeof CreativeDirectorInputSchema>,
  output: z.infer<typeof CreativeDirectorOutputSchema>,
  now: Date,
) {
  const plan = output.creativePlan;
  const script = output.script;
  invariant(
    [
      script.fullText,
      plan.cta.type,
      plan.cta.text,
      ...script.segments.flatMap((s) => [s.id, s.text]),
      ...plan.scenes.flatMap((s) => [s.clientKey, s.objective, s.visualIntent]),
      ...plan.recordingRequests.flatMap((r) => [r.clientKey, r.title, r.instructions]),
      ...plan.captureRequests.flatMap((r) => [
        r.clientKey,
        r.editorialPurpose,
        ...r.desiredOutputs.map((o) => o.moment),
      ]),
    ].every((s) => s.trim().length > 0),
    'EMPTY_REQUIRED_FIELD',
  );
  invariant(
    input.templateCandidates.some((t) => t.templateVersionId === plan.templateVersionId),
    'UNKNOWN_TEMPLATE_VERSION',
  );
  invariant(
    input.editingProfileCandidates.some(
      (p) => p.editingProfileVersionId === plan.editingProfileVersionId,
    ),
    'UNKNOWN_EDITING_PROFILE_VERSION',
  );
  invariant(
    plan.requiredExistingAssetIds.every((id) =>
      input.availableAssets.some((a) => a.assetId === id),
    ),
    'UNKNOWN_ASSET',
  );
  invariant(
    plan.targetDurationSec >= input.constraints.minDurationSec &&
      plan.targetDurationSec <= input.constraints.maxDurationSec &&
      script.estimatedDurationSec >= input.constraints.minDurationSec &&
      script.estimatedDurationSec <= input.constraints.maxDurationSec,
    'DURATION_OUT_OF_BOUNDS',
  );
  unique(
    script.segments.map((s) => s.id),
    'DUPLICATE_SEGMENT',
  );
  unique(
    [...plan.scenes, ...plan.recordingRequests, ...plan.captureRequests].map((s) => s.clientKey),
    'DUPLICATE_CLIENT_KEY',
  );
  invariant(
    normalize(script.fullText) === normalize(script.segments.map((s) => s.text).join(' ')),
    'SCRIPT_SEGMENT_MISMATCH',
  );
  for (const block of [...plan.scenes, ...plan.recordingRequests])
    invariant(
      block.scriptSegmentRefs.every((id) => script.segments.some((s) => s.id === id)),
      'UNKNOWN_SCRIPT_SEGMENT',
    );
  for (const capture of plan.captureRequests) {
    const candidate = input.captureScenarioCandidates.find(
      (c) => c.captureScenarioVersionId === capture.captureScenarioVersionId,
    );
    invariant(candidate, 'UNKNOWN_CAPTURE_SCENARIO_VERSION');
    invariant(input.productionCapabilities.playwrightCaptureAvailable, 'CAPTURE_NOT_AVAILABLE');
    invariant(
      capture.desiredOutputs.every((o) => candidate.outputCapabilities.includes(o.role)),
      'CAPTURE_OUTPUT_NOT_SUPPORTED',
    );
    invariant(
      schema.fromJSONSchema(candidate.inputSchemaSummary).safeParse(capture.scenarioInput).success,
      'CAPTURE_INPUT_INVALID',
    );
  }
  invariant(
    script.voiceMode !== 'NATURAL_USER_VOICE' || input.productionCapabilities.naturalVoiceAvailable,
    'VOICE_NOT_AVAILABLE',
  );
  invariant(
    !plan.recordingRequests.some((r) => r.type === 'GREEN_SCREEN_VIDEO') ||
      input.productionCapabilities.greenScreenPresenterAvailable,
    'PRESENTER_NOT_AVAILABLE',
  );
  invariant(
    plan.platformConsiderations.every((p) =>
      input.constraints.targetPlatforms.includes(p.platform),
    ),
    'PLATFORM_NOT_REQUESTED',
  );
  invariant(
    input.brandKnowledge.commercial.ctas.some(
      (c) => c.type === plan.cta.type && normalize(c.text) === normalize(plan.cta.text),
    ),
    'CTA_NOT_ALLOWED',
  );
  validateClaims(
    input.brandKnowledge,
    output.factualClaims,
    [script.fullText, plan.cta.text, ...plan.scenes.map((s) => s.visualIntent)],
    now,
  );
}
