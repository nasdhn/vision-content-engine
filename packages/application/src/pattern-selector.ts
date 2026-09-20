import type { z } from 'zod';
import type { PatternVersionSpecSchema } from '@vision/contracts';
import { normalize, textHash } from '@vision/contracts/canonical';
import { invariant } from '@vision/domain';

export type PatternDefinition = {
  id: string;
  status: string;
  spec: z.infer<typeof PatternVersionSpecSchema>;
};
export type SelectionContext = {
  audience: string;
  useCase: string;
  topic: string;
  angle: string;
  proofType: string;
  formats: string[];
  platforms: string[];
  productProof: boolean;
  humanPresence: boolean;
  externalEvidence: boolean;
  excludeIds: string[];
  recent: {
    patternVersionId: string;
    audience: string;
    topic: string;
    angle: string;
    hookShape: string;
    proofType: string;
    primaryFormat: string;
    platform: string;
  }[];
};
export type SelectionPolicy = {
  mode: 'EXPLORE' | 'BALANCED' | 'EXPLOIT';
  seed: string;
  limit: number;
  explorationSlots: number;
  fatiguePenalty: number;
};
/** Inspectable context-local ordering; no persisted or universal performance score. */
export function selectPatterns(
  patterns: PatternDefinition[],
  context: SelectionContext,
  policy: SelectionPolicy,
) {
  invariant(
    Number.isSafeInteger(policy.limit) &&
      policy.limit > 0 &&
      Number.isSafeInteger(policy.explorationSlots) &&
      policy.explorationSlots >= 0 &&
      policy.explorationSlots <= policy.limit &&
      Number.isFinite(policy.fatiguePenalty) &&
      policy.fatiguePenalty >= 0,
    'INVALID_SELECTION_POLICY',
  );
  const excluded: { patternVersionId: string; reasons: string[] }[] = [];
  const eligible = patterns.flatMap((p) => {
    const c = p.spec.constraints;
    const reasons = [
      ...(p.status !== 'ACTIVE' ? ['NOT_ACTIVE'] : []),
      ...(context.excludeIds.includes(p.id) ? ['EXPLICIT_EXCLUSION'] : []),
      ...(!p.spec.adaptation.compatiblePrimaryFormats.some((f) => context.formats.includes(f))
        ? ['FORMAT_INCOMPATIBLE']
        : []),
      ...(c.requiresProductProof && !context.productProof ? ['PRODUCT_PROOF_REQUIRED'] : []),
      ...(c.requiresHumanPresence && !context.humanPresence ? ['HUMAN_PRESENCE_REQUIRED'] : []),
      ...(c.requiresExternalClaimEvidence && !context.externalEvidence
        ? ['EXTERNAL_EVIDENCE_REQUIRED']
        : []),
    ];
    if (reasons.length) {
      excluded.push({ patternVersionId: p.id, reasons });
      return [];
    }
    const fit =
      Number(
        p.spec.adaptation.suitableAudiences.some(
          (s) => normalize(s) === normalize(context.audience),
        ),
      ) +
      Number(
        p.spec.adaptation.suitableVisionUseCases.some(
          (s) => normalize(s) === normalize(context.useCase),
        ),
      );
    const usage = context.recent.filter((r) => r.patternVersionId === p.id);
    const fatigue = usage.filter(
      (r) =>
        normalize(r.audience) === normalize(context.audience) &&
        normalize(r.topic) === normalize(context.topic) &&
        normalize(r.angle) === normalize(context.angle) &&
        r.hookShape === p.spec.structure.hook.shape &&
        r.proofType === context.proofType &&
        context.formats.includes(r.primaryFormat) &&
        context.platforms.includes(r.platform),
    ).length;
    return [
      {
        patternVersionId: p.id,
        eligibilityReasons: [
          'ACTIVE',
          'PRODUCTION_COMPATIBLE',
          `STRATEGIC_FIT:${fit}`,
          `RECENT_USES:${usage.length}`,
        ],
        cautions: fatigue ? [`COMBINATION_FATIGUE:${fatigue}`] : [],
        fit,
        fatigue,
        uses: usage.length,
        tie: textHash(`${policy.seed}:${p.spec.identity.patternKey}`),
      },
    ];
  });
  const explore = [...eligible].sort((a, b) => a.uses - b.uses || a.tie.localeCompare(b.tie));
  const exploit = [...eligible].sort(
    (a, b) =>
      b.fit - b.fatigue * policy.fatiguePenalty - (a.fit - a.fatigue * policy.fatiguePenalty) ||
      a.tie.localeCompare(b.tie),
  );
  const order =
    policy.mode === 'EXPLORE'
      ? explore
      : policy.mode === 'EXPLOIT'
        ? exploit
        : [...explore.slice(0, policy.explorationSlots), ...exploit];
  const seen = new Set<string>();
  const candidates = order
    .filter((p) => !seen.has(p.patternVersionId) && !!seen.add(p.patternVersionId))
    .slice(0, policy.limit)
    .map(({ patternVersionId, eligibilityReasons, cautions }) => ({
      patternVersionId,
      eligibilityReasons,
      cautions,
    }));
  return { candidates, excluded };
}
