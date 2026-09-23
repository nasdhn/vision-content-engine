import { z } from 'zod';
import { AnalystOutputSchema } from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import { assertHuman, invariant } from '@vision/domain';
import type { Prisma, RecommendationStatus } from './generated/prisma/client.js';
import { audit, lock } from './transaction.js';
import type { Actor, Transaction } from './transaction.js';

const ConfidenceSchema = z.enum([
  'INSUFFICIENT_DATA',
  'WEAK_SIGNAL',
  'INTERESTING_SIGNAL',
  'FAIRLY_SOLID',
]);

const CONFIDENCE_RANK = {
  INSUFFICIENT_DATA: 0,
  WEAK_SIGNAL: 1,
  INTERESTING_SIGNAL: 2,
  FAIRLY_SOLID: 3,
} as const;

const JsonSafeSchema = z.unknown().superRefine((value, ctx) => {
  try {
    contentHash(value);
  } catch {
    ctx.addIssue({
      code: 'custom',
      message: 'Expected canonical JSON-safe value',
    });
  }
});

export const LearningEvidenceTraceSchema = z
  .object({
    analysisOperationKey: z.string().min(1),
    evidencePolicyVersion: z.string().min(1),
    analysisWindow: z
      .object({
        from: z.string().datetime(),
        to: z.string().datetime(),
      })
      .strict(),
    measurementWindow: z.string().min(1),
    metric: z.string().min(1).nullable(),
    businessOutcome: z.string().min(1).nullable(),
    eligiblePublicationIds: z.array(z.string().uuid()),
    excludedPublicationIds: z.array(z.string().uuid()),
    exclusionReasons: z.record(z.string().uuid(), z.string().min(1)),
    sampleSize: z.number().int().nonnegative(),
    distinctPublishDates: z.array(z.string().min(1)),
    contentDimensions: JsonSafeSchema,
    metricSemantics: JsonSafeSchema,
    platforms: z.array(z.enum(['TIKTOK', 'INSTAGRAM', 'YOUTUBE'])),
    deterministicConfidenceCeiling: ConfidenceSchema,
    attributionContext: JsonSafeSchema,
    sourceAuthority: JsonSafeSchema,
    outlierDiagnostics: JsonSafeSchema,
    directionDiagnostics: JsonSafeSchema,
    experimentContext: JsonSafeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.metric === null && value.businessOutcome === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['metric'],
        message: 'Metric or business outcome required',
      });
    }

    if (new Set(value.eligiblePublicationIds).size !== value.eligiblePublicationIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['eligiblePublicationIds'],
        message: 'Eligible publication IDs must be unique',
      });
    }

    if (new Set(value.excludedPublicationIds).size !== value.excludedPublicationIds.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['excludedPublicationIds'],
        message: 'Excluded publication IDs must be unique',
      });
    }

    const excluded = new Set(value.excludedPublicationIds);
    for (const publicationId of value.excludedPublicationIds) {
      if (!value.exclusionReasons[publicationId]) {
        ctx.addIssue({
          code: 'custom',
          path: ['exclusionReasons', publicationId],
          message: 'Every excluded publication requires a reason',
        });
      }
    }
    for (const publicationId of Object.keys(value.exclusionReasons)) {
      if (!excluded.has(publicationId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['exclusionReasons', publicationId],
          message: 'Exclusion reason references a publication that is not excluded',
        });
      }
    }
  });

export const LearningLimitationsTraceSchema = z
  .object({
    deterministic: z.array(z.string()),
    analyst: z.array(z.string()),
    dataQuality: z.array(z.string()),
    comparability: z.array(z.string()),
    attribution: z.array(z.string()),
  })
  .strict();

const InsightPersistenceContextSchema = z
  .object({
    scopeType: z.string().min(1),
    scopeId: z.string().min(1).optional(),
    evidence: LearningEvidenceTraceSchema,
    limitations: LearningLimitationsTraceSchema,
  })
  .strict();

export const ValidatedAnalystPersistenceInputSchema = z
  .object({
    modelInvocationId: z.string().uuid(),
    output: AnalystOutputSchema,
    insightContexts: z.array(InsightPersistenceContextSchema),
    recommendationInsightIndexes: z.array(z.number().int().nonnegative().nullable()),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.insightContexts.length !== value.output.insights.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['insightContexts'],
        message: 'One persistence context is required per Insight',
      });
    }

    if (value.recommendationInsightIndexes.length !== value.output.recommendations.length) {
      ctx.addIssue({
        code: 'custom',
        path: ['recommendationInsightIndexes'],
        message: 'Recommendation mapping length must match recommendations',
      });
    }

    value.recommendationInsightIndexes.forEach((index, recommendationIndex) => {
      if (index !== null && index >= value.output.insights.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['recommendationInsightIndexes', recommendationIndex],
          message: 'Recommendation maps to an unknown Insight index',
        });
      }
    });

    value.output.insights.forEach((insight, index) => {
      const context = value.insightContexts[index];
      if (!context) return;

      const eligible = new Set(context.evidence.eligiblePublicationIds);
      for (const publicationId of insight.evidencePublicationIds) {
        if (!eligible.has(publicationId)) {
          ctx.addIssue({
            code: 'custom',
            path: ['output', 'insights', index, 'evidencePublicationIds'],
            message: 'Insight evidence must be part of the eligible evidence set',
          });
        }
      }

      if (context.evidence.sampleSize < insight.evidencePublicationIds.length) {
        ctx.addIssue({
          code: 'custom',
          path: ['insightContexts', index, 'evidence', 'sampleSize'],
          message: 'Sample size cannot be smaller than cited evidence',
        });
      }

      if (
        CONFIDENCE_RANK[insight.confidence] >
        CONFIDENCE_RANK[context.evidence.deterministicConfidenceCeiling]
      ) {
        ctx.addIssue({
          code: 'custom',
          path: ['output', 'insights', index, 'confidence'],
          message: 'Insight confidence exceeds deterministic ceiling',
        });
      }

      const finalLimitations = new Set(insight.limitations);
      for (const limitation of [
        ...context.limitations.deterministic,
        ...context.limitations.analyst,
      ]) {
        if (!finalLimitations.has(limitation)) {
          ctx.addIssue({
            code: 'custom',
            path: ['output', 'insights', index, 'limitations'],
            message: 'Final limitations must preserve deterministic and Analyst limitations',
          });
        }
      }
    });
  });

export type ValidatedAnalystPersistenceInput = z.infer<
  typeof ValidatedAnalystPersistenceInputSchema
>;

const RecommendedTestSchema = z
  .object({
    hypothesis: z.string().min(1),
    change: z.string().min(1),
    keepConstant: z.array(z.string()),
    primaryMetric: z.string().min(1),
    measurementWindow: z.string().min(1),
  })
  .strict();

const ExperimentProposalAuditSchema = z
  .object({
    experimentId: z.string().uuid(),
    campaignId: z.string().uuid().nullable(),
  })
  .strict();

function toInputJson(value: unknown): Prisma.InputJsonValue {
  contentHash(value);
  return value as Prisma.InputJsonValue;
}

function jsonObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function recommendationAction(
  next: Exclude<RecommendationStatus, 'PROPOSED'>,
): 'Recommendation.accepted' | 'Recommendation.rejected' | 'Recommendation.executed' {
  if (next === 'ACCEPTED') return 'Recommendation.accepted';
  if (next === 'REJECTED') return 'Recommendation.rejected';
  return 'Recommendation.executed';
}

export class Learning {
  constructor(
    private readonly tx: Transaction,
    private readonly actor: Actor,
  ) {}

  async persistValidatedAnalystOutput(rawInput: unknown) {
    invariant(this.actor.actorType === 'AI', 'AI_ACTOR_REQUIRED');
    const input = ValidatedAnalystPersistenceInputSchema.parse(rawInput);

    await this.tx.$queryRaw`
      SELECT id
      FROM "ModelInvocation"
      WHERE id = ${input.modelInvocationId}::uuid
      FOR UPDATE
    `;

    const invocation = await this.tx.modelInvocation.findUniqueOrThrow({
      where: { id: input.modelInvocationId },
    });
    const policy = jsonObject(invocation.policyJson);

    invariant(
      invocation.status === 'SUCCEEDED' &&
        invocation.promptKey === 'analyst' &&
        invocation.promptVersion === '1.0.0' &&
        invocation.inputSchemaVersion === '1.0.0' &&
        invocation.outputSchemaVersion === '1.0.0' &&
        typeof invocation.outputHash === 'string' &&
        invocation.outputHash.length > 0 &&
        policy?.['capability'] === 'ANALYST',
      'VALIDATED_ANALYST_INVOCATION_REQUIRED',
    );

    const alreadyApplied = await this.tx.auditEvent.findFirst({
      where: {
        subjectType: 'ModelInvocation',
        subjectId: input.modelInvocationId,
        action: 'ModelInvocation.applied',
      },
    });
    invariant(!alreadyApplied, 'INVOCATION_ALREADY_APPLIED');

    const insights = [];
    for (let index = 0; index < input.output.insights.length; index += 1) {
      const insight = input.output.insights[index]!;
      const context = input.insightContexts[index]!;
      const row = await this.tx.insight.create({
        data: {
          scopeType: context.scopeType,
          ...(context.scopeId !== undefined ? { scopeId: context.scopeId } : {}),
          statement: insight.statement,
          confidence: insight.confidence,
          evidenceJson: toInputJson(context.evidence),
          limitationsJson: toInputJson({
            deterministic: context.limitations.deterministic,
            analyst: context.limitations.analyst,
            dataQuality: context.limitations.dataQuality,
            comparability: context.limitations.comparability,
            attribution: context.limitations.attribution,
            final: insight.limitations,
          }),
          modelInvocationId: input.modelInvocationId,
        },
      });
      await audit(this.tx, this.actor, 'Insight.created', 'Insight', row.id);
      insights.push(row);
    }

    const recommendations = [];
    for (let index = 0; index < input.output.recommendations.length; index += 1) {
      const recommendation = input.output.recommendations[index]!;
      const insightIndex = input.recommendationInsightIndexes[index]!;
      const insightId = insightIndex === null ? undefined : insights[insightIndex]?.id;
      invariant(
        insightIndex === null || insightId !== undefined,
        'RECOMMENDATION_INSIGHT_MAPPING_INVALID',
      );

      const row = await this.tx.recommendation.create({
        data: {
          ...(insightId !== undefined ? { insightId } : {}),
          title: recommendation.title,
          description: recommendation.description,
          recommendedTestJson: toInputJson(recommendation.nextTest),
          status: 'PROPOSED',
        },
      });
      await audit(this.tx, this.actor, 'Recommendation.proposed', 'Recommendation', row.id);
      recommendations.push(row);
    }

    // The gateway hash is the provider/schema-valid output. 9C may then re-inject mandatory
    // deterministic limitations, so preserve both hashes instead of pretending they are identical.
    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'ModelInvocation.applied',
        subjectType: 'ModelInvocation',
        subjectId: input.modelInvocationId,
        afterJson: toInputJson({
          gatewayOutputHash: invocation.outputHash,
          durableOutputHash: contentHash(input.output),
          insightIds: insights.map((row) => row.id),
          recommendationIds: recommendations.map((row) => row.id),
        }),
      },
    });

    return { insights, recommendations };
  }

  async transitionRecommendation(id: string, next: Exclude<RecommendationStatus, 'PROPOSED'>) {
    assertHuman(this.actor);
    await lock(this.tx, 'Recommendation', id, 'RECOMMENDATION_NOT_FOUND');

    const row = await this.tx.recommendation.findUniqueOrThrow({ where: { id } });
    const legal =
      (row.status === 'PROPOSED' && (next === 'ACCEPTED' || next === 'REJECTED')) ||
      (row.status === 'ACCEPTED' && next === 'EXECUTED');

    invariant(legal, 'INVALID_RECOMMENDATION_TRANSITION');

    const updated = await this.tx.recommendation.update({
      where: { id },
      data: { status: next },
    });
    await audit(this.tx, this.actor, recommendationAction(next), 'Recommendation', id);
    return updated;
  }

  async createExperimentProposal(recommendationId: string, campaignId?: string) {
    assertHuman(this.actor);
    if (campaignId !== undefined) {
      invariant(z.string().uuid().safeParse(campaignId).success, 'INVALID_CAMPAIGN_ID');
    }

    await lock(this.tx, 'Recommendation', recommendationId, 'RECOMMENDATION_NOT_FOUND');

    const existingAudit = await this.tx.auditEvent.findFirst({
      where: {
        action: 'Experiment.proposal_created',
        subjectType: 'Recommendation',
        subjectId: recommendationId,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const expectedCampaignId = campaignId ?? null;
    if (existingAudit) {
      const parsed = ExperimentProposalAuditSchema.safeParse(existingAudit.afterJson);
      invariant(parsed.success, 'EXPERIMENT_PROPOSAL_AUDIT_INVALID');
      invariant(parsed.data.campaignId === expectedCampaignId, 'EXPERIMENT_PROPOSAL_CONFLICT');
      const existing = await this.tx.experiment.findUnique({
        where: { id: parsed.data.experimentId },
      });
      invariant(existing, 'EXPERIMENT_PROPOSAL_AUDIT_INVALID');
      return existing;
    }

    const recommendation = await this.tx.recommendation.findUniqueOrThrow({
      where: { id: recommendationId },
    });
    invariant(recommendation.status === 'ACCEPTED', 'RECOMMENDATION_NOT_ACCEPTED');

    const recommendedTest = RecommendedTestSchema.safeParse(recommendation.recommendedTestJson);
    invariant(recommendedTest.success, 'RECOMMENDATION_TEST_REQUIRED');

    if (campaignId !== undefined) {
      const campaign = await this.tx.campaign.findUnique({ where: { id: campaignId } });
      invariant(campaign, 'CAMPAIGN_NOT_FOUND');
    }

    const experiment = await this.tx.experiment.create({
      data: {
        ...(campaignId !== undefined ? { campaignId } : {}),
        name: recommendation.title,
        hypothesis: recommendedTest.data.hypothesis,
        primaryMetric: recommendedTest.data.primaryMetric,
        status: 'DRAFT',
      },
    });

    await this.tx.auditEvent.create({
      data: {
        ...this.actor,
        action: 'Experiment.proposal_created',
        subjectType: 'Recommendation',
        subjectId: recommendationId,
        afterJson: toInputJson({
          experimentId: experiment.id,
          campaignId: expectedCampaignId,
        }),
      },
    });

    return experiment;
  }
}
