import { z } from "zod";

export const PlatformSchema = z.enum([
  "TIKTOK",
  "INSTAGRAM",
  "YOUTUBE",
]);

export const PublicationDeliveryModeSchema = z.enum([
  "API_AUTOMATED",
  "MANUAL_HANDOFF",
]);

export const PublicationStatusSchema = z.enum([
  "DRAFT",
  "SCHEDULED",
  "READY_FOR_MANUAL_PUBLISH",
  "PUBLISHING",
  "PUBLISHING_UNKNOWN",
  "PUBLISHED",
  "FAILED",
  "CANCELLED",
]);

export const AssetDerivationSchema = z.object({
  sourceAssetId: z.string().uuid(),
  derivedAssetId: z.string().uuid(),
  type: z.literal("PLATFORM_DERIVATIVE"),
  platform: PlatformSchema.optional(),
  transformationProfileKey: z.string().min(1),
  transformationProfileVersion: z.string().min(1),
  metadata: z.unknown().optional(),
}).strict();

export const InstagramReelMetadataSchema = z.object({
  schemaVersion: z.literal("instagram-reel-v1"),
  platform: z.literal("INSTAGRAM"),
  caption: z.string(),
  shareToFeed: z.boolean(),
}).strict();

export const YouTubeShortMetadataSchema = z.object({
  schemaVersion: z.literal("youtube-short-v1"),
  platform: z.literal("YOUTUBE"),
  title: z.string().min(1),
  description: z.string(),
  tags: z.array(z.string()),
  categoryId: z.string().min(1),
  defaultLanguage: z.string().default("fr"),
  privacyStatus: z.enum(["private", "public", "unlisted"]),
  publishAt: z.string().datetime().optional(),
  selfDeclaredMadeForKids: z.boolean(),
  containsSyntheticMedia: z.boolean().optional(),
}).strict();

export const TikTokManualMetadataSchema = z.object({
  schemaVersion: z.literal("tiktok-manual-handoff-v1"),
  platform: z.literal("TIKTOK"),
  caption: z.string(),
  hashtags: z.array(z.string()),
  ctaNotes: z.string().optional(),
  coverRecommendation: z.string().optional(),
  commercialDisclosureReminder: z.boolean(),
}).strict();

export const PlatformCapabilitiesSchema = z.object({
  schemaVersion: z.literal("v1"),
  canPublishVideo: z.boolean(),
  canPublishPublic: z.boolean(),
  supportsNativeScheduling: z.boolean(),
  deliveryMode: PublicationDeliveryModeSchema,
  limitations: z.array(z.string()),
  checkedAt: z.string().datetime(),
}).strict();

export const DeliveryUrlLeaseSchema = z.object({
  assetId: z.string().uuid(),
  platform: z.literal("INSTAGRAM"),
  url: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

export const ManualPublishConfirmationSchema = z.object({
  publicationId: z.string().uuid(),
  confirmedPublishedAt: z.string().datetime(),
  remoteUrl: z.string().url().optional(),
  notes: z.string().optional(),
}).strict();
