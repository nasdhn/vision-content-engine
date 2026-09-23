import { z } from 'zod';

import { contentHash } from './canonical.js';
import { ModelPolicySchema } from './gateway-and-prompts.js';
import { UuidSchema } from './shared.js';

export const WEEKLY_ANALYSIS_QUEUE_NAME = 'ai' as const;
export const WEEKLY_ANALYSIS_JOB_TYPE = 'WEEKLY_ANALYSIS' as const;
export const WEEKLY_ANALYSIS_OUTBOX_EVENT = 'WeeklyAnalysis.requested' as const;
export const WEEKLY_ANALYSIS_OUTBOX_EVENT_TYPES = [WEEKLY_ANALYSIS_OUTBOX_EVENT] as const;
export const WEEKLY_ANALYSIS_CONTEXT_VERSION = 'WEEKLY_ANALYSIS_CONTEXT_V1' as const;
export const WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION = 'EVIDENCE_POLICY_RUNTIME_V1' as const;
export const WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION = '1.0.0' as const;

export const WeeklyAnalysisMeasurementWindowSchema = z.enum([
  'T_PLUS_1H',
  'T_PLUS_6H',
  'T_PLUS_24H',
  'T_PLUS_72H',
  'T_PLUS_7D',
  'T_PLUS_30D',
]);

const WeeklyAnalysisWindowSchema = z
  .object({
    from: z.string().datetime(),
    to: z.string().datetime(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.from.endsWith('Z') || !value.to.endsWith('Z')) {
      ctx.addIssue({
        code: 'custom',
        message: 'Weekly analysis windows must use UTC Z instants',
      });
      return;
    }

    const from = new Date(value.from);
    const to = new Date(value.to);
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    if (to.getTime() - from.getTime() !== weekMs) {
      ctx.addIssue({
        code: 'custom',
        message: 'Weekly analysis windows must span exactly seven days',
      });
    }

    if (
      from.getUTCHours() !== 0 ||
      from.getUTCMinutes() !== 0 ||
      from.getUTCSeconds() !== 0 ||
      from.getUTCMilliseconds() !== 0 ||
      to.getUTCHours() !== 0 ||
      to.getUTCMinutes() !== 0 ||
      to.getUTCSeconds() !== 0 ||
      to.getUTCMilliseconds() !== 0
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Weekly analysis boundaries must be UTC midnight',
      });
    }
  });

const WeeklyAnalysisKnowledgeSnapshotSchema = z
  .object({
    id: UuidSchema,
    version: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

const WeeklyAnalysisBudgetSchema = z
  .object({
    key: z.string().min(1),
    from: z.string().datetime(),
    to: z.string().datetime(),
    limit: z.string().regex(/^\d+(?:\.\d{1,8})?$/),
    currency: z.string().regex(/^[A-Z]{3}$/),
  })
  .strict();

const WeeklyAnalystPolicySchema = ModelPolicySchema.superRefine((value, ctx) => {
  if (value.capability !== 'ANALYST') {
    ctx.addIssue({
      code: 'custom',
      path: ['capability'],
      message: 'Weekly analysis requires ANALYST capability',
    });
  }
});

const weeklyPlanShape = {
  analysisWindow: WeeklyAnalysisWindowSchema,
  measurementWindow: WeeklyAnalysisMeasurementWindowSchema,
  evidencePolicyVersion: z.literal(WEEKLY_ANALYSIS_EVIDENCE_POLICY_VERSION),
  analystPromptVersion: z.literal(WEEKLY_ANALYSIS_ANALYST_PROMPT_VERSION),
  contextBuilderVersion: z.literal(WEEKLY_ANALYSIS_CONTEXT_VERSION),
  knowledgeSnapshot: WeeklyAnalysisKnowledgeSnapshotSchema,
  policy: WeeklyAnalystPolicySchema,
  budget: WeeklyAnalysisBudgetSchema,
} as const;

export const WeeklyAnalysisPlanSchema = z.object(weeklyPlanShape).strict();

export const WeeklyAnalysisRequestPayloadSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    kind: z.literal(WEEKLY_ANALYSIS_JOB_TYPE),
    workflowRunId: UuidSchema,
    jobAttemptId: UuidSchema,
    operationId: UuidSchema,
    analysisOperationKey: z.string().regex(/^[a-f0-9]{64}$/),
    ...weeklyPlanShape,
  })
  .strict();

export const WeeklyAnalysisQueueJobSchema = WeeklyAnalysisRequestPayloadSchema.extend({
  outboxEventId: UuidSchema,
}).strict();

export type WeeklyAnalysisPlan = z.infer<typeof WeeklyAnalysisPlanSchema>;
export type WeeklyAnalysisRequestPayload = z.infer<typeof WeeklyAnalysisRequestPayloadSchema>;
export type WeeklyAnalysisQueueJob = z.infer<typeof WeeklyAnalysisQueueJobSchema>;
export type WeeklyAnalysisMeasurementWindow = z.infer<typeof WeeklyAnalysisMeasurementWindowSchema>;

export function weeklyAnalysisOperationKeyFor(rawInput: unknown) {
  const input = WeeklyAnalysisPlanSchema.parse(rawInput);
  return contentHash({
    workflowType: WEEKLY_ANALYSIS_JOB_TYPE,
    analysisWindow: input.analysisWindow,
    measurementWindow: input.measurementWindow,
    evidencePolicyVersion: input.evidencePolicyVersion,
    analystPromptVersion: input.analystPromptVersion,
    contextBuilderVersion: input.contextBuilderVersion,
  });
}

export function parseWeeklyAnalysisOutboxEvent(event: {
  id: string;
  eventType: string;
  payloadJson: unknown;
}): WeeklyAnalysisQueueJob {
  if (event.eventType !== WEEKLY_ANALYSIS_OUTBOX_EVENT) {
    throw new Error('INVALID_WEEKLY_ANALYSIS_OUTBOX_EVENT');
  }

  return WeeklyAnalysisQueueJobSchema.parse({
    ...WeeklyAnalysisRequestPayloadSchema.parse(event.payloadJson),
    outboxEventId: event.id,
  });
}
