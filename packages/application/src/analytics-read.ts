import { manualTikTokOverdueAt, parseManualTikTokJobType } from '@vision/analytics';
import type { PrismaClient } from '@vision/database';

export type AnalyticsConfidenceCounts = {
  total: number;
  direct: number;
  inferred: number;
  unknown: number;
};

export type AnalyticsReadModel = {
  generatedAt: string;
  funnel: {
    websiteVisits: AnalyticsConfidenceCounts;
    signups: AnalyticsConfidenceCounts;
    activations: AnalyticsConfidenceCounts;
    customers: AnalyticsConfidenceCounts;
    revenueEvents: AnalyticsConfidenceCounts;
    revenueByCurrency: {
      currency: string;
      amountMinor: string;
      eventCount: number;
    }[];
  };
  attribution: AnalyticsConfidenceCounts;
  freshness: {
    latestEvidenceAt: string | null;
    ageSeconds: number | null;
    publicationsWithoutMeasurement: number;
  };
  quality: {
    states: { code: string; count: number }[];
  };
  platforms: {
    platform: string;
    publishedCount: number;
    measuredCount: number;
    latestCollectedAt: string | null;
    attribution: AnalyticsConfidenceCounts;
    warnings: string[];
  }[];
  publications: {
    publicationId: string;
    platform: string;
    accountName: string;
    title: string;
    campaignName: string;
    remoteUrl: string | null;
    publishedAt: string;
    measurement: null | {
      collectedAt: string;
      ageSeconds: number;
      windowKey: string | null;
      windowLabel: string;
      collectionMethod: string;
      metricSemanticsVersion: string;
      availabilityStatus: string;
      unavailableMetrics: string[];
      notes: string[];
      comparabilityNotes: string[];
      metrics: {
        views: string | null;
        engagedViews: string | null;
        reach: string | null;
        impressions: string | null;
        likes: string | null;
        comments: string | null;
        shares: string | null;
        saves: string | null;
        watchTimeMs: string | null;
        avgWatchDurationMs: number | null;
        avgWatchPercentage: number | null;
        completionRate: number | null;
        profileVisits: string | null;
        websiteClicks: string | null;
        follows: string | null;
      };
    };
    attribution: AnalyticsConfidenceCounts;
  }[];
  experiments: {
    id: string;
    name: string;
    hypothesis: string;
    primaryMetric: string | null;
    status: string;
    startedAt: string | null;
    endedAt: string | null;
    arms: {
      id: string;
      label: string;
      publicationId: string | null;
      conceptVersionId: string | null;
    }[];
  }[];
};

type Confidence = 'DIRECT' | 'INFERRED' | 'UNKNOWN';

const iso = (value: Date) => value.toISOString();

function emptyConfidenceCounts(): AnalyticsConfidenceCounts {
  return { total: 0, direct: 0, inferred: 0, unknown: 0 };
}

function addConfidence(target: AnalyticsConfidenceCounts, confidence: Confidence, count = 1) {
  target.total += count;
  if (confidence === 'DIRECT') target.direct += count;
  else if (confidence === 'INFERRED') target.inferred += count;
  else target.unknown += count;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function availability(value: unknown) {
  const record = jsonRecord(value);
  return {
    status: typeof record?.['status'] === 'string' ? record['status'] : 'AVAILABLE',
    unavailableMetrics: stringArray(record?.['unavailableMetrics']),
    notes: stringArray(record?.['notes']),
  };
}

function comparabilityNotes(value: unknown) {
  const record = jsonRecord(value);
  return stringArray(record?.['notes']);
}

function asString(value: bigint | null): string | null {
  return value === null ? null : value.toString();
}

function windowKeyFromJobType(jobType: string | undefined): string | null {
  if (!jobType) return null;
  const automated = /^ANALYTICS_COLLECT:[^:]+:(T_PLUS_(?:1H|6H|24H|72H|7D|30D))$/.exec(jobType);
  if (automated) return automated[1]!;
  const manual = /^ANALYTICS_MANUAL:TIKTOK:(T_PLUS_(?:24H|72H|7D))$/.exec(jobType);
  return manual?.[1] ?? null;
}

function windowLabel(windowKey: string | null) {
  return windowKey ? windowKey.replace('T_PLUS_', 'T+') : 'Mesure observée';
}

function platformDefaultWarning(platform: string) {
  if (platform === 'TIKTOK') {
    return 'TikTok V1 repose sur une saisie manuelle : ne pas assimiler ses métriques à une API temps réel.';
  }
  if (platform === 'YOUTUBE') {
    return 'Les métriques YouTube conservent leur sémantique provider et ne sont pas automatiquement comparables aux autres plateformes.';
  }
  return 'Les métriques Instagram conservent leur sémantique provider et ne sont pas automatiquement comparables aux autres plateformes.';
}

export class AnalyticsReadService {
  constructor(
    private readonly db: PrismaClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async overview(): Promise<AnalyticsReadModel> {
    const generatedAt = this.now();
    const [
      attributionGroups,
      revenueRows,
      publications,
      failedAnalyticsJobs,
      manualJobs,
      experiments,
    ] = await Promise.all([
      this.db.attributionEvent.groupBy({
        by: ['eventType', 'confidenceType'],
        where: {
          OR: [
            { eventType: 'WEBSITE_VISIT', sourceSystem: 'UMAMI' },
            {
              eventType: { in: ['SIGNUP', 'ACTIVATION', 'CUSTOMER', 'REVENUE'] },
              sourceSystem: 'VISION_APP',
            },
          ],
        },
        _count: { _all: true },
      }),
      this.db.attributionEvent.groupBy({
        by: ['valueCurrency'],
        where: {
          eventType: 'REVENUE',
          sourceSystem: 'VISION_APP',
          valueCurrency: { not: null },
        },
        _sum: { valueAmountMinor: true },
        _count: { _all: true },
        orderBy: { valueCurrency: 'asc' },
      }),
      this.db.publication.findMany({
        where: { status: 'PUBLISHED', publishedAt: { not: null } },
        orderBy: [{ publishedAt: 'desc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          publishedAt: true,
          remoteUrl: true,
          platformAccount: {
            select: { platform: true, displayName: true },
          },
          render: {
            select: {
              editingPlanVersion: {
                select: {
                  creativePlanVersion: {
                    select: {
                      scriptVersion: {
                        select: {
                          conceptVersion: { select: { title: true } },
                        },
                      },
                      creativePlan: {
                        select: {
                          concept: {
                            select: {
                              brief: {
                                select: {
                                  campaign: { select: { name: true } },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          normalizedMetrics: {
            orderBy: [{ collectedAt: 'desc' }, { id: 'desc' }],
            take: 1,
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
              availabilityJson: true,
              comparabilityJson: true,
              metricSemanticsVersion: true,
              rawSnapshot: {
                select: {
                  collectionOperationId: true,
                  collectionMethod: true,
                },
              },
            },
          },
        },
      }),
      this.db.jobAttempt.findMany({
        where: {
          failureCode: { not: null },
          workflowRun: { is: { workflowType: 'ANALYTICS' } },
        },
        select: { failureCode: true },
      }),
      this.db.jobAttempt.findMany({
        where: {
          status: 'QUEUED',
          queueName: 'vce-analytics-manual',
          jobType: { startsWith: 'ANALYTICS_MANUAL:TIKTOK:' },
          workflowRun: {
            is: { workflowType: 'ANALYTICS', rootEntityType: 'PublicationAnalytics' },
          },
        },
        select: {
          jobType: true,
          workflowRun: { select: { rootEntityId: true } },
        },
      }),
      this.db.experiment.findMany({
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: 20,
        select: {
          id: true,
          name: true,
          hypothesis: true,
          primaryMetric: true,
          status: true,
          startedAt: true,
          endedAt: true,
          arms: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              id: true,
              label: true,
              publicationId: true,
              conceptVersionId: true,
            },
          },
        },
      }),
    ]);

    const funnel = {
      websiteVisits: emptyConfidenceCounts(),
      signups: emptyConfidenceCounts(),
      activations: emptyConfidenceCounts(),
      customers: emptyConfidenceCounts(),
      revenueEvents: emptyConfidenceCounts(),
      revenueByCurrency: revenueRows.map((row) => ({
        currency: row.valueCurrency!,
        amountMinor: (row._sum.valueAmountMinor ?? 0n).toString(),
        eventCount: row._count._all,
      })),
    };
    const attribution = emptyConfidenceCounts();

    const stageByType = {
      WEBSITE_VISIT: funnel.websiteVisits,
      SIGNUP: funnel.signups,
      ACTIVATION: funnel.activations,
      CUSTOMER: funnel.customers,
      REVENUE: funnel.revenueEvents,
    } as const;

    for (const group of attributionGroups) {
      const count = group._count._all;
      addConfidence(attribution, group.confidenceType, count);
      addConfidence(stageByType[group.eventType], group.confidenceType, count);
    }

    const operationIds = publications.flatMap((publication) => {
      const latest = publication.normalizedMetrics[0];
      return latest ? [latest.rawSnapshot.collectionOperationId] : [];
    });
    const operationJobs =
      operationIds.length === 0
        ? []
        : await this.db.jobAttempt.findMany({
            where: { operationId: { in: operationIds } },
            select: { operationId: true, jobType: true },
          });
    const jobTypeByOperation = new Map(operationJobs.map((job) => [job.operationId, job.jobType]));

    const publicationIds = publications.map((publication) => publication.id);
    const publicationAttributionGroups =
      publicationIds.length === 0
        ? []
        : await this.db.attributionEvent.groupBy({
            by: ['publicationId', 'confidenceType'],
            where: {
              publicationId: { in: publicationIds },
              OR: [
                { eventType: 'WEBSITE_VISIT', sourceSystem: 'UMAMI' },
                {
                  eventType: { in: ['SIGNUP', 'ACTIVATION', 'CUSTOMER', 'REVENUE'] },
                  sourceSystem: 'VISION_APP',
                },
              ],
            },
            _count: { _all: true },
          });
    const attributionByPublication = new Map<string, AnalyticsConfidenceCounts>();
    for (const group of publicationAttributionGroups) {
      if (!group.publicationId) continue;
      const counts = attributionByPublication.get(group.publicationId) ?? emptyConfidenceCounts();
      addConfidence(counts, group.confidenceType, group._count._all);
      attributionByPublication.set(group.publicationId, counts);
    }

    const rows = publications.map((publication) => {
      const latest = publication.normalizedMetrics[0] ?? null;
      const available = availability(latest?.availabilityJson);
      const operationId = latest?.rawSnapshot.collectionOperationId;
      const windowKey = windowKeyFromJobType(
        operationId ? jobTypeByOperation.get(operationId) : undefined,
      );
      return {
        publicationId: publication.id,
        platform: publication.platformAccount.platform,
        accountName: publication.platformAccount.displayName,
        title:
          publication.render.editingPlanVersion.creativePlanVersion.scriptVersion.conceptVersion
            .title,
        campaignName:
          publication.render.editingPlanVersion.creativePlanVersion.creativePlan.concept.brief
            .campaign.name,
        remoteUrl: publication.remoteUrl,
        publishedAt: iso(publication.publishedAt!),
        measurement: latest
          ? {
              collectedAt: iso(latest.collectedAt),
              ageSeconds: Math.max(
                0,
                Math.floor((generatedAt.getTime() - latest.collectedAt.getTime()) / 1_000),
              ),
              windowKey,
              windowLabel: windowLabel(windowKey),
              collectionMethod: latest.rawSnapshot.collectionMethod,
              metricSemanticsVersion: latest.metricSemanticsVersion,
              availabilityStatus: available.status,
              unavailableMetrics: available.unavailableMetrics,
              notes: available.notes,
              comparabilityNotes: comparabilityNotes(latest.comparabilityJson),
              metrics: {
                views: asString(latest.views),
                engagedViews: asString(latest.engagedViews),
                reach: asString(latest.reach),
                impressions: asString(latest.impressions),
                likes: asString(latest.likes),
                comments: asString(latest.comments),
                shares: asString(latest.shares),
                saves: asString(latest.saves),
                watchTimeMs: asString(latest.watchTimeMs),
                avgWatchDurationMs: latest.avgWatchDurationMs,
                avgWatchPercentage: latest.avgWatchPercentage,
                completionRate: latest.completionRate,
                profileVisits: asString(latest.profileVisits),
                websiteClicks: asString(latest.websiteClicks),
                follows: asString(latest.follows),
              },
            }
          : null,
        attribution: attributionByPublication.get(publication.id) ?? emptyConfidenceCounts(),
      };
    });

    const qualityCounts = new Map<string, number>();
    const addQuality = (code: string, count = 1) => {
      qualityCounts.set(code, (qualityCounts.get(code) ?? 0) + count);
    };
    for (const job of failedAnalyticsJobs) {
      if (job.failureCode) addQuality(job.failureCode);
    }
    for (const row of rows) {
      const status = row.measurement?.availabilityStatus;
      if (status && status !== 'AVAILABLE') addQuality(status);
    }

    const publicationById = new Map(
      publications.map((publication) => [publication.id, publication]),
    );
    for (const job of manualJobs) {
      const workflowRun = job.workflowRun;
      if (!workflowRun) {
        addQuality('SCHEMA_DRIFT');
        continue;
      }

      const publication = publicationById.get(workflowRun.rootEntityId);
      if (!publication?.publishedAt) continue;
      try {
        const key = parseManualTikTokJobType(job.jobType);
        if (
          manualTikTokOverdueAt(publication.publishedAt, key).getTime() <= generatedAt.getTime()
        ) {
          addQuality('MANUAL_SNAPSHOT_OVERDUE');
        }
      } catch {
        addQuality('SCHEMA_DRIFT');
      }
    }

    const platformMap = new Map<
      string,
      {
        platform: string;
        publishedCount: number;
        measuredCount: number;
        latestCollectedAt: Date | null;
        attribution: AnalyticsConfidenceCounts;
        warnings: Set<string>;
      }
    >();
    for (const row of rows) {
      const current = platformMap.get(row.platform) ?? {
        platform: row.platform,
        publishedCount: 0,
        measuredCount: 0,
        latestCollectedAt: null,
        attribution: emptyConfidenceCounts(),
        warnings: new Set<string>(),
      };
      current.publishedCount += 1;
      if (row.measurement) {
        current.measuredCount += 1;
        const collected = new Date(row.measurement.collectedAt);
        if (!current.latestCollectedAt || collected > current.latestCollectedAt) {
          current.latestCollectedAt = collected;
        }
        for (const note of row.measurement.comparabilityNotes) current.warnings.add(note);
      }
      current.attribution.total += row.attribution.total;
      current.attribution.direct += row.attribution.direct;
      current.attribution.inferred += row.attribution.inferred;
      current.attribution.unknown += row.attribution.unknown;
      platformMap.set(row.platform, current);
    }

    const platforms = [...platformMap.values()]
      .sort((left, right) => left.platform.localeCompare(right.platform))
      .map((row) => ({
        platform: row.platform,
        publishedCount: row.publishedCount,
        measuredCount: row.measuredCount,
        latestCollectedAt: row.latestCollectedAt ? iso(row.latestCollectedAt) : null,
        attribution: row.attribution,
        warnings:
          row.warnings.size > 0 ? [...row.warnings] : [platformDefaultWarning(row.platform)],
      }));

    const latestEvidenceAt = rows.reduce<Date | null>((latest, row) => {
      if (!row.measurement) return latest;
      const value = new Date(row.measurement.collectedAt);
      return !latest || value > latest ? value : latest;
    }, null);

    return {
      generatedAt: iso(generatedAt),
      funnel,
      attribution,
      freshness: {
        latestEvidenceAt: latestEvidenceAt ? iso(latestEvidenceAt) : null,
        ageSeconds: latestEvidenceAt
          ? Math.max(0, Math.floor((generatedAt.getTime() - latestEvidenceAt.getTime()) / 1_000))
          : null,
        publicationsWithoutMeasurement: rows.filter((row) => row.measurement === null).length,
      },
      quality: {
        states: [...qualityCounts.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([code, count]) => ({ code, count })),
      },
      platforms,
      publications: rows,
      experiments: experiments.map((experiment) => ({
        id: experiment.id,
        name: experiment.name,
        hypothesis: experiment.hypothesis,
        primaryMetric: experiment.primaryMetric,
        status: experiment.status,
        startedAt: experiment.startedAt ? iso(experiment.startedAt) : null,
        endedAt: experiment.endedAt ? iso(experiment.endedAt) : null,
        arms: experiment.arms,
      })),
    };
  }
}
