import { z } from 'zod';
import { RUNTIME_INTEGER_MAX } from './runtime-budget.js';

export const CapabilitySchema = z.enum([
  'CREATOR',
  'CREATIVE_DIRECTOR',
  'EDITING_INTELLIGENCE',
  'CREATIVE_QA',
  'ANALYST',
]);

export const ModelPolicySchema = z
  .object({
    capability: CapabilitySchema,
    preferredProvider: z.string().optional(),
    preferredModel: z.string().optional(),
    reasoningLevel: z.string().optional(),
    maxAttempts: z.number().int().positive().max(RUNTIME_INTEGER_MAX),
    timeoutMs: z.number().int().positive().max(RUNTIME_INTEGER_MAX),
    fallbackPolicy: z.enum(['NONE', 'SAME_CONTRACT_ALLOWED']),
    maxInputTokens: z.number().int().positive().max(RUNTIME_INTEGER_MAX).optional(),
    maxOutputTokens: z.number().int().positive().max(RUNTIME_INTEGER_MAX).optional(),
    maxEstimatedCost: z
      .number()
      .nonnegative()
      .max(9_999_999_999)
      .refine((value) => Number(value.toFixed(8)) === value, {
        message: 'Cost precision exceeds 8 decimals',
      })
      .optional(),
  })
  .strict()
  .superRefine((policy, ctx) => {
    for (const field of ['maxInputTokens', 'maxOutputTokens'] as const) {
      if (policy[field] !== undefined && policy[field] * policy.maxAttempts > RUNTIME_INTEGER_MAX)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Aggregate token limit exceeds persisted integer range',
        });
    }
  });

export const PromptArtifactSchema = z
  .object({
    key: z.string().min(1),
    version: z.string().min(1),
    capability: CapabilitySchema,
    schemaVersion: z.string().min(1),
    contentHash: z.string().min(1),
    status: z.enum(['DRAFT', 'ACTIVE', 'DEPRECATED']),
    content: z.string().min(1),
  })
  .strict();

export const ModelInvocationAttemptRecordSchema = z
  .object({
    attemptNumber: z.number().int().positive().max(RUNTIME_INTEGER_MAX),
    provider: z.string().min(1),
    model: z.string().min(1),
    reasoningLevel: z.string().optional(),
    status: z.enum(['RUNNING', 'SUCCEEDED', 'FAILED', 'REJECTED_SCHEMA']),
    requestHash: z.string().min(1),
    responseHash: z.string().optional(),
    requestPayloadRef: z.string().optional(),
    responsePayloadRef: z.string().optional(),
    rawPayloadExpiresAt: z.string().datetime().optional(),
    inputTokens: z.number().int().nonnegative().optional(),
    outputTokens: z.number().int().nonnegative().optional(),
    cachedInputTokens: z.number().int().nonnegative().optional(),
    latencyMs: z.number().int().nonnegative().optional(),
    costAmount: z.number().nonnegative().optional(),
    costCurrency: z.string().length(3).optional(),
    validation: z.record(z.string(), z.unknown()).optional(),
    failureCode: z.string().optional(),
  })
  .strict();
