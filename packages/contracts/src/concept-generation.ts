import { z } from 'zod';

import { CreatorInputSchema, CreatorOutputSchema } from './creator.js';
import { ModelPolicySchema } from './gateway-and-prompts.js';
import { RuntimeBudgetSchema } from './runtime-budget.js';
import { UuidSchema } from './shared.js';

export const CONCEPT_GENERATION_QUEUE_NAME = 'ai' as const;
export const CONCEPT_GENERATION_JOB_TYPE = 'AI' as const;
export const CONCEPT_GENERATION_REQUEST_BOUND_ACTION = 'ConceptGeneration.requestBound' as const;

export const ConceptGenerationSelectionSchema = z
  .object({
    audience: z.string().trim().min(1),
    useCase: z.string().trim().min(1),
    topic: z.string().trim().min(1),
    angle: z.string().trim().min(1),
    proofType: z.string().trim().min(1),
    productProof: z.boolean(),
    humanPresence: z.boolean(),
    externalEvidence: z.boolean(),
    excludeIds: z.array(UuidSchema),
  })
  .strict();

export const ConceptGenerationSelectionPolicySchema = z
  .object({
    mode: z.enum(['EXPLORE', 'BALANCED', 'EXPLOIT']),
    seed: z.string().min(1),
    limit: z.number().int().positive(),
    explorationSlots: z.number().int().nonnegative(),
    fatiguePenalty: z.number().nonnegative(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.explorationSlots > value.limit) {
      ctx.addIssue({
        code: 'custom',
        path: ['explorationSlots'],
        message: 'explorationSlots must not exceed limit',
      });
    }
  });

export const ConceptGenerationDurationSchema = z
  .object({
    minDurationSec: z.number().nonnegative(),
    maxDurationSec: z.number().positive(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.maxDurationSec <= value.minDurationSec) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxDurationSec'],
        message: 'maxDurationSec must exceed minDurationSec',
      });
    }
  });

const ConceptGenerationRequestBodySchema = z
  .object({
    requestId: UuidSchema,
    briefId: UuidSchema,
    knowledgeSnapshotId: UuidSchema,
    ideaIds: z.array(UuidSchema),
    generationConstraints: CreatorInputSchema.shape.generationConstraints,
    selection: ConceptGenerationSelectionSchema,
    selectionPolicy: ConceptGenerationSelectionPolicySchema,
    duration: ConceptGenerationDurationSchema,
    policy: ModelPolicySchema,
    budget: RuntimeBudgetSchema,
  })
  .strict();

function validateConceptGenerationRequest(
  value: z.infer<typeof ConceptGenerationRequestBodySchema>,
  ctx: z.RefinementCtx,
) {
  if (value.policy.capability !== 'CREATOR') {
    ctx.addIssue({
      code: 'custom',
      path: ['policy', 'capability'],
      message: 'Concept generation requires CREATOR capability',
    });
  }

  for (const field of ['maxInputTokens', 'maxOutputTokens', 'maxEstimatedCost'] as const) {
    if (value.policy[field] === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['policy', field],
        message: `${field} is required for durable generation`,
      });
    }
  }

  if (new Set(value.ideaIds).size !== value.ideaIds.length) {
    ctx.addIssue({
      code: 'custom',
      path: ['ideaIds'],
      message: 'ideaIds must be unique',
    });
  }
}

export const ConceptGenerationCheckpointMetadataSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    kind: z.literal('CONCEPT_GENERATION'),
    requestId: UuidSchema,
    briefVersionId: UuidSchema,
    knowledgeSnapshotId: UuidSchema,
  })
  .strict();

export const ConceptGenerationOutputCheckpointSchema = z
  .object({
    outputHash: z.string().min(1),
    output: CreatorOutputSchema,
    metadata: ConceptGenerationCheckpointMetadataSchema,
    metadataHash: z.string().min(1),
  })
  .strict();

export const ConceptGenerationPlanSchema = ConceptGenerationRequestBodySchema.superRefine(
  validateConceptGenerationRequest,
);

export const ConceptGenerationRequestPayloadSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    kind: z.literal('CONCEPT_GENERATION'),
    workflowRunId: UuidSchema,
    jobAttemptId: UuidSchema,
    briefVersionId: UuidSchema,
    ...ConceptGenerationRequestBodySchema.shape,
  })
  .strict()
  .superRefine(validateConceptGenerationRequest);

export type ConceptGenerationPlan = z.infer<typeof ConceptGenerationPlanSchema>;

export type ConceptGenerationRequestPayload = z.infer<typeof ConceptGenerationRequestPayloadSchema>;
