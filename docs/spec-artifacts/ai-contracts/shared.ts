import { z } from "zod";

export const UuidSchema = z.string().uuid();
export const JsonRecordSchema = z.record(z.string(), z.unknown());

export const PlatformSchema = z.enum([
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
]);

export const PrimaryFormatSchema = z.enum([
  "PRODUCT_DEMO",
  "MANUAL_TO_VISION",
  "PROBLEM_SOLUTION",
  "GREEN_SCREEN_EXPLAINER",
  "FOUNDER_STORY",
]);

export const VerifiedClaimSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  type: z.enum([
    "PRODUCT_FACT",
    "PRICING_FACT",
    "BUSINESS_FACT",
    "EXTERNAL_STAT",
  ]),
  sourceIds: z.array(UuidSchema).min(1),
  validFrom: z.string().datetime().optional(),
  validUntil: z.string().datetime().optional(),
}).strict();

export const ForbiddenClaimSchema = z.object({
  id: z.string().min(1),
  patternOrMeaning: z.string().min(1),
  reason: z.string().min(1),
}).strict();

export const ProposedClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum([
    "PRODUCT_FACT",
    "PRICING_FACT",
    "EXTERNAL_STAT",
    "OPINION",
    "EXPERIENCE",
  ]),
  verifiedClaimIds: z.array(z.string().min(1)),
  disposition: z.enum([
    "VERIFIED",
    "HUMAN_REVIEW_REQUIRED",
  ]),
}).strict();

export const ProductFeatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const UseCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  targetAudience: z.string().optional(),
}).strict();

export const TargetCustomerSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const ValuePropositionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
}).strict();

export const CTAOptionSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  text: z.string().min(1),
  url: z.string().url().optional(),
}).strict();

export const BrandKnowledgeSnapshotSchema = z.object({
  id: UuidSchema,
  key: z.string().min(1),
  version: z.number().int().positive(),
  contentHash: z.string().min(1),
  effectiveAt: z.string().datetime(),
  brand: z.object({
    name: z.literal("Vision"),
    domain: z.string().min(1),
    primaryLanguage: z.literal("fr"),
    market: z.literal("FRANCE"),
    tone: z.array(z.string().min(1)),
    forbiddenTone: z.array(z.string().min(1)),
  }).strict(),
  product: z.object({
    category: z.string().min(1),
    description: z.string().min(1),
    features: z.array(ProductFeatureSchema),
    useCases: z.array(UseCaseSchema),
    targetCustomers: z.array(TargetCustomerSchema),
    valuePropositions: z.array(ValuePropositionSchema),
  }).strict(),
  commercial: z.object({
    pricingClaims: z.array(VerifiedClaimSchema),
    ctas: z.array(CTAOptionSchema),
  }).strict(),
  claims: z.object({
    verified: z.array(VerifiedClaimSchema),
    forbidden: z.array(ForbiddenClaimSchema),
  }).strict(),
  visualIdentity: z.object({
    allowedAssetIds: z.array(UuidSchema),
    notes: z.array(z.string()),
  }).strict(),
}).strict();

export const ConceptVersionSnapshotSchema = z.object({
  id: UuidSchema,
  conceptId: UuidSchema,
  version: z.number().int().positive(),
  title: z.string().min(1),
  angle: z.string().nullable().optional(),
  hook: z.string().nullable().optional(),
  audience: z.string().nullable().optional(),
  objective: z.string().nullable().optional(),
  hypothesis: z.string().nullable().optional(),
  selectedPatternVersionId: UuidSchema.nullable().optional(),
}).strict();

export const PatternVersionSnapshotSchema = z.object({
  id: UuidSchema,
  patternId: UuidSchema,
  version: z.number().int().positive(),
  key: z.string().min(1),
  name: z.string().min(1),
  category: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  whenToUse: z.string().nullable().optional(),
  hookStructure: JsonRecordSchema.optional(),
  storyStructure: JsonRecordSchema.optional(),
  visualStructure: JsonRecordSchema.optional(),
  ctaStyle: JsonRecordSchema.optional(),
  constraints: JsonRecordSchema.optional(),
}).strict();

export const ScriptSegmentSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  purpose: z.string().optional(),
}).strict();

export const ScriptVersionSnapshotSchema = z.object({
  id: UuidSchema,
  scriptId: UuidSchema,
  conceptVersionId: UuidSchema,
  version: z.number().int().positive(),
  language: z.string().min(1),
  fullText: z.string().min(1),
  segments: z.array(ScriptSegmentSchema),
  estimatedDurationMs: z.number().int().positive().nullable().optional(),
  voiceMode: z.enum([
    "NATURAL_USER_VOICE",
    "NO_VOICE",
    "OTHER_HUMAN",
    "AI_VOICE",
  ]),
}).strict();

export const CreativePlanVersionSnapshotSchema = z.object({
  id: UuidSchema,
  creativePlanId: UuidSchema,
  version: z.number().int().positive(),
  scriptVersionId: UuidSchema,
  templateVersionId: UuidSchema,
  editingProfileVersionId: UuidSchema,
  primaryFormat: PrimaryFormatSchema,
  targetDurationMs: z.number().int().positive().nullable().optional(),
  scenePlan: z.array(JsonRecordSchema),
  cta: JsonRecordSchema.optional(),
}).strict();

export const EditingProfileVersionSnapshotSchema = z.object({
  id: UuidSchema,
  key: z.string().min(1),
  version: z.number().int().positive(),
  policy: JsonRecordSchema,
}).strict();

export const TemplateVersionSnapshotSchema = z.object({
  id: UuidSchema,
  key: z.string().min(1),
  version: z.number().int().positive(),
  capabilities: JsonRecordSchema,
  inputSchemaSummary: JsonRecordSchema,
}).strict();

export const AssetSummarySchema = z.object({
  assetId: UuidSchema,
  kind: z.enum(["IMAGE","VIDEO","AUDIO","FONT","SUBTITLE","JSON","OTHER"]),
  source: z.enum(["UPLOAD","RECORDING","CAPTURE","RENDER","SYSTEM","EXTERNAL"]),
  durationMs: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  semanticRole: z.string().optional(),
  transcriptSegments: z.array(z.object({
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().positive(),
    text: z.string().min(1),
  }).strict()).optional(),
  visualMoments: z.array(z.object({
    atMs: z.number().int().nonnegative(),
    label: z.string().min(1),
  }).strict()).optional(),
  qualityWarnings: z.array(z.string()).optional(),
}).strict();

export const ContentMemoryItemSchema = z.object({
  conceptVersionId: UuidSchema,
  publicationIds: z.array(UuidSchema),
  topic: z.string().min(1),
  angle: z.string().min(1),
  hookType: z.string().optional(),
  patternVersionId: UuidSchema.optional(),
  templateVersionId: UuidSchema.optional(),
  editingProfileVersionId: UuidSchema.optional(),
  ctaType: z.string().optional(),
  durationMs: z.number().int().positive().optional(),
  platforms: z.array(PlatformSchema),
  performance: z.object({
    measurementWindow: z.string().min(1),
    metrics: z.object({
      views: z.number().nullable().optional(),
      avgWatchDurationMs: z.number().nullable().optional(),
      avgWatchPercentage: z.number().min(0).max(100).nullable().optional(),
      completionRate: z.number().min(0).max(1).nullable().optional(),
      shares: z.number().nullable().optional(),
      saves: z.number().nullable().optional(),
      profileVisits: z.number().nullable().optional(),
      websiteClicks: z.number().nullable().optional(),
      signups: z.number().nullable().optional(),
      activations: z.number().nullable().optional(),
      customers: z.number().nullable().optional(),
      revenueAmountMinor: z.number().nullable().optional(),
    }).strict(),
    comparabilityNotes: z.array(z.string()),
  }).strict().optional(),
}).strict();
