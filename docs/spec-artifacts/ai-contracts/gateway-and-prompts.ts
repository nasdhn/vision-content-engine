import { z } from "zod";

export const CapabilitySchema = z.enum([
  "CREATOR",
  "CREATIVE_DIRECTOR",
  "EDITING_INTELLIGENCE",
  "CREATIVE_QA",
  "ANALYST",
]);

export const ModelPolicySchema = z.object({
  capability: CapabilitySchema,
  preferredProvider: z.string().optional(),
  preferredModel: z.string().optional(),
  reasoningLevel: z.string().optional(),
  maxAttempts: z.number().int().positive(),
  timeoutMs: z.number().int().positive(),
  fallbackPolicy: z.enum([
    "NONE",
    "SAME_CONTRACT_ALLOWED",
  ]),
  maxInputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive().optional(),
  maxEstimatedCost: z.number().nonnegative().optional(),
}).strict();

export const PromptArtifactSchema = z.object({
  key: z.string().min(1),
  version: z.string().min(1),
  capability: CapabilitySchema,
  schemaVersion: z.string().min(1),
  contentHash: z.string().min(1),
  status: z.enum(["DRAFT", "ACTIVE", "DEPRECATED"]),
  content: z.string().min(1),
}).strict();
