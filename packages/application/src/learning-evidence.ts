import type { PrismaClient } from '@vision/database';

export const EVIDENCE_POLICY_RUNTIME_VERSION = 'EVIDENCE_POLICY_RUNTIME_V1' as const;

export const EVIDENCE_CONFIDENCE_LEVELS = [
  'INSUFFICIENT_DATA',
  'WEAK_SIGNAL',
  'INTERESTING_SIGNAL',
  'FAIRLY_SOLID',
] as const;

export type EvidenceConfidence = (typeof EVIDENCE_CONFIDENCE_LEVELS)[number];

export const EVIDENCE_POLICY_RUNTIME_V1 = Object.freeze({
  version: EVIDENCE_POLICY_RUNTIME_VERSION,
  singlePublicationMaxConfidence: 'WEAK_SIGNAL' as EvidenceConfidence,
  interestingSignal: Object.freeze({
    minimumComparablePublications: 3,
    minimumDistinctPublishDates: 2,
  }),
  fairlySolid: Object.freeze({
    minimumComparablePublications: 6,
    minimumDistinctPublishDates: 3,
    outlierDominanceShare: 0.6,
    consistentDirectionShare: 0.75,
  }),
});

export const LEARNING_METRIC_KEYS = [
  'views',
  'engagedViews',
  'reach',
  'impressions',
  'likes',
  'comments',
  'shares',
  'saves',
  'watchTimeMs',
  'avgWatchDurationMs',
  'avgWatchPercentage',
  'completionRate',
  'profileVisits',
  'websiteClicks',
  'follows',
] as const;

export type LearningMetricKey = (typeof LEARNING_METRIC_KEYS)[number];

export const LEARNING_WINDOW_KEYS = [
  'T_PLUS_1H',
  'T_PLUS_6H',
  'T_PLUS_24H',
  'T_PLUS_72H',
  'T_PLUS_7D',
  'T_PLUS_30D',
] as const;

export type LearningWindowKey = (typeof LEARNING_WINDOW_KEYS)[number];

export type EvidenceEffectDirection = -1 | 0 | 1;

export type LearningEvidenceObservation = Readonly<{
  publicationId: string;
  platform: 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE';
  publishedAt: string;
  collectedAt: string;
  measurementWindow: LearningWindowKey;
  metricSemanticsVersion: string;
  metricValue: number | bigint | null;
  crossPlatformComparable?: boolean;
  effectDirection?: EvidenceEffectDirection | null;
  comparabilityNotes?: readonly string[];
}>;

export type EvidenceExclusionReason =
  | 'MEASUREMENT_WINDOW_MISMATCH'
  | 'METRIC_UNAVAILABLE'
  | 'METRIC_VALUE_OUT_OF_RANGE'
  | 'INCOMPATIBLE_METRIC_SEMANTICS'
  | 'INCOMPATIBLE_PLATFORM';

export type EvidenceExcludedObservation = Readonly<{
  publicationId: string;
  reason: EvidenceExclusionReason;
}>;

export type EvidenceFrame = Readonly<{
  evidencePolicyVersion: typeof EVIDENCE_POLICY_RUNTIME_VERSION;
  metricKey: LearningMetricKey;
  measurementWindow: LearningWindowKey;
  analysisWindow: Readonly<{ from: string; to: string }>;
  eligible: readonly Readonly<{
    publicationId: string;
    platform: 'TIKTOK' | 'INSTAGRAM' | 'YOUTUBE';
    publishedAt: string;
    collectedAt: string;
    metricValue: number;
    effectDirection: EvidenceEffectDirection | null;
  }>[];
  excluded: readonly EvidenceExcludedObservation[];
  sampleSize: number;
  distinctPublishDates: number;
  metricSemanticsVersion: string | null;
  platforms: readonly ('TIKTOK' | 'INSTAGRAM' | 'YOUTUBE')[];
  comparabilityLimitations: readonly string[];
  confounders: readonly string[];
  confoundersDocumented: boolean;
  diagnostics: Readonly<{
    outlierDominanceShare: number | null;
    consistentDirectionShare: number | null;
  }>;
  deterministicConfidenceCeiling: EvidenceConfidence;
}>;

export type BuildEvidenceFrameInput = Readonly<{
  metricKey: LearningMetricKey;
  measurementWindow: LearningWindowKey;
  analysisWindow: Readonly<{ from: Date; to: Date }>;
  observations: readonly LearningEvidenceObservation[];
  confounders?: readonly string[];
  confoundersDocumented: boolean;
}>;

type Platform = LearningEvidenceObservation['platform'];

const CONFIDENCE_RANK: Record<EvidenceConfidence, number> = {
  INSUFFICIENT_DATA: 0,
  WEAK_SIGNAL: 1,
  INTERESTING_SIGNAL: 2,
  FAIRLY_SOLID: 3,
};

function capConfidence(
  current: EvidenceConfidence,
  ceiling: EvidenceConfidence,
): EvidenceConfidence {
  return CONFIDENCE_RANK[current] <= CONFIDENCE_RANK[ceiling] ? current : ceiling;
}

function utcDateKey(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) throw new Error('INVALID_EVIDENCE_DATE');
  return parsed.toISOString().slice(0, 10);
}

function normalizeMetricValue(value: number | bigint | null): number | null {
  if (value === null) return null;
  if (typeof value === 'bigint') {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      return null;
    }
    return Number(value);
  }
  if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER) {
    return null;
  }
  return value;
}

function mostFrequentLexical(values: readonly string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return (
    [...counts.entries()].sort(([leftValue, leftCount], [rightValue, rightCount]) => {
      if (leftCount !== rightCount) return rightCount - leftCount;
      return leftValue.localeCompare(rightValue);
    })[0]?.[0] ?? null
  );
}

function outlierDominanceShare(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const magnitudes = values.map((value) => Math.abs(value));
  const total = magnitudes.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  return Math.max(...magnitudes) / total;
}

function consistentDirectionShare(
  directions: readonly (EvidenceEffectDirection | null)[],
): number | null {
  if (directions.length === 0 || directions.some((value) => value === null)) return null;
  const nonZero = directions.filter((value): value is -1 | 1 => value === -1 || value === 1);
  if (nonZero.length !== directions.length || nonZero.length === 0) return null;
  const positive = nonZero.filter((value) => value === 1).length;
  const negative = nonZero.length - positive;
  return Math.max(positive, negative) / nonZero.length;
}

function uniqueSorted<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)].sort() as T[];
}

function limitationPush(target: string[], value: string) {
  if (!target.includes(value)) target.push(value);
}

export function nullSafeRate(
  numerator: number | bigint | null,
  denominator: number | bigint | null,
): number | null {
  if (numerator === null || denominator === null) return null;

  if (typeof numerator === 'bigint' || typeof denominator === 'bigint') {
    const n = typeof numerator === 'bigint' ? numerator : BigInt(numerator);
    const d = typeof denominator === 'bigint' ? denominator : BigInt(denominator);
    if (n < 0n || d <= 0n) return null;
    if (n === 0n) return 0;
    const scale = 1_000_000n;
    return Number((n * scale) / d) / Number(scale);
  }

  if (!Number.isFinite(numerator) || !Number.isFinite(denominator)) return null;
  if (numerator < 0 || denominator <= 0) return null;
  return numerator / denominator;
}

export const AUTHORITATIVE_ATTRIBUTION_SOURCE = Object.freeze({
  WEBSITE_VISIT: 'UMAMI',
  SIGNUP: 'VISION_APP',
  ACTIVATION: 'VISION_APP',
  CUSTOMER: 'VISION_APP',
  REVENUE: 'VISION_APP',
} as const);

export type LearningAttributionEventType = keyof typeof AUTHORITATIVE_ATTRIBUTION_SOURCE;
export type LearningAttributionSourceSystem = 'UMAMI' | 'VISION_APP' | 'MANUAL';

export function authoritativeSourceFor(
  eventType: LearningAttributionEventType,
): (typeof AUTHORITATIVE_ATTRIBUTION_SOURCE)[LearningAttributionEventType] {
  return AUTHORITATIVE_ATTRIBUTION_SOURCE[eventType];
}

export function isAuthoritativeAttributionSource(
  eventType: LearningAttributionEventType,
  sourceSystem: LearningAttributionSourceSystem,
) {
  return authoritativeSourceFor(eventType) === sourceSystem;
}

export function learningWindowFromAnalyticsJobType(jobType: string): LearningWindowKey | null {
  const automated = /^ANALYTICS_COLLECT:[^:]+:(T_PLUS_(?:1H|6H|24H|72H|7D|30D))$/.exec(jobType);
  if (automated) return automated[1] as LearningWindowKey;

  const manual = /^ANALYTICS_MANUAL:TIKTOK:(T_PLUS_(?:24H|72H|7D|30D))$/.exec(jobType);
  return (manual?.[1] as LearningWindowKey | undefined) ?? null;
}

export function buildEvidenceFrame(input: BuildEvidenceFrameInput): EvidenceFrame {
  const from = input.analysisWindow.from;
  const to = input.analysisWindow.to;
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    from.getTime() >= to.getTime()
  ) {
    throw new Error('INVALID_ANALYSIS_WINDOW');
  }

  const excluded: EvidenceExcludedObservation[] = [];
  const limitations: string[] = [];
  const requestedWindow: LearningEvidenceObservation[] = [];

  for (const observation of input.observations) {
    if (observation.measurementWindow !== input.measurementWindow) {
      excluded.push({
        publicationId: observation.publicationId,
        reason: 'MEASUREMENT_WINDOW_MISMATCH',
      });
      continue;
    }
    if (observation.metricValue === null) {
      excluded.push({
        publicationId: observation.publicationId,
        reason: 'METRIC_UNAVAILABLE',
      });
      continue;
    }
    if (normalizeMetricValue(observation.metricValue) === null) {
      excluded.push({
        publicationId: observation.publicationId,
        reason: 'METRIC_VALUE_OUT_OF_RANGE',
      });
      continue;
    }
    requestedWindow.push(observation);
  }

  const chosenSemantics = mostFrequentLexical(
    requestedWindow.map((observation) => observation.metricSemanticsVersion),
  );
  const semanticCompatible: LearningEvidenceObservation[] = [];

  for (const observation of requestedWindow) {
    if (chosenSemantics !== null && observation.metricSemanticsVersion !== chosenSemantics) {
      excluded.push({
        publicationId: observation.publicationId,
        reason: 'INCOMPATIBLE_METRIC_SEMANTICS',
      });
      continue;
    }
    semanticCompatible.push(observation);
  }

  const platforms = uniqueSorted(semanticCompatible.map((observation) => observation.platform));
  let platformCompatible = semanticCompatible;

  if (platforms.length > 1) {
    const allExplicitlyComparable = semanticCompatible.every(
      (observation) => observation.crossPlatformComparable === true,
    );

    if (!allExplicitlyComparable) {
      const chosenPlatform = mostFrequentLexical(
        semanticCompatible.map((observation) => observation.platform),
      ) as Platform | null;
      platformCompatible = [];
      for (const observation of semanticCompatible) {
        if (observation.platform !== chosenPlatform) {
          excluded.push({
            publicationId: observation.publicationId,
            reason: 'INCOMPATIBLE_PLATFORM',
          });
          continue;
        }
        platformCompatible.push(observation);
      }
      limitationPush(
        limitations,
        'Cross-platform comparison blocked because compatibility was not explicitly established.',
      );
    }
  }

  for (const observation of platformCompatible) {
    for (const note of observation.comparabilityNotes ?? []) {
      limitationPush(limitations, note);
    }
  }

  if (excluded.some((entry) => entry.reason === 'MEASUREMENT_WINDOW_MISMATCH')) {
    limitationPush(limitations, 'Observations with a different measurement window were excluded.');
  }
  if (excluded.some((entry) => entry.reason === 'INCOMPATIBLE_METRIC_SEMANTICS')) {
    limitationPush(limitations, 'Observations with incompatible metric semantics were excluded.');
  }
  if (excluded.some((entry) => entry.reason === 'METRIC_UNAVAILABLE')) {
    limitationPush(
      limitations,
      'Unavailable metrics remain NULL and were excluded rather than converted to zero.',
    );
  }
  if (excluded.some((entry) => entry.reason === 'METRIC_VALUE_OUT_OF_RANGE')) {
    limitationPush(
      limitations,
      'Metric values outside the deterministic numeric range were excluded.',
    );
  }

  const eligible = platformCompatible
    .map((observation) => ({
      publicationId: observation.publicationId,
      platform: observation.platform,
      publishedAt: observation.publishedAt,
      collectedAt: observation.collectedAt,
      metricValue: normalizeMetricValue(observation.metricValue)!,
      effectDirection: observation.effectDirection ?? null,
    }))
    .sort((left, right) => {
      const dateOrder = left.publishedAt.localeCompare(right.publishedAt);
      if (dateOrder !== 0) return dateOrder;
      return left.publicationId.localeCompare(right.publicationId);
    });

  const sampleSize = eligible.length;
  const distinctPublishDates = new Set(
    eligible.map((observation) => utcDateKey(observation.publishedAt)),
  ).size;
  const outlierShare = outlierDominanceShare(
    eligible.map((observation) => observation.metricValue),
  );
  const directionShare = consistentDirectionShare(
    eligible.map((observation) => observation.effectDirection),
  );

  let confidence: EvidenceConfidence = sampleSize === 0 ? 'INSUFFICIENT_DATA' : 'WEAK_SIGNAL';

  if (
    sampleSize >= EVIDENCE_POLICY_RUNTIME_V1.interestingSignal.minimumComparablePublications &&
    distinctPublishDates >=
      EVIDENCE_POLICY_RUNTIME_V1.interestingSignal.minimumDistinctPublishDates &&
    input.confoundersDocumented
  ) {
    confidence = 'INTERESTING_SIGNAL';
  }

  if (
    confidence === 'INTERESTING_SIGNAL' &&
    sampleSize >= EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.minimumComparablePublications &&
    distinctPublishDates >= EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.minimumDistinctPublishDates &&
    directionShare !== null &&
    directionShare >= EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.consistentDirectionShare &&
    outlierShare !== null &&
    outlierShare <= EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.outlierDominanceShare
  ) {
    confidence = 'FAIRLY_SOLID';
  }

  if (sampleSize === 1) {
    confidence = capConfidence(
      confidence,
      EVIDENCE_POLICY_RUNTIME_V1.singlePublicationMaxConfidence,
    );
  }

  if (!input.confoundersDocumented && sampleSize >= 3) {
    limitationPush(
      limitations,
      'Important confounders are not explicitly documented; confidence is capped.',
    );
  }
  if (
    sampleSize >= EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.minimumComparablePublications &&
    directionShare === null
  ) {
    limitationPush(
      limitations,
      'Consistent effect direction is not established; FAIRLY_SOLID is unavailable.',
    );
  } else if (
    directionShare !== null &&
    directionShare < EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.consistentDirectionShare
  ) {
    limitationPush(
      limitations,
      'Observed effect direction is not consistent enough for FAIRLY_SOLID.',
    );
  }
  if (
    outlierShare !== null &&
    outlierShare > EVIDENCE_POLICY_RUNTIME_V1.fairlySolid.outlierDominanceShare
  ) {
    limitationPush(
      limitations,
      'A single observation dominates the metric evidence; FAIRLY_SOLID is unavailable.',
    );
    confidence = capConfidence(confidence, 'INTERESTING_SIGNAL');
  }

  return {
    evidencePolicyVersion: EVIDENCE_POLICY_RUNTIME_VERSION,
    metricKey: input.metricKey,
    measurementWindow: input.measurementWindow,
    analysisWindow: { from: from.toISOString(), to: to.toISOString() },
    eligible,
    excluded: excluded.sort((left, right) => {
      const publicationOrder = left.publicationId.localeCompare(right.publicationId);
      if (publicationOrder !== 0) return publicationOrder;
      return left.reason.localeCompare(right.reason);
    }),
    sampleSize,
    distinctPublishDates,
    metricSemanticsVersion: chosenSemantics,
    platforms: uniqueSorted(eligible.map((observation) => observation.platform)),
    comparabilityLimitations: limitations,
    confounders: [...(input.confounders ?? [])],
    confoundersDocumented: input.confoundersDocumented,
    diagnostics: {
      outlierDominanceShare: outlierShare,
      consistentDirectionShare: directionShare,
    },
    deterministicConfidenceCeiling: confidence,
  };
}

type NormalizedMetricRow = Readonly<{
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
  comparabilityJson: unknown;
  metricSemanticsVersion: string;
  rawSnapshot: Readonly<{ collectionOperationId: string }>;
}>;

function metricFromRow(
  row: NormalizedMetricRow,
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
  const notes = Array.isArray(record?.['notes'])
    ? record['notes'].filter((entry): entry is string => typeof entry === 'string')
    : [];
  return {
    crossPlatformComparable:
      metricKey === 'views' && record?.['crossPlatformViewsComparable'] === true,
    notes,
  };
}

export type MetricEvidenceQuery = Readonly<{
  analysisWindow: Readonly<{ from: Date; to: Date }>;
  measurementWindow: LearningWindowKey;
  metricKey: LearningMetricKey;
  confounders?: readonly string[];
  confoundersDocumented: boolean;
  platform?: Platform;
}>;

export class EvidenceComparabilityService {
  constructor(private readonly db: PrismaClient) {}

  async metricFrame(query: MetricEvidenceQuery): Promise<EvidenceFrame> {
    if (
      Number.isNaN(query.analysisWindow.from.getTime()) ||
      Number.isNaN(query.analysisWindow.to.getTime()) ||
      query.analysisWindow.from.getTime() >= query.analysisWindow.to.getTime()
    ) {
      throw new Error('INVALID_ANALYSIS_WINDOW');
    }

    const publications = await this.db.publication.findMany({
      where: {
        status: 'PUBLISHED',
        publishedAt: {
          gte: query.analysisWindow.from,
          lt: query.analysisWindow.to,
        },
        ...(query.platform === undefined
          ? {}
          : { platformAccount: { is: { platform: query.platform } } }),
      },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }],
      take: 501,
      select: {
        id: true,
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

    if (publications.length > 500) throw new Error('EVIDENCE_PUBLICATION_LIMIT_EXCEEDED');

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

    const observations: LearningEvidenceObservation[] = [];

    for (const publication of publications) {
      if (!publication.publishedAt) continue;

      const candidateRows = publication.normalizedMetrics.flatMap((row) => {
        const window = windowByOperation.get(row.rawSnapshot.collectionOperationId);
        return window === undefined ? [] : [{ row, window }];
      });

      const exactWindowRows = candidateRows.filter(
        (candidate) => candidate.window === query.measurementWindow,
      );
      const chosen = exactWindowRows.at(-1);

      if (!chosen) {
        continue;
      }

      const comparability = comparabilityForMetric(chosen.row.comparabilityJson, query.metricKey);

      observations.push({
        publicationId: publication.id,
        platform: publication.platformAccount.platform,
        publishedAt: publication.publishedAt.toISOString(),
        collectedAt: chosen.row.collectedAt.toISOString(),
        measurementWindow: chosen.window,
        metricSemanticsVersion: chosen.row.metricSemanticsVersion,
        metricValue: metricFromRow(chosen.row, query.metricKey),
        crossPlatformComparable: comparability.crossPlatformComparable,
        comparabilityNotes: comparability.notes,
      });
    }

    return buildEvidenceFrame({
      metricKey: query.metricKey,
      measurementWindow: query.measurementWindow,
      analysisWindow: query.analysisWindow,
      observations,
      ...(query.confounders === undefined ? {} : { confounders: query.confounders }),
      confoundersDocumented: query.confoundersDocumented,
    });
  }
}
