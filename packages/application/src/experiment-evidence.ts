import type { PrismaClient } from '@vision/database';

import {
  buildEvidenceFrame,
  learningWindowFromAnalyticsJobType,
  LEARNING_METRIC_KEYS,
  type EvidenceFrame,
  type LearningEvidenceObservation,
  type LearningMetricKey,
  type LearningWindowKey,
} from './learning-evidence.js';

const LEARNING_METRIC_KEY_SET = new Set<string>(LEARNING_METRIC_KEYS);

export const EXPERIMENT_EVIDENCE_READINESS = [
  'READY',
  'INSUFFICIENT_DATA',
  'PRIMARY_METRIC_MISSING',
  'UNSUPPORTED_PRIMARY_METRIC',
] as const;

export type ExperimentEvidenceReadiness = (typeof EXPERIMENT_EVIDENCE_READINESS)[number];

export const EXPERIMENT_ARM_EVIDENCE_READINESS = [
  'READY',
  'PUBLICATION_NOT_ASSIGNED',
  'PUBLICATION_NOT_FOUND',
  'PUBLICATION_NOT_PUBLISHED',
  'MEASUREMENT_NOT_READY',
  'METRIC_UNAVAILABLE',
  'METRIC_VALUE_OUT_OF_RANGE',
  'EXCLUDED_FROM_COMPARISON',
] as const;

export type ExperimentArmEvidenceReadiness = (typeof EXPERIMENT_ARM_EVIDENCE_READINESS)[number];

type Platform = LearningEvidenceObservation['platform'];

export type ExperimentEvidenceArmInput = Readonly<{
  id: string;
  label: string;
  conceptVersionId: string | null;
  publicationId: string | null;
  publication: Readonly<{
    id: string;
    status: string;
    publishedAt: string | null;
    platform: Platform;
    collectedAt: string | null;
    measurementWindow: LearningWindowKey | null;
    metricSemanticsVersion: string | null;
    metricValue: number | bigint | null;
    crossPlatformComparable: boolean;
    comparabilityNotes: readonly string[];
  }> | null;
}>;

export type ExperimentEvidenceInput = Readonly<{
  experiment: Readonly<{
    id: string;
    name: string;
    hypothesis: string;
    primaryMetric: string | null;
    status: string;
  }>;
  measurementWindow: LearningWindowKey;
  analysisWindow: Readonly<{ from: Date; to: Date }>;
  confounders?: readonly string[];
  confoundersDocumented: boolean;
  arms: readonly ExperimentEvidenceArmInput[];
}>;

export type ExperimentEvidenceArmResult = Readonly<{
  armId: string;
  label: string;
  conceptVersionId: string | null;
  publicationId: string | null;
  readiness: ExperimentArmEvidenceReadiness;
  metricValue: number | null;
  platform: Platform | null;
  publishedAt: string | null;
  collectedAt: string | null;
  metricSemanticsVersion: string | null;
  limitations: readonly string[];
}>;

export type ExperimentEvidenceAnalysis = Readonly<{
  experimentId: string;
  experimentName: string;
  hypothesis: string;
  experimentStatus: string;
  primaryMetric: string | null;
  measurementWindow: LearningWindowKey;
  readiness: ExperimentEvidenceReadiness;
  arms: readonly ExperimentEvidenceArmResult[];
  evidenceFrame: EvidenceFrame | null;
  limitations: readonly string[];
}>;

export type AnalyzeExperimentEvidenceQuery = Readonly<{
  experimentId: string;
  measurementWindow: LearningWindowKey;
  analysisWindow: Readonly<{ from: Date; to: Date }>;
  confounders?: readonly string[];
  confoundersDocumented: boolean;
}>;

function asLearningMetricKey(value: string | null): LearningMetricKey | null {
  if (value === null || !LEARNING_METRIC_KEY_SET.has(value)) return null;
  return value as LearningMetricKey;
}

function normalizeMetricValue(value: number | bigint | null): number | null {
  if (value === null) return null;

  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return Number(value);
  }

  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }

  return value;
}

function uniquePush(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function armBase(
  arm: ExperimentEvidenceArmInput,
): Omit<ExperimentEvidenceArmResult, 'readiness' | 'metricValue' | 'limitations'> {
  return {
    armId: arm.id,
    label: arm.label,
    conceptVersionId: arm.conceptVersionId,
    publicationId: arm.publicationId,
    platform: arm.publication?.platform ?? null,
    publishedAt: arm.publication?.publishedAt ?? null,
    collectedAt: arm.publication?.collectedAt ?? null,
    metricSemanticsVersion: arm.publication?.metricSemanticsVersion ?? null,
  };
}

export function buildExperimentEvidenceAnalysis(
  input: ExperimentEvidenceInput,
): ExperimentEvidenceAnalysis {
  const limitations: string[] = [];
  const primaryMetric = asLearningMetricKey(input.experiment.primaryMetric);

  if (input.experiment.primaryMetric === null) {
    return {
      experimentId: input.experiment.id,
      experimentName: input.experiment.name,
      hypothesis: input.experiment.hypothesis,
      experimentStatus: input.experiment.status,
      primaryMetric: null,
      measurementWindow: input.measurementWindow,
      readiness: 'PRIMARY_METRIC_MISSING',
      arms: input.arms.map((arm) => ({
        ...armBase(arm),
        readiness:
          arm.publicationId === null ? 'PUBLICATION_NOT_ASSIGNED' : 'MEASUREMENT_NOT_READY',
        metricValue: null,
        limitations: ['Experiment primaryMetric is not declared.'],
      })),
      evidenceFrame: null,
      limitations: ['Experiment primaryMetric is not declared.'],
    };
  }

  if (primaryMetric === null) {
    const message = `Unsupported Experiment primaryMetric: ${input.experiment.primaryMetric}.`;
    return {
      experimentId: input.experiment.id,
      experimentName: input.experiment.name,
      hypothesis: input.experiment.hypothesis,
      experimentStatus: input.experiment.status,
      primaryMetric: input.experiment.primaryMetric,
      measurementWindow: input.measurementWindow,
      readiness: 'UNSUPPORTED_PRIMARY_METRIC',
      arms: input.arms.map((arm) => ({
        ...armBase(arm),
        readiness:
          arm.publicationId === null ? 'PUBLICATION_NOT_ASSIGNED' : 'MEASUREMENT_NOT_READY',
        metricValue: null,
        limitations: [message],
      })),
      evidenceFrame: null,
      limitations: [message],
    };
  }

  const observations: LearningEvidenceObservation[] = [];
  const preliminary = new Map<string, ExperimentEvidenceArmResult>();

  for (const arm of input.arms) {
    if (arm.publicationId === null) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'PUBLICATION_NOT_ASSIGNED',
        metricValue: null,
        limitations: [
          'ExperimentArm has no exact publicationId; conceptVersionId is not used to guess publication membership.',
        ],
      });
      continue;
    }

    if (arm.publication === null) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'PUBLICATION_NOT_FOUND',
        metricValue: null,
        limitations: ['The ExperimentArm publicationId does not resolve to a Publication.'],
      });
      continue;
    }

    if (arm.publication.status !== 'PUBLISHED' || arm.publication.publishedAt === null) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'PUBLICATION_NOT_PUBLISHED',
        metricValue: null,
        limitations: ['The exact ExperimentArm Publication is not canonically PUBLISHED.'],
      });
      continue;
    }

    if (
      arm.publication.measurementWindow === null ||
      arm.publication.collectedAt === null ||
      arm.publication.metricSemanticsVersion === null
    ) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'MEASUREMENT_NOT_READY',
        metricValue: null,
        limitations: [
          `No canonical ${input.measurementWindow} normalized measurement is ready for this Publication.`,
        ],
      });
      continue;
    }

    if (arm.publication.measurementWindow !== input.measurementWindow) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'MEASUREMENT_NOT_READY',
        metricValue: null,
        limitations: [
          `Canonical measurement window ${arm.publication.measurementWindow} does not match requested ${input.measurementWindow}.`,
        ],
      });
      continue;
    }

    const normalizedValue = normalizeMetricValue(arm.publication.metricValue);
    if (arm.publication.metricValue === null) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'METRIC_UNAVAILABLE',
        metricValue: null,
        limitations: [
          'The declared primary metric is unavailable (NULL) and is not converted to zero.',
        ],
      });
    } else if (normalizedValue === null) {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'METRIC_VALUE_OUT_OF_RANGE',
        metricValue: null,
        limitations: ['The declared primary metric is outside the deterministic numeric range.'],
      });
    } else {
      preliminary.set(arm.id, {
        ...armBase(arm),
        readiness: 'READY',
        metricValue: normalizedValue,
        limitations: [...arm.publication.comparabilityNotes],
      });
    }

    observations.push({
      publicationId: arm.publication.id,
      platform: arm.publication.platform,
      publishedAt: arm.publication.publishedAt,
      collectedAt: arm.publication.collectedAt,
      measurementWindow: arm.publication.measurementWindow,
      metricSemanticsVersion: arm.publication.metricSemanticsVersion,
      metricValue: arm.publication.metricValue,
      crossPlatformComparable: arm.publication.crossPlatformComparable,
      effectDirection: null,
      comparabilityNotes: arm.publication.comparabilityNotes,
    });
  }

  const evidenceFrame = buildEvidenceFrame({
    metricKey: primaryMetric,
    measurementWindow: input.measurementWindow,
    analysisWindow: input.analysisWindow,
    observations,
    ...(input.confounders === undefined ? {} : { confounders: input.confounders }),
    confoundersDocumented: input.confoundersDocumented,
  });

  const eligiblePublicationIds = new Set(
    evidenceFrame.eligible.map((observation) => observation.publicationId),
  );
  const exclusionByPublicationId = new Map(
    evidenceFrame.excluded.map((entry) => [entry.publicationId, entry.reason]),
  );

  const arms = input.arms.map((arm): ExperimentEvidenceArmResult => {
    const current = preliminary.get(arm.id);
    if (!current) throw new Error(`EXPERIMENT_ARM_ANALYSIS_MISSING:${arm.id}`);

    if (
      current.readiness === 'READY' &&
      arm.publicationId !== null &&
      !eligiblePublicationIds.has(arm.publicationId)
    ) {
      const reason = exclusionByPublicationId.get(arm.publicationId);
      return {
        ...current,
        readiness: 'EXCLUDED_FROM_COMPARISON',
        limitations: [
          ...current.limitations,
          `Publication excluded from direct comparison${reason ? `: ${reason}` : '.'}`,
        ],
      };
    }

    return current;
  });

  for (const arm of arms) {
    for (const limitation of arm.limitations) uniquePush(limitations, limitation);
  }
  for (const limitation of evidenceFrame.comparabilityLimitations) {
    uniquePush(limitations, limitation);
  }

  uniquePush(
    limitations,
    'Experiment analysis is descriptive only; Phase 9 V1 does not declare an authoritative winner or causal effect.',
  );

  const readyArmCount = arms.filter((arm) => arm.readiness === 'READY').length;
  const readiness: ExperimentEvidenceReadiness =
    readyArmCount >= 2 && evidenceFrame.sampleSize >= 2 ? 'READY' : 'INSUFFICIENT_DATA';

  return {
    experimentId: input.experiment.id,
    experimentName: input.experiment.name,
    hypothesis: input.experiment.hypothesis,
    experimentStatus: input.experiment.status,
    primaryMetric,
    measurementWindow: input.measurementWindow,
    readiness,
    arms,
    evidenceFrame,
    limitations,
  };
}

type NormalizedMetricProjection = Readonly<{
  collectedAt: Date;
  views: bigint | null;
  engagedViews: bigint | null;
  reach: bigint | null;
  impressions: bigint | null;
  likes: bigint | null;
  comments: bigint | null;
  shares: bigint | null;
  saves: bigint | null;
  watchTimeMs: bigint | null;
  avgWatchDurationMs: number | null;
  avgWatchPercentage: number | null;
  completionRate: number | null;
  profileVisits: bigint | null;
  websiteClicks: bigint | null;
  follows: bigint | null;
}>;

function metricValueFromRow(
  row: NormalizedMetricProjection,
  metricKey: LearningMetricKey,
): number | bigint | null {
  switch (metricKey) {
    case 'views':
      return row.views;
    case 'engagedViews':
      return row.engagedViews;
    case 'reach':
      return row.reach;
    case 'impressions':
      return row.impressions;
    case 'likes':
      return row.likes;
    case 'comments':
      return row.comments;
    case 'shares':
      return row.shares;
    case 'saves':
      return row.saves;
    case 'watchTimeMs':
      return row.watchTimeMs;
    case 'avgWatchDurationMs':
      return row.avgWatchDurationMs;
    case 'avgWatchPercentage':
      return row.avgWatchPercentage;
    case 'completionRate':
      return row.completionRate;
    case 'profileVisits':
      return row.profileVisits;
    case 'websiteClicks':
      return row.websiteClicks;
    case 'follows':
      return row.follows;
  }
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function comparabilityForMetric(value: unknown, metricKey: LearningMetricKey) {
  const record = jsonRecord(value);
  return {
    crossPlatformComparable:
      metricKey === 'views' && record?.['crossPlatformViewsComparable'] === true,
    notes: Array.isArray(record?.['notes'])
      ? record['notes'].filter((entry): entry is string => typeof entry === 'string')
      : [],
  };
}

export class ExperimentEvidenceService {
  constructor(private readonly db: PrismaClient) {}

  async analyze(query: AnalyzeExperimentEvidenceQuery): Promise<ExperimentEvidenceAnalysis | null> {
    if (
      Number.isNaN(query.analysisWindow.from.getTime()) ||
      Number.isNaN(query.analysisWindow.to.getTime()) ||
      query.analysisWindow.from.getTime() >= query.analysisWindow.to.getTime()
    ) {
      throw new Error('INVALID_ANALYSIS_WINDOW');
    }

    const experiment = await this.db.experiment.findUnique({
      where: { id: query.experimentId },
      select: {
        id: true,
        name: true,
        hypothesis: true,
        primaryMetric: true,
        status: true,
        arms: {
          orderBy: [{ label: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            label: true,
            conceptVersionId: true,
            publicationId: true,
          },
        },
      },
    });

    if (!experiment) return null;

    const primaryMetric = asLearningMetricKey(experiment.primaryMetric);
    const publicationIds = experiment.arms.flatMap((arm) =>
      arm.publicationId === null ? [] : [arm.publicationId],
    );

    const publications =
      publicationIds.length === 0
        ? []
        : await this.db.publication.findMany({
            where: { id: { in: publicationIds } },
            select: {
              id: true,
              status: true,
              publishedAt: true,
              platformAccount: { select: { platform: true } },
              normalizedMetrics: {
                orderBy: [{ collectedAt: 'asc' }, { id: 'asc' }],
                select: {
                  collectedAt: true,
                  views: true,
                  engagedViews: true,
                  reach: true,
                  impressions: true,
                  likes: true,
                  comments: true,
                  shares: true,
                  saves: true,
                  watchTimeMs: true,
                  avgWatchDurationMs: true,
                  avgWatchPercentage: true,
                  completionRate: true,
                  profileVisits: true,
                  websiteClicks: true,
                  follows: true,
                  comparabilityJson: true,
                  metricSemanticsVersion: true,
                  rawSnapshot: { select: { collectionOperationId: true } },
                },
              },
            },
          });

    const publicationById = new Map(
      publications.map((publication) => [publication.id, publication]),
    );
    const operationIds = publications.flatMap((publication) =>
      publication.normalizedMetrics.map((metric) => metric.rawSnapshot.collectionOperationId),
    );

    const jobs =
      operationIds.length === 0
        ? []
        : await this.db.jobAttempt.findMany({
            where: {
              operationId: { in: operationIds },
              status: 'SUCCEEDED',
            },
            orderBy: [{ attemptNumber: 'desc' }, { createdAt: 'desc' }],
            select: {
              operationId: true,
              jobType: true,
              attemptNumber: true,
            },
          });

    const windowByOperation = new Map<string, LearningWindowKey>();
    for (const job of jobs) {
      if (windowByOperation.has(job.operationId)) continue;
      const window = learningWindowFromAnalyticsJobType(job.jobType);
      if (window !== null) windowByOperation.set(job.operationId, window);
    }

    const arms: ExperimentEvidenceArmInput[] = experiment.arms.map((arm) => {
      if (arm.publicationId === null) {
        return {
          id: arm.id,
          label: arm.label,
          conceptVersionId: arm.conceptVersionId,
          publicationId: null,
          publication: null,
        };
      }

      const publication = publicationById.get(arm.publicationId);
      if (!publication) {
        return {
          id: arm.id,
          label: arm.label,
          conceptVersionId: arm.conceptVersionId,
          publicationId: arm.publicationId,
          publication: null,
        };
      }

      const exactWindowRows = publication.normalizedMetrics.flatMap((row) => {
        const window = windowByOperation.get(row.rawSnapshot.collectionOperationId);
        return window === query.measurementWindow ? [{ row, window }] : [];
      });
      const chosen = exactWindowRows.at(-1) ?? null;

      if (!chosen || primaryMetric === null) {
        return {
          id: arm.id,
          label: arm.label,
          conceptVersionId: arm.conceptVersionId,
          publicationId: arm.publicationId,
          publication: {
            id: publication.id,
            status: publication.status,
            publishedAt: publication.publishedAt?.toISOString() ?? null,
            platform: publication.platformAccount.platform,
            collectedAt: null,
            measurementWindow: null,
            metricSemanticsVersion: null,
            metricValue: null,
            crossPlatformComparable: false,
            comparabilityNotes: [],
          },
        };
      }

      const comparability = comparabilityForMetric(chosen.row.comparabilityJson, primaryMetric);

      return {
        id: arm.id,
        label: arm.label,
        conceptVersionId: arm.conceptVersionId,
        publicationId: arm.publicationId,
        publication: {
          id: publication.id,
          status: publication.status,
          publishedAt: publication.publishedAt?.toISOString() ?? null,
          platform: publication.platformAccount.platform,
          collectedAt: chosen.row.collectedAt.toISOString(),
          measurementWindow: chosen.window,
          metricSemanticsVersion: chosen.row.metricSemanticsVersion,
          metricValue: metricValueFromRow(chosen.row, primaryMetric),
          crossPlatformComparable: comparability.crossPlatformComparable,
          comparabilityNotes: comparability.notes,
        },
      };
    });

    return buildExperimentEvidenceAnalysis({
      experiment: {
        id: experiment.id,
        name: experiment.name,
        hypothesis: experiment.hypothesis,
        primaryMetric: experiment.primaryMetric,
        status: experiment.status,
      },
      measurementWindow: query.measurementWindow,
      analysisWindow: query.analysisWindow,
      ...(query.confounders === undefined ? {} : { confounders: query.confounders }),
      confoundersDocumented: query.confoundersDocumented,
      arms,
    });
  }
}
