import { z } from 'zod';

import {
  AnalystInputSchema,
  AnalystOutputSchema,
  BrandKnowledgeSnapshotSchema,
  WeeklyAnalysisRequestPayloadSchema,
} from '@vision/contracts';
import { contentHash } from '@vision/contracts/canonical';
import type { PrismaClient } from '@vision/database';

import {
  AUTHORITATIVE_ATTRIBUTION_SOURCE,
  EVIDENCE_CONFIDENCE_LEVELS,
  EVIDENCE_POLICY_RUNTIME_V1,
  EVIDENCE_POLICY_RUNTIME_VERSION,
  EvidenceComparabilityService,
  LEARNING_METRIC_KEYS,
} from './learning-evidence.js';
import type { EvidenceConfidence, EvidenceFrame, LearningMetricKey } from './learning-evidence.js';
import { ExperimentEvidenceService } from './experiment-evidence.js';
import type { ExperimentEvidenceAnalysis } from './experiment-evidence.js';
import { mergeDeterministicAnalystLimitations, validateAnalystOutput } from './analyst-runtime.js';
import type { AnalystValidationContext } from './analyst-runtime.js';

const MAX_WEEKLY_PUBLICATIONS = 100;
const MAX_WEEKLY_EXPERIMENTS = 25;
const MAX_PRIOR_INSIGHTS = 25;
const MAX_ATTRIBUTION_EVENTS = 1_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const OBSERVATIONAL_CONFOUNDERS = [
  'Publication timing, topic, audience, distribution and creative execution may differ across observations.',
] as const;

const ConfidenceSchema = z.enum(EVIDENCE_CONFIDENCE_LEVELS);

const WeeklyAnalysisValidationContextSchema = z
  .object({
    deterministicConfidenceCeiling: ConfidenceSchema,
    mandatoryLimitations: z.array(z.string()),
    allowedPrimaryMetrics: z.array(z.string()),
    allowedMeasurementWindows: z.array(z.string()),
  })
  .strict();

const JsonRecordSchema = z.record(z.string(), z.unknown());

export const WeeklyAnalysisCheckpointMetadataSchema = z
  .object({
    schemaVersion: z.literal('v1'),
    analysisOperationKey: z.string().regex(/^[a-f0-9]{64}$/),
    workflowRunId: z.string().uuid(),
    input: AnalystInputSchema,
    validationContext: WeeklyAnalysisValidationContextSchema,
    evidence: JsonRecordSchema,
    limitations: z
      .object({
        deterministic: z.array(z.string()),
        dataQuality: z.array(z.string()),
        comparability: z.array(z.string()),
        attribution: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

export const WeeklyAnalysisOutputCheckpointSchema = z
  .object({
    outputHash: z.string().regex(/^[a-f0-9]{64}$/),
    output: AnalystOutputSchema,
    metadata: WeeklyAnalysisCheckpointMetadataSchema,
    metadataHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export type WeeklyAnalysisCheckpointMetadata = z.infer<
  typeof WeeklyAnalysisCheckpointMetadataSchema
>;

function unique(values: readonly string[]) {
  return [...new Set(values)].sort();
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function safeInteger(value: bigint) {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(value);
}

function minimumConfidence(values: readonly EvidenceConfidence[]): EvidenceConfidence {
  if (values.length === 0) return 'INSUFFICIENT_DATA';
  const rank = new Map(EVIDENCE_CONFIDENCE_LEVELS.map((value, index) => [value, index]));
  return [...values].sort((left, right) => rank.get(left)! - rank.get(right)!)[0]!;
}

function latestMondayUtc(now: Date) {
  if (Number.isNaN(now.getTime())) throw new Error('INVALID_ANALYSIS_CLOCK');
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const mondayOffset = (now.getUTCDay() + 6) % 7;
  return new Date(midnight - mondayOffset * 24 * 60 * 60 * 1000);
}

export function latestCompletedUtcWeek(now: Date) {
  const to = latestMondayUtc(now);
  const from = new Date(to.getTime() - WEEK_MS);
  return Object.freeze({ from: from.toISOString(), to: to.toISOString() });
}

type FrameEntry = Readonly<{
  platform: 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE';
  metricKey: LearningMetricKey;
  frame: EvidenceFrame;
}>;

export class WeeklyAnalysisContextBuilder {
  private readonly evidence: EvidenceComparabilityService;
  private readonly experiments: ExperimentEvidenceService;

  constructor(private readonly db: PrismaClient) {
    this.evidence = new EvidenceComparabilityService(db);
    this.experiments = new ExperimentEvidenceService(db);
  }

  async build(rawJob: unknown) {
    const job = WeeklyAnalysisRequestPayloadSchema.parse(rawJob);
    const analysisWindow = {
      from: new Date(job.analysisWindow.from),
      to: new Date(job.analysisWindow.to),
    };

    const candidates = await this.db.publication.findMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: { gte: analysisWindow.from, lt: analysisWindow.to },
      },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: MAX_WEEKLY_PUBLICATIONS + 1,
      select: {
        id: true,
        publishedAt: true,
        platformAccount: { select: { platform: true } },
        mediaAsset: { select: { durationMs: true } },
        render: {
          select: {
            editingPlanVersion: {
              select: {
                templateVersionId: true,
                editingProfileVersionId: true,
                creativePlanVersion: {
                  select: {
                    scriptVersion: {
                      select: {
                        conceptVersion: { select: { selectedPatternVersionId: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    if (candidates.length > MAX_WEEKLY_PUBLICATIONS) {
      throw new Error('WEEKLY_ANALYSIS_PUBLICATION_LIMIT_EXCEEDED');
    }

    const platforms = unique(candidates.map((row) => row.platformAccount.platform)) as (
      'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE'
    )[];

    const frames: FrameEntry[] = [];
    for (const platform of platforms) {
      for (const metricKey of LEARNING_METRIC_KEYS) {
        const frame = await this.evidence.metricFrame({
          analysisWindow,
          measurementWindow: job.measurementWindow,
          metricKey,
          platform,
          confounders: OBSERVATIONAL_CONFOUNDERS,
          confoundersDocumented: true,
        });
        if (frame.sampleSize > 0) frames.push({ platform, metricKey, frame });
      }
    }

    const metricsByPublication = new Map<string, Record<string, number>>();
    const keysByPublication = new Map<string, string[]>();
    const limitationsByPublication = new Map<string, string[]>();

    for (const entry of frames) {
      for (const observation of entry.frame.eligible) {
        const metrics = metricsByPublication.get(observation.publicationId) ?? {};
        metrics[entry.metricKey] = observation.metricValue;
        metricsByPublication.set(observation.publicationId, metrics);

        const keys = keysByPublication.get(observation.publicationId) ?? [];
        keys.push(entry.metricKey);
        keysByPublication.set(observation.publicationId, keys);

        const limitations = limitationsByPublication.get(observation.publicationId) ?? [];
        limitations.push(...entry.frame.comparabilityLimitations);
        limitationsByPublication.set(observation.publicationId, limitations);
      }
    }

    const publications = candidates.flatMap((row) => {
      const normalizedMetrics = metricsByPublication.get(row.id);
      if (!normalizedMetrics || !row.publishedAt) return [];

      const plan = row.render.editingPlanVersion;
      const conceptVersion = plan.creativePlanVersion.scriptVersion.conceptVersion;
      const durationMs = row.mediaAsset?.durationMs ?? null;
      const contentDimensions = {
        ...(conceptVersion.selectedPatternVersionId
          ? { patternVersionId: conceptVersion.selectedPatternVersionId }
          : {}),
        templateVersionId: plan.templateVersionId,
        editingProfileVersionId: plan.editingProfileVersionId,
        ...(durationMs !== null && durationMs > 0 ? { durationMs } : {}),
      };

      return [
        {
          publicationId: row.id,
          platform: row.platformAccount.platform,
          publishedAt: row.publishedAt.toISOString(),
          measurementWindow: job.measurementWindow,
          contentDimensions,
          normalizedMetrics,
          comparability: {
            comparableMetricKeys: unique(keysByPublication.get(row.id) ?? []),
            limitations: unique([
              ...(limitationsByPublication.get(row.id) ?? []),
              'EvidenceFrames are platform-specific; cross-platform metric equivalence is not assumed.',
            ]),
          },
        },
      ];
    });

    const publicationIds = new Set(publications.map((row) => row.publicationId));
    const experimentRows =
      publicationIds.size === 0
        ? []
        : await this.db.experiment.findMany({
            where: { arms: { some: { publicationId: { in: [...publicationIds] } } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: MAX_WEEKLY_EXPERIMENTS + 1,
            select: {
              id: true,
              hypothesis: true,
              primaryMetric: true,
              status: true,
              arms: {
                orderBy: [{ label: 'asc' }, { id: 'asc' }],
                select: { label: true, publicationId: true, variablesJson: true },
              },
            },
          });

    if (experimentRows.length > MAX_WEEKLY_EXPERIMENTS) {
      throw new Error('WEEKLY_ANALYSIS_EXPERIMENT_LIMIT_EXCEEDED');
    }

    const experimentAnalyses: ExperimentEvidenceAnalysis[] = [];
    for (const row of experimentRows) {
      const analysis = await this.experiments.analyze({
        experimentId: row.id,
        measurementWindow: job.measurementWindow,
        analysisWindow,
        confounders: OBSERVATIONAL_CONFOUNDERS,
        confoundersDocumented: true,
      });
      if (analysis) experimentAnalyses.push(analysis);
    }

    const supportedMetricSet = new Set<string>(LEARNING_METRIC_KEYS);
    const analystExperiments = experimentRows.flatMap((row) => {
      if (!row.primaryMetric || !supportedMetricSet.has(row.primaryMetric)) return [];
      return [
        {
          experimentId: row.id,
          hypothesis: row.hypothesis,
          primaryMetric: row.primaryMetric,
          status: row.status,
          arms: row.arms.map((arm) => ({
            label: arm.label,
            publicationIds:
              arm.publicationId && publicationIds.has(arm.publicationId) ? [arm.publicationId] : [],
            variables: jsonRecord(arm.variablesJson),
          })),
        },
      ];
    });

    const priorRows = await this.db.insight.findMany({
      where: { createdAt: { lt: analysisWindow.from } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_PRIOR_INSIGHTS,
      select: { id: true, statement: true, confidence: true, limitationsJson: true },
    });

    const priorInsights = priorRows.map((row) => {
      const trace = jsonRecord(row.limitationsJson);
      const final = Array.isArray(trace['final'])
        ? trace['final'].filter((value): value is string => typeof value === 'string')
        : [];
      return {
        insightId: row.id,
        statement: row.statement,
        confidence: row.confidence,
        limitations: final,
      };
    });

    const attributionRows = await this.db.attributionEvent.findMany({
      where: {
        occurredAt: { gte: analysisWindow.from, lt: analysisWindow.to },
        OR: [
          { eventType: 'WEBSITE_VISIT', sourceSystem: 'UMAMI' },
          {
            eventType: { in: ['SIGNUP', 'ACTIVATION', 'CUSTOMER', 'REVENUE'] },
            sourceSystem: 'VISION_APP',
          },
        ],
      },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
      take: MAX_ATTRIBUTION_EVENTS + 1,
      select: {
        eventType: true,
        confidenceType: true,
        publicationId: true,
        valueAmountMinor: true,
        valueCurrency: true,
      },
    });

    if (attributionRows.length > MAX_ATTRIBUTION_EVENTS) {
      throw new Error('WEEKLY_ANALYSIS_ATTRIBUTION_LIMIT_EXCEEDED');
    }

    type AttributionEventType = (typeof attributionRows)[number]['eventType'];
    const count = (eventType: AttributionEventType) =>
      attributionRows.filter((row) => row.eventType === eventType).length;
    const nullableCount = (eventType: AttributionEventType) => {
      const value = count(eventType);
      return value === 0 ? null : value;
    };

    const revenueRows = attributionRows.filter((row) => row.eventType === 'REVENUE');
    const revenueCurrencies = unique(
      revenueRows.flatMap((row) => (row.valueCurrency ? [row.valueCurrency] : [])),
    );
    let revenueAmountMinor: number | null = null;
    let revenueCurrency: string | null = null;
    if (
      revenueRows.length > 0 &&
      revenueCurrencies.length === 1 &&
      revenueRows.every((row) => row.valueAmountMinor !== null)
    ) {
      const sum = revenueRows.reduce((total, row) => total + row.valueAmountMinor!, 0n);
      revenueAmountMinor = safeInteger(sum);
      revenueCurrency = revenueAmountMinor === null ? null : revenueCurrencies[0]!;
    }

    const attributionSignals = {
      websiteVisits: nullableCount('WEBSITE_VISIT'),
      signups: nullableCount('SIGNUP'),
      activations: nullableCount('ACTIVATION'),
      customers: nullableCount('CUSTOMER'),
      revenueAmountMinor,
      revenueCurrency,
      directPublicationLinks:
        attributionRows.length === 0
          ? null
          : attributionRows.filter(
              (row) => row.confidenceType === 'DIRECT' && row.publicationId !== null,
            ).length,
      inferredSignals:
        attributionRows.length === 0
          ? null
          : attributionRows.filter((row) => row.confidenceType === 'INFERRED').length,
    };

    const experimentCeilings = experimentAnalyses.flatMap((analysis) =>
      analysis.evidenceFrame ? [analysis.evidenceFrame.deterministicConfidenceCeiling] : [],
    );
    const deterministicConfidenceCeiling = minimumConfidence([
      ...frames.map((entry) => entry.frame.deterministicConfidenceCeiling),
      ...experimentCeilings,
    ]);

    const dataQualityLimitations: string[] = [];
    if (candidates.length > publications.length) {
      dataQualityLimitations.push(
        'Some published content had no comparable normalized metric at the frozen measurement window and was excluded.',
      );
    }
    if (publications.length === 0) {
      dataQualityLimitations.push(
        'No publication had comparable canonical evidence at the frozen measurement window.',
      );
    }

    const comparabilityLimitations = unique([
      ...frames.flatMap((entry) => entry.frame.comparabilityLimitations),
      ...experimentAnalyses.flatMap((analysis) => analysis.limitations),
      'EvidenceFrames are platform-specific; cross-platform metric equivalence is not assumed.',
    ]);
    const attributionLimitations =
      attributionRows.length === 0
        ? ['No authoritative attribution signal was available in the frozen analysis window.']
        : revenueRows.length > 0 && revenueAmountMinor === null
          ? [
              'Revenue was not aggregated because currency or numeric completeness was incompatible.',
            ]
          : [];

    const mandatoryLimitations = unique([
      ...dataQualityLimitations,
      ...comparabilityLimitations,
      ...attributionLimitations,
      'Prior Insights are context only and are not counted as fresh evidence.',
      'Phase 9 V1 is descriptive only; causal claims are forbidden.',
    ]);

    const allowedPrimaryMetrics = unique(frames.map((entry) => entry.metricKey));
    const validationContext: AnalystValidationContext = WeeklyAnalysisValidationContextSchema.parse(
      {
        deterministicConfidenceCeiling,
        mandatoryLimitations,
        allowedPrimaryMetrics,
        allowedMeasurementWindows: [job.measurementWindow],
      },
    );

    const input = AnalystInputSchema.parse({
      analysisWindow: job.analysisWindow,
      publications,
      experiments: analystExperiments,
      priorInsights,
      attributionSignals,
      minimumEvidencePolicy: {
        minimumComparableSamples:
          EVIDENCE_POLICY_RUNTIME_V1.interestingSignal.minimumComparablePublications,
        confidenceRulesVersion: EVIDENCE_POLICY_RUNTIME_VERSION,
      },
    });

    const eligiblePublicationIds = publications.map((row) => row.publicationId);
    const excludedPublicationIds = candidates
      .filter((row) => !publicationIds.has(row.id))
      .map((row) => row.id);
    const exclusionReasons = Object.fromEntries(
      excludedPublicationIds.map((id) => [id, 'NO_COMPARABLE_METRIC_AT_FROZEN_MEASUREMENT_WINDOW']),
    );

    const metricSemantics = frames.map((entry) => ({
      platform: entry.platform,
      metric: entry.metricKey,
      version: entry.frame.metricSemanticsVersion,
      sampleSize: entry.frame.sampleSize,
    }));
    const outlierDiagnostics = frames.map((entry) => ({
      platform: entry.platform,
      metric: entry.metricKey,
      outlierDominanceShare: entry.frame.diagnostics.outlierDominanceShare,
    }));
    const directionDiagnostics = frames.map((entry) => ({
      platform: entry.platform,
      metric: entry.metricKey,
      consistentDirectionShare: entry.frame.diagnostics.consistentDirectionShare,
    }));

    const evidence = {
      analysisOperationKey: job.analysisOperationKey,
      evidencePolicyVersion: EVIDENCE_POLICY_RUNTIME_VERSION,
      analysisWindow: job.analysisWindow,
      measurementWindow: job.measurementWindow,
      metric: null,
      businessOutcome: 'weekly_cross_metric_analysis',
      eligiblePublicationIds,
      excludedPublicationIds,
      exclusionReasons,
      sampleSize: publications.length,
      distinctPublishDates: unique(publications.map((row) => row.publishedAt.slice(0, 10))),
      contentDimensions: {
        publications: publications.map((row) => ({
          publicationId: row.publicationId,
          dimensions: row.contentDimensions,
        })),
      },
      metricSemantics,
      platforms: unique(publications.map((row) => row.platform)),
      deterministicConfidenceCeiling,
      attributionContext: attributionSignals,
      sourceAuthority: AUTHORITATIVE_ATTRIBUTION_SOURCE,
      outlierDiagnostics,
      directionDiagnostics,
      experimentContext: experimentAnalyses,
    };

    const limitations = {
      deterministic: mandatoryLimitations,
      dataQuality: unique(dataQualityLimitations),
      comparability: comparabilityLimitations,
      attribution: unique(attributionLimitations),
    };

    const knowledge = await this.db.knowledgeSnapshot.findUniqueOrThrow({
      where: { id: job.knowledgeSnapshot.id },
    });
    if (
      knowledge.version !== job.knowledgeSnapshot.version ||
      knowledge.contentHash !== job.knowledgeSnapshot.contentHash ||
      knowledge.status === 'DRAFT' ||
      knowledge.status === 'ARCHIVED'
    ) {
      throw new Error('WEEKLY_ANALYSIS_KNOWLEDGE_MISMATCH');
    }

    const knowledgeContext = BrandKnowledgeSnapshotSchema.parse({
      ...jsonRecord(knowledge.payloadJson),
      id: knowledge.id,
      key: knowledge.key,
      version: knowledge.version,
      contentHash: knowledge.contentHash,
      effectiveAt: knowledge.effectiveAt.toISOString(),
    });

    const checkpointMetadata = WeeklyAnalysisCheckpointMetadataSchema.parse({
      schemaVersion: 'v1',
      analysisOperationKey: job.analysisOperationKey,
      workflowRunId: job.workflowRunId,
      input,
      validationContext,
      evidence,
      limitations,
    });

    return { input, validationContext, knowledgeContext, checkpointMetadata } as const;
  }
}

export function restoreWeeklyAnalystOutput(rawCheckpoint: unknown) {
  const checkpoint = WeeklyAnalysisOutputCheckpointSchema.parse(rawCheckpoint);
  if (contentHash(checkpoint.output) !== checkpoint.outputHash) {
    throw new Error('WEEKLY_ANALYSIS_CHECKPOINT_HASH_MISMATCH');
  }
  if (contentHash(checkpoint.metadata) !== checkpoint.metadataHash) {
    throw new Error('WEEKLY_ANALYSIS_CHECKPOINT_METADATA_HASH_MISMATCH');
  }
  validateAnalystOutput(
    checkpoint.metadata.input,
    checkpoint.output,
    checkpoint.metadata.validationContext,
  );
  return {
    metadata: checkpoint.metadata,
    output: mergeDeterministicAnalystLimitations(
      checkpoint.output,
      checkpoint.metadata.validationContext.mandatoryLimitations,
    ),
  } as const;
}

export function buildWeeklyAnalystPersistenceInput(
  modelInvocationId: string,
  rawOutput: unknown,
  rawMetadata: unknown,
) {
  const metadata = WeeklyAnalysisCheckpointMetadataSchema.parse(rawMetadata);
  const output = mergeDeterministicAnalystLimitations(
    AnalystOutputSchema.parse(rawOutput),
    metadata.validationContext.mandatoryLimitations,
  );

  return {
    modelInvocationId,
    output,
    insightContexts: output.insights.map((insight) => ({
      scopeType: 'WEEKLY_ANALYSIS',
      scopeId: metadata.analysisOperationKey,
      evidence: metadata.evidence,
      limitations: {
        deterministic: metadata.limitations.deterministic,
        analyst: unique(
          insight.limitations.filter(
            (value) => !metadata.limitations.deterministic.includes(value),
          ),
        ),
        dataQuality: metadata.limitations.dataQuality,
        comparability: metadata.limitations.comparability,
        attribution: metadata.limitations.attribution,
      },
    })),
    recommendationInsightIndexes: output.recommendations.map(() => null),
  };
}
