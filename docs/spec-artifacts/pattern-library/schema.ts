import { z } from "zod";

export const PatternCategorySchema = z.enum([
  "PAIN",
  "TRANSFORMATION",
  "DEMONSTRATION",
  "EDUCATION",
  "CONTRARIAN",
  "PROOF",
  "FOUNDER",
  "OBJECTION",
]);

export const PatternHookShapeSchema = z.enum([
  "QUESTION",
  "PROBLEM_STATEMENT",
  "CONTRARIAN_CLAIM",
  "RESULT_FIRST",
  "MISTAKE",
  "COMPARISON",
  "LIVE_PROOF",
  "OBSERVATION",
]);

export const PatternStoryRoleSchema = z.enum([
  "HOOK",
  "CONTEXT",
  "PAIN",
  "PROOF",
  "TRANSFORMATION",
  "EXPLANATION",
  "OBJECTION",
  "DEMO",
  "CTA",
]);

export const PatternVisualModeSchema = z.enum([
  "PRODUCT_SCREEN",
  "GREEN_SCREEN_PRESENTER",
  "TEXT_LED",
  "BEFORE_AFTER",
  "COMPARISON",
  "BROLL",
]);

export const PatternCtaTypeSchema = z.enum([
  "SOFT_DISCOVERY",
  "TRY_PRODUCT",
  "VISIT_PROFILE",
  "COMMENT",
  "SAVE",
  "FOLLOW",
  "NO_CTA",
]);

export const PatternProvenanceSourceSchema = z.enum([
  "INTERNAL_SYNTHESIS",
  "USER_OBSERVATION",
  "REFERENCE_ANALYSIS",
  "PERFORMANCE_DERIVED",
  "RESEARCH_DERIVED",
]);

export const PatternVersionSpecSchema = z.object({
  identity: z.object({
    patternVersionId: z.string().uuid(),
    patternKey: z.string().min(1),
    name: z.string().min(1),
    version: z.number().int().positive(),
    category: PatternCategorySchema,
    tags: z.array(z.string().min(1)),
  }).strict(),

  thesis: z.object({
    description: z.string().min(1),
    psychologicalMechanism: z.string().min(1),
    whyItMayWork: z.string().min(1),
    whenToUse: z.array(z.string().min(1)).min(1),
    whenNotToUse: z.array(z.string().min(1)).min(1),
  }).strict(),

  structure: z.object({
    hook: z.object({
      objective: z.string().min(1),
      shape: PatternHookShapeSchema,
      formula: z.string().min(1),
      timingGuidance: z.object({
        targetFirstBeatMs: z.number().int().nonnegative(),
        maxSetupMs: z.number().int().nonnegative(),
      }).strict(),
      originalExamples: z.array(z.string().min(1)).min(1),
    }).strict(),

    story: z.array(z.object({
      order: z.number().int().nonnegative(),
      role: PatternStoryRoleSchema,
      objective: z.string().min(1),
      optional: z.boolean(),
      durationWeight: z.number().positive().optional(),
    }).strict()).min(1),

    visual: z.object({
      openingVisualIntent: z.string().min(1),
      recommendedVisualModes: z.array(PatternVisualModeSchema).min(1),
      proofMoment: z.string().optional(),
      recommendedRevealWindow: z.object({
        minMs: z.number().int().nonnegative(),
        maxMs: z.number().int().positive(),
      }).strict().optional(),
      visualFailureModes: z.array(z.string().min(1)),
    }).strict(),

    cta: z.object({
      preferredTypes: z.array(PatternCtaTypeSchema).min(1),
      tone: z.string().min(1),
      placementGuidance: z.enum([
        "EARLY",
        "MIDDLE",
        "END",
        "CONTEXT_DEPENDENT",
      ]),
      avoid: z.array(z.string().min(1)),
    }).strict(),
  }).strict(),

  adaptation: z.object({
    suitableVisionUseCases: z.array(z.string().min(1)).min(1),
    suitableAudiences: z.array(z.string().min(1)).min(1),
    compatiblePrimaryFormats: z.array(z.enum([
      "PRODUCT_DEMO",
      "MANUAL_TO_VISION",
      "PROBLEM_SOLUTION",
      "GREEN_SCREEN_EXPLAINER",
      "FOUNDER_STORY",
    ])).min(1),
    compatibleEditingProfileKeys: z.array(z.string().min(1)).min(1),
  }).strict(),

  constraints: z.object({
    forbiddenMoves: z.array(z.string().min(1)),
    commonFailureModes: z.array(z.string().min(1)),
    requiresProductProof: z.boolean(),
    requiresHumanPresence: z.boolean(),
    requiresExternalClaimEvidence: z.boolean(),
  }).strict(),

  provenance: z.object({
    sourceType: PatternProvenanceSourceSchema,
    sourceReferenceIds: z.array(z.string()),
    createdBy: z.enum(["HUMAN", "AI_ASSISTED"]),
    abstractionNotes: z.string().optional(),
  }).strict(),
}).strict();

export const PatternEvidenceSnapshotSchema = z.object({
  patternVersionId: z.string().uuid(),
  computedAt: z.string().datetime(),
  analysisWindow: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).strict(),
  usage: z.object({
    conceptCount: z.number().int().nonnegative(),
    publishedCount: z.number().int().nonnegative(),
  }).strict(),
  signals: z.array(z.object({
    metric: z.string().min(1),
    observation: z.string().min(1),
    confidence: z.enum([
      "INSUFFICIENT_DATA",
      "WEAK_SIGNAL",
      "INTERESTING_SIGNAL",
      "FAIRLY_SOLID",
    ]),
    comparablePublicationIds: z.array(z.string().uuid()),
    limitations: z.array(z.string()),
  }).strict()),
  knownBiases: z.array(z.string()),
}).strict();
