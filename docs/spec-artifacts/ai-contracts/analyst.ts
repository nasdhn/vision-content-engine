import { z } from "zod";
import { PlatformSchema, PrimaryFormatSchema, UuidSchema } from "./shared";

export const AnalystPublicationSchema = z.object({
  publicationId: UuidSchema,
  platform: PlatformSchema,
  publishedAt: z.string().datetime(),
  measurementWindow: z.string().min(1),
  contentDimensions: z.object({
    patternVersionId: UuidSchema.optional(),
    hookType: z.string().optional(),
    templateVersionId: UuidSchema.optional(),
    editingProfileVersionId: UuidSchema.optional(),
    ctaType: z.string().optional(),
    durationMs: z.number().int().positive().optional(),
    primaryFormat: PrimaryFormatSchema.optional(),
  }).strict(),
  normalizedMetrics: z.object({
    views: z.number().nullable().optional(),
    engagedViews: z.number().nullable().optional(),
    reach: z.number().nullable().optional(),
    impressions: z.number().nullable().optional(),
    likes: z.number().nullable().optional(),
    comments: z.number().nullable().optional(),
    shares: z.number().nullable().optional(),
    saves: z.number().nullable().optional(),
    watchTimeMs: z.number().nullable().optional(),
    avgWatchDurationMs: z.number().nullable().optional(),
    avgWatchPercentage: z.number().min(0).max(100).nullable().optional(),
    completionRate: z.number().min(0).max(1).nullable().optional(),
    profileVisits: z.number().nullable().optional(),
    websiteClicks: z.number().nullable().optional(),
    follows: z.number().nullable().optional(),
  }).strict(),
  comparability: z.object({
    comparableMetricKeys: z.array(z.string()),
    limitations: z.array(z.string()),
  }).strict(),
}).strict();

const AnalystExperimentSchema = z.object({
  experimentId: UuidSchema,
  hypothesis: z.string().min(1),
  primaryMetric: z.string().min(1),
  status: z.enum(["DRAFT","RUNNING","COMPLETED","CANCELLED"]),
  arms: z.array(z.object({
    label: z.string().min(1),
    publicationIds: z.array(UuidSchema),
    variables: z.record(z.string(), z.unknown()),
  }).strict()),
}).strict();

const PriorInsightSchema = z.object({
  insightId: UuidSchema,
  statement: z.string().min(1),
  confidence: z.enum([
    "INSUFFICIENT_DATA","WEAK_SIGNAL","INTERESTING_SIGNAL","FAIRLY_SOLID",
  ]),
  limitations: z.array(z.string()),
}).strict();

export const AnalystInputSchema = z.object({
  analysisWindow: z.object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  }).strict(),
  publications: z.array(AnalystPublicationSchema),
  experiments: z.array(AnalystExperimentSchema),
  priorInsights: z.array(PriorInsightSchema),
  attributionSignals: z.object({
    websiteVisits: z.number().nullable().optional(),
    signups: z.number().nullable().optional(),
    activations: z.number().nullable().optional(),
    customers: z.number().nullable().optional(),
    revenueAmountMinor: z.number().nullable().optional(),
    revenueCurrency: z.string().length(3).nullable().optional(),
    directPublicationLinks: z.number().nullable().optional(),
    inferredSignals: z.number().nullable().optional(),
  }).strict(),
  minimumEvidencePolicy: z.object({
    minimumComparableSamples: z.number().int().positive(),
    confidenceRulesVersion: z.string().min(1),
  }).strict(),
}).strict();

export const AnalystOutputSchema = z.object({
  insights: z.array(z.object({
    statement: z.string().min(1),
    confidence: z.enum([
      "INSUFFICIENT_DATA","WEAK_SIGNAL","INTERESTING_SIGNAL","FAIRLY_SOLID",
    ]),
    evidencePublicationIds: z.array(UuidSchema),
    limitations: z.array(z.string()),
    dimensions: z.object({
      patternVersionIds: z.array(UuidSchema).optional(),
      hookTypes: z.array(z.string()).optional(),
      editingProfileVersionIds: z.array(UuidSchema).optional(),
      platforms: z.array(PlatformSchema).optional(),
    }).strict(),
  }).strict()),
  recommendations: z.array(z.object({
    title: z.string().min(1),
    description: z.string().min(1),
    nextTest: z.object({
      hypothesis: z.string().min(1),
      change: z.string().min(1),
      keepConstant: z.array(z.string()),
      primaryMetric: z.string().min(1),
      measurementWindow: z.string().min(1),
    }).strict(),
  }).strict()),
}).strict();
