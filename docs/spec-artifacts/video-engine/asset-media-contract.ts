import { z } from "zod";

export const MediaAssetIngestSpecSchema = z.object({
  assetId: z.string().uuid(),
  sourceType: z.enum([
    "UPLOAD","RECORDING","CAPTURE","RENDER","SYSTEM","EXTERNAL"
  ]),
  objectKey: z.string().min(1),
  expectedChecksumSha256: z.string().optional(),
  declaredMimeType: z.string().optional(),
  allowNetworkFetch: z.literal(false),
}).strict();

export const MediaNormalizationResultSchema = z.object({
  sourceAssetId: z.string().uuid(),
  normalizedAssetId: z.string().uuid().optional(),
  probeVersion: z.string().min(1),
  colorProfileKey: z.string().min(1),
  normalizationApplied: z.boolean(),
  operations: z.array(z.string()),
  warnings: z.array(z.string()),
}).strict();
