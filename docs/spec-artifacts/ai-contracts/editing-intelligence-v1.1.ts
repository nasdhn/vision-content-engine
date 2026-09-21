import { z } from 'zod';
import { EditingPlanSpecSchema } from '../editing-intelligence/schema';

export const EditingBlockerReasonCodeSchema = z.enum([
  'ASSET_QUALITY_INSUFFICIENT',
  'PROOF_COVERAGE_INSUFFICIENT',
  'SCRIPT_ASSET_MISMATCH',
  'PRESENTER_COVERAGE_INSUFFICIENT',
  'VOICE_COVERAGE_INSUFFICIENT',
  'CREATIVE_PLAN_CONSTRAINT_CONFLICT',
]);

export const EditingBlockerRecoverabilitySchema = z.enum([
  'RECOVERABLE_WITH_INPUT',
  'REQUIRES_CREATIVE_PLAN_REVISION',
]);

export const EditingBlockerEvidenceSchema = z
  .object({
    assetIds: z.array(z.string().uuid()),
    scriptSegmentIds: z.array(z.string().min(1)),
    constraintKeys: z.array(
      z.enum([
        'SCRIPT',
        'CREATIVE_PLAN',
        'TEMPLATE',
        'EDITING_PROFILE',
        'DURATION',
        'VOICE_MODE',
        'PRODUCT_PROOF',
        'PRESENTER',
      ]),
    ),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.assetIds.length + value.scriptSegmentIds.length + value.constraintKeys.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'blocker evidence must reference at least one provided fact',
      });
    }
  });

export const EditingBlockerRequiredActionSchema = z
  .object({
    type: z.enum([
      'RECORD_OR_SELECT_ASSET',
      'RECAPTURE_PRODUCT_PROOF',
      'REVISE_CREATIVE_PLAN',
      'CHANGE_TEMPLATE',
      'CHANGE_EDITING_PROFILE',
    ]),
    detail: z.string().min(1).max(500),
    requestedAssetRoles: z
      .array(
        z.enum([
          'VOICE',
          'PRESENTER',
          'PRODUCT_CAPTURE',
          'SCREENSHOT',
          'BROLL',
          'MUSIC',
          'SFX',
          'IMAGE',
        ]),
      )
      .max(8)
      .optional(),
  })
  .strict();

export const EditingBlockerSpecSchema = z
  .object({
    reasonCode: EditingBlockerReasonCodeSchema,
    recoverability: EditingBlockerRecoverabilitySchema,
    summary: z.string().min(1).max(500),
    evidence: EditingBlockerEvidenceSchema,
    requiredAction: EditingBlockerRequiredActionSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const inputActions = new Set(['RECORD_OR_SELECT_ASSET', 'RECAPTURE_PRODUCT_PROOF']);
    const revisionActions = new Set([
      'REVISE_CREATIVE_PLAN',
      'CHANGE_TEMPLATE',
      'CHANGE_EDITING_PROFILE',
    ]);

    if (
      value.recoverability === 'RECOVERABLE_WITH_INPUT' &&
      !inputActions.has(value.requiredAction.type)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'recoverable input blockers require an input-resolution action',
        path: ['requiredAction', 'type'],
      });
    }

    if (
      value.recoverability === 'REQUIRES_CREATIVE_PLAN_REVISION' &&
      !revisionActions.has(value.requiredAction.type)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'creative-plan blockers require a revision action',
        path: ['requiredAction', 'type'],
      });
    }
  });

export const EditingIntelligencePlanResultSchema = z
  .object({
    kind: z.literal('PLAN'),
    plan: EditingPlanSpecSchema,
  })
  .strict();

export const EditingIntelligenceBlockedResultSchema = z
  .object({
    kind: z.literal('BLOCKED'),
    blocker: EditingBlockerSpecSchema,
  })
  .strict();

export const EditingIntelligenceOutputV11Schema = z.discriminatedUnion('kind', [
  EditingIntelligencePlanResultSchema,
  EditingIntelligenceBlockedResultSchema,
]);
