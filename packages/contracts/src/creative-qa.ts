import { z } from 'zod';

import {
  ConceptVersionSnapshotSchema,
  CreativePlanVersionSnapshotSchema,
  ScriptVersionSnapshotSchema,
  UuidSchema,
} from './shared.js';
import { EditingPlanSpecSchema } from './editing.js';

export const CreativeQAInputSchema = z
  .object({
    concept: ConceptVersionSnapshotSchema,
    script: ScriptVersionSnapshotSchema,
    creativePlan: CreativePlanVersionSnapshotSchema,
    editingPlan: EditingPlanSpecSchema,
    renderTechnicalReport: z
      .object({
        durationMs: z.number().int().positive(),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().positive(),
        audioPresent: z.boolean(),
        blackFrameSignals: z
          .object({
            catastrophic: z.boolean(),
            affectedDurationMs: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
        silenceSignals: z
          .object({
            catastrophic: z.boolean(),
            affectedDurationMs: z.number().int().nonnegative(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    renderInspection: z
      .object({
        durationMs: z.number().int().positive(),
        sampledFrames: z.array(
          z.object({ atMs: z.number().int().nonnegative(), assetId: UuidSchema }).strict(),
        ),
        transcript: z
          .array(
            z
              .object({
                startMs: z.number().int().nonnegative(),
                endMs: z.number().int().positive(),
                text: z.string(),
              })
              .strict(),
          )
          .optional(),
        cutEvents: z
          .array(z.object({ atMs: z.number().int().nonnegative(), type: z.string() }).strict())
          .optional(),
        silenceWindows: z
          .array(
            z
              .object({
                startMs: z.number().int().nonnegative(),
                endMs: z.number().int().positive(),
              })
              .strict(),
          )
          .optional(),
        captionObservations: z
          .array(
            z
              .object({
                startMs: z.number().int().nonnegative(),
                endMs: z.number().int().positive(),
                text: z.string(),
              })
              .strict(),
          )
          .optional(),
        productVisibilitySignals: z
          .object({
            firstVisibleAtMs: z.number().int().nonnegative().optional(),
            totalVisibleMs: z.number().int().nonnegative().optional(),
            readabilityWarnings: z.array(z.string()),
          })
          .strict()
          .optional(),
        audioSignals: z
          .object({
            voicePresent: z.boolean(),
            musicPresent: z.boolean(),
            clippingDetected: z.boolean().optional(),
            warnings: z.array(z.string()),
          })
          .strict()
          .optional(),
      })
      .strict(),
  })
  .strict();

export const CreativeQAOutputSchema = z
  .object({
    result: z.enum(['PASS', 'PASS_WITH_WARNINGS', 'FAIL']),
    evaluatedDimensions: z.array(z.string()),
    notEvaluatedDimensions: z.array(z.string()),
    issues: z.array(
      z
        .object({
          code: z.enum([
            'PACING_TOO_SLOW',
            'PACING_TOO_FAST',
            'CUTS_TOO_MECHANICAL',
            'CAPTIONS_TOO_BUSY',
            'PRODUCT_NOT_VISIBLE_ENOUGH',
            'HOOK_VISUALLY_WEAK',
            'SOUND_TOO_BUSY',
            'CTA_TOO_LONG',
            'GREEN_SCREEN_BAD_PLACEMENT',
            'SCRIPT_VISUAL_MISMATCH',
            'OTHER',
          ]),
          severity: z.enum(['WARNING', 'ERROR']),
          startMs: z.number().int().nonnegative().optional(),
          endMs: z.number().int().positive().optional(),
          explanation: z.string().min(1),
          suggestedFix: z.string().optional(),
        })
        .strict(),
    ),
    summary: z.string().min(1),
  })
  .strict();
