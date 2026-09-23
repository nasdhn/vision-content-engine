import { WeeklyAnalysisRequestPayloadSchema } from '@vision/contracts';
import { Persistence } from '@vision/database';
import type { Actor, PrismaClient } from '@vision/database';

const MAX_REPORTS = 26;
const MAX_CHECKPOINT_SCAN = 500;

type Counts = {
  total: number | null;
  direct: number | null;
  inferred: number | null;
  unknown: number | null;
};

export type LearningReportSummary = {
  analysisOperationKey: string;
  workflowRunId: string;
  status: string;
  currentStep: string | null;
  analysisWindow: { from: string; to: string };
  measurementWindow: string;
  createdAt: string;
  finishedAt: string | null;
  insightCount: number;
};

export type LearningWeeklyReport = LearningReportSummary & {
  generatedAt: string;
  businessOutcomes: {
    websiteVisits: Counts & { sourceSystem: 'UMAMI' };
    signups: Counts & { sourceSystem: 'VISION_APP' };
    activations: Counts & { sourceSystem: 'VISION_APP' };
    customers: Counts & { sourceSystem: 'VISION_APP' };
    revenueEvents: Counts & { sourceSystem: 'VISION_APP' };
    revenueByCurrency: { currency: string; amountMinor: string }[];
    attributionSummary: {
      directPublicationLinks: number | null;
      inferredSignals: number | null;
      unknownSignals: number | null;
    };
  };
  funnel: {
    stage: 'CONTENT' | 'WEBSITE' | 'SIGNUP' | 'ACTIVATION' | 'CUSTOMER' | 'REVENUE';
    value: number | null;
    availability: 'OBSERVED' | 'UNAVAILABLE';
    unit: string | null;
  }[];
  platformPerformance: {
    platform: string;
    publicationCount: number;
    measurementWindow: string;
    metrics: {
      metric: string;
      observedValues: number[];
      unavailableCount: number;
      comparableSampleSize: number;
      semanticVersions: string[];
      limitations: string[];
    }[];
  }[];
  contentSignals: {
    insightId: string;
    statement: string;
    confidence: string;
    sampleSize: number;
    measurementWindow: string;
    limitations: string[];
    patternVersionIds: string[];
    hookTypes: string[];
    platforms: string[];
  }[];
  contentContext: {
    patternVersionIds: { value: string; count: number }[];
    hookTypes: { value: string; count: number }[];
    primaryFormats: { value: string; count: number }[];
    ctaTypes: { value: string; count: number }[];
  };
  editingSignals: {
    insightId: string;
    statement: string;
    confidence: string;
    sampleSize: number;
    measurementWindow: string;
    limitations: string[];
    editingProfileVersionIds: string[];
  }[];
  editingContext: {
    editingProfileVersionIds: { value: string; count: number }[];
    templateVersionIds: { value: string; count: number }[];
    durationsMs: { value: string; count: number }[];
  };
  insights: {
    id: string;
    statement: string;
    confidence: string;
    citedPublicationIds: string[];
    citedSampleSize: number;
    weeklySampleSize: number | null;
    measurementWindow: string;
    limitations: string[];
    dimensions: Record<string, string[]>;
    sourceContext: {
      evidencePolicyVersion: string | null;
      platforms: string[];
      sourceAuthority: Record<string, string>;
    };
    createdAt: string;
  }[];
  recommendations: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    recommendedTest: null | {
      hypothesis: string;
      change: string;
      keepConstant: string[];
      primaryMetric: string;
      measurementWindow: string;
    };
    experimentProposal: null | {
      experimentId: string;
      status: string;
      campaignId: string | null;
    };
    createdAt: string;
  }[];
  experiments: {
    experimentId: string;
    name: string;
    hypothesis: string;
    status: string;
    primaryMetric: string | null;
    measurementWindow: string;
    readiness: string;
    arms: {
      label: string;
      publicationId: string | null;
      readiness: string;
      metricValue: number | null;
      platform: string | null;
      metricSemanticsVersion: string | null;
      limitations: string[];
    }[];
    limitations: string[];
  }[];
  dataQuality: {
    issues: { category: string; detail: string }[];
    excludedPublicationCount: number;
    unavailableMetricCount: number;
  };
};

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function strings(value: unknown): string[] {
  return array(value).filter((entry): entry is string => typeof entry === 'string');
}

function text(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringMap(value: unknown): Record<string, string> {
  const row = record(value);
  if (!row) return {};
  return Object.fromEntries(
    Object.entries(row).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function frequency(values: (string | null)[]) {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, count]) => ({ value, count }));
}

function checkpointKey(value: unknown) {
  return text(record(record(value)?.['metadata'])?.['analysisOperationKey']);
}

function auditIds(value: unknown, key: 'insightIds' | 'recommendationIds') {
  return strings(record(value)?.[key]);
}

function mergedLimitations(value: unknown): string[] {
  const row = record(value);
  if (!row) return [];
  const final = strings(row['final']);
  if (final.length > 0) return final;
  return unique([
    ...strings(row['deterministic']),
    ...strings(row['analyst']),
    ...strings(row['dataQuality']),
    ...strings(row['comparability']),
    ...strings(row['attribution']),
  ]);
}

function frozenCount(value: unknown): Counts {
  return {
    total: finite(value),
    direct: null,
    inferred: null,
    unknown: null,
  };
}

function recommendedTest(value: unknown) {
  const row = record(value);
  if (!row) return null;
  const hypothesis = text(row['hypothesis']);
  const change = text(row['change']);
  const primaryMetric = text(row['primaryMetric']);
  const measurementWindow = text(row['measurementWindow']);
  if (!hypothesis || !change || !primaryMetric || !measurementWindow) return null;
  return {
    hypothesis,
    change,
    keepConstant: strings(row['keepConstant']),
    primaryMetric,
    measurementWindow,
  };
}

function experimentProjection(value: unknown): LearningWeeklyReport['experiments'] {
  return array(value).flatMap((entry) => {
    const row = record(entry);
    const experimentId = text(row?.['experimentId']);
    if (!row || !experimentId) return [];
    return [
      {
        experimentId,
        name: text(row['experimentName']) ?? 'Expérience',
        hypothesis: text(row['hypothesis']) ?? 'Hypothèse indisponible',
        status: text(row['experimentStatus']) ?? 'UNKNOWN',
        primaryMetric: text(row['primaryMetric']),
        measurementWindow: text(row['measurementWindow']) ?? 'UNKNOWN',
        readiness: text(row['readiness']) ?? 'INSUFFICIENT_DATA',
        arms: array(row['arms']).flatMap((armValue) => {
          const arm = record(armValue);
          const label = text(arm?.['label']);
          if (!arm || !label) return [];
          return [
            {
              label,
              publicationId: text(arm['publicationId']),
              readiness: text(arm['readiness']) ?? 'MEASUREMENT_NOT_READY',
              metricValue: finite(arm['metricValue']),
              platform: text(arm['platform']),
              metricSemanticsVersion: text(arm['metricSemanticsVersion']),
              limitations: strings(arm['limitations']),
            },
          ];
        }),
        limitations: strings(row['limitations']),
      },
    ];
  });
}

export class LearningDashboardService {
  private readonly persistence: Persistence;

  constructor(
    private readonly db: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.persistence = new Persistence(db);
  }

  private async frozenRequest(workflowRunId: string) {
    const job = await this.db.jobAttempt.findFirst({
      where: { workflowRunId, jobType: 'WEEKLY_ANALYSIS' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    if (!job) throw new Error('LEARNING_REPORT_JOB_NOT_FOUND');

    const event = await this.db.outboxEvent.findFirst({
      where: {
        eventType: 'WeeklyAnalysis.requested',
        aggregateType: 'JobAttempt',
        aggregateId: job.id,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (!event) throw new Error('LEARNING_REPORT_FROZEN_WINDOW_NOT_FOUND');
    return WeeklyAnalysisRequestPayloadSchema.parse(event.payloadJson);
  }

  async list(): Promise<LearningReportSummary[]> {
    const workflows = await this.db.workflowRun.findMany({
      where: {
        workflowType: 'WEEKLY_ANALYSIS',
        rootEntityType: 'WeeklyAnalysisOperation',
        status: 'SUCCEEDED',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_REPORTS,
      select: {
        id: true,
        rootEntityId: true,
        status: true,
        currentStep: true,
        createdAt: true,
        finishedAt: true,
      },
    });

    const scopeIds = workflows.map((row) => row.rootEntityId);
    const insightRows = scopeIds.length
      ? await this.db.insight.findMany({
          where: { scopeType: 'WEEKLY_ANALYSIS', scopeId: { in: scopeIds } },
          select: { scopeId: true },
        })
      : [];
    const countByScope = new Map<string, number>();
    for (const row of insightRows) {
      if (!row.scopeId) continue;
      countByScope.set(row.scopeId, (countByScope.get(row.scopeId) ?? 0) + 1);
    }

    const result: LearningReportSummary[] = [];
    for (const workflow of workflows) {
      const frozen = await this.frozenRequest(workflow.id);
      result.push({
        analysisOperationKey: workflow.rootEntityId,
        workflowRunId: workflow.id,
        status: workflow.status,
        currentStep: workflow.currentStep,
        analysisWindow: frozen.analysisWindow,
        measurementWindow: frozen.measurementWindow,
        createdAt: workflow.createdAt.toISOString(),
        finishedAt: workflow.finishedAt?.toISOString() ?? null,
        insightCount: countByScope.get(workflow.rootEntityId) ?? 0,
      });
    }
    return result;
  }

  private async checkpoint(analysisOperationKey: string) {
    const rows = await this.db.auditEvent.findMany({
      where: {
        action: 'ModelInvocation.output_checkpointed',
        subjectType: 'ModelInvocation',
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MAX_CHECKPOINT_SCAN,
      select: { subjectId: true, afterJson: true },
    });

    const found = rows.find((row) => checkpointKey(row.afterJson) === analysisOperationKey);
    if (!found && rows.length >= MAX_CHECKPOINT_SCAN) {
      throw new Error('LEARNING_REPORT_PROVENANCE_LIMIT_EXCEEDED');
    }
    return found ?? null;
  }

  async detail(analysisOperationKey: string): Promise<LearningWeeklyReport> {
    const workflow = await this.db.workflowRun.findFirst({
      where: {
        workflowType: 'WEEKLY_ANALYSIS',
        rootEntityType: 'WeeklyAnalysisOperation',
        rootEntityId: analysisOperationKey,
        status: 'SUCCEEDED',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        status: true,
        currentStep: true,
        createdAt: true,
        finishedAt: true,
      },
    });
    if (!workflow) throw new Error('LEARNING_REPORT_NOT_FOUND');

    const frozen = await this.frozenRequest(workflow.id);
    const checkpoint = await this.checkpoint(analysisOperationKey);
    if (!checkpoint) throw new Error('LEARNING_REPORT_PROVENANCE_NOT_FOUND');
    const envelope = record(checkpoint.afterJson);
    const metadata = record(envelope?.['metadata']);
    const input = record(metadata?.['input']);
    const output = record(envelope?.['output']);

    const insightRows = await this.db.insight.findMany({
      where: { scopeType: 'WEEKLY_ANALYSIS', scopeId: analysisOperationKey },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });

    const evidence = record(insightRows[0]?.evidenceJson) ?? record(metadata?.['evidence']) ?? {};
    const measurementWindow = text(evidence['measurementWindow']) ?? frozen.measurementWindow;
    const weeklySampleSize = finite(evidence['sampleSize']);

    const invocationIds = [
      ...new Set([
        ...insightRows.flatMap((row) => (row.modelInvocationId ? [row.modelInvocationId] : [])),
        ...(checkpoint ? [checkpoint.subjectId] : []),
      ]),
    ];
    const applied = invocationIds.length
      ? await this.db.auditEvent.findMany({
          where: {
            action: 'ModelInvocation.applied',
            subjectType: 'ModelInvocation',
            subjectId: { in: invocationIds },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { subjectId: true, afterJson: true },
        })
      : [];

    const outputInsights = array(output?.['insights']).map(record);
    const checkpointApplied = checkpoint
      ? applied.find((entry) => entry.subjectId === checkpoint.subjectId)
      : undefined;
    const persistedInsightIds = auditIds(checkpointApplied?.afterJson, 'insightIds');
    const outputByInsightId = new Map<string, Record<string, unknown>>();
    persistedInsightIds.forEach((id, index) => {
      const source = outputInsights[index];
      if (source) outputByInsightId.set(id, source);
    });

    const recommendationIds = [
      ...new Set(applied.flatMap((entry) => auditIds(entry.afterJson, 'recommendationIds'))),
    ];
    const recommendationRows = recommendationIds.length
      ? await this.db.recommendation.findMany({ where: { id: { in: recommendationIds } } })
      : [];
    const recommendationById = new Map(recommendationRows.map((row) => [row.id, row]));

    const proposalAudits = recommendationIds.length
      ? await this.db.auditEvent.findMany({
          where: {
            action: 'Experiment.proposal_created',
            subjectType: 'Recommendation',
            subjectId: { in: recommendationIds },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { subjectId: true, afterJson: true },
        })
      : [];
    const proposalByRecommendation = new Map(
      proposalAudits.map((row) => [row.subjectId, record(row.afterJson)]),
    );
    const experimentIds = proposalAudits.flatMap((row) => {
      const id = text(record(row.afterJson)?.['experimentId']);
      return id ? [id] : [];
    });
    const experimentRows = experimentIds.length
      ? await this.db.experiment.findMany({
          where: { id: { in: experimentIds } },
          select: { id: true, status: true, campaignId: true },
        })
      : [];
    const experimentById = new Map(experimentRows.map((row) => [row.id, row]));

    const recommendations = recommendationIds.flatMap((id) => {
      const row = recommendationById.get(id);
      if (!row) return [];
      const proposal = proposalByRecommendation.get(id);
      const experimentId = text(proposal?.['experimentId']);
      const experiment = experimentId ? experimentById.get(experimentId) : undefined;
      return [
        {
          id: row.id,
          title: row.title,
          description: row.description,
          status: row.status,
          recommendedTest: recommendedTest(row.recommendedTestJson),
          experimentProposal: experiment
            ? {
                experimentId: experiment.id,
                status: experiment.status,
                campaignId: experiment.campaignId,
              }
            : null,
          createdAt: row.createdAt.toISOString(),
        },
      ];
    });

    const sourceContext = {
      evidencePolicyVersion: text(evidence['evidencePolicyVersion']),
      platforms: strings(evidence['platforms']),
      sourceAuthority: stringMap(evidence['sourceAuthority']),
    };

    const insights = insightRows.map((row) => {
      const source = outputByInsightId.get(row.id);
      const dimensions = record(source?.['dimensions']) ?? {};
      const citedPublicationIds = strings(source?.['evidencePublicationIds']);
      return {
        id: row.id,
        statement: row.statement,
        confidence: row.confidence,
        citedPublicationIds,
        citedSampleSize: citedPublicationIds.length,
        weeklySampleSize,
        measurementWindow,
        limitations: mergedLimitations(row.limitationsJson),
        dimensions: Object.fromEntries(
          Object.entries(dimensions)
            .map(([key, value]) => [key, strings(value)] as const)
            .filter(([, values]) => values.length > 0),
        ),
        sourceContext,
        createdAt: row.createdAt.toISOString(),
      };
    });

    const frozenPublications = array(input?.['publications']).flatMap((value) => {
      const row = record(value);
      const publicationId = text(row?.['publicationId']);
      const platform = text(row?.['platform']);
      if (!row || !publicationId || !platform) return [];
      return [
        {
          publicationId,
          platform,
          measurementWindow: text(row['measurementWindow']) ?? measurementWindow,
          contentDimensions: record(row['contentDimensions']) ?? {},
          normalizedMetrics: record(row['normalizedMetrics']) ?? {},
          comparability: record(row['comparability']) ?? {},
        },
      ];
    });

    const metricSemantics = array(evidence['metricSemantics']).flatMap((value) => {
      const row = record(value);
      const platform = text(row?.['platform']);
      const metric = text(row?.['metric']);
      if (!row || !platform || !metric) return [];
      return [
        {
          platform,
          metric,
          version: text(row['version']),
          sampleSize: finite(row['sampleSize']) ?? 0,
        },
      ];
    });

    const platformPerformance = unique(frozenPublications.map((row) => row.platform))
      .sort()
      .map((platform) => {
        const publications = frozenPublications.filter((row) => row.platform === platform);
        const metricKeys = unique(
          publications.flatMap((row) => Object.keys(row.normalizedMetrics)),
        ).sort();
        return {
          platform,
          publicationCount: publications.length,
          measurementWindow,
          metrics: metricKeys.map((metric) => {
            const observedValues = publications.flatMap((publication) => {
              const value = finite(publication.normalizedMetrics[metric]);
              return value === null ? [] : [value];
            });
            const semantics = metricSemantics.filter(
              (row) => row.platform === platform && row.metric === metric,
            );
            return {
              metric,
              observedValues,
              unavailableCount: publications.length - observedValues.length,
              comparableSampleSize: Math.max(0, ...semantics.map((row) => row.sampleSize), 0),
              semanticVersions: unique(
                semantics.flatMap((row) => (row.version ? [row.version] : [])),
              ),
              limitations: unique(
                publications.flatMap((row) => strings(row.comparability['limitations'])),
              ),
            };
          }),
        };
      });

    const dimensions = frozenPublications.map((row) => row.contentDimensions);
    const contentContext = {
      patternVersionIds: frequency(dimensions.map((row) => text(row['patternVersionId']))),
      hookTypes: frequency(dimensions.map((row) => text(row['hookType']))),
      primaryFormats: frequency(dimensions.map((row) => text(row['primaryFormat']))),
      ctaTypes: frequency(dimensions.map((row) => text(row['ctaType']))),
    };
    const editingContext = {
      editingProfileVersionIds: frequency(
        dimensions.map((row) => text(row['editingProfileVersionId'])),
      ),
      templateVersionIds: frequency(dimensions.map((row) => text(row['templateVersionId']))),
      durationsMs: frequency(
        dimensions.map((row) => {
          const duration = finite(row['durationMs']);
          return duration === null ? null : String(duration);
        }),
      ),
    };

    const frozenAttribution =
      record(input?.['attributionSignals']) ?? record(evidence['attributionContext']) ?? {};
    const websiteVisits = frozenCount(frozenAttribution['websiteVisits']);
    const signups = frozenCount(frozenAttribution['signups']);
    const activations = frozenCount(frozenAttribution['activations']);
    const customers = frozenCount(frozenAttribution['customers']);
    const revenueEvents = frozenCount(null);
    const revenueAmountMinor = finite(frozenAttribution['revenueAmountMinor']);
    const revenueCurrency = text(frozenAttribution['revenueCurrency']);

    const issueKeys = [
      ['DATA_QUALITY', 'dataQuality'],
      ['COMPARABILITY', 'comparability'],
      ['ATTRIBUTION', 'attribution'],
    ] as const;
    const issueRows: { category: string; detail: string }[] = [];
    const limitationSources = [
      ...insightRows.map((row) => record(row.limitationsJson)),
      record(metadata?.['limitations']),
    ].filter((row): row is Record<string, unknown> => row !== null);
    for (const [category, key] of issueKeys) {
      for (const detail of unique(limitationSources.flatMap((row) => strings(row[key])))) {
        issueRows.push({ category, detail });
      }
    }

    const exclusionReasons = record(evidence['exclusionReasons']) ?? {};
    for (const detail of unique(
      Object.values(exclusionReasons).filter((value): value is string => typeof value === 'string'),
    )) {
      issueRows.push({ category: 'EXCLUDED_EVIDENCE', detail });
    }

    let unavailableMetricCount = 0;
    for (const publication of frozenPublications) {
      for (const value of Object.values(publication.normalizedMetrics)) {
        if (value === null || value === undefined) unavailableMetricCount += 1;
      }
    }
    if (unavailableMetricCount > 0) {
      issueRows.push({
        category: 'NULL_METRICS',
        detail: `${unavailableMetricCount} frozen metric value(s) are unavailable.`,
      });
    }

    return {
      analysisOperationKey,
      workflowRunId: workflow.id,
      status: workflow.status,
      currentStep: workflow.currentStep,
      analysisWindow: frozen.analysisWindow,
      measurementWindow,
      createdAt: workflow.createdAt.toISOString(),
      finishedAt: workflow.finishedAt?.toISOString() ?? null,
      insightCount: insightRows.length,
      generatedAt: this.now().toISOString(),
      businessOutcomes: {
        websiteVisits: { ...websiteVisits, sourceSystem: 'UMAMI' },
        signups: { ...signups, sourceSystem: 'VISION_APP' },
        activations: { ...activations, sourceSystem: 'VISION_APP' },
        customers: { ...customers, sourceSystem: 'VISION_APP' },
        revenueEvents: { ...revenueEvents, sourceSystem: 'VISION_APP' },
        revenueByCurrency:
          revenueAmountMinor !== null && revenueCurrency
            ? [{ currency: revenueCurrency, amountMinor: String(revenueAmountMinor) }]
            : [],
        attributionSummary: {
          directPublicationLinks: finite(frozenAttribution['directPublicationLinks']),
          inferredSignals: finite(frozenAttribution['inferredSignals']),
          unknownSignals: null,
        },
      },
      funnel: [
        {
          stage: 'CONTENT',
          value: frozenPublications.length,
          availability: 'OBSERVED',
          unit: 'publications',
        },
        {
          stage: 'WEBSITE',
          value: websiteVisits.total,
          availability: websiteVisits.total === null ? 'UNAVAILABLE' : 'OBSERVED',
          unit: null,
        },
        {
          stage: 'SIGNUP',
          value: signups.total,
          availability: signups.total === null ? 'UNAVAILABLE' : 'OBSERVED',
          unit: null,
        },
        {
          stage: 'ACTIVATION',
          value: activations.total,
          availability: activations.total === null ? 'UNAVAILABLE' : 'OBSERVED',
          unit: null,
        },
        {
          stage: 'CUSTOMER',
          value: customers.total,
          availability: customers.total === null ? 'UNAVAILABLE' : 'OBSERVED',
          unit: null,
        },
        {
          stage: 'REVENUE',
          value: revenueAmountMinor,
          availability:
            revenueAmountMinor === null || revenueCurrency === null ? 'UNAVAILABLE' : 'OBSERVED',
          unit:
            revenueAmountMinor === null || revenueCurrency === null
              ? null
              : `minor units ${revenueCurrency}`,
        },
      ],
      platformPerformance,
      contentSignals: insights
        .filter(
          (insight) =>
            (insight.dimensions['patternVersionIds'] ?? []).length > 0 ||
            (insight.dimensions['hookTypes'] ?? []).length > 0,
        )
        .map((insight) => ({
          insightId: insight.id,
          statement: insight.statement,
          confidence: insight.confidence,
          sampleSize: insight.citedSampleSize,
          measurementWindow: insight.measurementWindow,
          limitations: insight.limitations,
          patternVersionIds: insight.dimensions['patternVersionIds'] ?? [],
          hookTypes: insight.dimensions['hookTypes'] ?? [],
          platforms: insight.dimensions['platforms'] ?? [],
        })),
      contentContext,
      editingSignals: insights
        .filter((insight) => (insight.dimensions['editingProfileVersionIds'] ?? []).length > 0)
        .map((insight) => ({
          insightId: insight.id,
          statement: insight.statement,
          confidence: insight.confidence,
          sampleSize: insight.citedSampleSize,
          measurementWindow: insight.measurementWindow,
          limitations: insight.limitations,
          editingProfileVersionIds: insight.dimensions['editingProfileVersionIds'] ?? [],
        })),
      editingContext,
      insights,
      recommendations,
      experiments: experimentProjection(evidence['experimentContext']),
      dataQuality: {
        issues: issueRows,
        excludedPublicationCount: strings(evidence['excludedPublicationIds']).length,
        unavailableMetricCount,
      },
    };
  }

  transitionRecommendation(
    actor: Actor,
    recommendationId: string,
    next: 'ACCEPTED' | 'REJECTED' | 'EXECUTED',
  ) {
    return this.persistence.transaction(actor, async (unit) => {
      const row = await unit.learning.transitionRecommendation(recommendationId, next);
      return { id: row.id, status: row.status };
    });
  }

  createExperimentProposal(actor: Actor, recommendationId: string, campaignId?: string) {
    return this.persistence.transaction(actor, async (unit) => {
      const row = await unit.learning.createExperimentProposal(recommendationId, campaignId);
      return { experimentId: row.id, status: row.status, campaignId: row.campaignId };
    });
  }
}
