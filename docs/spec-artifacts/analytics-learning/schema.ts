import { z } from "zod";

export const MetricCollectionMethodSchema = z.enum([
  "PLATFORM_API",
  "MANUAL_ENTRY",
]);

export const InsightConfidenceSchema = z.enum([
  "INSUFFICIENT_DATA",
  "WEAK_SIGNAL",
  "INTERESTING_SIGNAL",
  "FAIRLY_SOLID",
]);

export const NormalizedMetricSnapshotSchema = z.object({
  publicationId: z.string().uuid(),
  rawSnapshotId: z.string().uuid().optional(),
  collectedAt: z.string().datetime(),

  views: z.number().int().nonnegative().nullable(),
  engagedViews: z.number().int().nonnegative().nullable(),
  reach: z.number().int().nonnegative().nullable(),
  impressions: z.number().int().nonnegative().nullable(),

  likes: z.number().int().nonnegative().nullable(),
  comments: z.number().int().nonnegative().nullable(),
  shares: z.number().int().nonnegative().nullable(),
  saves: z.number().int().nonnegative().nullable(),

  watchTimeMs: z.number().int().nonnegative().nullable(),
  avgWatchDurationMs: z.number().int().nonnegative().nullable(),
  avgWatchPercentage: z.number().nonnegative().nullable(),
  completionRate: z.number().min(0).max(1).nullable(),

  profileVisits: z.number().int().nonnegative().nullable(),
  websiteClicks: z.number().int().nonnegative().nullable(),
  follows: z.number().int().nonnegative().nullable(),

  otherMetrics: z.record(z.string(), z.unknown()).optional(),
  availability: z.record(z.string(), z.string()).optional(),
  comparability: z.record(z.string(), z.unknown()).optional(),

  normalizerVersion: z.string().min(1),
  metricSemanticsVersion: z.string().min(1),
}).strict();

export const AttributionEventInputSchema = z.object({
  externalEventId: z.string().min(1),
  sourceSystem: z.enum(["UMAMI", "VISION_APP", "STRIPE", "MANUAL"]),
  eventType: z.enum([
    "WEBSITE_VISIT",
    "SIGNUP",
    "ACTIVATION",
    "CUSTOMER",
    "REVENUE",
  ]),
  occurredAt: z.string().datetime(),
  userId: z.string().optional(),
  externalVisitorId: z.string().optional(),
  trackingCode: z.string().optional(),
  campaignTrackingCode: z.string().optional(),
  valueAmountMinor: z.number().int().nonnegative().optional(),
  valueCurrency: z.string().length(3).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.eventType === "REVENUE") {
    if (v.valueAmountMinor === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "REVENUE requires valueAmountMinor",
        path: ["valueAmountMinor"],
      });
    }
    if (!v.valueCurrency) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "REVENUE requires valueCurrency",
        path: ["valueCurrency"],
      });
    }
  }
});
