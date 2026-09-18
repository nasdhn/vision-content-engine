import { z } from "zod";

export const UuidSchema = z.string().uuid();

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

export const ProposedClaimSchema = z.object({
  text: z.string().min(1),
  type: z.enum([
    "PRODUCT_FACT",
    "PRICING_FACT",
    "EXTERNAL_STAT",
    "OPINION",
    "EXPERIENCE",
  ]),
  verifiedClaimIds: z.array(UuidSchema),
  disposition: z.enum([
    "VERIFIED",
    "HUMAN_REVIEW_REQUIRED",
  ]),
}).strict();

export const BrandKnowledgeSnapshotSchema = z.object({
  version: z.string().min(1),
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
    features: z.array(z.unknown()),
    useCases: z.array(z.unknown()),
    targetCustomers: z.array(z.unknown()),
    valuePropositions: z.array(z.unknown()),
  }).strict(),
  commercial: z.object({
    pricingClaims: z.array(z.unknown()),
    ctas: z.array(z.unknown()),
  }).strict(),
  claims: z.object({
    verified: z.array(z.unknown()),
    forbidden: z.array(z.unknown()),
  }).strict(),
  visualIdentity: z.object({
    allowedAssetIds: z.array(UuidSchema),
    notes: z.array(z.string()),
  }).strict(),
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
      avgWatchPercentage: z.number().nullable().optional(),
      completionRate: z.number().nullable().optional(),
      shares: z.number().nullable().optional(),
      saves: z.number().nullable().optional(),
      profileVisits: z.number().nullable().optional(),
      websiteClicks: z.number().nullable().optional(),
    }).strict(),
    comparabilityNotes: z.array(z.string()),
  }).strict().optional(),
}).strict();
